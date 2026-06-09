import { loadGraph } from "./store.js";
import { renderModuleDossier, renderAskDossier } from "./evidence.js";
import { findModules } from "./find.js";

// Per-module grounding packet for the enrichment pass. Returns undefined when the
// index is missing or the slug is unknown.
export function runDossier(outDir: string, repo: string, slug: string): string | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const module = graph.modules.find((m) => m.slug === slug);
  if (!module) return undefined;
  return renderModuleDossier(repo, graph, module);
}

// Question-driven grounding packet for the Q&A workflow.
export function runAsk(
  outDir: string,
  repo: string,
  question: string,
  k = 5,
): { content: string; modules: string[] } | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const results = findModules(graph, question, k);
  const modules = results.map((r) => ({ slug: r.slug, files: r.files }));
  return { content: renderAskDossier(repo, graph, question, modules), modules: results.map((r) => r.slug) };
}
