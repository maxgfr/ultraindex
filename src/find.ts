import type { FileNode, FindResult, Graph } from "./types.js";
import { loadGraph } from "./store.js";
import { keywords } from "./util.js";
import { byStr } from "./sort.js";

const DEFAULT_K = 8;
const MAX_FILES = 8;

function textOf(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// Score a haystack against the query keywords: an exact whole-word hit counts
// more than a substring hit. Returns the score and which terms matched.
function scoreText(hay: string, kws: string[]): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const kw of kws) {
    const k = kw.toLowerCase();
    const word = new RegExp(`(^|[^a-z0-9_])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`);
    if (word.test(hay)) {
      score += 3;
      matched.push(kw);
    } else if (hay.includes(k)) {
      score += 1;
      matched.push(kw);
    }
  }
  return { score, matched };
}

// Rank modules for a task and return the EXACT files to open. This is the
// navigator's core: read the index (not the repo), match deterministically, and
// point the agent at a handful of files instead of the whole tree.
export function findModules(graph: Graph, query: string, k = DEFAULT_K): FindResult[] {
  const kws = keywords(query);
  if (kws.length === 0) return [];

  const filesByModule = new Map<string, FileNode[]>();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, (list = []));
    list.push(f);
  }

  const scored: { r: FindResult; degree: number }[] = [];
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    // Don't count a structural-fallback summary ("N file(s) in `path/`…") — it
    // just echoes the path and would double-count path tokens as if they were
    // real lexical content.
    const summary = /^\d+ file\(s\) in /.test(m.summary) ? undefined : m.summary;
    const moduleHay = textOf([m.slug, m.path, summary]);
    const mod = scoreText(moduleHay, kws);

    // Per-file scoring drives both the module score and the file ordering.
    const scoredFiles = members
      .map((f) => {
        const hay = textOf([f.rel, f.title, f.summary]);
        const s = scoreText(hay, kws);
        return { f, score: s.score, matched: s.matched, degree: f.degIn + f.degOut };
      })
      .sort((a, b) => b.score - a.score || b.degree - a.degree || byStr(a.f.rel, b.f.rel));

    // Use the best-matching file plus a small breadth bonus — NOT the raw sum —
    // so a 50-file __tests__ dir can't outrank the real implementation just by
    // having many keyword-bearing filenames.
    const bestFile = scoredFiles[0]?.score ?? 0;
    const matchCount = scoredFiles.filter((x) => x.score > 0).length;
    // Require an actual keyword hit — a module with no match shouldn't surface
    // just because it's well-connected. Degree only breaks ties among matches.
    if (mod.score === 0 && bestFile === 0) continue;

    const matchedTerms = new Set([...mod.matched, ...scoredFiles.flatMap((x) => x.matched)]);
    // Coverage: reward matching MORE of the distinct query terms, so a 2/2 match
    // outranks a 1/2 match on the same token.
    const coverageWeight = 0.4 + 0.6 * (matchedTerms.size / kws.length);
    // Tail (tests/docs/examples) down-weighted so implementation outranks tests.
    const tierWeight = m.tier === 2 ? 0.45 : 1;
    // A test/demo/sandbox dir mid-path (e.g. app/api/test-sentry-error) is not a
    // real feature even if it isn't a TIER2 leaf.
    const pathPenalty = /(^|\/|-|_)(tests?|demo|examples?|sandbox|stub|mock|fixtures?)(\/|-|_|$)/i.test(m.path) ? 0.55 : 1;
    // A generic infrastructural leaf (store/components/types/…) should rank below
    // the feature module that owns it.
    const leaf = m.path.split("/").pop() ?? "";
    const genericPenalty = /^(stores?|components?|types?|utils?|hooks?|constants?|helpers?|styles?|assets?|queries|state)$/i.test(leaf) ? 0.8 : 1;

    const keywordScore = mod.score * 2 + bestFile + Math.min(matchCount, 5) * 0.5;
    const total = keywordScore * tierWeight * pathPenalty * genericPenalty * coverageWeight + Math.min(m.degIn + m.degOut, 5) * 0.25;

    const matched = [...matchedTerms].sort(byStr);
    // Files to open: prefer those that matched; fall back to the module's
    // highest-degree members so a module match still yields concrete files.
    let files = scoredFiles.filter((x) => x.score > 0).map((x) => x.f.rel);
    if (files.length === 0) {
      files = members
        .slice()
        .sort((a, b) => b.degIn + b.degOut - (a.degIn + a.degOut) || byStr(a.rel, b.rel))
        .map((f) => f.rel);
    }
    const neighbors = [
      ...graph.moduleEdges.filter((e) => e.from === m.slug).map((e) => e.to),
      ...graph.moduleEdges.filter((e) => e.to === m.slug).map((e) => e.from),
    ];

    scored.push({
      degree: m.degIn + m.degOut,
      r: {
        slug: m.slug,
        path: m.path,
        title: m.title,
        tier: m.tier,
        score: Number(total.toFixed(3)),
        matched,
        files: files.slice(0, MAX_FILES),
        neighbors: [...new Set(neighbors)].sort(byStr).slice(0, 8),
      },
    });
  }

  // Tie-break by degree (centrality) then slug — never by name luck alone.
  scored.sort((a, b) => b.r.score - a.r.score || b.degree - a.degree || byStr(a.r.slug, b.r.slug));
  return scored.slice(0, k).map((x) => x.r);
}

export function runFind(outDir: string, query: string, k = DEFAULT_K): FindResult[] | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  return findModules(graph, query, k);
}
