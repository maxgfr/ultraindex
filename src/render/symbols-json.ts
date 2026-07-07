import { SCHEMA_VERSION } from "../types.js";
import type { SymbolIndex } from "../types.js";
import type { RepoScan } from "../scan.js";
import { byStr } from "../sort.js";

// Build the persisted symbol table from the scan. `defs` collects every declared
// symbol by name; `refs` (files that USE a name) is filled by the graph's
// use/mention pass and merged in here. Ordering is fully deterministic so
// symbols.json is byte-stable across rebuilds.
export function buildSymbolIndex(scan: RepoScan, refs: Map<string, Set<string>> = new Map()): SymbolIndex {
  const defsByName = new Map<string, SymbolIndex["defs"][string]>();
  for (const f of scan.files) {
    for (const s of f.symbols) {
      let arr = defsByName.get(s.name);
      if (!arr) defsByName.set(s.name, (arr = []));
      arr.push({
        file: s.file,
        line: s.line,
        kind: s.kind,
        exported: s.exported,
        lang: s.lang,
        ...(s.parent ? { parent: s.parent } : {}),
      });
    }
  }

  const defs: SymbolIndex["defs"] = {};
  for (const name of [...defsByName.keys()].sort(byStr)) {
    defs[name] = defsByName
      .get(name)!
      .slice()
      .sort((a, b) => byStr(a.file, b.file) || a.line - b.line || byStr(a.kind, b.kind));
  }

  const refsOut: SymbolIndex["refs"] = {};
  for (const name of [...refs.keys()].sort(byStr)) {
    const files = [...refs.get(name)!].sort(byStr);
    if (files.length) refsOut[name] = files;
  }

  return { schemaVersion: SCHEMA_VERSION, defs, refs: refsOut };
}

export function renderSymbolsJson(index: SymbolIndex): string {
  return JSON.stringify(index, null, 2) + "\n";
}
