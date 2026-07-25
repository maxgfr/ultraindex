import { join } from "node:path";
import type { Tier } from "./types.js";
import { loadGraph, loadManifest, indexPaths } from "./store.js";
import { readIfExists } from "./output.js";
import { parseRegions, isEnrichedBody } from "./merge.js";
import { proseDigest, proseFreshness, type ProseFreshness } from "./prose.js";
import { byStr } from "./engine.js";

export interface ModuleStatus {
  slug: string;
  path: string;
  tier: Tier;
  degree: number; // degIn + degOut — how load-bearing the module is
  enriched: boolean; // at least one human region carries real prose
  tested: boolean; // at least one test file covers a member (testedBy stamped)
  regions: { enriched: number; total: number }; // human regions filled / declared
  // Whether this entry's prose still describes the source it was written
  // against, AS OF THE LAST BUILD (status never walks the repo — `check` is the
  // live-verified tier).
  prose: ProseFreshness;
}

export interface StatusResult {
  enriched: number; // modules with at least one enriched region
  total: number;
  untested: number; // testable modules (tier ≤ 1, code, symbols) with no covering test
  proseStale: number; // enriched modules whose source moved after the prose was written
  suggestedNext: string[]; // first slugs needing work, in enrichment order
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
  // Read straight from disk, as advertised: compare against the manifest's
  // hashes rather than re-walking the repo. Immediately after a build those ARE
  // the current source, so the answer is exact; between builds `check` covers
  // the delta. Two clean tiers — status is zero-cost, check is live-verified.
  const manifest = loadManifest(outDir);

  const modules: ModuleStatus[] = graph.modules.map((m) => {
    let total = 0;
    let filled = 0;
    let prose: ProseFreshness = "none";
    const text = readIfExists(join(enc, `${m.slug}.md`));
    if (text) {
      const parsed = parseRegions(text);
      if (parsed.ok) {
        for (const r of parsed.regions) {
          if (r.type !== "human") continue;
          total++;
          if (isEnrichedBody(r.body)) filled++;
        }
        const recorded = manifest?.modules[m.slug];
        prose = proseFreshness(
          recorded?.prose,
          proseDigest(parsed.regions),
          recorded?.members ?? m.members,
          manifest?.fileHashes ?? {},
        );
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
      prose,
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

  // Stale prose ranks ABOVE never-enriched. A missing explanation misleads
  // nobody; a stale one actively asserts something that may now be false, and
  // downstream trusts it MORE — `find` reports `enriched` as higher-signal and
  // boosts that prose in ranking. Stale prose is a load-bearing lie: fix first.
  const rank = (m: ModuleStatus): number => (m.prose === "stale" ? 0 : m.enriched ? 2 : 1);
  modules.sort(
    (a, b) =>
      rank(a) - rank(b) || // stale prose, then never-enriched, then done
      Number(a.tier === 2) - Number(b.tier === 2) || // tail enriches last
      b.degree - a.degree || // most-connected first
      byStr(a.slug, b.slug),
  );

  const enriched = modules.filter((m) => m.enriched).length;
  const needsWork = modules.filter((m) => !m.enriched || m.prose === "stale");
  return {
    enriched,
    total: modules.length,
    untested,
    proseStale: modules.filter((m) => m.prose === "stale").length,
    suggestedNext: needsWork.slice(0, 5).map((m) => m.slug),
    modules,
  };
}
