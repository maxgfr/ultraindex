import type { Edge, Graph } from "./types.js";
import { loadGraph } from "./store.js";
import { byStr } from "./sort.js";

export interface NeighborLink {
  node: string;
  direction: "out" | "in";
  kind: string;
  weight: number;
  depth: number;
  // Only present for a `call` edge — see Edge.confidence.
  confidence?: "extracted" | "inferred";
}

export interface NeighborResult {
  target: string;
  scope: "module" | "file";
  links: NeighborLink[];
  members?: string[]; // for a module target
}

// Breadth-first walk of `edges` from `start`, out to `depth` hops, in both
// directions. Deterministic ordering.
function bfs(edges: Edge[], start: string, depth: number): NeighborLink[] {
  const out = new Map<string, Edge[]>();
  const inn = new Map<string, Edge[]>();
  for (const e of edges) {
    if (e.dangling) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
  }
  const seen = new Set<string>([start]);
  const links: NeighborLink[] = [];
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const e of (out.get(node) ?? []).slice().sort((a, b) => byStr(a.to, b.to))) {
        if (seen.has(e.to)) continue;
        links.push({ node: e.to, direction: "out", kind: e.kind, weight: e.weight, depth: d, confidence: e.confidence });
        seen.add(e.to);
        next.push(e.to);
      }
      for (const e of (inn.get(node) ?? []).slice().sort((a, b) => byStr(a.from, b.from))) {
        if (seen.has(e.from)) continue;
        links.push({ node: e.from, direction: "in", kind: e.kind, weight: e.weight, depth: d, confidence: e.confidence });
        seen.add(e.from);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return links;
}

export function neighborsOf(graph: Graph, target: string, depth = 1): NeighborResult | undefined {
  const mod = graph.modules.find((m) => m.slug === target);
  if (mod) {
    return { target, scope: "module", links: bfs(graph.moduleEdges, target, depth), members: mod.members };
  }
  const file = graph.files.find((f) => f.rel === target);
  if (file) {
    return { target, scope: "file", links: bfs(graph.fileEdges, target, depth) };
  }
  return undefined;
}

export function runNeighbors(outDir: string, target: string, depth = 1): NeighborResult | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  return neighborsOf(graph, target, depth);
}
