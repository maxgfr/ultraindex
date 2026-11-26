import { foldText, keywords, subtokens } from "./engine.js";

// Lexical matching primitives for `find`: identifier splitting, conservative
// stemming, and a small code-domain synonym table. Everything here is pure and
// deterministic — same input, same output, no I/O.
//
// Tokenization agrees with the engine's `keywords()` (which tokenizes the
// QUERY): words are runs of Unicode letters, marks, numbers and underscores,
// and Han/kana/Hangul runs — written without spaces — are segmented into
// overlapping bigrams by the engine's `subtokens()`. Pure-ASCII text, the
// common case for code, takes a fast path that never touches a Unicode regex.

const NON_ASCII = /[^\x00-\x7F]/;
// The engine's word boundary (codeindex NON_WORD): anything but a letter, mark,
// number or underscore — plus variation selectors and enclosing marks, which
// are marks but never part of a word. On ASCII it splits exactly where
// [^A-Za-z0-9_] does.
const UNICODE_WORD_SPLIT = /(?:[^\p{L}\p{M}\p{N}_]|[\u{FE00}-\u{FE0F}\u{20D0}-\u{20FF}\u{E0100}-\u{E01EF}])+/u;
// Every ASCII character that is not a word character. Splitting on it never
// cuts a non-ASCII word, so it can run before the Unicode boundary.
const ASCII_SEPARATORS = /[\x00-\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+/;
// The same boundary without the underscore: identifier parts (snake_case).
const UNICODE_PART_SPLIT = /(?:[^\p{L}\p{M}\p{N}]|[\u{FE00}-\u{FE0F}\u{20D0}-\u{20FF}\u{E0100}-\u{E01EF}])+/u;
// What makes a non-ASCII word splittable: a case hump, a digit, an underscore.
const UNICODE_SPLITTABLE = /[\p{Lu}\p{Lt}\p{N}_]/u;
// The engine's CJK detector (codeindex HAS_CJK), verbatim: a token carrying any
// of these is segmented by `subtokens()` rather than treated as one word.
const HAS_CJK =
  /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFF66-\uFFDC\u{16FE0}-\u{16FFF}\u{1AFF0}-\u{1B2FF}\u{20000}-\u{3FFFF}]/u;

