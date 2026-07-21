// Single source of truth for the version the CLI/bundle reports. Kept in
// lockstep with package.json and both SKILL.md files by scripts/sync-version.mjs
// during a semantic-release run. Do not edit by hand outside a release.
export const VERSION = "5.1.0";

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

// Identifies the extraction engine's output shape independently of the artifact
// schema. The incremental build cache keys reused FileRecords on (content hash,
// EXTRACTOR_VERSION); bump this whenever symbol/import extraction changes so a
// stale cache is discarded wholesale rather than mixing old and new records. v3
// adds FileRecord.calls (call-site callee names) and importedNames; v4 adds
// CommonJS assignment-style JS/TS definitions (`x.y = function () {}`).
export const EXTRACTOR_VERSION = 4;

// How a file is classified for the encyclopedia. `code` gets symbol/import
// extraction; `doc` gets link/heading extraction; the rest are catalogued but
// not deeply parsed.
export type FileKind = "code" | "doc" | "config" | "asset" | "other";

// Edge kinds in the link-graph. `contains` is the module→member hierarchy;
// `doc-link` a markdown link; `import` a resolved local code import; `call` a
// resolved cross-file function/method/constructor call (a global second pass over
// collected call sites); `use` a code file referencing another file's unique
// exported symbol (AST-derived, suppressed when an `import` or `call` edge already
// covers the same pair); `mention` a doc naming an exported symbol.
export type EdgeKind = "contains" | "doc-link" | "import" | "call" | "use" | "mention";

// Dependency tier, mirroring reconstruct's model: 0 = foundations (types, utils,
// config), 1 = features, 2 = tail (tests, docs, examples, scripts).
export type Tier = 0 | 1 | 2;

// A symbol extracted deterministically from source (no LLM). Shape matches the
// lifted lang/* extractors. Feeds the code view and the symbol half of `find`.
export interface CodeSymbol {
  name: string;
  kind: string; // function | class | method | const | type | interface | enum | struct | trait | def
  file: string; // relative to repo root
  line: number; // 1-based
  endLine?: number; // 1-based end of the declaration node (AST extractor only)
  parent?: string; // enclosing symbol name for a nested member (AST extractor only)
  signature?: string;
  exported: boolean;
  lang: string;
}

// A raw, UNRESOLVED outbound reference found in a file: a markdown link target,
// or an import specifier as written. Resolution to a real file happens later in
// the graph builder, which is where language/path context lives.
export interface RawRef {
  kind: "doc-link" | "import";
  spec: string; // the target/specifier exactly as written
}

// Everything extracted from one file in a single pass. The unit the graph and
// renderers consume; nothing here requires the model.
export interface FileRecord {
  rel: string; // posix path relative to repo root
  ext: string;
  size: number;
  lines: number;
  hash: string; // sha1 of content — the staleness oracle
  kind: FileKind;
  lang: string;
  title?: string; // markdown H1, or basename for code
  summary?: string; // one-line: first doc paragraph / top doc-comment
  headings: string[]; // markdown section headings
  symbols: CodeSymbol[]; // declared symbols (capped per file)
  refs: RawRef[]; // unresolved outbound links/imports
  pkg?: string; // Java: the file's `package` declaration — anchors source roots
  idents?: string[]; // distinctive identifiers referenced (transient — feeds `use` edges, not persisted)
  // Unresolved call-site callee names (cap 512, deduped by name+line, sorted by
  // name then line). Transient-ish: consumed by the graph builder's global call
  // resolution pass, not surfaced in the graph itself.
  calls?: { name: string; line: number }[];
  // JS/TS named-import bindings (cap 256, deduped, sorted) — feeds the JS/TS
  // import-evidence gate in call resolution.
  importedNames?: string[];
}

// A node in the link-graph. Files and modules are both nodes; `find`/`neighbors`
// traverse the file-level graph, while INDEX.md/Mermaid show module nodes only.
export interface FileNode {
  id: string; // == rel
  kind: "file";
  rel: string;
  fileKind: FileKind;
  lang: string;
  module: string; // owning module slug
  title?: string;
  summary?: string;
  symbols: number;
  lines: number;
  degIn: number;
  degOut: number;
  // File-graph PageRank scaled by the file count (average file ≈ 1.0), 4 dp.
  // Absent only on graphs built before centrality existed.
  pagerank?: number;
  // Present (true) only when the path classifies as a test file (tests-map.ts).
  testFile?: true;
}

export interface ModuleNode {
  id: string; // == slug
  kind: "module";
  slug: string;
  path: string; // directory path (or "(root)")
  title: string;
  summary: string;
  tier: Tier;
  members: string[]; // member file rels, sorted
  symbols: number; // total declared symbols across members
  degIn: number;
  degOut: number;
  // Navigation community (a Louvain cluster of related modules), 0-based; id 0 is
  // the largest cluster. OPTIONAL/additive: never affects slugs or lexical
  // ranking; used only to bias `find`'s graph-expansion ordering (and shown in
  // INDEX.md). Absent only on graphs built before communities existed.
  community?: number;
  // Module-graph PageRank scaled by the module count (average ≈ 1.0), 4 dp.
  pagerank?: number;
  // Normalized undirected Brandes betweenness, [0,1], 6 dp. Absent when the
  // BETWEENNESS_MAX_NODES guard skipped the pass (see the manifest note).
  betweenness?: number;
  // Sorted test-file rels with a resolved import/call/use edge into a member —
  // "which tests cover this module". Absent when none do.
  testedBy?: string[];
}

// A directed edge. For a resolved edge `to` is a node id; for a dangling edge
// `to` is the unresolved spec and `dangling` is set with a `reason`.
export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  dangling?: boolean;
  reason?: string;
  // Only `call` edges set this. extracted = an import between the files
  // corroborates the call; inferred = resolved by a unique name match without
  // import evidence.
  confidence?: "extracted" | "inferred";
}

// The full machine graph, persisted as graph.json. Holds BOTH file-level and
// module-level nodes/edges; never loaded wholesale into the model. Deliberately
// carries NO wall-clock timestamp so two builds of an unchanged repo are
// byte-identical (the volatile `builtAt` lives in the manifest instead).
export interface Graph {
  schemaVersion: number;
  version: string;
  commit?: string; // stable for a given HEAD
  fileCount: number;
  languages: Record<string, number>;
  files: FileNode[];
  modules: ModuleNode[];
  fileEdges: Edge[];
  moduleEdges: Edge[];
  // Surprising cross-community couplings (see surprise.ts), capped and sorted
  // (pairEdges asc, from, to). Absent when none were found.
  surprises?: SurpriseEdge[];
}

// A dependency edge that is one of at most 2 links between two otherwise-
// separate communities — an architectural leak worth extra review attention.
export interface SurpriseEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  communities: [number, number]; // [community(from), community(to)]
  pairEdges: number; // total module edges between the two communities
}

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
  scan?: { include?: string[]; exclude?: string[]; maxBytes?: number; maxFiles?: number };
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

// A persisted symbol table (symbols.json), emitted at build so `symbols <name>`
// can answer "where is X defined?" without re-scanning the repo. `defs` maps a
// symbol name to its definition sites; `refs` maps a name to the files that
// reference it (populated by the use/mention pass). Deterministically ordered.
export interface SymbolIndex {
  schemaVersion: number;
  // `endLine` mirrors CodeSymbol.endLine (AST extractor only) — `delta` uses it
  // to map changed line ranges to their enclosing symbols.
  defs: Record<
    string,
    { file: string; line: number; endLine?: number; kind: string; exported: boolean; lang: string; parent?: string }[]
  >;
  refs: Record<string, string[]>;
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
