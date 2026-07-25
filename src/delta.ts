import { join, relative, isAbsolute } from "node:path";
import { statSync } from "node:fs";
import type { DiffSpec } from "./engine.js";
import {
  isGitWorktree,
  resolveBaseRef,
  diffFiles,
  diffHunks,
  untrackedFiles,
  byStr,
  have,
  sh,
  compileGlobs,
  readText,
  sha1,
  computeDelta,
} from "./engine.js";
import type { DeltaResult as EngineDeltaResult, DeltaModule as EngineDeltaModule } from "./engine.js";
import { loadGraph, loadSymbols, loadManifest } from "./store.js";

// `delta`: map a git diff onto the index and hand back a risk-scored review
// panel. The scoring — changed files -> enclosing symbols -> blast radius ->
// reasons -> score — is deterministic graph work and now lives in the codeindex
// engine (`computeDelta`). Two things stay here because they are ultraindex's:
//
//   1. the STALENESS GATE. The engine computes against whatever graph it is
//      handed; ultraindex serves a PERSISTED index, so it must prove the index
//      still describes the bytes on disk before trusting a line-mapped symbol
//      attribution. A confidently wrong attribution is worse than "build first".
//   2. the ENCYCLOPEDIA DECORATION. Each scored module gains the path of the
//      entry an agent should read next — a concept the engine has no notion of.

export type { DeltaOptions, ChangedSymbol, DeltaChange } from "./engine.js";
export { RISK_WEIGHTS } from "./engine.js";

// The engine's module row plus the entry to open next.
export interface DeltaModule extends EngineDeltaModule {
  entry: string; // encyclopedia entry path
}

export interface DeltaResult extends Omit<EngineDeltaResult, "modules"> {
  modules: DeltaModule[];
}

export type DeltaError = { error: string; stale?: string[] };

const DEFAULT_DEPTH = 2;

// Attach the encyclopedia entry an agent should read next to every scored
// module. The engine has no notion of encyclopedias, so this is the one seam
// between its result and ultraindex's — exported so callers that compute a
// delta directly decorate it the same way `runDelta` does.
export function withEntries(res: EngineDeltaResult): DeltaResult {
  return { ...res, modules: res.modules.map((m) => ({ ...m, entry: `encyclopedia/${m.slug}.md` })) };
}

