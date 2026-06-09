import { SCHEMA_VERSION, VERSION } from "../types.js";
import type { Graph, Manifest } from "../types.js";
import type { RepoScan } from "../scan.js";
import type { SyncResult } from "../entries.js";
import { byStr } from "../sort.js";

function sortedRecord<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort(byStr)) out[k] = obj[k]!;
  return out;
}

// Assemble the manifest: per-file content hashes (the staleness oracle) plus the
// module → members / human-region-keys map (the merge memory) and any build
// notes. `builtAt` is the only volatile field and lives ONLY here, never in the
// graph or the rendered markdown, so those stay byte-stable.
export function buildManifest(
  scan: RepoScan,
  graph: Graph,
  outRel: string,
  sync: SyncResult,
  builtAt: string,
  extraNotes: string[] = [],
): Manifest {
  const fileHashes: Record<string, string> = {};
  for (const f of scan.files) fileHashes[f.rel] = f.hash;

  const modules: Record<string, { members: string[]; humanKeys: string[] }> = {};
  for (const m of graph.modules) {
    modules[m.slug] = { members: m.members, humanKeys: (sync.humanKeys[m.slug] ?? []).slice().sort(byStr) };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    version: VERSION,
    commit: scan.commit,
    builtAt,
    repo: scan.root,
    out: outRel,
    fileHashes: sortedRecord(fileHashes),
    modules: sortedRecord(modules),
    orphaned: sync.orphaned.slice().sort(byStr),
    notes: [...extraNotes, ...sync.notes],
  };
}

export function renderManifestJson(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}
