import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { FileRecord, RepoScan } from "./engine.js";
import { byStr, keywords, searchIndex, subtokens } from "./engine.js";
import { SCHEMA_VERSION, EXTRACTOR_VERSION } from "./types.js";
import { indexPaths } from "./store.js";

// Body search for `find`/`ask`: the engine's BM25F lexical search (symbol
// names, path segments, headings, summary, doc comments, and the prose body of
// comments and short literals) over the records the build extracted. It is what
// finds an answer that lives only inside a function, such as a route registered
// inline (`app.get("/health", …)`), which no path, title or summary mentions.
//
// The engine builds its BM25 index in memory from the scan's records, and that
// build is the cost: about 0.1 ms per file, so close to a second on a 10k-file
// repo, on every `find`. The build therefore persists the records the engine
// reads, plus a postings list (term → files) used only to pick candidates, in
// search.jsonl. At query time:
//
//   - corpus small enough (record bytes ≤ BUDGET_BYTES): the engine indexes all
//     of it and gets the question as typed, exactly what its own `search`
//     ranks over the same records;
//   - larger: the query's terms are taken rarest first while the files carrying
//     them fit the budget, and the engine indexes only those files, queried
//     with only those terms. A term's document frequency is then exact (every
//     file carrying it is in the corpus); the corpus size behind its IDF is the
//     candidate set. A term too common to fit the budget is left out: it would
//     barely move BM25 and would cost the whole corpus.
//
// The engine's fuzzy bridges (stem and trigram neighbours of a term no file
// carries) stay off in both cases: they walk the whole vocabulary, about half
// a second on a 10k-file repo, and find's own stemmer and synonyms already
// bridge the metadata side.
//
// search.jsonl is a cache like cache.json: regenerable, safe to gitignore (find
// then ranks on metadata alone). It is still deterministic — same scan, same
// bytes — so it does not weaken the byte-identical rebuild guarantee.
//
// Layout, one JSON value per line:
//   line 1      header: format, versions, the sorted term list, and the byte
//               offsets of every postings line and every record line, relative
//               to the end of the header line;
//   T lines     postings: the ascending file ids carrying term i;
//   N lines     records: the fields of a FileRecord the engine's lexical index
//               reads (rel, symbols' name/kind/line/doc, headings, summary,
//               terms), in scan order.

// Bump when the layout or the record fields change.
export const SEARCH_VERSION = 1;
const FORMAT = "ultraindex-search";

// Record bytes the engine indexes per query. ~4 MiB of records is ~1000 files
// of a typical repo, ~0.1 s of index build.
export const BUDGET_BYTES = 4 * 1024 * 1024;
// Hits returned to the caller, best first.
const HIT_LIMIT = 40;
// The engine's plain-term shape (codeindex bm25 PLAIN_TERM): a term of this
// shape enters its index as is; any other is split by `subtokens`.
const PLAIN_TERM = /^[a-z0-9]{2,}$/;

interface Header {
  format: string;
  version: number;
  schemaVersion: number;
  extractorVersion: number;
  files: number;
  terms: string[];
  termOffsets: number[]; // T + 1 entries
  fileOffsets: number[]; // N + 1 entries, after the postings
}

// The fields the engine's lexical index reads, nothing else.
function searchRecord(f: FileRecord): Record<string, unknown> {
  return {
    rel: f.rel,
    symbols: f.symbols.map((s) => ({ name: s.name, kind: s.kind, line: s.line, ...(s.doc ? { doc: s.doc } : {}) })),
    headings: f.headings,
    ...(f.summary ? { summary: f.summary } : {}),
    ...(f.terms?.length ? { terms: f.terms } : {}),
  };
}

