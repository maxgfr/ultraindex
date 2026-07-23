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
  FileKind,
  FileNode,
  FileRecord,
  Graph,
  Hunk,
  ModuleNode,
  RawRef,
  RepoScan,
  SurpriseEdge,
  SymbolIndex,
  Tier,
} from "./vendor/codeindex-engine.mjs";

export {
  DEFAULT_MAX_FILES,
  EXTRACTOR_VERSION,
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
  computeSurprises,
  computeSymbolRefs,
  computeTestMap,
  detectCommunities,
  diffFiles,
  diffHunks,
  ensureGrammars,
  extToLang,
  extractCode,
  extractMarkdown,
  foldText,
  have,
  headCommit,
  isGitWorktree,
  keywords,
  readText,
  renderGraphJson,
  renderSymbolsJson,
  resolveBaseRef,
  resolveImport,
  rrf,
  scanRepo,
  sh,
  sha1,
  shortHash,
  tierForPath,
  untrackedFiles,
  walk,
} from "./vendor/codeindex-engine.mjs";

// NOT re-exported: the vendor engine's `renderMermaid(graph, opts?): string`
// (a generic Graph -> Mermaid renderer). WHY: ultraindex has its own
// same-named renderMermaid (src/render/mermaid.ts) — tier-clustered, returns
// a MermaidResult with truncation counts, and is the one every internal
// caller (src/build.ts) actually imports, always by that concrete path. The
// two are genuinely different functions that happen to share a name; folding
// the vendor one into this barrel would make `renderMermaid` ambiguous the
// moment anyone imported it from "./engine.js" instead of
// "./render/mermaid.js". Leaving it out of the curated surface means only
// one `renderMermaid` is ever importable from an ultraindex-authored module;
// the vendor's generic one remains reachable, deliberately, only via its
// concrete path "./vendor/codeindex-engine.mjs" for the rare case something
// needs the un-tiered renderer.
