import { basename, relative, isAbsolute } from "node:path";
import type { BuildOptions, ExtractionCache, FileRecord, Graph, Manifest } from "./types.js";
import { VERSION, SCHEMA_VERSION, EXTRACTOR_VERSION } from "./types.js";
import { scanRepo, DEFAULT_MAX_FILES, buildResolveContext, buildModules, buildGraph, detectCommunities, applyCentrality, computeTestMap, computeSurprises, renderGraphJson, buildSymbolIndex, renderSymbolsJson, computeSymbolRefs } from "./engine.js";
import { renderEntrySpec, buildEntryEdgeIndex } from "./render/encyclopedia.js";
import { renderIndex } from "./render/index-md.js";
import { renderMermaid } from "./render/mermaid.js";
import { buildManifest, renderManifestJson } from "./render/manifest.js";
import { syncEntries, type EntryInput } from "./entries.js";
import { loadManifest, loadCache, indexPaths } from "./store.js";
import { writeFileIfChanged, removeFile, ensureDir } from "./output.js";

export interface BuildResult {
  outDir: string;
  graph: Graph;
  manifest: Manifest;
  capped: boolean; // the walk hit --max-files; the index is partial
}

// The full deterministic pipeline: scan → resolve → group → graph → render →
// idempotent write. The model is never involved; this is pure file work.
export function runBuild(opts: BuildOptions, builtAt: string): BuildResult {
  const cache = opts.noCache ? undefined : loadCache(opts.out);
  const scan = scanRepo(opts.repo, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes,
    maxFiles: opts.maxFiles,
    gitignore: opts.gitignore,
    out: opts.out,
    cache,
    fullHash: opts.fullHash,
  });
  const ctx = buildResolveContext(scan);
  const { modules, moduleOf } = buildModules(scan);
  // Stamp graph.json with ULTRAINDEX's identity (it owns the artifact's
  // schema/version lineage), not the engine's.
  const graph = buildGraph(scan, ctx, modules, moduleOf, { version: VERSION, schemaVersion: SCHEMA_VERSION });

  const records = new Map<string, FileRecord>(scan.files.map((f) => [f.rel, f]));
  const paths = indexPaths(opts.out);
  ensureDir(opts.out);

  // Entries: render each module's region spec, then merge against existing prose.
  // The edge index is built once so each entry costs O(its own links), not O(E).
  const prev = loadManifest(opts.out);

  // Cluster modules into navigation communities (never affects slugs or lexical
  // ranking; biases find's graph-expansion ordering and feeds the surprise
  // pass). Computed here — after the graph and the previous manifest —
  // so graph.json, INDEX.md and the manifest all serialize the same ids, and a
  // rebuild can reuse the prior ids for an unchanged partition.
  const communities = detectCommunities(graph.modules, graph.moduleEdges, prev?.communities);
  for (const m of graph.modules) {
    const id = communities.get(m.slug);
    if (id !== undefined) m.community = id;
  }

  // Centrality (pagerank/betweenness) stamped after communities so both layers
  // serialize from the same node arrays in one fixed order.
  const centralityNotes = applyCentrality(graph);

  // tests→code: classify test files and project the dependency edges through
  // that classification. Stamped before entries render so the links region can
  // list "Tested by".
  const testMap = computeTestMap(graph);
  for (const f of graph.files) {
    if (testMap.testFiles.has(f.rel)) f.testFile = true;
  }
  for (const m of graph.modules) {
    const t = testMap.testedByModule.get(m.slug);
    if (t?.length) m.testedBy = t;
  }

  // Surprising cross-community couplings, persisted on the graph so navigation
  // and delta can read them without recomputing.
  const surprises = computeSurprises(graph);
  if (surprises.length) graph.surprises = surprises;

  const edgeIndex = buildEntryEdgeIndex(graph, moduleOf);
  const entryInputs: EntryInput[] = graph.modules.map((m) => ({
    slug: m.slug,
    members: m.members,
    spec: renderEntrySpec(m, edgeIndex, records),
  }));
  const sync = syncEntries(opts.out, entryInputs, prev?.modules ?? {});

  // Top-level artifacts.
  const mermaid = opts.mermaid ? renderMermaid(graph) : undefined;
  writeFileIfChanged(paths.graph, renderGraphJson(graph));
  writeFileIfChanged(paths.symbols, renderSymbolsJson(buildSymbolIndex(scan, computeSymbolRefs(scan))));
  if (mermaid) writeFileIfChanged(paths.mermaid, mermaid.content);
  else removeFile(paths.mermaid); // keep the dir consistent with --no-mermaid
  writeFileIfChanged(paths.index, renderIndex(graph, { repoName: basename(opts.repo) || "repo", mermaid }));

  const cappedNote = scan.capped
    ? [`file scan hit the --max-files cap (${opts.maxFiles ?? DEFAULT_MAX_FILES}); the index is PARTIAL — raise --max-files to index the whole repo`]
    : [];
  const extraNotes = [
    ...ctx.warnings,
    ...cappedNote,
    ...centralityNotes,
    ...(opts.mermaid ? [] : ["mermaid diagram disabled (--no-mermaid)"]),
  ];
  const outRel = !isAbsolute(relative(opts.repo, opts.out)) && !relative(opts.repo, opts.out).startsWith("..")
    ? relative(opts.repo, opts.out)
    : opts.out;
  const manifest = buildManifest(scan, graph, outRel, sync, builtAt, extraNotes, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes,
    maxFiles: opts.maxFiles,
    gitignore: opts.gitignore,
  });
  writeFileIfChanged(paths.manifest, renderManifestJson(manifest));

  // Refresh the extraction cache for the next build (skipped with --no-cache).
  // Written last and excluded from the byte-identical guarantee — it is build
  // state, not part of the index.
  if (!opts.noCache) {
    const files: ExtractionCache["files"] = {};
    for (const f of scan.files) files[f.rel] = { hash: f.hash, record: f, size: f.size, mtimeMs: scan.mtimes.get(f.rel) };
    const cacheOut: ExtractionCache = { schemaVersion: SCHEMA_VERSION, extractorVersion: EXTRACTOR_VERSION, files };
    writeFileIfChanged(paths.cache, JSON.stringify(cacheOut) + "\n");
  }

  return { outDir: opts.out, graph, manifest, capped: scan.capped };
}