// Every token the engine could index for a file, in any field: a superset is
// safe (a candidate that does not match costs a little time), a missing token
// would lose a hit. The one gap is the engine's compound path split ("userprofile"
// → "user profile" when both are declared names): those pieces are path tokens,
// which find's own metadata ranking already covers.
function tokensOf(f: FileRecord): Set<string> {
  const out = new Set<string>();
  const add = (text: string): void => {
    for (const t of subtokens(text)) out.add(t);
  };
  for (const s of f.symbols) {
    if (s.doc) add(s.doc);
    add(s.name);
  }
  for (const seg of f.rel.split("/")) add(seg);
  for (const h of f.headings) add(h);
  if (f.summary) add(f.summary);
  for (const t of f.terms ?? []) {
    out.add(t);
    if (!PLAIN_TERM.test(t)) add(t);
  }
  return out;
}

// search.jsonl for a scan. Deterministic: terms sorted, file ids in scan order.
export function renderSearchCache(files: FileRecord[]): string {
  const postings = new Map<string, number[]>();
  files.forEach((f, id) => {
    for (const t of tokensOf(f)) {
      let ids = postings.get(t);
      if (!ids) postings.set(t, (ids = []));
      ids.push(id);
    }
  });
  const terms = [...postings.keys()].sort(byStr);
  const lines: string[] = [];
  const termOffsets: number[] = [];
  const fileOffsets: number[] = [];
  let offset = 0;
  const push = (line: string, offsets: number[]): void => {
    offsets.push(offset);
    lines.push(line);
    offset += Buffer.byteLength(line) + 1;
  };
  for (const t of terms) push(JSON.stringify(postings.get(t)), termOffsets);
  termOffsets.push(offset);
  for (const f of files) push(JSON.stringify(searchRecord(f)), fileOffsets);
  fileOffsets.push(offset);
  const header: Header = {
    format: FORMAT,
    version: SEARCH_VERSION,
    schemaVersion: SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    files: files.length,
    terms,
    termOffsets,
    fileOffsets,
  };
  return JSON.stringify(header) + "\n" + lines.join("\n") + (lines.length ? "\n" : "");
}

interface Loaded {
  key: string;
  header: Header;
  base: number; // byte offset of the first line after the header
  full?: RepoScan; // the whole corpus as a scan, once built (small corpora)
}

// One loaded header per process, keyed by path + size + mtime: an MCP server
// answering many queries parses it once, and a small corpus's scan (and the
// BM25 index the engine caches on it) is reused across queries. Postings and
// records are read on demand at their offsets: a query touches a few lines of
// a file that runs to tens of MB on a large repo.
let memo: Loaded | undefined;

function readAt(fd: number, start: number, end: number): string {
  const buf = Buffer.allocUnsafe(end - start);
  let read = 0;
  while (read < buf.length) {
    const n = readSync(fd, buf, read, buf.length - read, start + read);
    if (n === 0) break;
    read += n;
  }
  return buf.toString("utf8", 0, read);
}

// The header line, read in growing chunks until its newline.
function readHeader(fd: number, size: number): { text: string; base: number } | undefined {
  const chunks: Buffer[] = [];
  let pos = 0;
  while (pos < size) {
    const buf = Buffer.allocUnsafe(Math.min(1 << 20, size - pos));
    const n = readSync(fd, buf, 0, buf.length, pos);
    if (n === 0) break;
    const nl = buf.subarray(0, n).indexOf(10);
    if (nl >= 0) {
      chunks.push(buf.subarray(0, nl));
      return { text: Buffer.concat(chunks).toString("utf8"), base: pos + nl + 1 };
    }
    chunks.push(buf.subarray(0, n));
    pos += n;
  }
  return undefined;
}

function load(fd: number, path: string): Loaded | undefined {
  const st = fstatSync(fd);
  const key = `${path}\0${st.size}\0${st.mtimeMs}`;
  if (memo?.key === key) return memo;
  const head = readHeader(fd, st.size);
  if (!head) return undefined;
  const header = JSON.parse(head.text) as Header;
  if (
    header.format !== FORMAT ||
    header.version !== SEARCH_VERSION ||
    header.schemaVersion !== SCHEMA_VERSION ||
    header.extractorVersion !== EXTRACTOR_VERSION ||
    header.fileOffsets.length !== header.files + 1 ||
    header.termOffsets.length !== header.terms.length + 1 ||
    head.base + header.fileOffsets[header.files]! !== st.size
  ) {
    return undefined;
  }
  memo = { key, header, base: head.base };
  return memo;
}

