import { join, basename, extname } from "node:path";
import type { FileNode, FindResult, Graph, ModuleNode } from "./types.js";
import { loadGraph, loadSymbols, indexPaths } from "./store.js";
import { readIfExists } from "./output.js";
import { humanBodies, isEnrichedBody } from "./merge.js";
import { buildHaystack, queryTerms, scoreHaystack, splitIdentifier } from "./lex.js";
import type { QueryTerm } from "./lex.js";
import { exportedNamesByFile } from "./symbols.js";
import { rrf } from "./util.js";
import { byStr } from "./sort.js";
import { loadVectors } from "./vectors.js";
import { loadSemanticConfig, embedTexts, cosine } from "./semantic.js";

const DEFAULT_K = 8;
const MAX_FILES = 8;
// Below this cosine, a "semantic match" is noise. bge/nomic-class models put
// genuinely related text well above it; some hosted models (OpenAI v3) score
// related pairs in the 0.2–0.4 band, so the floor stays low. Dropping the noise
// just degrades hybrid toward lexical for that query — it never errors.
const MIN_COSINE = 0.25;

// Related module slugs, both directions, deduped and capped.
function moduleNeighbors(graph: Graph, slug: string): string[] {
  const ns = [
    ...graph.moduleEdges.filter((e) => e.from === slug).map((e) => e.to),
    ...graph.moduleEdges.filter((e) => e.to === slug).map((e) => e.from),
  ];
  return [...new Set(ns)].sort(byStr).slice(0, 8);
}

function textOf(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// Verified analysis written into `ui:human` regions is the highest-signal text
// in the index — weight it above the structural summary, below nothing.
const PROSE_WEIGHT = 1.5;

// Load each module's enriched prose (stub regions excluded) for query-time
// scoring. Citations and other bracketed tokens are stripped so `[file:line]`
// references don't pollute keyword matching. Read at query time — prose written
// AFTER the last build is searchable immediately, and graph.json stays untouched.
export function loadEnrichedProse(outDir: string, graph: Graph): Map<string, string> {
  const enc = indexPaths(outDir).encyclopedia;
  const out = new Map<string, string>();
  for (const m of graph.modules) {
    const text = readIfExists(join(enc, `${m.slug}.md`));
    if (!text) continue;
    const bodies = [...humanBodies(text).values()].filter(isEnrichedBody);
    if (!bodies.length) continue;
    out.set(m.slug, bodies.join(" ").replace(/\[[^\]]*\]/g, " ").toLowerCase());
  }
  return out;
}

