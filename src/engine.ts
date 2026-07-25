// Curated re-export surface over the vendored codeindex engine
// (src/vendor/codeindex-engine.mjs). Explicit named re-exports instead of
// `export *`: every name ultraindex actually consumes is visible in one
// place, unused vendor surface doesn't leak through by accident, and a
// genuine name collision becomes a compile error (TS2300 "Duplicate
// identifier") instead of `export *`'s silent exclude-the-ambiguous-name
// behavior. Add a name here only when something under src/ or tests/ needs
// it — grep `from "./engine.js"` / `from "../engine.js"` across the repo
// before trimming or extending this list.

export type {
  CodeSymbol,
  DiffFile,
  DiffSpec,
  Edge,
  EdgeKind,
  ChangedSymbol,
  ClusteredMermaidResult,
  DeltaChange,
  DeltaModule,
  DeltaOptions,
  DeltaResult,
  EmbedEndpointOptions,
  FileKind,
  ImpactResult,
  NeighborLink,
  NeighborResult,
  FileNode,
  FileRecord,
  Graph,
  Hunk,
  ModuleNode,
  RawRef,
  RepoScan,
  StaticEmbedModel,
  SurpriseEdge,
  SymbolIndex,
  Tier,
} from "./vendor/codeindex-engine.mjs";

export {
  DEFAULT_MAX_FILES,
  EXTRACTOR_VERSION,
  RISK_WEIGHTS,
  allGrammarKeys,
  applyCentrality,
  buildGraph,
  buildModules,
  buildResolveContext,
  buildSymbolIndex,
  byKey,
  byStr,
  classify,
  clip,
  clipInline,
  compileGlobs,
  computeDelta,
  computeSurprises,
  computeSymbolRefs,
  computeTestMap,
  detectCommunities,
  diffFiles,
  diffHunks,
  embedViaEndpoint,
  encode,
  encodeQueryViaEndpoint,
  ensureGrammars,
  extToLang,
  extractCode,
  extractMarkdown,
  foldText,
  formatDeltaPanel,
  have,
  headCommit,
  hubThreshold,
  impactOf,
  intDot,
  isGitWorktree,
  keywords,
  loadEmbedModel,
  neighborsOf,
  quantize,
  readText,
  renderGraphJson,
  renderMermaidClustered,
  renderSymbolsJson,
  resolveBaseRef,
  resolveEmbedEndpoint,
  resolveEmbedModelDir,
  resolveGrammarsTier,
  resolveImport,
  rrf,
  runCli,
  scanRepo,
  sh,
  sha1,
  sharedGrammarsCacheDir,
  shortHash,
  tierForPath,
  untrackedFiles,
  walk,
} from "./vendor/codeindex-engine.mjs";

// NOT re-exported: the vendor engine's `renderMermaid(graph, opts?): string`.
// WHY: the tier-clustered whole-graph renderer this project needs now lives
// upstream as `renderMermaidClustered`, which IS in the barrel above, and
// src/render/mermaid.ts is a five-line wrapper that only supplies the `%%`
// title. So the two `renderMermaid`s are no longer rival implementations —
// they answer different questions: the vendor's draws ONE module's
// neighbourhood and returns raw mermaid, ours draws the whole graph fenced,
// with truncation counts. Keeping the vendor name out of the curated surface
// means only one `renderMermaid` is ever importable from an ultraindex-authored
// module; the neighbourhood renderer stays reachable, deliberately, only via
// its concrete path "./vendor/codeindex-engine.mjs".
//
// Also deliberately absent: the engine's `SCHEMA_VERSION`. src/types.ts
// declares ultraindex's own (the on-disk artifact shape, which is ours to
// version) and re-exports the engine's `EXTRACTOR_VERSION` from that same
// module — adding the engine's SCHEMA_VERSION here would be a live TS2300
// waiting to happen.
//
// THE RULE for a capability that moves upstream: its name enters this barrel in
// the SAME commit that deletes the local twin. Two implementations under one
// name compile fine and are worse than a compile error, because nothing tells
// you which one a caller got. `hubThreshold` was that mistake once — the engine
// gained it while src/find.ts still defined its own.
