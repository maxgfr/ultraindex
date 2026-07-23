import type { FileRecord, Tier } from "./engine.js";

// Single source of truth for the version the CLI/bundle reports. Kept in
// lockstep with package.json and both SKILL.md files by scripts/sync-version.mjs
// during a semantic-release run. Do not edit by hand outside a release.
export const VERSION = "5.2.1";

// Bumped whenever the on-disk artifact shape changes, so `check`/nav can reject
// an index written by an incompatible engine instead of misreading it. v2 adds
// symbols.json, the `use` edge kind, per-symbol parent/endLine, and the
// extraction cache; v3 adds the `call` edge kind, `Edge.confidence`,
// `ModuleNode.community` (graph.json), and `Manifest.communities` (manifest.json)
// — the community fields are additive/optional, so they share the same bump. v4
// adds node centrality (`pagerank`/`betweenness`), the tests→code fields
// (`FileNode.testFile`/`ModuleNode.testedBy`), and symbols.json `endLine` —
// `delta` relies on these, so a v3 index must be rejected, not half-read. An
// index written by an incompatible engine can't be read, so `check` asks for a
// rebuild.
export const SCHEMA_VERSION = 4;

// ---------------------------------------------------------------------------
// Engine-owned types and constants. The deterministic core (scan → extract →
// resolve → graph → analytics → graph.json/symbols.json) lives in the vendored
// codeindex engine; its data shapes are re-exported here so downstream files
// keep importing from "./types.js" unchanged. EXTRACTOR_VERSION now tracks the
// ENGINE's extraction pipeline — a vendored-engine bump that changes extraction
// output discards the incremental cache wholesale, exactly as before.
// ---------------------------------------------------------------------------
export type {
  FileKind,
  EdgeKind,
  Tier,
  CodeSymbol,
  RawRef,
  FileRecord,
  FileNode,
  ModuleNode,
  Edge,
  Graph,
  SurpriseEdge,
  SymbolIndex,
} from "./engine.js";
export { EXTRACTOR_VERSION } from "./engine.js";

// Per-build bookkeeping, persisted as manifest.json. The staleness oracle
// (content hashes) and the merge memory (which modules existed, which human
// region keys each entry carried).
export interface Manifest {
  schemaVersion: number;
  version: string;
  commit?: string;
  builtAt: string;
  repo: string; // absolute repo root — lets dossier/ask/check default --repo correctly
  out: string; // out dir, relative to repo when possible
  fileHashes: Record<string, string>; // rel -> sha1 of content
  modules: Record<string, { members: string[]; humanKeys: string[] }>;
  orphaned: string[]; // module slugs whose prose was moved to _orphaned/
  notes: string[]; // merge conflicts and other build-time warnings
  // Navigation communities from the last build: community-id string → sorted
  // member slugs. OPTIONAL/additive; the next build reads it to keep community ids
  // stable across small edits (see detectCommunities' remap-to-previous rule).
  communities?: Record<string, string[]>;
  // The file-selection filters the build applied, when any — so `check` can hash
  // the SAME file set and not report a filtered build as perpetually stale.
  // `gitignore: false` records a --no-gitignore build for the same reason.
  scan?: { include?: string[]; exclude?: string[]; maxBytes?: number; maxFiles?: number; gitignore?: boolean };
}

// Resolved options for a `build`.
export interface BuildOptions {
  repo: string; // absolute path to the repo
  out: string; // absolute path to the output dir
  include?: string[];
  exclude?: string[];
  maxBytes?: number;
  maxFiles?: number;
  noCache?: boolean;
  // Re-read and re-hash every file, disabling the (size,mtime) stat fastpath — the
  // escape hatch when a content edit might have preserved both size and mtime.
  fullHash?: boolean;
  // false = --no-gitignore: index files .gitignore would hide. The engine's walk
  // honors .gitignore by default (undefined/true).
  gitignore?: boolean;
  mermaid: boolean;
  json: boolean;
}

