import type { Graph } from "./types.js";

// A grounding citation written by the agent in encyclopedia prose or an answer:
//   [src/foo.ts]            — whole file
//   [src/foo.ts:42]         — a line
//   [src/foo.ts:42-58]      — a line range
// The path must be a real file in the index and the line(s) within range. This
// is the anti-hallucination guard — the ultraindex analog of ultradoc's `check`.
export interface Citation {
  raw: string;
  path: string;
  start?: number;
  end?: number;
}

// `[...]` NOT followed by `(` — i.e. a bracket token, not a markdown link.
const TOKEN_RE = /\[([^\]\n]+)\](?!\()/g;
const LINE_SUFFIX = /:(\d+)(?:-(\d+))?$/;

// Only treat a bracket token as a citation when it looks like a file path (has a
// slash or a file-extension ending). Prose asides like `[TODO]` or `[note]` are
// ignored, so they don't cause false grounding failures.
function looksLikePath(s: string): boolean {
  return /\//.test(s) || /\.[A-Za-z0-9]{1,8}(:\d|$)/.test(s);
}

export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const raw = m[1]!.trim();
    if (!looksLikePath(raw) || seen.has(raw)) continue;
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
  }
  return out;
}

export interface CitationCheck {
  ok: boolean;
  resolved: Citation[];
  unresolved: { citation: Citation; reason: string }[];
}

// Validate every citation in `text` against the index's file/line table.
export function checkCitations(text: string, fileLines: Map<string, number>): CitationCheck {
  const resolved: Citation[] = [];
  const unresolved: { citation: Citation; reason: string }[] = [];
  for (const c of parseCitations(text)) {
    const lines = fileLines.get(c.path);
    if (lines === undefined) {
      unresolved.push({ citation: c, reason: "no such file in the index" });
      continue;
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