// Score EVERY matched module and return the FULL sorted list (score desc, degree
// desc, slug). The seed/expansion layer needs rows below the top-k, so scoring is
// factored out here; `findModules` is the top-k slice of this. `symbolNames` maps
// a file rel → its exported symbol names, folded into that file's haystack so a
// query naming an exported identifier surfaces its owning module even when no
// title/summary/path mentions it. Absent ⇒ identical to symbol-free scoring.
export function scoreModules(
  graph: Graph,
  query: string,
  prose?: Map<string, string>,
  symbolNames?: Map<string, string[]>,
): { r: FindResult; degree: number }[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  // Exported symbol names declared in a file, folded into its haystack.
  const namesOf = (rel: string): string => (symbolNames?.get(rel) ?? []).join(" ");

  const filesByModule = new Map<string, FileNode[]>();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, (list = []));
    list.push(f);
  }

  const moduleSummary = (m: ModuleNode): string | undefined =>
    // A structural-fallback summary ("N file(s) in `path/`…") just echoes the
    // path — never count it as lexical content.
    /^\d+ file\(s\) in /.test(m.summary) ? undefined : m.summary;

  // IDF pre-pass: document frequency of each query term across MODULES (the
  // ranked unit). A term that hits almost every module carries little signal; a
  // rare one is discriminating. idf = clamp(0.5, 2.0, 1 + ln((N+1)/(df+1))).
  const N = graph.modules.length;
  const df = new Map<string, number>();
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    const combined =
      textOf([m.slug, m.path, moduleSummary(m)]) +
      " " +
      (prose?.get(m.slug) ?? "") +
      " " +
      // Must fold in the SAME symbol names as the scored haystacks, or df/idf
      // would drift from what's actually scored below.
      members.map((f) => textOf([f.rel, f.title, f.summary, namesOf(f.rel)])).join(" ");
    for (const raw of new Set(scoreHaystack(buildHaystack(combined), terms).matched)) {
      df.set(raw, (df.get(raw) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const t of terms) {
    const d = df.get(t.raw) ?? 0;
    idf.set(t.raw, Math.min(2, Math.max(0.5, 1 + Math.log((N + 1) / (d + 1)))));
  }

  // Full-query tier, computed once: the whole query joined into one string, and
  // the largest IDF among its terms (the bonus scales with the query's rarity).
  const joined = terms.map((t) => t.exact).join(" ");
  const maxIdf = Math.max(1, ...terms.map((t) => idf.get(t.raw) ?? 1));

  const scored: { r: FindResult; degree: number }[] = [];
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    const summary = moduleSummary(m);
    const moduleHay = textOf([m.slug, m.path, summary]);
    const mod = scoreHaystack(buildHaystack(moduleHay), terms, false, idf);
    const enrichedText = prose?.get(m.slug);
    // Enriched prose is the only long haystack — score it with saturation and
    // length normalization so verbose entries can't win on repetition alone.
    const pro = enrichedText
      ? scoreHaystack(buildHaystack(enrichedText), terms, true, idf)
      : { score: 0, matched: [] as string[] };

    // Per-file scoring drives both the module score and the file ordering.
    const scoredFiles = members
      .map((f) => {
        const hay = textOf([f.rel, f.title, f.summary, namesOf(f.rel)]);
        const s = scoreHaystack(buildHaystack(hay), terms, false, idf);
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
    if (mod.score === 0 && bestFile === 0 && pro.score === 0) continue;

    const matchedTerms = new Set([...mod.matched, ...pro.matched, ...scoredFiles.flatMap((x) => x.matched)]);
    // Coverage: reward matching MORE of the distinct query terms. Squared so a
    // 1-of-5 collision on a single term can't ride a high tier past a 3-of-5
    // match; the 0.4 floor is kept because ultraindex's blended score must not
    // zero out partial matches.
    const coverageWeight = 0.4 + 0.6 * (matchedTerms.size / terms.length) ** 2;
    // Tail (tests/docs/examples) down-weighted so implementation outranks tests.
    const tierWeight = m.tier === 2 ? 0.45 : 1;
    // A test/demo/sandbox dir mid-path (e.g. app/api/test-sentry-error) is not a
    // real feature even if it isn't a TIER2 leaf.
    const pathPenalty = /(^|\/|-|_)(tests?|demo|examples?|sandbox|stub|mock|fixtures?)(\/|-|_|$)/i.test(m.path) ? 0.55 : 1;
    // A generic infrastructural leaf (store/components/types/…) should rank below
    // the feature module that owns it.
    const leaf = m.path.split("/").pop() ?? "";
    const genericPenalty = /^(stores?|components?|types?|utils?|hooks?|constants?|helpers?|styles?|assets?|queries|state)$/i.test(leaf) ? 0.8 : 1;

    // Full-query bonus: does the WHOLE query match a token-normalized module
    // label — its slug, its path, or a member's basename (extension dropped)?
    // Exact equality is worth more than a shared prefix; take the max, one
    // bonus per module.
    const labels = [
      splitIdentifier(m.slug).join(" "),
      splitIdentifier(m.path).join(" "),
      ...members.map((f) => splitIdentifier(basename(f.rel, extname(f.rel))).join(" ")),
      // An exported symbol name whose token form IS the whole query is as strong
      // a label as a matching basename — a query naming a function should lift its
      // module the same way its filename would.
      ...members.flatMap((f) => (symbolNames?.get(f.rel) ?? []).map((n) => splitIdentifier(n).join(" "))),
    ];
    const fullQuery = labels.some((l) => l === joined)
      ? 10 * maxIdf
      : labels.some((l) => l.startsWith(joined))
        ? 4 * maxIdf
        : 0;

    // Deliberate deviation from graphify: the full-query bonus is folded INTO
    // keywordScore rather than added after the penalties, so the tier/path/
    // generic and coverage factors below still apply — ultraindex wants a
    // test-dir module demoted even when its name is an exact query hit.
    const keywordScore = mod.score * 2 + pro.score * PROSE_WEIGHT + bestFile + Math.min(matchCount, 5) * 0.5 + fullQuery;
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
        neighbors: moduleNeighbors(graph, m.slug),
        enriched: enrichedText !== undefined,
      },
    });
  }

  // Tie-break by degree (centrality) then slug — never by name luck alone.
  scored.sort((a, b) => b.r.score - a.r.score || b.degree - a.degree || byStr(a.r.slug, b.r.slug));
  return scored;
}