// The extraction cache (cache.json): per-file content hash → the FileRecord that
// extraction produced. On the next build, a file whose content hash is unchanged
// reuses its record and skips re-parsing (the expensive AST step). Keyed by
// EXTRACTOR_VERSION so an engine change discards the whole cache rather than
// mixing old and new records. Not part of the index; safe to delete or gitignore.
export interface ExtractionCache {
  schemaVersion: number;
  extractorVersion: number;
  // `size`/`mtimeMs` are the stat fastpath's key: on the next build a NON-DOC file
  // whose size AND mtime both match its cache entry reuses `record` without being
  // read or hashed. OPTIONAL/additive — a cache written before the fastpath (or an
  // entry missing either field) simply falls through to the content-hash check.
  files: Record<string, { hash: string; record: FileRecord; size?: number; mtimeMs?: number }>;
}

// One result row from `find`: the module, why it matched, and — crucially — the
// exact source files the agent should open.
export interface FindResult {
  slug: string;
  path: string;
  title: string;
  tier: Tier;
  score: number;
  matched: string[]; // query terms that hit
  files: string[]; // exact source files to open, best-first
  neighbors: string[]; // related module slugs
  enriched: boolean; // the entry carries verified human analysis — higher-trust
  semanticRank?: number; // 1-based rank in the cosine list, only when hybrid ran
  // How an APPENDED row (beyond the ranked top-k) reached the result set:
  // "term" = a per-query-term guarantee (a module below top-k that solely covers
  // a query term); "graph" = discovered by expanding the graph neighbourhood of a
  // strong hit. Absent on a normal ranked row.
  via?: "graph" | "term";
}

// Connection details for an OpenAI-compatible /v1/embeddings provider. Read
// from env or <out>/semantic.json — when absent, the semantic layer is off and
// the engine never touches the network.
export interface SemanticConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

// Optional per-module embedding store, persisted as vectors.json. Excluded from
// the byte-identical reproducibility guarantee (floats depend on the provider/
// model). `hash` is the sha1 of the exact text embedded — the staleness oracle.
export interface VectorStore {
  schemaVersion: number;
  model: string;
  dim: number;
  vectors: Record<string, { hash: string; v: number[] }>; // slug -> embedded-text hash + vector
}

// Summary of an `embed` run.
export interface EmbedReport {
  model: string;
  dim: number;
  total: number; // modules in the graph
  embedded: number; // freshly embedded this run
  reused: number; // unchanged, vector kept
  removed: number; // slugs pruned (module gone from the graph)
}

// One file's staleness verdict from `check`.
export type FileStatus = "unchanged" | "changed" | "added" | "removed";

export interface CheckResult {
  ok: boolean;
  stale: boolean;
  changed: string[];
  added: string[];
  removed: string[];
  errors: string[]; // integrity failures (broken index)
  warnings: string[]; // orphaned prose, merge conflicts, etc.
}

// ---------------------------------------------------------------------------
// Semantic claim verification (`verify` + `check --answer --semantic`). The
// mechanical answer gate proves a `[file:line]` citation RESOLVES to a real
// file/range; `verify` asks whether the cited EXCERPT actually SUPPORTS the
// claim. `verify` emits ClaimEvidencePair[] (a worklist); an agent fills a
// Verdict per pair; `verify --apply` / `check --semantic` then FAIL on a
// refuted/unsupported claim — additive, never relaxing the resolution gate.
// ---------------------------------------------------------------------------
export type VerdictKind = "supported" | "partial" | "refuted" | "unsupported";

export interface ClaimEvidencePair {
  claimId: string; // "C1", "C2", …
  claim: string; // the claim-unit text (capped)
  citation: string; // the cited token, e.g. "src/retry.ts:2" or "src/x.ts:10-20"
  path: string; // the cited file (repo-relative)
  digest: string; // the cited excerpt read from the repo
}

export interface Verdict extends ClaimEvidencePair {
  verdict: VerdictKind;
  note: string;
}

export interface VerifyResult {
  ok: boolean;
  pairs: number;
  adjudicated: number;
  supported: number;
  partial: number;
  refuted: number;
  unsupported: number;
  failures: { claimId: string; citation: string; verdict: VerdictKind; note: string }[];
  unadjudicated: string[];
  verdicts?: Verdict[];
}
