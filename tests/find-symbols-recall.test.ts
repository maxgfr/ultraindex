import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, FileNode, ModuleNode, Tier, SymbolIndex } from "../src/types.js";
import { findModules } from "../src/find.js";
import { exportedNamesByFile } from "../src/symbols.js";
import { byStr } from "../src/engine.js";

function fileNode(rel: string, module: string): FileNode {
  return {
    id: rel, kind: "file", rel, fileKind: "code", lang: "typescript", module,
    title: rel.split("/").pop()!, symbols: 1, lines: 10, degIn: 0, degOut: 0,
  };
}

function moduleNode(slug: string, path: string, tier: Tier, members: string[]): ModuleNode {
  return {
    id: slug, kind: "module", slug, path, title: path, summary: "", tier, members,
    symbols: members.length, degIn: 0, degOut: 0,
  };
}

// A module whose path/title/summary never name `computeRrfFusion`; the identifier
// lives ONLY as an exported symbol of one of its files.
function graph(): Graph {
  const files = [fileNode("src/widgets/aaa.ts", "widgets"), fileNode("src/other/b.ts", "other")];
  const modules = [
    moduleNode("widgets", "src/widgets", 1, ["src/widgets/aaa.ts"]),
    moduleNode("other", "src/other", 1, ["src/other/b.ts"]),
  ];
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
    languages: { typescript: files.length }, files, modules, fileEdges: [], moduleEdges: [],
  };
}

function symbolIndex(defs: SymbolIndex["defs"]): SymbolIndex {
  return { schemaVersion: SCHEMA_VERSION, defs, refs: {} };
}

describe("exportedNamesByFile", () => {
  it("indexes only exported names, deduped, byStr-sorted per file", () => {
    const idx = symbolIndex({
      // out of byStr order on purpose — the function sorts.
      zeta: [{ file: "src/a.ts", line: 3, kind: "function", exported: true, lang: "ts" }],
      alpha: [
        { file: "src/a.ts", line: 1, kind: "function", exported: true, lang: "ts" },
        { file: "src/a.ts", line: 9, kind: "function", exported: true, lang: "ts" }, // dup file → dedupe
      ],
      hidden: [{ file: "src/a.ts", line: 5, kind: "const", exported: false, lang: "ts" }],
    });
    const map = exportedNamesByFile(idx);
    expect(map.get("src/a.ts")).toEqual(["alpha", "zeta"]);
  });

  it("caps a single file at 60 names, keeping the first 60 in byStr order", () => {
    const defs: SymbolIndex["defs"] = {};
    for (let i = 0; i < 71; i++) {
      defs[`sym${i}`] = [{ file: "src/f.ts", line: i + 1, kind: "function", exported: true, lang: "ts" }];
    }
    const map = exportedNamesByFile(symbolIndex(defs));
    const names = map.get("src/f.ts")!;
    expect(names.length).toBe(60);
    expect(names).toEqual(Object.keys(defs).sort(byStr).slice(0, 60));
  });
});

describe("findModules: exported symbol names in the haystack", () => {
  it("surfaces the owning module for a symbol never named in title/summary/path", () => {
    const g = graph();
    const idx = symbolIndex({
      computeRrfFusion: [{ file: "src/widgets/aaa.ts", line: 4, kind: "function", exported: true, lang: "ts" }],
    });
    const map = exportedNamesByFile(idx);

    const withNames = findModules(g, "computeRrfFusion", 8, undefined, map);
    expect(withNames[0]?.slug).toBe("widgets");
    expect(withNames[0]?.matched).toContain("computeRrfFusion");

    // Documents the gap being closed: no symbolNames → the query hits nothing.
    const withoutNames = findModules(g, "computeRrfFusion", 8);
    expect(withoutNames.find((r) => r.slug === "widgets")).toBeUndefined();
  });
});
