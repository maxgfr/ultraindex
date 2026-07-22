import { SCHEMA_VERSION } from "./types.js";
import type { EmbedReport, Graph, SemanticConfig, VectorStore } from "./types.js";
import { indexPaths, loadGraph } from "./store.js";
import { readIfExists, writeFileIfChanged } from "./output.js";
import { sha1, byStr } from "./engine.js";
import { embedTexts, moduleEmbedText } from "./semantic.js";
import { loadEnrichedProse } from "./find.js";

export function loadVectors(outDir: string): VectorStore | undefined {
  const raw = readIfExists(indexPaths(outDir).vectors);
  if (raw === undefined) return undefined;
  try {
    const v = JSON.parse(raw) as VectorStore;
    return v.schemaVersion === SCHEMA_VERSION && v.vectors ? v : undefined;
  } catch {
    return undefined;
  }
}

// Round to 6 decimals on save: stable diffs without measurable ranking impact.
function round6(v: number[]): number[] {
  return v.map((x) => Number(x.toFixed(6)));
}

export function saveVectors(outDir: string, store: VectorStore): void {
  // Keys sorted so re-saving an unchanged store is byte-stable.
  const sorted: VectorStore = {
    schemaVersion: store.schemaVersion,
    model: store.model,
    dim: store.dim,
    vectors: Object.fromEntries(
      Object.keys(store.vectors)
        .sort(byStr)
        .map((slug) => [slug, store.vectors[slug]!]),
    ),
  };
  writeFileIfChanged(indexPaths(outDir).vectors, JSON.stringify(sorted, null, 2) + "\n");
}

// Recompute each module's embed-text hash against the stored one — the
// staleness probe `check` uses, network-free.
export function staleVectorSlugs(outDir: string, graph: Graph, store: VectorStore): string[] {
  const prose = loadEnrichedProse(outDir, graph);
  const filesByModule = groupFiles(graph);
  const stale: string[] = [];
  for (const m of graph.modules) {
    const text = moduleEmbedText(m, filesByModule.get(m.slug) ?? [], prose.get(m.slug));
    const stored = store.vectors[m.slug];
    if (!stored || stored.hash !== sha1(text)) stale.push(m.slug);
  }
  return stale.sort(byStr);
}

function groupFiles(graph: Graph): Map<string, Graph["files"]> {
  const byModule = new Map<string, Graph["files"]>();
  for (const f of graph.files) {
    let list = byModule.get(f.module);
    if (!list) byModule.set(f.module, (list = []));
    list.push(f);
  }
  return byModule;
}

// Embed every module's text, incrementally: a module whose embed-text hash and
// model match the store keeps its vector (no network for it); slugs gone from
// the graph are pruned; a model or dimension change discards the whole store.
export async function runEmbed(outDir: string, cfg: SemanticConfig, force = false): Promise<EmbedReport | undefined> {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;

  const prior = loadVectors(outDir);
  const reusable = !force && prior && prior.model === cfg.model ? prior.vectors : {};

  const prose = loadEnrichedProse(outDir, graph);
  const filesByModule = groupFiles(graph);
  const modules = graph.modules.slice().sort((a, b) => byStr(a.slug, b.slug));

  const next: VectorStore = { schemaVersion: SCHEMA_VERSION, model: cfg.model, dim: prior?.model === cfg.model ? prior.dim : 0, vectors: {} };
  const toEmbed: { slug: string; hash: string; text: string }[] = [];
  let reused = 0;
  for (const m of modules) {
    const text = moduleEmbedText(m, filesByModule.get(m.slug) ?? [], prose.get(m.slug));
    const hash = sha1(text);
    const stored = reusable[m.slug];
    if (stored && stored.hash === hash) {
      next.vectors[m.slug] = stored;
      reused++;
    } else {
      toEmbed.push({ slug: m.slug, hash, text });
    }
  }

  if (toEmbed.length) {
    const vectors = await embedTexts(cfg, toEmbed.map((t) => t.text));
    const dim = vectors[0]?.length ?? 0;
    if (next.dim && dim !== next.dim) {
      // The provider changed dimensions under the same model name (model swap
      // behind one endpoint). Reused vectors are now incomparable — re-embed all.
      return runEmbed(outDir, cfg, true);
    }
    next.dim = dim;
    toEmbed.forEach((t, i) => {
      next.vectors[t.slug] = { hash: t.hash, v: round6(vectors[i]!) };
    });
  }

  const removed = prior ? Object.keys(prior.vectors).filter((slug) => !(slug in next.vectors)).length : 0;
  saveVectors(outDir, next);
  return {
    model: cfg.model,
    dim: next.dim,
    total: graph.modules.length,
    embedded: toEmbed.length,
    reused,
    removed,
  };
}