// Rank modules for a task and return the EXACT files to open. This is the
// navigator's core: read the index (not the repo), match deterministically, and
// point the agent at a handful of files instead of the whole tree. The top-k
// slice of `scoreModules`; the trailing `symbolNames` is optional so existing
// callers keep their exact behavior.
export function findModules(
  graph: Graph,
  query: string,
  k = DEFAULT_K,
  prose?: Map<string, string>,
  symbolNames?: Map<string, string[]>,
): FindResult[] {
  return scoreModules(graph, query, prose, symbolNames).slice(0, k).map((x) => x.r);
}

// graphify's seed constants, verbatim: at most 3 seeds, and a seed must score at
// least 20% of the top hit.
const MAX_SEEDS = 3;
const SEED_GAP_RATIO = 0.2;

// Pick the module slugs to expand the graph from. Walk the full sorted list
// top-down taking up to 3 seeds, stopping once a row drops below 20% of the top
// score. Then a per-term guarantee: for each query term with no seed covering it,
// append the first (highest-ranked) module that DID match that term, so a term
// whose only bearer sits below top-k is never silently dropped.
export function pickSeeds(scored: { r: FindResult; degree: number }[], terms: QueryTerm[]): string[] {
  if (scored.length === 0) return [];
  const topScore = scored[0]!.r.score;
  const seeds: string[] = [];
  const picked = new Set<string>();
  const matchedBySlug = new Map(scored.map((s) => [s.r.slug, s.r.matched]));
  for (const s of scored) {
    if (seeds.length >= MAX_SEEDS) break;
    if (s.r.score < SEED_GAP_RATIO * topScore) break;
    seeds.push(s.r.slug);
    picked.add(s.r.slug);
  }
  for (const t of terms) {
    if (seeds.some((slug) => matchedBySlug.get(slug)?.includes(t.raw))) continue;
    const hit = scored.find((s) => s.r.matched.includes(t.raw));
    if (hit && !picked.has(hit.r.slug)) {
      seeds.push(hit.r.slug);
      picked.add(hit.r.slug);
    }
  }
  return seeds;
}

// Graph-expansion depth and the hub floor. Below 50 there is no gating (the
// intended never-worse behavior on small graphs); above it, a hyper-connected
// module is visited but not expanded through so a hub can't drag in the world.
const EXPAND_DEPTH = 2;
const HUB_FLOOR = 50;

// The hub-gating threshold over a degree distribution: max(50, p99). p99 = the
// degree at index min(n-1, floor(0.99n)) of the ASCENDING degree array (numeric
// sort — deterministic without byStr). Exported so `neighbors`' BFS gates on the
// exact same rule this module's `expandResults` applies to graph expansion.
export function hubThreshold(degrees: number[]): number {
  const sorted = degrees.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const p99 = n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(0.99 * n))]!;
  return Math.max(HUB_FLOOR, p99);
}

