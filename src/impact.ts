import type { Edge, Graph } from "./types.js";
import { loadGraph } from "./store.js";
import { byStr } from "./sort.js";

export interface ImpactedFile {
  rel: string;
  module: string;
  depth: number; // hops from the target (1 = direct dependent)
}

export interface ImpactResult {
  target: string;
  scope: "module" | "file";
  seeds: string[]; // the files whose dependents we traced
  files: ImpactedFile[]; // transitive dependents, nearest first
  modules: string[]; // distinct modules touched
}

// Reverse dependency closure: every file that transitively IMPORTS, USES, or
// CALLS one of `seeds`, out to `depth` hops (default: the full closure).
// Import/use/call edges are the only ones carrying a real "depends on"
// relation — doc-links and mentions do not — so the answer is "what breaks if
// I change this", not "what mentions it".
function reverseClosure(edges: Edge[], seeds: string[], depth: number): Map<string, number> {
  const dependents = new Map<string, Edge[]>(); // target file → incoming import/use/call edges
  for (const e of edges) {
    if (e.dangling || (e.kind !== "import" && e.kind !== "use" && e.kind !== "call")) continue;
    let arr = dependents.get(e.to);
    if (!arr) dependents.set(e.to, (arr = []));
    arr.push(e);
  }
  const depthOf = new Map<string, number>();
  const seen = new Set<string>(seeds);
  let frontier = [...seeds];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const e of (dependents.get(node) ?? []).slice().sort((a, b) => byStr(a.from, b.from))) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        depthOf.set(e.from, d);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return depthOf;
}

export function impactOf(graph: Graph, target: string, depth = Infinity): ImpactResult | undefined {
  const moduleOf = new Map(graph.files.map((f) => [f.rel, f.module]));
  const mod = graph.modules.find((m) => m.slug === target);
  const file = mod ? undefined : graph.files.find((f) => f.rel === target);
  if (!mod && !file) return undefined;

  const seeds = mod ? mod.members : [file!.rel];
  const depthOf = reverseClosure(graph.fileEdges, seeds, depth);
  const files: ImpactedFile[] = [...depthOf.entries()]
    .map(([rel, d]) => ({ rel, module: moduleOf.get(rel) ?? "root", depth: d }))
    .sort((a, b) => a.depth - b.depth || byStr(a.rel, b.rel));
  const modules = [...new Set(files.map((f) => f.module).filter((m) => m !== target))].sort(byStr);

  return { target, scope: mod ? "module" : "file", seeds, files, modules };
}

export function runImpact(outDir: string, target: string, depth = Infinity): ImpactResult | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  return impactOf(graph, target, depth);
}
