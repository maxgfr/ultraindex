import { basename, relative, isAbsolute } from "node:path";
import type { BuildOptions, FileRecord, Graph, Manifest } from "./types.js";
import { scanRepo } from "./scan.js";
import { DEFAULT_MAX_FILES } from "./walk.js";
import { buildResolveContext } from "./resolve.js";
import { buildModules } from "./modules.js";
import { buildGraph } from "./graph.js";
import { renderEntrySpec, buildEntryEdgeIndex } from "./render/encyclopedia.js";
import { renderIndex } from "./render/index-md.js";
import { renderMermaid } from "./render/mermaid.js";
import { renderGraphJson } from "./render/graph-json.js";
import { buildManifest, renderManifestJson } from "./render/manifest.js";
import { syncEntries, type EntryInput } from "./entries.js";
import { loadManifest, indexPaths } from "./store.js";
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
  const scan = scanRepo(opts.repo, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes,
    maxFiles: opts.maxFiles,
    out: opts.out,
  });
  const ctx = buildResolveContext(scan);
  const { modules, moduleOf } = buildModules(scan);
  const graph = buildGraph(scan, ctx, modules, moduleOf);

  const records = new Map<string, FileRecord>(scan.files.map((f) => [f.rel, f]));
  const paths = indexPaths(opts.out);
  ensureDir(opts.out);

  // Entries: render each module's region spec, then merge against existing prose.
  // The edge index is built once so each entry costs O(its own links), not O(E).
  const prev = loadManifest(opts.out);
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
  if (mermaid) writeFileIfChanged(paths.mermaid, mermaid.content);
  else removeFile(paths.mermaid); // keep the dir consistent with --no-mermaid
  writeFileIfChanged(paths.index, renderIndex(graph, { repoName: basename(opts.repo) || "repo", mermaid }));

  const cappedNote = scan.capped
    ? [`file scan hit the --max-files cap (${opts.maxFiles ?? DEFAULT_MAX_FILES}); the index is PARTIAL — raise --max-files to index the whole repo`]
    : [];
  const extraNotes = [
    ...ctx.warnings,
    ...cappedNote,
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
  });
  writeFileIfChanged(paths.manifest, renderManifestJson(manifest));

  return { outDir: opts.out, graph, manifest, capped: scan.capped };
}
