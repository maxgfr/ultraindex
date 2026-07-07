import { keywords } from "./util.js";

// Lexical matching primitives for `find`: identifier splitting, conservative
// stemming, and a small code-domain synonym table. Everything here is pure and
// deterministic — same input, same output, no I/O.

// Split an identifier into its subtokens: camelCase/PascalCase humps, acronym
// boundaries (HTTPServer -> http server), snake/kebab separators, and
// letter<->digit boundaries (OAuth2Token -> oauth 2 token). Lowercased, deduped,
// order-preserving.
export function splitIdentifier(token: string): string[] {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of spaced.split(/[^A-Za-z0-9]+| /)) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

// Conservative suffix stemmer: plurals, -ing, -ed, and a trailing -e so that
// "parse"/"parsing"/"parses" all land on "pars". Deliberately NOT Porter —
// over-stemming is worse than under-stemming for code identifiers. Never stems
// tokens carrying digits (status codes, versions) and never below 3 chars.
export function stem(token: string): string {
  if (token.length < 4 || /\d/.test(token)) return token;
  let t = token;
  if (t.length >= 5 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
  else if (/(ses|xes|zes|ches|shes)$/.test(t)) t = t.slice(0, -2);
  else if (!t.endsWith("ss") && t.endsWith("s")) t = t.slice(0, -1);
  if (t.length >= 6 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length >= 5 && t.endsWith("ed")) t = t.slice(0, -2);
  if (t.length >= 5 && t.endsWith("e")) t = t.slice(0, -1);
  return t.length >= 3 ? t : token;
}

// Small, code-domain synonym groups. Matching is by stemmed form, so plural and
// -ing variants of these words resolve to the same group. Kept deliberately
// short: every group is a chance for a false positive.
const SYNONYM_GROUPS: string[][] = [
  ["auth", "authentication", "authn", "login", "signin", "signon", "sso", "session"],
  ["perm", "permission", "authz", "authorization", "acl", "role", "rbac"],
  ["db", "database", "storage", "persistence", "sql"],
  ["config", "configuration", "settings", "options", "preferences"],
  ["init", "initialize", "initialise", "setup", "bootstrap"],
  ["delete", "remove", "destroy", "drop"],
  ["fetch", "request", "http", "api"],
  ["error", "exception", "failure", "fault"],
  ["user", "account", "profile"],
  ["test", "spec", "unittest"],
  ["dir", "directory", "folder"],
  ["doc", "docs", "documentation", "readme"],
  ["util", "utility", "helper"],
  ["nav", "navigate", "navigation", "router", "routing", "route"],
  ["embed", "embedding", "vector", "semantic"],
  ["search", "find", "query", "lookup"],
  ["log", "logging", "logger"],
  ["message", "messaging", "notification", "notify"],
];

// stem(word) -> synonym group id.
const GROUP_OF = new Map<string, number>();
SYNONYM_GROUPS.forEach((group, id) => {
  for (const word of group) {
    GROUP_OF.set(word, id);
    GROUP_OF.set(stem(word), id);
  }
});

export function synonymGroup(token: string): number | undefined {
  return GROUP_OF.get(token) ?? GROUP_OF.get(stem(token));
}

// One query term expanded into its match forms, strongest to weakest: the exact
// token, its stems/subtokens, and its synonym groups. The raw form is what
// `matched` reports back, so coverage counts original terms regardless of which
// form actually hit.
export interface QueryTerm {
  raw: string;
  exact: string; // lowercased raw
  forms: string[]; // stems + identifier subtokens (excluding exact)
  groups: number[]; // synonym group ids
}

export function queryTerms(question: string): QueryTerm[] {
  return keywords(question).map((raw) => {
    const exact = raw.toLowerCase();
    // Subtokens of an identifier-style term — but only the meaningful ones
    // (stopword/1-char humps like the "get" in getUserProfile carry no signal).
    const parts = splitIdentifier(raw).filter((p) => p !== exact && keywords(p).length > 0);
    const forms = new Set<string>();
    for (const f of [stem(exact), ...parts, ...parts.map(stem)]) {
      if (f !== exact) forms.add(f);
    }
    const groups = new Set<number>();
    for (const f of [exact, ...parts]) {
      const g = synonymGroup(f);
      if (g !== undefined) groups.add(g);
    }
    return { raw, exact, forms: [...forms], groups: [...groups] };
  });
}

// A pre-tokenized text ready for scoring: token counts (raw word tokens, their
// identifier subtokens, and stems of both), synonym group counts, plus the raw
// lowercase string for the substring fallback.
export interface Haystack {
  counts: Map<string, number>;
  groups: Map<number, number>;
  raw: string;
  length: number; // raw word-token count, for length normalization
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function buildHaystack(text: string): Haystack {
  const counts = new Map<string, number>();
  const groups = new Map<number, number>();
  let length = 0;
  for (const tok of text.split(/[^A-Za-z0-9_]+/)) {
    if (!tok) continue;
    length++;
    const lower = tok.toLowerCase();
    const forms = new Set<string>([lower, stem(lower)]);
    for (const part of splitIdentifier(tok)) {
      forms.add(part);
      forms.add(stem(part));
    }
    for (const f of forms) bump(counts, f);
    const seen = new Set<number>();
    for (const f of forms) {
      const g = GROUP_OF.get(f);
      if (g !== undefined && !seen.has(g)) {
        seen.add(g);
        bump(groups, g);
      }
    }
  }
  return { counts, groups, raw: text.toLowerCase(), length };
}

// Score a haystack against the query terms. Per term, first match wins, tiered:
// exact token 3 > stem/subtoken 2 > synonym 1.5 > raw substring 1 (the floor —
// matches the engine's historical behavior). With `saturate` (long enriched
// prose only), repeated hits add a damped bonus and the total is normalized by
// length, BM25-style; short metadata haystacks keep binary hit semantics.
export function scoreHaystack(
  hay: Haystack,
  terms: QueryTerm[],
  saturate = false,
  idf?: Map<string, number>,
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const t of terms) {
    let weight = 0;
    let count = 0;
    const exactCount = hay.counts.get(t.exact) ?? 0;
    if (exactCount > 0) {
      weight = 3;
      count = exactCount;
    } else {
      for (const f of t.forms) {
        const c = hay.counts.get(f) ?? 0;
        if (c > count) count = c;
      }
      if (count > 0) weight = 2;
      else {
        for (const g of t.groups) {
          const c = hay.groups.get(g) ?? 0;
          if (c > count) count = c;
        }
        if (count > 0) weight = 1.5;
        else if (hay.raw.includes(t.exact)) {
          weight = 1;
          count = 1;
        }
      }
    }
    if (weight === 0) continue;
    // A rare query term (low document frequency) counts for more than a common
    // one — supplied by findModules as a per-term multiplier, clamped so IDF
    // reweights but never dominates the tier weights. Absent ⇒ neutral (1).
    const rarity = idf?.get(t.raw) ?? 1;
    score += (saturate ? weight * Math.min(1.5, 1 + Math.log1p(count - 1) * 0.25) : weight) * rarity;
    matched.push(t.raw);
  }
  if (saturate) score /= 1 + Math.log(Math.max(1, hay.length / 200));
  return { score, matched };
}
