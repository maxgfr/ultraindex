import type { Graph, ModuleNode, Tier } from "../types.js";
import { byStr } from "../sort.js";

export interface MermaidResult {
  content: string;
  shownModules: number;
  totalModules: number;
  shownEdges: number;
  totalEdges: number;
}

const TIER_LABEL: Record<Tier, string> = { 0: "Foundations", 1: "Features", 2: "Tail" };
const DEFAULT_MAX_MODULES = 40;
const DEFAULT_MAX_EDGES = 80;

const degree = (m: ModuleNode): number => m.degIn + m.degOut;

// Mermaid node ids must be identifier-safe; slugs may contain dashes.
function nodeId(slug: string): string {
  return "m_" + slug.replace(/[^A-Za-z0-9_]/g, "_");
}

function quoteLabel(s: string): string {
  return s.replace(/"/g, "'");
}

// Render a Mermaid flowchart of the MODULE graph only (file nodes would explode
// on a large repo). Clustered by tier, capped to the most-connected modules and
// heaviest edges, with the truncation stated explicitly — never a silent cap.
export function renderMermaid(
  graph: Graph,
  opts: { maxModules?: number; maxEdges?: number } = {},
): MermaidResult {
  const maxModules = opts.maxModules ?? DEFAULT_MAX_MODULES;
  const maxEdges = opts.maxEdges ?? DEFAULT_MAX_EDGES;

  const ranked = graph.modules
    .slice()
    .sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug));
  const shown = ranked.slice(0, maxModules);
  const shownSet = new Set(shown.map((m) => m.slug));

  const eligibleEdges = graph.moduleEdges.filter((e) => shownSet.has(e.from) && shownSet.has(e.to));
  const edges = eligibleEdges
    .slice()
    .sort((a, b) => b.weight - a.weight || byStr(a.from, b.from) || byStr(a.to, b.to))
    .slice(0, maxEdges);

  const lines: string[] = [];
  lines.push(`%% ultraindex module graph — ${shown.length} of ${graph.modules.length} modules, ${edges.length} of ${graph.moduleEdges.length} edges`);
  if (shown.length < graph.modules.length || edges.length < graph.moduleEdges.length) {
    lines.push(`%% truncated to the most-connected modules/edges; see graph.json for the full graph`);
  }
  lines.push("flowchart LR");

  // Group nodes into tier subgraphs (only tiers that have shown modules).
  for (const tier of [0, 1, 2] as Tier[]) {
    const inTier = shown.filter((m) => m.tier === tier);
    if (!inTier.length) continue;
    lines.push(`  subgraph ${TIER_LABEL[tier]}`);
    for (const m of inTier) lines.push(`    ${nodeId(m.slug)}["${quoteLabel(m.path)}"]`);
    lines.push("  end");
  }

  for (const e of edges) {
    const label = e.weight > 1 ? `|${e.weight}| ` : "";
    lines.push(`  ${nodeId(e.from)} -->${label ? " " + label : " "}${nodeId(e.to)}`);
  }

  const content = "```mermaid\n" + lines.join("\n") + "\n```\n";
  return {
    content,
    shownModules: shown.length,
    totalModules: graph.modules.length,
    shownEdges: edges.length,
    totalEdges: graph.moduleEdges.length,
  };
}
