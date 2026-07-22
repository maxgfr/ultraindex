import type { Edge, Graph } from "./types.js";
import { loadGraph } from "./store.js";
import { hubThreshold } from "./find.js";
import { byStr } from "./engine.js";

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
// directions. Deterministic ordering. With `kinds` set, only edges of those kinds
// are traversed (and the degree distribution is measured over that same filtered
// subgraph, so the hub gate reflects the view the caller asked for).
function bfs(edges: Edge[], start: string, depth: number, kinds?: Set<string>): NeighborLink[] {
  const out = new Map<string, Edge[]>();
  const inn = new Map<string, Edge[]>();
  // Degree = count of incident non-dangling (kind-filtered) edges per node, built
  // from the same edge list — feeds the hub gate below.
  const degree = new Map<string, number>();
  for (const e of edges) {
    if (e.dangling) continue;
    if (kinds && !kinds.has(e.kind)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  // Hub gate, identical in spirit to find's expandResults: a non-start node whose
  // degree ≥ max(50, p99) is emitted as a link but never expanded THROUGH, so one
  // hyper-connected node can't pull the whole graph into the neighbourhood. The 50
  // floor makes it a no-op on small graphs (never-worse), and it only bites at
  // depth ≥ 2 — depth-1 links all come from `start`, which always expands.
  const threshold = hubThreshold([...degree.values()]);
  const seen = new Set<string>([start]);
  const links: NeighborLink[] = [];
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      if (node !== start && (degree.get(node) ?? 0) >= threshold) continue;
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

export function neighborsOf(graph: Graph, target: string, depth = 1, kinds?: Set<string>): NeighborResult | undefined {
  const mod = graph.modules.find((m) => m.slug === target);
  if (mod) {
    return { target, scope: "module", links: bfs(graph.moduleEdges, target, depth, kinds), members: mod.members };
  }
  const file = graph.files.find((f) => f.rel === target);
  if (file) {
    return { target, scope: "file", links: bfs(graph.fileEdges, target, depth, kinds) };
  }
  return undefined;
}

export function runNeighbors(outDir: string, target: string, depth = 1, kinds?: Set<string>): NeighborResult | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  return neighborsOf(graph, target, depth, kinds);
}