// Split an identifier into its subtokens: camelCase/PascalCase humps, acronym
// boundaries (HTTPServer -> http server), snake/kebab separators, and
// letter<->digit boundaries (OAuth2Token -> oauth 2 token). Lowercased, deduped,
// order-preserving. Non-ASCII input goes through the Unicode-aware splitter.
export function splitIdentifier(token: string): string[] {
  if (NON_ASCII.test(token)) return splitUnicodeIdentifier(token);
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

// The same splits on any script, after the engine's diacritic folding: case
// humps between Unicode upper/lower letters (BenutzerProfil -> benutzer
// profil), letter<->digit boundaries, and any non-letter separator. A part
// carrying CJK is segmented into the engine's bigrams, so an identifier or path
// written in Japanese or Chinese yields the same tokens a query in that
// language does.
function splitUnicodeIdentifier(token: string): string[] {
  const spaced = foldText(token)
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2");
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (t: string): void => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const part of spaced.split(UNICODE_PART_SPLIT)) {
    if (!part) continue;
    if (HAS_CJK.test(part)) for (const seg of subtokens(part)) push(seg);
    else push(part.toLowerCase());
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
  // Ranking weight. 1 for every term of a plain query. With extra search terms
  // (`--terms`), 1 for the terms, for question words they repeat and for
  // identifier-shaped question words; QUESTION_WEIGHT_WITH_TERMS for the
  // question's other words.
  weight: number;
  // Whether a raw substring hit counts (the weakest tier). Off for the
  // down-weighted question words, whose short function words ("de", "la",
  // "и") would otherwise substring-match almost every haystack.
  substring: boolean;
  needle: string; // `exact` in the haystack's folded form, for the substring tier
}

// How much a question word counts once the caller supplied `--terms`. The
// caller (a multilingual agent) wrote the terms in the code's own vocabulary;
// a question in another language mostly contributes words no code shares,
// plus function words that collide by accident. Halved rather than dropped, so
// a repo documented in the question's language still ranks on them.
export const QUESTION_WEIGHT_WITH_TERMS = 0.5;

// camelCase humps, snake_case, digits: a question word shaped like code is the
// same in every language, so it keeps full weight next to `--terms`.
const IDENTIFIER_SHAPED = /[a-z][A-Z]|_|\d/;

function expandTerm(raw: string, weight: number, substring: boolean): QueryTerm {
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
  return { raw, exact, forms: [...forms], groups: [...groups], weight, substring, needle: foldText(exact) };
}

// The question's terms, merged with the caller's extra search terms when given.
// Terms come first (they lead the full-query tier), then the question words
// they do not already cover. Merging is by stem, so "orders" in the question
// and "order" in the terms are one term that counts once, at full weight.
export function queryTerms(question: string, extra?: string): QueryTerm[] {
  const fromQuestion = keywords(question);
  const fromTerms = extra ? keywords(extra) : [];
  if (fromTerms.length === 0) return fromQuestion.map((raw) => expandTerm(raw, 1, true));
  const out: QueryTerm[] = [];
  const byStem = new Map<string, QueryTerm>();
  const add = (raw: string, weight: number, substring: boolean): void => {
    const key = stem(raw.toLowerCase());
    const prior = byStem.get(key);
    if (prior) {
      prior.weight = Math.max(prior.weight, weight);
      prior.substring ||= substring;
      return;
    }
    const term = expandTerm(raw, weight, substring);
    byStem.set(key, term);
    out.push(term);
  };
  for (const raw of fromTerms) add(raw, 1, true);
  for (const raw of fromQuestion) {
    if (IDENTIFIER_SHAPED.test(raw)) add(raw, 1, true);
    else add(raw, QUESTION_WEIGHT_WITH_TERMS, false);
  }
  return out;
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

// The forms one ASCII word token contributes: itself, its stem, and its
// identifier subtokens with their stems.
function wordForms(tok: string): Set<string> {
  const lower = tok.toLowerCase();
  const forms = new Set<string>([lower, stem(lower)]);
  for (const part of splitIdentifier(tok)) {
    forms.add(part);
    forms.add(stem(part));
  }
  return forms;
}

function addForms(counts: Map<string, number>, groups: Map<number, number>, forms: Set<string>): void {
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

// One token's two forms (itself and its stem), without allocating a set.
function addPair(counts: Map<string, number>, groups: Map<number, number>, form: string, stemmed: string): void {
  bump(counts, form);
  const g = GROUP_OF.get(form);
  if (g !== undefined) bump(groups, g);
  if (stemmed === form) return;
  bump(counts, stemmed);
  const h = GROUP_OF.get(stemmed);
  if (h !== undefined && h !== g) bump(groups, h);
}

export function buildHaystack(text: string): Haystack {
  // Fold diacritics once at entry so every derived token set — and hay.raw for
  // the substring fallback — is on the same footing as a folded query.
  const folded = foldText(text);
  const counts = new Map<string, number>();
  const groups = new Map<number, number>();
  let length = 0;
  if (!NON_ASCII.test(folded)) {
    // ASCII fast path: the historical tokenizer, unchanged.
    for (const tok of folded.split(/[^A-Za-z0-9_]+/)) {
      if (!tok) continue;
      length++;
      addForms(counts, groups, wordForms(tok));
    }
    return { counts, groups, raw: folded.toLowerCase(), length };
  }
  // Mixed text: split on ASCII separators first (a cheap non-Unicode regex), so
  // the ASCII words of a mostly-English summary that merely contains an em dash
  // stay on the fast tokenizer; only chunks carrying non-ASCII characters are
  // re-split on the engine's Unicode boundary.
  for (const chunk of folded.split(ASCII_SEPARATORS)) {
    if (!chunk) continue;
    if (!NON_ASCII.test(chunk)) {
      length++;
      addForms(counts, groups, wordForms(chunk));
      continue;
    }
    for (const tok of chunk.split(UNICODE_WORD_SPLIT)) {
      if (!tok) continue;
      if (!NON_ASCII.test(tok)) {
        length++;
        addForms(counts, groups, wordForms(tok));
      } else if (HAS_CJK.test(tok)) {
        // A space-free CJK run: the engine's segments (bigrams, a lone ideograph
        // whole, embedded Latin pieces as words), each one token — what
        // keywords() makes of the same text in a query. Deduped within the run.
        for (const seg of subtokens(tok)) {
          length++;
          addPair(counts, groups, seg, stem(seg));
        }
      } else {
        // Any other script (Cyrillic, Greek, Arabic, Latin letters that do not
        // fold to ASCII…): the same forms as an ASCII word, split Unicode-aware.
        // A token with no capital, digit or underscore has nothing to split —
        // the usual case, since most haystacks arrive lowercased.
        length++;
        if (UNICODE_SPLITTABLE.test(tok)) addForms(counts, groups, wordForms(tok));
        else {
          const lower = tok.toLowerCase();
          addPair(counts, groups, lower, stem(lower));
        }
      }
    }
  }
  return { counts, groups, raw: folded.toLowerCase(), length };
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
        else if (t.substring && hay.raw.includes(t.needle)) {
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
    score += (saturate ? weight * Math.min(1.5, 1 + Math.log1p(count - 1) * 0.25) : weight) * rarity * t.weight;
    matched.push(t.raw);
  }
  if (saturate) score /= 1 + Math.log(Math.max(1, hay.length / 200));
  return { score, matched };
}