// Index of a term in the header's sorted list (byStr is code-unit order, the
// order of `<` on strings), or -1.
function termId(terms: string[], t: string): number {
  let lo = 0;
  let hi = terms.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = terms[mid]!;
    if (m === t) return mid;
    if (m < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

// Line i of a section, its trailing newline excluded.
function lineAt(fd: number, c: Loaded, offsets: number[], i: number): string {
  return readAt(fd, c.base + offsets[i]!, c.base + offsets[i + 1]! - 1);
}

function record(fd: number, c: Loaded, id: number): FileRecord {
  return JSON.parse(lineAt(fd, c, c.header.fileOffsets, id)) as FileRecord;
}

function scanOf(files: FileRecord[]): RepoScan {
  return {
    root: "",
    files,
    languages: {},
    docText: new Map(),
    mtimes: new Map(),
    capped: false,
    excluded: 0,
    contentUnchanged: true,
    cacheDirty: false,
  };
}

// The engine's query terms: keywords, then their subtokens, deduped in order.
function engineTerms(text: string): string[] {
  const out: string[] = [];
  for (const kw of keywords(text)) for (const t of subtokens(kw)) if (!out.includes(t)) out.push(t);
  return out;
}

export interface BodyHit {
  rel: string;
  score: number; // the engine's BM25F score
  terms: string[]; // the engine terms the file matched
}

// Rank the index's files for a question (plus the caller's `--terms`) with the
// engine's lexical search. Undefined when the index carries no usable
// search.jsonl (built before it existed, or by another schema/extractor):
// find then ranks on metadata alone.
// `budget` (record bytes the engine may index) is a parameter for tests only.
export function searchBodies(outDir: string, query: string, extraTerms?: string, budget = BUDGET_BYTES): BodyHit[] | undefined {
  const path = indexPaths(outDir).search;
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const c = load(fd, path);
    if (!c) return undefined;
    return rank(fd, c, extraTerms?.trim() ? `${query} ${extraTerms.trim()}` : query, budget);
  } catch {
    // A truncated or hand-edited cache is not an error: metadata-only ranking.
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function rank(fd: number, c: Loaded, text: string, budget: number): BodyHit[] {
  const { header } = c;
  const total = header.fileOffsets[header.files]! - header.fileOffsets[0]!;
  let scan: RepoScan;
  let engineQuery: string;
  if (total <= budget) {
    if (!c.full) c.full = scanOf(Array.from({ length: header.files }, (_, id) => record(fd, c, id)));
    scan = c.full;
    engineQuery = text;
  } else {
    const fileBytes = (id: number): number => header.fileOffsets[id + 1]! - header.fileOffsets[id]!;
    const postings = engineTerms(text)
      // A term the engine's own keyword pass would drop from the joined query
      // (a stopword subtoken, a single character) is not searched: no candidates.
      .filter((t) => keywords(t).length > 0)
      .map((t) => ({ t, id: termId(header.terms, t) }))
      .filter((p) => p.id >= 0)
      .map(({ t, id }) => ({ t, ids: JSON.parse(lineAt(fd, c, header.termOffsets, id)) as number[] }))
      .sort((a, b) => a.ids.length - b.ids.length || byStr(a.t, b.t));
    const chosen: string[] = [];
    const picked = new Set<number>();
    let bytes = 0;
    for (const p of postings) {
      let extra = 0;
      for (const id of p.ids) if (!picked.has(id)) extra += fileBytes(id);
      if (bytes + extra > budget) continue;
      for (const id of p.ids) picked.add(id);
      bytes += extra;
      chosen.push(p.t);
    }
    if (chosen.length === 0) return [];
    scan = scanOf([...picked].sort((a, b) => a - b).map((id) => record(fd, c, id)));
    engineQuery = chosen.join(" ");
  }
  return searchIndex(scan, engineQuery, { limit: HIT_LIMIT, fuzzy: false }).map((r) => ({
    rel: r.file,
    score: r.score,
    terms: r.matchedTerms,
  }));
}
