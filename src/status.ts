import { join } from "node:path";
import type { Tier } from "./types.js";
import { loadGraph, indexPaths } from "./store.js";
import { readIfExists } from "./output.js";
import { parseRegions, isEnrichedBody } from "./merge.js";
import { byStr } from "./sort.js";

export interface ModuleStatus {
  slug: string;
  path: string;
  tier: Tier;
  degree: number; // degIn + degOut — how load-bearing the module is
  enriched: boolean; // at least one human region carries real prose
  tested: boolean; // at least one test file covers a member (testedBy stamped)
  regions: { enriched: number; total: number }; // human regions filled / declared
}

export interface StatusResult {
  enriched: number; // modules with at least one enriched region
  total: number;
  untested: number; // testable modules (tier ≤ 1, code, symbols) with no covering test
  suggestedNext: string[]; // first unenriched slugs, in enrichment order
  modules: ModuleStatus[]; // ALL modules, sorted in the order an agent should enrich
}

// The enrichment work-queue: which modules still hold stubs, ordered by where
// prose buys the most navigation value — unenriched first, foundations/features
// before tail, most-connected first. An agent enriching under a budget walks
// this list top-down; `status` read straight from disk, so prose written since
// the last build counts immediately.
export function runStatus(outDir: string): StatusResult | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const enc = indexPaths(outDir).encyclopedia;

  const modules: ModuleStatus[] = graph.modules.map((m) => {
    let total = 0;
    let filled = 0;
    const text = readIfExists(join(enc, `${m.slug}.md`));
    if (text) {
      const parsed = parseRegions(text);
      if (parsed.ok) {
        for (const r of parsed.regions) {
          if (r.type !== "human") continue;
          total++;
          if (isEnrichedBody(r.body)) filled++;
        }
      }
    }
    return {
      slug: m.slug,
      path: m.path,
      tier: m.tier,
      degree: m.degIn + m.degOut,
      enriched: filled > 0,
      tested: Boolean(m.testedBy?.length),
      regions: { enriched: filled, total },
    };
  });

  // Same "testable" rule as the INDEX.md Tests line, from the stamped fields:
  // tier ≤ 1, declared symbols, and at least one non-test code member.
  const nonTestCode = new Set<string>();
  for (const f of graph.files) {
    if (f.fileKind === "code" && !f.testFile) nonTestCode.add(f.module);
  }
  const untested = graph.modules.filter(
    (m) => m.tier <= 1 && m.symbols > 0 && nonTestCode.has(m.slug) && !m.testedBy?.length,
  ).length;

  modules.sort(
    (a, b) =>
      Number(a.enriched) - Number(b.enriched) || // work first, done last
      Number(a.tier === 2) - Number(b.tier === 2) || // tail enriches last
      b.degree - a.degree || // most-connected first
      byStr(a.slug, b.slug),
  );

  const enriched = modules.filter((m) => m.enriched).length;
  return {
    enriched,
    total: modules.length,
    untested,
    suggestedNext: modules.filter((m) => !m.enriched).slice(0, 5).map((m) => m.slug),
    modules,
  };
}
