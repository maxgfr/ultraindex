import { basename } from "node:path";
import type { FileRecord } from "./types.js";
import { walk, readText } from "./walk.js";
import { headCommit } from "./git.js";
import { sha1 } from "./hash.js";
import { classify, MARKDOWN_EXT } from "./classify.js";
import { extToLang } from "./lang/registry.js";
import { compileGlobs } from "./glob.js";
import { byKey } from "./sort.js";
import { extractMarkdown } from "./extract/markdown.js";
import { extractCode } from "./extract/code.js";

export interface RepoScan {
  root: string;
  commit?: string;
  files: FileRecord[];
  languages: Record<string, number>;
}

export interface ScanOptions {
  include?: string[];
  exclude?: string[];
  maxBytes?: number;
  out?: string; // absolute output dir to exclude from the scan (self-index guard)
}

function countLines(s: string): number {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// Walk the repo once and turn every in-scope file into a FileRecord. Pure file
// I/O + deterministic extraction — never reads the repo into the model.
export function scanRepo(root: string, opts: ScanOptions = {}): RepoScan {
  const include = compileGlobs(opts.include);
  const exclude = compileGlobs(opts.exclude);
  const walked = walk(root, { maxFileBytes: opts.maxBytes });
  // Never index our own output (e.g. a committed `docs/ultraindex/`), or builds
  // would describe the encyclopedia instead of the code.
  const outPrefix = opts.out ? opts.out.replace(/\/+$/, "") + "/" : null;

  const files: FileRecord[] = [];
  const languages: Record<string, number> = {};

  for (const f of walked) {
    if (outPrefix && (f.abs === opts.out || f.abs.startsWith(outPrefix))) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;

    const kind = classify(f.rel, f.ext);
    const lang = extToLang(f.ext);
    languages[lang] = (languages[lang] ?? 0) + 1;

    const content = readText(f.abs);
    const record: FileRecord = {
      rel: f.rel,
      ext: f.ext,
      size: f.size,
      lines: countLines(content),
      hash: sha1(content),
      kind,
      lang,
      headings: [],
      symbols: [],
      refs: [],
    };

    if (content) {
      if (kind === "doc" && MARKDOWN_EXT.has(f.ext)) {
        const md = extractMarkdown(content);
        record.title = md.title ?? basename(f.rel);
        record.summary = md.summary;
        record.headings = md.headings;
        record.refs = md.refs;
      } else if (kind === "doc") {
        // Non-markdown prose (.rst/.txt): title from basename, no link graph.
        record.title = basename(f.rel);
      } else if (kind === "code") {
        const code = extractCode(f.rel, f.ext, content);
        record.title = basename(f.rel);
        record.summary = code.summary;
        record.symbols = code.symbols;
        record.refs = code.refs;
        record.pkg = code.pkg;
      } else {
        record.title = basename(f.rel);
      }
    } else {
      record.title = basename(f.rel);
    }

    files.push(record);
  }

  files.sort(byKey((f) => f.rel));
  return { root, commit: headCommit(root), files, languages };
}