// Orchestrate: git plumbing → targeted staleness gate → computeDelta. Fails
// closed when any diff-touched, index-eligible file drifted from the manifest
// hashes — symbol line-mapping is only correct against a fresh index, and a
// confidently wrong attribution is worse than "run build first".
export function runDelta(outDir: string, repo: string, opts: { base?: string; staged?: boolean; depth?: number }): DeltaResult | DeltaError {
  if (!have("git")) return { error: "git is required for delta and was not found on PATH" };
  if (!isGitWorktree(repo)) return { error: `delta needs a git worktree — ${repo} is not inside one` };
  const graph = loadGraph(outDir);
  if (!graph) return { error: `no index at ${outDir} — run \`ultraindex build\` first` };
  const symbols = loadSymbols(outDir);
  const manifest = loadManifest(outDir);

  const notes: string[] = [];
  let base: DeltaResult["base"];
  if (opts.staged) {
    const head = sh("git", ["-C", repo, "rev-parse", "HEAD"]);
    if (!head.ok) return { error: "cannot resolve HEAD — empty repository?" };
    base = { ref: "HEAD", mergeBase: head.stdout.trim(), staged: true };
  } else {
    const r = resolveBaseRef(repo, opts.base);
    if ("error" in r) return { error: r.error };
    if (r.note) notes.push(r.note);
    base = { ref: r.ref, mergeBase: r.mergeBase, staged: false };
  }

  const spec: DiffSpec = opts.staged ? { staged: true } : { mergeBase: base.mergeBase };
  let files = diffFiles(repo, spec);
  if (!opts.staged) {
    const known = new Set(files.map((f) => f.path));
    for (const u of untrackedFiles(repo)) {
      if (!known.has(u)) files.push({ path: u, status: "added" });
    }
  }
  // The index dir itself may live inside the repo — its churn is not a change.
  const outRel = relative(repo, outDir);
  if (!isAbsolute(outRel) && !outRel.startsWith("..")) {
    const prefix = outRel.replace(/\/+$/, "") + "/";
    files = files.filter((f) => f.path !== outRel && !f.path.startsWith(prefix));
  }

  // Targeted staleness gate: hash only the diff-touched, index-eligible files.
  if (manifest) {
    const include = compileGlobs(manifest.scan?.include);
    const exclude = compileGlobs(manifest.scan?.exclude);
    const maxBytes = manifest.scan?.maxBytes ?? 1024 * 1024;
    const stale: string[] = [];
    for (const f of files) {
      if (f.status === "deleted") {
        if (manifest.fileHashes[f.path] !== undefined) stale.push(f.path);
        continue;
      }
      if (include && !include(f.path)) continue;
      if (exclude && exclude(f.path)) continue;
      const abs = join(repo, f.path);
      let text: string;
      try {
        const st = statSync(abs);
        if (!st.isFile() || st.size > maxBytes) continue;
        text = readText(abs);
      } catch {
        continue;
      }
      const recorded = manifest.fileHashes[f.path];
      if (recorded === undefined || sha1(text) !== recorded) stale.push(f.path);
    }
    if (stale.length) {
      stale.sort(byStr);
      return {
        error:
          `index is stale for ${stale.length} changed file(s) (${stale.slice(0, 5).join(", ")}) — ` +
          "run `ultraindex build` first",
        stale,
      };
    }
  }

  const res = computeDelta(graph, symbols, { files, hunks: diffHunks(repo, spec), base, notes }, opts.depth ?? DEFAULT_DEPTH);
  // The engine says "symbol index missing" because it cannot know what the
  // consumer calls that artifact. For an ultraindex user it has a filename and
  // a fix, so restore the actionable wording rather than passing the generic
  // one through.
  const decorated = withEntries(res);
  return {
    ...decorated,
    notes: decorated.notes.map((n) =>
      n === "symbol index missing — symbol-level attribution disabled"
        ? "symbols.json missing — symbol-level attribution disabled"
        : n,
    ),
  };
}

// The human panel. Stdout-only by design: delta output is ephemeral per-
// worktree state — agents persist it themselves with --json.
export function formatDeltaPanel(res: DeltaResult): string {
  const mb = res.base.mergeBase.slice(0, 7);
  const vs = `${res.base.staged ? "staged vs " : ""}${res.base.ref}`;
  if (!res.changes.length && !res.unindexed.length) {
    return `ultraindex: no changes vs ${vs} (merge-base ${mb})\n`;
  }
  const changedCount = res.changes.length + res.unindexed.length;
  const lines = [
    `ultraindex: delta vs ${vs} (merge-base ${mb}) — ${changedCount} changed file(s), ` +
      `${res.modules.length} module(s)${res.indexCommit ? `, index @ ${res.indexCommit}` : ""}`,
  ];
  for (const n of res.notes) lines.push(`  note: ${n}`);
  for (const m of res.modules) {
    lines.push(`  ${m.bucket.padEnd(6)} ${m.slug}  score ${m.score}${m.reasons.length ? ` — ${m.reasons.join("; ")}` : ""}`);
    const tests =
      m.tests.status === "gap" ? "GAP" : m.tests.status === "covered" ? `covered (${m.tests.files.length})` : "n/a";
    lines.push(`         open: ${m.open.join(", ") || "—"} · entry: ${m.entry} · tests: ${tests}`);
  }
  if (res.dangling.length) {
    lines.push(`  dangling:  ${res.dangling.map((d) => `${d.spec} (from ${d.from})`).join(" · ")}`);
  }
  if (res.deleted.length) lines.push(`  deleted:   ${res.deleted.join(", ")}`);
  if (res.unindexed.length) lines.push(`  unindexed: ${res.unindexed.join(", ")}`);
  const top = res.modules.find((m) => m.bucket !== "LOW");
  if (top) {
    lines.push(`  next: dossier ${top.slug} · impact ${top.open[0] ?? top.slug} --json · ground findings, then check --answer`);
  }
  return lines.join("\n") + "\n";
}
