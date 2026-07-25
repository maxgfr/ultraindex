import { SCHEMA_VERSION, VERSION } from "../types.js";
import type { Graph, Manifest, ProseState } from "../types.js";
import type { RepoScan } from "../engine.js";
import { byStr } from "../engine.js";
import type { SyncResult } from "../entries.js";
import { proseSourceHash } from "../prose.js";

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
  filters: { include?: string[]; exclude?: string[]; maxBytes?: number; maxFiles?: number; gitignore?: boolean } = {},
  prev?: Manifest,
): Manifest {
  const fileHashes: Record<string, string> = {};
  for (const f of scan.files) fileHashes[f.rel] = f.hash;

  const modules: Record<string, { members: string[]; humanKeys: string[]; prose?: ProseState }> = {};
  for (const m of graph.modules) {
    const entry: { members: string[]; humanKeys: string[]; prose?: ProseState } = {
      members: m.members,
      humanKeys: (sync.humanKeys[m.slug] ?? []).slice().sort(byStr),
    };
    const digest = sync.proseDigests[m.slug];
    if (digest) {
      // Rename-aware lookup: prose that migrated from a predecessor inherits
      // that predecessor's source pointer, so a rename cannot launder staleness.
      const from = sync.migrations[m.slug];
      const prevMod = prev?.modules[m.slug] ?? (from ? prev?.modules[from] : undefined);
      // The digest is unchanged ⇒ nobody touched the prose ⇒ keep pointing at
      // the source it was actually written against, even though the source may
      // have moved underneath it. A moved digest means it was edited since the
      // last build, so it was written against the source as of now.
      const carried = prevMod?.prose?.digest === digest ? prevMod.prose.source : undefined;
      entry.prose = { digest, source: carried ?? proseSourceHash(m.members, fileHashes) };
    }
    modules[m.slug] = entry;
  }

  // NOTE on prose baselining. Prose already on disk when this feature shipped
  // gets its source state stamped from the CURRENT state, asserting it was
  // written against source it may never have seen. We deliberately do NOT emit a
  // note for that: from inside a build, "prose that predates tracking" and
  // "prose the user just wrote between two builds" are indistinguishable — both
  // are enriched-on-disk with no manifest record — so any note would fire on
  // ordinary first enrichment and train people to ignore it. The honest signal
  // lives in `check` instead, which reports an enriched entry with no recorded
  // source state as `proseUnknown` rather than as fresh.

  // Navigation communities: community-id string → sorted member slugs. Recorded so
  // the next build can remap ids and keep them stable across a small edit. Only
  // emitted when a community was actually assigned (keeps a pre-community manifest
  // shape when none exist).
  const communityMembers = new Map<number, string[]>();
  for (const m of graph.modules) {
    if (m.community === undefined) continue;
    (communityMembers.get(m.community) ?? communityMembers.set(m.community, []).get(m.community)!).push(m.slug);
  }
  const communities: Record<string, string[]> = {};
  for (const [id, members] of communityMembers) communities[String(id)] = members.slice().sort(byStr);

  // Only record the filters when the build actually applied some, so the common
  // unfiltered manifest stays byte-stable.
  const scanFilters: Manifest["scan"] = {};
  if (filters.include?.length) scanFilters!.include = filters.include;
  if (filters.exclude?.length) scanFilters!.exclude = filters.exclude;
  if (filters.maxBytes !== undefined) scanFilters!.maxBytes = filters.maxBytes;
  if (filters.maxFiles !== undefined) scanFilters!.maxFiles = filters.maxFiles;
  // Only a --no-gitignore build is recorded — the default (gitignore honored)
  // keeps the manifest shape unchanged.
  if (filters.gitignore === false) scanFilters!.gitignore = false;

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
    ...(Object.keys(communities).length ? { communities: sortedRecord(communities) } : {}),
    ...(Object.keys(scanFilters!).length ? { scan: scanFilters } : {}),
  };
}

export function renderManifestJson(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}
