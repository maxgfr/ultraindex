import type { Graph, SymbolIndex } from "./types.js";
import { loadGraph, loadSymbols } from "./store.js";
import { splitIdentifier } from "./lex.js";
import { keywords, foldText } from "./util.js";
import { byStr } from "./sort.js";

export interface SymbolSite {
  file: string;
  line: number;
  kind: string;
  exported: boolean;
  lang: string;
  parent?: string;
  module: string;
}

export interface SymbolHit {
  name: string;
  defs: SymbolSite[];
  refs: string[]; // files that reference the name
}

export interface SymbolResult {
  query: string;
  hits: SymbolHit[];
}

const MAX_HITS = 20;

// Tiered lexical scores over a symbol name (graphify's `_score_nodes`): an exact
// term match dwarfs a prefix, which dwarfs a substring, which dwarfs a hit that
// lives only in the def's file path. The 10× gaps let per-term IDF reorder
// WITHIN a tier without ever crossing one.
const EXACT = 1000, PREFIX = 100, SUBSTRING = 1, SOURCE = 0.5;

// Look up a symbol by name. An exact key hit short-circuits to that one symbol;
// otherwise rank every def name by the tiered scorer above so the closest names
// surface first. Answers "where is X defined, and what references it" from
// symbols.json, so it costs no repo re-scan.
export function lookupSymbols(index: SymbolIndex, graph: Graph, query: string): SymbolResult {
  const moduleOf = new Map(graph.files.map((f) => [f.rel, f.module]));
  const names = Object.keys(index.defs);

  let matches: string[];
  if (index.defs[query]) {
    matches = [query];
  } else {
    // keywords() already folds + dedupes order-preserving; lowercase so terms
    // compare against the case-folded labels. An all-stopword/short query falls
    // back to the whole folded string so it still ranks something.
    let terms = keywords(query).map((t) => t.toLowerCase());
    if (terms.length === 0) terms = [foldText(query).toLowerCase()];

    // Per name: the flattened label, its identifier subtokens joined (so a
    // prefix hit can land on a leading subtoken, not just a raw prefix), and its
    // lowercased def file paths for the source-hit signal.
    const normLabels = names.map((n) => foldText(n).toLowerCase());
    const labelTokens = names.map((n) => splitIdentifier(n).join(" ").toLowerCase());
    const sourcePaths = names.map((n) => (index.defs[n] ?? []).map((d) => d.file.toLowerCase()));

    // UNCLAMPED IDF over def names — the tier gaps absorb its range, so it only
    // reorders within a tier. df(t) = names whose flattened label contains t.
    const N = names.length;
    const idf = new Map<string, number>();
    for (const t of terms) {
      const dfT = normLabels.reduce((c, l) => c + (l.includes(t) ? 1 : 0), 0);
      idf.set(t, Math.log(1 + N / (1 + dfT)));
    }
    const joined = terms.join(" ");
    const maxIdf = Math.max(...terms.map((t) => idf.get(t) ?? 0)) || 1;

    const scored: { name: string; score: number }[] = [];
    for (let i = 0; i < names.length; i++) {
      const normLabel = normLabels[i]!;
      const label = labelTokens[i]!;
      const paths = sourcePaths[i]!;
      let score = 0;
      let tiered = 0; // exact/prefix credit, scaled by coverage below
      let matched = 0;
      // Full-query tier: the entire query matches the whole label.
      if (joined === normLabel || joined === label) score += EXACT * 10 * maxIdf;
      else if (normLabel.startsWith(joined) || label.startsWith(joined)) score += PREFIX * 10 * maxIdf;
      for (const t of terms) {
        const w = idf.get(t) ?? 0;
        // Strongest tier only. A substring hit counts for coverage but is not
        // itself scaled by it (it goes straight into `score`, not `tiered`).
        if (t === normLabel) { tiered += EXACT * w; matched++; }
        else if (normLabel.startsWith(t) || label.startsWith(t)) { tiered += PREFIX * w; matched++; }
        else if (normLabel.includes(t)) { score += SUBSTRING * w; matched++; }
        // A term found only in the def's file path is a weak independent signal
        // with NO coverage credit — graphify's deliberate rule.
        if (paths.some((p) => p.includes(t))) score += SOURCE * w;
      }
      // Coverage², as in findModules: a broad multi-term match beats a single
      // strong collision.
      score += tiered * (matched / terms.length) ** 2;
      if (score > 0) scored.push({ name: names[i]!, score });
    }
    // Best score, then shortest name (closest match), then alphabetical.
    matches = scored
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length || byStr(a.name, b.name))
      .slice(0, MAX_HITS)
      .map((x) => x.name);
  }

  const hits: SymbolHit[] = matches.map((name) => ({
    name,
    defs: (index.defs[name] ?? []).map((d) => ({ ...d, module: moduleOf.get(d.file) ?? "root" })),
    refs: index.refs[name] ?? [],
  }));
  return { query, hits };
}

export function runSymbols(outDir: string, query: string): SymbolResult | undefined {
  const graph = loadGraph(outDir);
  const index = loadSymbols(outDir);
  if (!graph || !index) return undefined;
  return lookupSymbols(index, graph, query);
}
