import { join } from "node:path";
import type { CheckResult } from "./types.js";
import { walk, readText } from "./walk.js";
import { sha1 } from "./hash.js";
import { loadGraph, loadManifest, indexPaths } from "./store.js";
import { readIfExists } from "./output.js";
import { byStr } from "./sort.js";

// Hash every file in the repo the way the build did (same out-dir exclusion),
// so staleness compares content, not git status. Lighter than a full scan — no
// symbol/link extraction, just content hashes.
function hashRepo(repo: string, outAbs: string): Record<string, string> {
  const outPrefix = outAbs.replace(/\/+$/, "") + "/";
  const out: Record<string, string> = {};
  for (const f of walk(repo)) {
    if (f.abs === outAbs || f.abs.startsWith(outPrefix)) continue;
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

  // Staleness: compare current content hashes against the manifest.
  const current = hashRepo(repo, outDir);
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
