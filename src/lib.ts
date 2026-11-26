// Library entry point, bundled to scripts/engine.mjs (+ scripts/engine.d.mts)
// so a downstream skill can vendor ultraindex the way ultraindex vendors
// codeindex: two self-contained files, no install step.
//
// Explicit named re-exports instead of `export *`, for the reasons spelled out
// in src/engine.ts: the public surface is visible in one place, internal
// helpers don't leak through by accident, and a name collision is a compile
// error rather than a silent exclusion. Add a name here only when a consumer
// needs it.
//
// THE CONTRACT: nothing reachable from this surface writes to stdout/stderr,
// sets `process.exitCode` or calls `process.exit`. Results and diagnostics come
// back as values; printing and exit status stay the CLI's job (src/cli.ts).
// tests/lib.test.ts drives the BUILT bundle and fails on any stray write.

import { warmGrammars, type WarmGrammarsOptions, type WarmGrammarsResult } from "./engine.js";

// ---- version and schema ----------------------------------------------------
export { VERSION, SCHEMA_VERSION, EXTRACTOR_VERSION } from "./types.js";

// ---- persisted shapes and option types --------------------------------------
export type {
  BuildOptions,
  CheckResult,
  ClaimEvidencePair,
  CodeSymbol,
  Edge,
  EdgeKind,
  EmbedReport,
  ExtractionCache,
  FileKind,
  FileNode,
  FileRecord,
  FileStatus,
  FindResult,
  Graph,
  Manifest,
  ModuleNode,
  ProseState,
  RawRef,
  SurpriseEdge,
  SymbolIndex,
  Tier,
  Verdict,
  VerdictKind,
  VectorStore,
  VerifyResult,
} from "./types.js";

// ---- build -------------------------------------------------------------------
export { runBuild, type BuildResult } from "./build.js";

// ---- freshness and grounding gates ------------------------------------------
export { runCheck, checkAnswer, type CheckOptions, type AnswerCheck } from "./check.js";
export { runStatus, type StatusResult, type ModuleStatus } from "./status.js";
export {
  parseCitations,
  checkCitations,
  fileLineTable,
  type Citation,
  type CitationCheck,
} from "./cite.js";
export {
  proseFreshness,
  proseDigest,
  proseSourceHash,
  type ProseFreshness,
} from "./prose.js";

// Semantic verification: only the pure entry points. `runVerify` and
// `applyVerdicts` persist worklists/verdicts next to the answer file and are
// CLI workflow steps, not library calls.
export {
  VERIFY_MAX,
  buildClaimPairs,
  citationlessClaims,
  reduceVerdicts,
  revalidateVerdicts,
  unreadableClaimCitations,
  verdictRowProblem,
  loadVerify,
  type VerifyWorklist,
} from "./verify.js";

// ---- navigation ------------------------------------------------------------
export {
  runFind,
  runFindHybrid,
  findModules,
  loadEnrichedProse,
  type HybridFind,
} from "./find.js";
export { runNeighbors, type NeighborResult, type NeighborLink } from "./neighbors.js";
export { runImpact, type ImpactResult } from "./impact.js";
export {
  runDelta,
  withEntries,
  type DeltaResult,
  type DeltaModule,
  type DeltaError,
  type DeltaOptions,
  type DeltaChange,
  type ChangedSymbol,
} from "./delta.js";
export {
  runSymbols,
  lookupSymbols,
  type SymbolResult,
  type SymbolHit,
  type SymbolSite,
} from "./symbols.js";

// ---- evidence ----------------------------------------------------------------
export {
  gatherEvidence,
  renderModuleDossier,
  renderAskDossier,
  type EvidenceFile,
} from "./evidence.js";
export { runDossier, runAsk } from "./explain.js";

// ---- index store -------------------------------------------------------------
export {
  indexPaths,
  indexExists,
  loadGraph,
  loadManifest,
  loadSymbols,
  loadCache,
} from "./store.js";

// ---- grammars ----------------------------------------------------------------
export type { WarmGrammarsOptions, WarmGrammarsResult };

// Load the tree-sitter grammars so `runBuild` extracts symbols via the AST
// instead of the regex fallback. The library counterpart of the CLI's
// `warmGrammars` (src/cli.ts), minus its stderr announcements and exit-status
// juggling: diagnostics go to `onNote` when given and are always returned in
// `notes`, never printed. When no grammars resolve locally it pulls them into
// the shared per-machine cache (network) unless `pull: false` or
// CODEINDEX_NO_GRAMMARS_PULL=1. Check `ready` to know which tier the next build
// will use. Idempotent: loaded grammars are cached in-process.
export function prepareGrammars(opts: WarmGrammarsOptions = {}): Promise<WarmGrammarsResult> {
  return warmGrammars({ label: "ultraindex", ...opts, onNote: opts.onNote ?? (() => {}) });
}

// ---- the pinned codeindex engine ------------------------------------------
// The exact engine copy this bundle was built against, so a consumer vendors
// ONE engine and its graph/symbol shapes always match ultraindex's.
export * as codeindex from "./vendor/codeindex-engine.mjs";

// Top-level on purpose, not only under `codeindex`: the engine's parallel
// extractor spawns workers that `import()` a module named `engine.mjs` (the
// running bundle when it has that name, else one sitting next to it) and call
// its top-level `runExtractWorker`. This bundle IS scripts/engine.mjs, and it
// sits next to the CLI bundle, so both resolve here; without this export every
// worker fails and extraction silently falls back to a single thread.
export { runExtractWorker } from "./engine.js";
