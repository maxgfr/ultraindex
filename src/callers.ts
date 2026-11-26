import { closeSync, fstatSync, openSync } from "node:fs";
import type { RepoScan } from "./engine.js";
import { buildCallerIndex, byStr, enclosingSymbol } from "./engine.js";
import { SCHEMA_VERSION, EXTRACTOR_VERSION } from "./types.js";
import { indexPaths } from "./store.js";
import { readAt, readHeader, termId } from "./search.js";

// Bound call sites for `symbols`: every call the engine BINDS to a definition
// (the same caller index `codeindex refs`/`callers` answer from), as opposed to
// the files that merely contain the name (symbols.json `refs`). A method named
// like a stdlib function — `MkdirAll` on a local type next to every
// `os.MkdirAll` in the repo — has a handful of call sites and hundreds of name
// mentions; only the first is its blast radius.
//
// Binding needs the whole scan, so it runs once at build time and is persisted
// in callers.jsonl; a `symbols` query then reads the lines it needs and never
// re-scans the repo. Like search.jsonl it is derived from the scan alone,
// deterministically (names sorted, sites sorted by file then line), so it keeps
// the byte-identical rebuild guarantee, and it is regenerable: an index without
// it (built before it existed) reports call sites as unavailable, never as zero.
//
// Layout, one JSON value per line (the same shape as search.jsonl, whose read
// helpers it shares):
//   line 1   header: format, versions, the sorted callee names, and the byte
//            offset of each name's line, relative to the end of the header;
//   N lines  {"name": <callee name>, "sites": [CallSite…]}, in header order.
// A query parses the header and reads only the lines of the names it asks for:
// the whole file runs to tens of MB on a large repo.

// Bump when the layout or the site fields change.
export const CALLERS_VERSION = 1;
const FORMAT = "ultraindex-callers";

export interface CallSite {
  file: string; // the file holding the call
  line: number;
  // The enclosing symbol of the call, as an engine name path (`Parent/name`).
  // Absent at the top level of a file.
  caller?: string;
  // The file of the definition the call binds to. Present only when the name
  // is declared in more than one file, so a reader can tell the bindings apart.
  def?: string;
}

interface Header {
  format: string;
  version: number;
  schemaVersion: number;
  extractorVersion: number;
  names: string[];
  offsets: number[]; // N + 1 entries
}

// callers.jsonl for a scan.
export function renderCallersCache(scan: RepoScan): string {
  const byRel = new Map(scan.files.map((f) => [f.rel, f]));
  // The caller index keys a name declared in several files as `name` and
  // `name@file`; group them back under the bare name.
  const byName = new Map<string, { defFiles: Set<string>; sites: { def: string; file: string; line: number }[] }>();
  for (const { def, callers } of buildCallerIndex(scan).values()) {
    let entry = byName.get(def.name);
    if (!entry) byName.set(def.name, (entry = { defFiles: new Set(), sites: [] }));
    entry.defFiles.add(def.file);
    for (const c of callers) entry.sites.push({ def: def.file, file: c.file, line: c.line });
  }
  const names = [...byName.keys()].sort(byStr);
  const lines: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const name of names) {
    const { defFiles, sites } = byName.get(name)!;
    sites.sort((a, b) => byStr(a.file, b.file) || a.line - b.line || byStr(a.def, b.def));
    const out: CallSite[] = sites.map((s) => {
      // The engine's enclosingSymbol looks the file up in the scan it is given;
      // handing it a one-file scan keeps this O(symbols in the file), not
      // O(files in the repo), per site.
      const rec = byRel.get(s.file);
      const enc = rec ? enclosingSymbol({ ...scan, files: [rec] }, s.file, s.line) : undefined;
      return {
        file: s.file,
        line: s.line,
        ...(enc ? { caller: enc.parent ? `${enc.parent}/${enc.name}` : enc.name } : {}),
        ...(defFiles.size > 1 ? { def: s.def } : {}),
      };
    });
    const line = JSON.stringify({ name, sites: out });
    offsets.push(offset);
    lines.push(line);
    offset += Buffer.byteLength(line) + 1;
  }
  offsets.push(offset);
  const header: Header = {
    format: FORMAT,
    version: CALLERS_VERSION,
    schemaVersion: SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    names,
    offsets,
  };
  return JSON.stringify(header) + "\n" + lines.join("\n") + (lines.length ? "\n" : "");
}

interface Loaded {
  key: string;
  header: Header;
  base: number; // byte offset of the first line after the header
}

// One parsed header per process, keyed by path + size + mtime, so an MCP
// server answering many queries parses it once.
let memo: Loaded | undefined;

function load(fd: number, path: string): Loaded | undefined {
  const st = fstatSync(fd);
  const key = `${path}\0${st.size}\0${st.mtimeMs}`;
  if (memo?.key === key) return memo;
  const head = readHeader(fd, st.size);
  if (!head) return undefined;
  const header = JSON.parse(head.text) as Header;
  if (
    header.format !== FORMAT ||
    header.version !== CALLERS_VERSION ||
    header.schemaVersion !== SCHEMA_VERSION ||
    header.extractorVersion !== EXTRACTOR_VERSION ||
    !Array.isArray(header.names) ||
    !Array.isArray(header.offsets) ||
    header.offsets.length !== header.names.length + 1 ||
    head.base + header.offsets[header.names.length]! !== st.size
  ) {
    return undefined;
  }
  memo = { key, header, base: head.base };
  return memo;
}

// The bound call sites of each requested name, read from callers.jsonl.
// Undefined when the index carries no usable callers.jsonl (built before it
// existed, or by another schema/extractor/layout). A name absent from the file
// has no bound call site.
export function loadCallSites(outDir: string, names: string[]): Map<string, CallSite[]> | undefined {
  const path = indexPaths(outDir).callers;
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const c = load(fd, path);
    if (!c) return undefined;
    const { names: known, offsets } = c.header;
    const out = new Map<string, CallSite[]>();
    for (const name of names) {
      const id = termId(known, name);
      if (id < 0) {
        out.set(name, []);
        continue;
      }
      const line = readAt(fd, c.base + offsets[id]!, c.base + offsets[id + 1]! - 1);
      out.set(name, (JSON.parse(line) as { sites: CallSite[] }).sites);
    }
    return out;
  } catch {
    // A truncated or hand-edited file is not an error: call sites unavailable.
    return undefined;
  } finally {
    closeSync(fd);
  }
}