// Append graph context to the ranked top-k. Two kinds of rows are added after
// `top` (unchanged, in order), deduped by slug, total length capped at k + 4:
//   1. per-term-guarantee seeds not already shown — their REAL scored row from
//      `fullScored`, marked via:"term";
//   2. modules discovered by an undirected, all-kinds, depth-2 BFS from the seeds
//      over the module graph, as bare rows marked via:"graph".
// Gap seeds are the highest-scored modules and are already inside `top`; a seed
// missing from `top` is therefore a per-term guarantee row ranked below it.
export function expandResults(
  graph: Graph,
  top: FindResult[],
  fullScored: { r: FindResult; degree: number }[],
  seeds: string[],
  k: number,
  // Slugs whose entry carries enriched prose, so a BFS-discovered bare row reports
  // its real enriched state instead of a hardcoded false. Absent ⇒ none enriched.
  enrichedSlugs?: Set<string>,
): FindResult[] {
  const cap = k + 4;
  const out: FindResult[] = [...top];
  const present = new Set(out.map((r) => r.slug));
  const rowBySlug = new Map(fullScored.map((s) => [s.r.slug, s.r]));
  const moduleBySlug = new Map(graph.modules.map((m) => [m.slug, m]));
  const degreeOf = (slug: string): number => {
    const m = moduleBySlug.get(slug);
    return m ? m.degIn + m.degOut : 0;
  };

  // 1. per-term guarantee rows (seeds not already surfaced), in seed order.
  for (const slug of seeds) {
    if (out.length >= cap) break;
    if (present.has(slug)) continue;
    const r = rowBySlug.get(slug);
    if (!r) continue;
    out.push({ ...r, via: "term" });
    present.add(slug);
  }

  const threshold = hubThreshold(graph.modules.map((m) => m.degIn + m.degOut));

  // Undirected adjacency over resolved module edges only (a dangling edge points
  // at an unresolved spec, not a real module).
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (const e of graph.moduleEdges) {
    if (e.dangling) continue;
    if (!moduleBySlug.has(e.from) || !moduleBySlug.has(e.to)) continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }

  // BFS: seeds at depth 0 always expand; a non-seed hub (degree ≥ threshold) is
  // recorded but its edges are not followed. Neighbours sorted by byStr so the
  // level-order is stable (final output is re-sorted, but visitation is fixed).
  const seedSet = new Set(seeds);
  const depth = new Map<string, number>();
  const queue: { slug: string; d: number }[] = [];
  for (const s of [...seeds].sort(byStr)) {
    if (!moduleBySlug.has(s) || depth.has(s)) continue;
    depth.set(s, 0);
    queue.push({ slug: s, d: 0 });
  }
  for (let i = 0; i < queue.length; i++) {
    const { slug, d } = queue[i]!;
    const expand = d < EXPAND_DEPTH && (seedSet.has(slug) || degreeOf(slug) < threshold);
    if (!expand) continue;
    for (const nb of [...(adj.get(slug) ?? [])].sort(byStr)) {
      if (depth.has(nb)) continue;
      depth.set(nb, d + 1);
      queue.push({ slug: nb, d: d + 1 });
    }
  }

  // 2. BFS-discovered modules (depth ≥ 1), ordered depth asc, degree desc, slug.
  const filesByModule = new Map<string, FileNode[]>();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, (list = []));
    list.push(f);
  }
  const discovered = [...depth.entries()]
    .filter(([, d]) => d >= 1)
    .sort((a, b) => a[1] - b[1] || degreeOf(b[0]) - degreeOf(a[0]) || byStr(a[0], b[0]));
  for (const [slug] of discovered) {
    if (out.length >= cap) break;
    if (present.has(slug)) continue;
    const m = moduleBySlug.get(slug);
    if (!m) continue;
    out.push({ ...bareRow(graph, m, filesByModule.get(slug) ?? [], enrichedSlugs?.has(slug) ?? false), via: "graph" });
    present.add(slug);
  }
  return out.slice(0, cap);
}

// Build the exported-symbol-name map for an index, once, from symbols.json. A
// missing or schema-mismatched symbols.json yields undefined — find then behaves
// exactly as before symbol names were indexed.
function loadSymbolNames(outDir: string): Map<string, string[]> | undefined {
  const index = loadSymbols(outDir);
  return index ? exportedNamesByFile(index) : undefined;
}

export function runFind(outDir: string, query: string, k = DEFAULT_K): FindResult[] | undefined {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const prose = loadEnrichedProse(outDir, graph);
  const full = scoreModules(graph, query, prose, loadSymbolNames(outDir));
  const top = full.slice(0, k).map((x) => x.r);
  return expandResults(graph, top, full, pickSeeds(full, queryTerms(query)), k, new Set(prose.keys()));
}

// A result row for a module that surfaced semantically but never matched a
// keyword: no lexical score, files by degree (the same fallback findModules
// uses when a module matches but none of its files do).
function bareRow(graph: Graph, m: ModuleNode, members: FileNode[], enriched: boolean): FindResult {
  const files = members
    .slice()
    .sort((a, b) => b.degIn + b.degOut - (a.degIn + a.degOut) || byStr(a.rel, b.rel))
    .map((f) => f.rel)
    .slice(0, MAX_FILES);
  return {
    slug: m.slug,
    path: m.path,
    title: m.title,
    tier: m.tier,
    score: 0,
    matched: [],
    files,
    neighbors: moduleNeighbors(graph, m.slug),
    enriched,
  };
}

