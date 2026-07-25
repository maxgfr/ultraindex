import type { Graph } from "../types.js";
import { renderMermaidClustered } from "../engine.js";
import type { ClusteredMermaidResult } from "../engine.js";

// The tier-clustered module diagram now lives in the codeindex engine
// (renderMermaidClustered) — deterministic rendering of a graph the engine
// already owns. Kept as a named local wrapper only so build.ts's call site and
// the `%%` title stay ultraindex's.
export type MermaidResult = ClusteredMermaidResult;

export function renderMermaid(
  graph: Graph,
  opts: { maxModules?: number; maxEdges?: number } = {},
): MermaidResult {
  return renderMermaidClustered(graph, { ...opts, title: "ultraindex module graph" });
}
