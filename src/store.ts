import { join } from "node:path";
import { SCHEMA_VERSION } from "./types.js";
import type { Graph, Manifest } from "./types.js";
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
} {
  return {
    index: join(outDir, "INDEX.md"),
    graph: join(outDir, "graph.json"),
    manifest: join(outDir, "manifest.json"),
    mermaid: join(outDir, "graph.mmd"),
    encyclopedia: join(outDir, "encyclopedia"),
    vectors: join(outDir, "vectors.json"),
    semantic: join(outDir, "semantic.json"),
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
