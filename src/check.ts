import { dirname, join } from "node:path";
import type { CheckResult, Manifest, VerifyResult } from "./types.js";
import { loadVerify, buildClaimPairs } from "./verify.js";
import { walk, readText } from "./walk.js";
import { sha1 } from "./hash.js";
import { compileGlobs } from "./glob.js";
import { loadGraph, loadManifest, indexPaths } from "./store.js";
import { readIfExists } from "./output.js";
import { byStr } from "./sort.js";
import { parseRegions } from "./merge.js";
import { checkCitations, fileLineTable } from "./cite.js";
import { loadVectors, staleVectorSlugs } from "./vectors.js";

// Hash every file in the repo the way the build did — SAME out-dir exclusion and
// SAME include/exclude/max-bytes filters (read back from the manifest) — so
// staleness compares content, not git status, and a filtered build isn't reported
// as perpetually stale. Lighter than a full scan: just content hashes.
function hashRepo(repo: string, outAbs: string, filters: Manifest["scan"]): Record<string, string> {
  const outPrefix = outAbs.replace(/\/+$/, "") + "/";
  const include = compileGlobs(filters?.include);
  const exclude = compileGlobs(filters?.exclude);
  const out: Record<string, string> = {};
  for (const f of walk(repo, { maxFileBytes: filters?.maxBytes })) {
    if (f.abs === outAbs || f.abs.startsWith(outPrefix)) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;
    out[f.rel] = sha1(readText(f.abs));
  }
  return out;
}

// Report whether the index is fresh (vs the current repo) and structurally
// sound. Exit-code policy (in the CLI): non-zero on stale OR errors.
export function runCheck(outDir: string, repo: string): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const graph = loadGraph(outDir);
  const manifest = loadManifest(outDir);
  if (!graph) errors.push("graph.json is missing or written by an incompatible engine version");
  if (!manifest) errors.push("manifest.json is missing or written by an incompatible engine version");
  if (!graph || !manifest) {
    return { ok: false, stale: false, changed: [], added: [], removed: [], errors, warnings };
  }

  // Staleness: compare current content hashes against the manifest, hashing the
  // same filtered file set the build used.
  const current = hashRepo(repo, outDir, manifest.scan);
  const recorded = manifest.fileHashes;
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const rel of Object.keys(current)) {
    if (!(rel in recorded)) added.push(rel);
    else if (current[rel] !== recorded[rel]) changed.push(rel);
  }
  for (const rel of Object.keys(recorded)) if (!(rel in current)) removed.push(rel);
  changed.sort(byStr);
  added.sort(byStr);
  removed.sort(byStr);

  // Integrity: every module has an entry; resolved edges point at real nodes.
  const enc = indexPaths(outDir).encyclopedia;
  for (const m of graph.modules) {
    if (readIfExists(join(enc, `${m.slug}.md`)) === undefined) {
      errors.push(`module "${m.slug}" has no encyclopedia entry`);
    }
  }
  const nodes = new Set(graph.files.map((f) => f.rel));
  for (const e of graph.fileEdges) {
    if (!e.dangling && !nodes.has(e.to)) errors.push(`edge ${e.from} → ${e.to} (${e.kind}) points at a non-existent node`);
  }

  // Grounding: every citation an agent wrote in a `ui:human` region must resolve
  // to a real file/line in the index. This is the blocking anti-hallucination
  // guard — bad citation ⇒ broken index ⇒ non-zero exit.
  const fileLines = fileLineTable(graph);
  for (const m of graph.modules) {
    const text = readIfExists(join(enc, `${m.slug}.md`));
    if (!text) continue;
    const parsed = parseRegions(text);
    if (!parsed.ok) {
      // Fail CLOSED, not open: unparseable fences must NOT silently skip citation
      // validation (that would let a bad citation through whenever a hand-edit
      // mangles a fence). Mirrors build's "unparseable region fences" conflict.
      errors.push(
        `encyclopedia/${m.slug}.md: unparseable region fences — each <!-- ui:human key=… --> / <!-- /ui:human key=… --> marker must be on its own line; fix the fences and re-run \`ultraindex build\``,
      );
      continue;
    }
    for (const r of parsed.regions) {
      if (r.type !== "human") continue;
      for (const u of checkCitations(r.body, fileLines).unresolved) {
        errors.push(`encyclopedia/${m.slug}.md [${r.key}]: citation [${u.citation.raw}] — ${u.reason}`);
      }
    }
  }

  // Optional semantic layer: stale vectors degrade ranking but never break
  // `find`, so drift is a warning, not a failure. Hash comparison only — this
  // never touches the network.
  const vectors = loadVectors(outDir);
  if (vectors) {
    if (!vectors.model || !vectors.dim) {
      warnings.push("vectors.json is corrupt (missing model/dim) — re-run `ultraindex embed`");
    } else {
      const staleVecs = staleVectorSlugs(outDir, graph, vectors);
      if (staleVecs.length) {
        warnings.push(`vectors.json stale for ${staleVecs.length} module(s) — run \`ultraindex embed\` to refresh`);
      }
    }
  }

  // Preserved-prose situations are warnings, not failures.
  for (const slug of manifest.orphaned) {
    warnings.push(`orphaned prose kept at encyclopedia/_orphaned/${slug}.md (module removed)`);
  }
  for (const note of manifest.notes) {
    if (/conflict|unparseable/i.test(note)) warnings.push(note);
  }

  const stale = changed.length + added.length + removed.length > 0;
  return { ok: errors.length === 0 && !stale, stale, changed, added, removed, errors, warnings };
}

