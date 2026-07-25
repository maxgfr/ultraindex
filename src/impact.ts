import { loadGraph } from "./store.js";
import { impactOf } from "./engine.js";
import type { ImpactResult } from "./engine.js";

// The reverse-dependency closure now lives in the codeindex engine
// (src/traverse.ts upstream) — it is deterministic graph work, so by this
// project's boundary rule it belongs there, not here. All that remains is
// loading the persisted graph, which is ultraindex's artifact.
export type { ImpactResult } from "./engine.js";

export function runImpact(outDir: string, target: string, depth = Infinity): ImpactResult | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  return impactOf(graph, target, depth);
}
