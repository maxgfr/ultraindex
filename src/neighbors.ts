import { loadGraph } from "./store.js";
import { neighborsOf } from "./engine.js";
import type { NeighborResult } from "./engine.js";

// The bidirectional, kind-filterable walk (and the hub gate it shares with
// impact) now lives in the codeindex engine — deterministic graph work. What
// stays here is loading ultraindex's own persisted graph.
export type { NeighborResult, NeighborLink } from "./engine.js";

export function runNeighbors(
  outDir: string,
  target: string,
  depth = 1,
  kinds?: Set<string>,
): NeighborResult | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  return neighborsOf(graph, target, depth, kinds);
}
