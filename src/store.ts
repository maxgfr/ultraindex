import { join } from "node:path";
import { SCHEMA_VERSION, EXTRACTOR_VERSION } from "./types.js";
import type { ExtractionCache, Graph, Manifest, SymbolIndex } from "./types.js";
import { readIfExists } from "./output.js";

// Canonical paths inside an index output directory.
export function indexPaths(outDir: string): {
  index: string;
  graph: string;
  manifest: string;
  mermaid: string;
  encyclopedia: string;
  vectors: string;
  semantic: string;
  symbols: string;
  cache: string;
} {
  return {
    index: join(outDir, "INDEX.md"),
    graph: join(outDir, "graph.json"),
    manifest: join(outDir, "manifest.json"),
    mermaid: join(outDir, "graph.mmd"),
    encyclopedia: join(outDir, "encyclopedia"),
    vectors: join(outDir, "vectors.json"),
    semantic: join(outDir, "semantic.json"),
    symbols: join(outDir, "symbols.json"),
    cache: join(outDir, "cache.json"),
  };
}

// Does an index exist at this path? (graph.json is the load-bearing artifact.)
export function indexExists(outDir: string): boolean {
  return readIfExists(indexPaths(outDir).graph) !== undefined;
}

export function loadGraph(outDir: string): Graph | undefined {
  const raw = readIfExists(indexPaths(outDir).graph);
  if (raw === undefined) return undefined;
  try {
    const g = JSON.parse(raw) as Graph;
    return g.schemaVersion === SCHEMA_VERSION ? g : undefined;
  } catch {
    return undefined;
  }
}

export function loadManifest(outDir: string): Manifest | undefined {
  const raw = readIfExists(indexPaths(outDir).manifest);
  if (raw === undefined) return undefined;
  try {
    const m = JSON.parse(raw) as Manifest;
    return m.schemaVersion === SCHEMA_VERSION ? m : undefined;
  } catch {
    return undefined;
  }
}

export function loadSymbols(outDir: string): SymbolIndex | undefined {
  const raw = readIfExists(indexPaths(outDir).symbols);
  if (raw === undefined) return undefined;
  try {
    const s = JSON.parse(raw) as SymbolIndex;
    return s.schemaVersion === SCHEMA_VERSION ? s : undefined;
  } catch {
    return undefined;
  }
}

// Load the extraction cache as a rel → {hash, record} map, but only if it matches
// BOTH the artifact schema and the extractor version — a mismatch means every
// record could be shaped differently, so the whole cache is discarded.
export function loadCache(outDir: string): Map<string, ExtractionCache["files"][string]> | undefined {
  const raw = readIfExists(indexPaths(outDir).cache);
  if (raw === undefined) return undefined;
  try {
    const c = JSON.parse(raw) as ExtractionCache;
    if (c.schemaVersion !== SCHEMA_VERSION || c.extractorVersion !== EXTRACTOR_VERSION) return undefined;
    return new Map(Object.entries(c.files));
  } catch {
    return undefined;
  }
}
