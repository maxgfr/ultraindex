import type { Graph } from "./types.js";

// A grounding citation written by the agent in encyclopedia prose or an answer:
//   [src/foo.ts]                 — whole file
//   [src/foo.ts:42]              — a line
//   [src/foo.ts:42-58]           — a line range
//   [app/[slug]/page.tsx:10]     — paths may contain inner [..] route segments
// The path must be a real file in the index and the line(s) within range. This
// is the anti-hallucination guard — the ultraindex analog of ultradoc's `check`.
export interface Citation {
  raw: string;
  path: string;
  start?: number;
  end?: number;
}

// Extension-anchored token: absorbs inner `[...]` (Next.js route params) by
// matching up to the `]` that follows a `.ext` (+ optional line suffix).
const EXT_TOKEN = /\[([^\n]*?\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?)\]/g;
// Plain token (no inner brackets) — for root files / extensionless paths.
const SIMPLE_TOKEN = /\[([^[\]\n]+)\]/g;
const LINE_SUFFIX = /:(\d+)(?:-(\d+))?$/;

// Looks like a file path worth resolving: has a slash, or a filename.ext shape.
function looksLikePath(s: string): boolean {
  return /\//.test(s) || /\.[A-Za-z0-9]{1,8}(:\d|$)/.test(s);
}

// Blank out regions where a `[file:line]` is NOT a load-bearing reference: fenced
// code blocks, inline code spans, HTML comments, and markdown links `[t](u)`.
// Without this, a decorative citation in an example block would falsely satisfy
// the gate (the critical bypass). Newlines are preserved so structure is intact.
function stripNonProse(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
    // A markdown link `[text](url)` is removed ONLY when its text isn't itself a
    // file path — so a nav link `[guide](docs/x)` or `[Node.js](url)` is dropped,
    // but a real citation that happens to be followed by `(…)` still counts.
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, (m, t: string) => (looksLikePath(t.trim()) ? m : " ".repeat(m.length)));
}

export function parseCitations(text: string): Citation[] {
  const prose = stripNonProse(text);
  const out: Citation[] = [];
  const seen = new Set<string>();
  const add = (rawIn: string): void => {
    const raw = rawIn.trim().replace(/[.,;]+$/, ""); // trim trailing prose punctuation
    if (!looksLikePath(raw) || seen.has(raw)) return;
    seen.add(raw);
    let path = raw;
    let start: number | undefined;
    let end: number | undefined;
    const ls = LINE_SUFFIX.exec(raw);
    if (ls) {
      path = raw.slice(0, ls.index);
      start = Number(ls[1]);
      end = ls[2] ? Number(ls[2]) : undefined;
    }
    if (path) out.push({ raw, path, start, end });
  };
  let m: RegExpExecArray | null;
  EXT_TOKEN.lastIndex = 0;
  while ((m = EXT_TOKEN.exec(prose))) add(m[1]!);
  SIMPLE_TOKEN.lastIndex = 0;
  while ((m = SIMPLE_TOKEN.exec(prose))) add(m[1]!);
  return out;
}

export interface CitationCheck {
  ok: boolean;
  resolved: Citation[];
  unresolved: { citation: Citation; reason: string }[];
}

// Validate citations against the index's file/line table. A token with a slash
// is treated as an intended repo-path citation and MUST resolve; a slash-less
// token that doesn't resolve is treated as prose (e.g. `[Node.js]`) and ignored,
// so ordinary writing doesn't trip the gate.
export function checkCitations(text: string, fileLines: Map<string, number>): CitationCheck {
  const resolved: Citation[] = [];
  const unresolved: { citation: Citation; reason: string }[] = [];
  for (const c of parseCitations(text)) {
    const lines = fileLines.get(c.path);
    if (lines === undefined) {
      if (c.path.includes("/")) unresolved.push({ citation: c, reason: "no such file in the index" });
      continue; // slash-less non-resolving token → prose, ignore
    }
    if (c.start !== undefined && (c.start < 1 || c.start > lines)) {
      unresolved.push({ citation: c, reason: `line ${c.start} out of range (1-${lines})` });
      continue;
    }
    if (c.end !== undefined && (c.end < (c.start ?? 1) || c.end > lines)) {
      unresolved.push({ citation: c, reason: `line range ${c.start}-${c.end} out of range (1-${lines})` });
      continue;
    }
    resolved.push(c);
  }
  return { ok: unresolved.length === 0, resolved, unresolved };
}

// The file -> line-count table the checker resolves against.
export function fileLineTable(graph: Graph): Map<string, number> {
  return new Map(graph.files.map((f) => [f.rel, f.lines]));
}
