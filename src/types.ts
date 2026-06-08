// Single source of truth for the version the CLI/bundle reports. Kept in
// lockstep with package.json and both SKILL.md files by scripts/sync-version.mjs
// during a semantic-release run. Do not edit by hand outside a release.
export const VERSION = "0.0.0";

// Bumped whenever the on-disk artifact shape changes, so `check`/nav can reject
// an index written by an incompatible engine instead of misreading it.
export const SCHEMA_VERSION = 1;

// How a file is classified for the encyclopedia. `code` gets symbol/import
// extraction; `doc` gets link/heading extraction; the rest are catalogued but
// not deeply parsed.
export type FileKind = "code" | "doc" | "config" | "asset" | "other";

// Edge kinds in the link-graph. `contains` is the module→member hierarchy;
// `doc-link` a markdown link; `import` a resolved local code import; `mention` a
// doc naming an exported symbol.
export type EdgeKind = "contains" | "doc-link" | "import" | "mention";

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
}

// Per-build bookkeeping, persisted as manifest.json. The staleness oracle
// (content hashes) and the merge memory (which modules existed, which human
// region keys each entry carried).
export interface Manifest {
  schemaVersion: number;
  version: string;
  commit?: string;
  builtAt: string;
  out: string; // out dir, relative to repo when possible
  fileHashes: Record<string, string>; // rel -> sha1 of content
  modules: Record<string, { members: string[]; humanKeys: string[] }>;
  orphaned: string[]; // module slugs whose prose was moved to _orphaned/
  notes: string[]; // merge conflicts and other build-time warnings
}

// Resolved options for a `build`.
export interface BuildOptions {
  repo: string; // absolute path to the repo
  out: string; // absolute path to the output dir
  include?: string[];
  exclude?: string[];
  maxBytes?: number;
  mermaid: boolean;
  json: boolean;
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