export interface AnswerCheck {
  ok: boolean;
  citations: number;
  resolved: number;
  errors: string[];
  warnings?: string[];
  semantic?: VerifyResult; // populated only by `check --semantic` (folds VERIFY.json)
}

// Validate an answer file's citations against the index — the Q&A grounding
// gate. Requires at least one citation and that all of them resolve. With
// `opts.semantic`, ALSO folds the VERIFY.json verdicts written next to the
// answer (fails on a refuted/unsupported claim) — additive: plain `checkAnswer`
// (no opts) is unchanged.
export function checkAnswer(outDir: string, answerPath: string, opts: { semantic?: boolean; repo?: string } = {}): AnswerCheck {
  const errors: string[] = [];
  const graph = loadGraph(outDir);
  if (!graph) return { ok: false, citations: 0, resolved: 0, errors: ["no index — run `ultraindex build` first"] };
  const text = readIfExists(answerPath);
  if (text === undefined) return { ok: false, citations: 0, resolved: 0, errors: [`answer file not found: ${answerPath}`] };

  const cc = checkCitations(text, fileLineTable(graph));
  const attempts = cc.resolved.length + cc.unresolved.length;
  if (attempts === 0) errors.push("answer has no citations — cite every claim with [file:line] (bare brackets, not a markdown link)");
  for (const u of cc.unresolved) errors.push(`citation [${u.citation.raw}] — ${u.reason}`);

  const result: AnswerCheck = { ok: errors.length === 0, citations: attempts, resolved: cc.resolved.length, errors };
  if (opts.semantic) {
    const warnings: string[] = [];
    const sem = loadVerify(dirname(answerPath));
    if (!sem) {
      warnings.push("--semantic: no VERIFY.json next to the answer — run `verify` then `verify --apply <verdicts.json>` first; semantic gate skipped.");
    } else {
      result.semantic = sem;
      if (!sem.ok) {
        result.ok = false;
        errors.push(`semantic verification failed: ${sem.failures.length} claim(s) refuted or unsupported by their cited excerpt (see VERIFY.json)`);
      }
      // Coverage guard: the gate can only attest to what VERIFY.json adjudicated.
      // Size "expected" the SAME way verify does (claim units with a resolvable,
      // readable excerpt) — NOT the raw mechanical citation count, which also counts
      // citations in headings or to empty files that verify can never pair (those
      // would otherwise demand a worklist that always comes back empty). An empty
      // verdicts set against real verifiable pairs must not read as "verified".
      // Use the SAME repo `verify` resolved its excerpts from (explicit --repo wins,
      // else the manifest's recorded root) so `expected` and `sem.pairs` count the
      // same content — otherwise --repo could spuriously warn/fail the gate.
      const repoRoot = opts.repo ?? loadManifest(outDir)?.repo;
      const expected = repoRoot ? buildClaimPairs(text, repoRoot).length : 0;
      if (sem.pairs === 0 && expected > 0) {
        result.ok = false;
        errors.push(
          `--semantic: VERIFY.json adjudicates 0 pair(s) but the answer has ${expected} verifiable claim↔citation pair(s) — the answer was not actually verified; re-run \`verify\` on a fresh worklist`,
        );
      } else if (sem.pairs < expected) {
        warnings.push(
          `--semantic: VERIFY.json covers ${sem.pairs} of ${expected} verifiable pair(s) — coverage may be stale or worklist-capped; re-run \`verify\` if the answer changed`,
        );
      }
      if (sem.unadjudicated?.length) warnings.push(`${sem.unadjudicated.length} claim(s) not fully adjudicated by verify`);
    }
    if (warnings.length) result.warnings = warnings;
  }
  return result;
}
