import { SCHEMA_VERSION } from "./types.js";
import type { EmbedReport, Graph, VectorStore } from "./types.js";
import { indexPaths, loadGraph } from "./store.js";
import { readIfExists, writeFileIfChanged } from "./output.js";
import { sha1, byStr } from "./engine.js";
import { embedTexts, moduleEmbedText, tierModelId } from "./semantic.js";
import type { EmbedTier } from "./semantic.js";
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

// Vectors are int8 (the engine quantizes every tier to the same scale), so they
// serialize as base64 rather than a float array: compact, exact, and — unlike
// rounded floats — round-trips byte-for-byte.
export function encodeVector(v: Int8Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

export function decodeVector(b64: string): Int8Array {
  const buf = Buffer.from(b64, "base64");
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function saveVectors(outDir: string, store: VectorStore): void {
  // Keys sorted so re-saving an unchanged store is byte-stable.
  const sorted: VectorStore = {
    schemaVersion: store.schemaVersion,
    modelId: store.modelId,
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
// model match the store keeps its vector; slugs gone from the graph are pruned;
// a model or dimension change discards the whole store. On the static tier this
// is pure local computation — no network, and byte-identical across machines.
export async function runEmbed(outDir: string, tier: EmbedTier, force = false): Promise<EmbedReport | undefined> {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;

  const modelId = tierModelId(tier);
  const prior = loadVectors(outDir);
  const reusable = !force && prior && prior.modelId === modelId ? prior.vectors : {};

  const prose = loadEnrichedProse(outDir, graph);
  const filesByModule = groupFiles(graph);
  const modules = graph.modules.slice().sort((a, b) => byStr(a.slug, b.slug));

  const next: VectorStore = {
    schemaVersion: SCHEMA_VERSION,
    modelId,
    dim: prior?.modelId === modelId ? prior.dim : 0,
    vectors: {},
  };
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
    const vectors = await embedTexts(
      tier,
      toEmbed.map((t) => t.text),
    );
    const dim = vectors[0]?.length ?? 0;
    if (next.dim && dim !== next.dim) {
      // The tier changed dimensions under the same id (a model swap behind one
      // endpoint). Reused vectors are now incomparable — re-embed all.
      return runEmbed(outDir, tier, true);
    }
    next.dim = dim;
    toEmbed.forEach((t, i) => {
      next.vectors[t.slug] = { hash: t.hash, v: encodeVector(vectors[i]!) };
    });
  }

  const removed = prior ? Object.keys(prior.vectors).filter((slug) => !(slug in next.vectors)).length : 0;
  saveVectors(outDir, next);
  return {
    modelId,
    dim: next.dim,
    total: graph.modules.length,
    embedded: toEmbed.length,
    reused,
    removed,
  };
}
