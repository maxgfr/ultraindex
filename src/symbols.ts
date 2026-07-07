import type { Graph, SymbolIndex } from "./types.js";
import { loadGraph, loadSymbols } from "./store.js";
import { splitIdentifier } from "./lex.js";
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

// Look up a symbol by name: an exact match first, else names that share the
// query as an identifier sub-token (getUser → getUserProfile) or a substring.
// Answers "where is X defined, and what references it" from symbols.json, so it
// costs no repo re-scan.
export function lookupSymbols(index: SymbolIndex, graph: Graph, query: string): SymbolResult {
  const moduleOf = new Map(graph.files.map((f) => [f.rel, f.module]));
  const names = Object.keys(index.defs);
  const q = query.toLowerCase();

  let matches: string[];
  if (index.defs[query]) {
    matches = [query];
  } else {
    const qParts = new Set(splitIdentifier(query).map((p) => p.toLowerCase()));
    matches = names
      .filter((n) => {
        const lower = n.toLowerCase();
        if (lower.includes(q)) return true;
        const parts = new Set(splitIdentifier(n).map((p) => p.toLowerCase()));
        for (const p of qParts) if (parts.has(p)) return true;
        return false;
      })
      // Exact-case, then shortest name (closest match), then alphabetical.
      .sort((a, b) => Number(b === query) - Number(a === query) || a.length - b.length || byStr(a, b))
      .slice(0, MAX_HITS);
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