export interface HybridFind {
  results: FindResult[];
  semantic: boolean; // true when the cosine ranking actually contributed
  warning?: string; // why the semantic side was skipped, when it was
}

// Hybrid find: fuse the lexical ranking with a cosine ranking over the stored
// module vectors (Reciprocal Rank Fusion — no score-scale juggling). The
// semantic side is strictly additive and strictly optional: without
// vectors.json this NEVER touches the network and returns exactly the lexical
// results; with it, any provider failure degrades to lexical with a warning.
export async function runFindHybrid(outDir: string, query: string, k = DEFAULT_K): Promise<HybridFind | undefined> {
  const graph = loadGraph(outDir);
  if (!graph) return undefined;
  const prose = loadEnrichedProse(outDir, graph);
  const pool = Math.max(k * 3, 24);
  const full = scoreModules(graph, query, prose, loadSymbolNames(outDir));
  const lexical = full.slice(0, pool).map((x) => x.r);
  // Seeds come from the LEXICAL scored list (rows with score > 0); expansion is
  // applied to whatever ranked list is ultimately returned — the fused list when
  // semantic ran, else the lexical one it degrades to.
  const seeds = pickSeeds(full, queryTerms(query));
  const expand = (topRows: FindResult[]): FindResult[] => expandResults(graph, topRows, full, seeds, k, new Set(prose.keys()));

  const store = loadVectors(outDir);
  if (!store) return { results: expand(lexical.slice(0, k)), semantic: false };

  const lexOnly = (warning: string): HybridFind => ({ results: expand(lexical.slice(0, k)), semantic: false, warning });
  const cfg = loadSemanticConfig(outDir);
  if (!cfg) {
    return lexOnly("vectors.json present but no semantic config (env or semantic.json) — lexical-only results");
  }
  let queryVector: number[];
  try {
    const [v] = await embedTexts(cfg, [query]);
    queryVector = v!;
  } catch (e) {
    return lexOnly(`semantic provider unavailable (${(e as Error).message}) — lexical-only results`);
  }
  if (queryVector.length !== store.dim) {
    return lexOnly(`query embedding dim ${queryVector.length} != vectors.json dim ${store.dim} (model changed?) — re-run \`ultraindex embed\`; lexical-only results`);
  }

  const moduleBySlug = new Map(graph.modules.map((m) => [m.slug, m]));
  const semanticSlugs = Object.entries(store.vectors)
    .filter(([slug]) => moduleBySlug.has(slug)) // a stale store may carry gone modules
    .map(([slug, rec]) => ({ slug, cos: cosine(queryVector, rec.v) }))
    .filter((s) => s.cos >= MIN_COSINE) // drop noise floor before fusing
    .sort((a, b) => b.cos - a.cos || byStr(a.slug, b.slug))
    .slice(0, pool)
    .map((s) => s.slug);

  const lexicalSlugs = lexical.map((r) => r.slug);
  const fused = rrf([lexicalSlugs, semanticSlugs], (s) => s);
  const lexRank = new Map(lexicalSlugs.map((s, i) => [s, i]));
  const semRank = new Map(semanticSlugs.map((s, i) => [s, i + 1])); // 1-based, reported
  const ordered = [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || (lexRank.get(a[0]) ?? 1e9) - (lexRank.get(b[0]) ?? 1e9) || byStr(a[0], b[0]))
    .slice(0, k)
    .map(([slug]) => slug);

  const lexRow = new Map(lexical.map((r) => [r.slug, r]));
  const filesByModule = new Map<string, FileNode[]>();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, (list = []));
    list.push(f);
  }
  const fusedTop = ordered.map((slug) => {
    const sem = semRank.get(slug);
    const row =
      lexRow.get(slug) ?? bareRow(graph, moduleBySlug.get(slug)!, filesByModule.get(slug) ?? [], prose.has(slug));
    return sem !== undefined ? { ...row, semanticRank: sem } : row;
  });
  return { results: expand(fusedTop), semantic: true };
}
