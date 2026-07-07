import { loadGraph } from "./store.js";
import { renderModuleDossier, renderAskDossier } from "./evidence.js";
import { runFindHybrid } from "./find.js";

// Per-module grounding packet for the enrichment pass. Returns undefined when the
// index is missing or the slug is unknown.
export function runDossier(outDir: string, repo: string, slug: string): string | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const module = graph.modules.find((m) => m.slug === slug);
  if (!module) return undefined;
  return renderModuleDossier(repo, graph, module);
}

// Question-driven grounding packet for the Q&A workflow. Uses the SAME hybrid
// ranking as `find` (lexical + enriched prose, plus the semantic layer when
// vectors.json exists) so `ask` can surface a module that answers the question
// without sharing its vocabulary. Degrades to lexical exactly like `find`.
export async function runAsk(
  outDir: string,
  repo: string,
  question: string,
  k = 5,
): Promise<{ content: string; modules: string[]; warning?: string } | undefined> {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const found = await runFindHybrid(outDir, question, k);
  if (!found) return undefined;
  const modules = found.results.map((r) => ({ slug: r.slug, files: r.files }));
  return {
    content: renderAskDossier(repo, graph, question, modules),
    modules: found.results.map((r) => r.slug),
    warning: found.warning,
  };
}
