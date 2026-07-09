import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";
import { runSymbols, lookupSymbols } from "../src/symbols.js";
import { runImpact } from "../src/impact.js";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, SymbolIndex } from "../src/types.js";

// Build a synthetic symbol table for the ranking tests: each name maps to one
// def site at the given file path (the rest of the site is filler).
function symIndex(defs: Record<string, string>): SymbolIndex {
  const out: SymbolIndex["defs"] = {};
  for (const [name, file] of Object.entries(defs)) {
    out[name] = [{ file, line: 1, kind: "function", exported: true, lang: "typescript" }];
  }
  return { schemaVersion: SCHEMA_VERSION, defs: out, refs: {} };
}
const EMPTY_GRAPH: Graph = {
  schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: 0,
  languages: {}, files: [], modules: [], fileEdges: [], moduleEdges: [],
};
const rank = (defs: Record<string, string>, query: string): string[] =>
  lookupSymbols(symIndex(defs), EMPTY_GRAPH, query).hits.map((h) => h.name);

describe("lookupSymbols scoring", () => {
  it("orders exact-tier > prefix-tier > substring-tier", () => {
    // No def is named exactly "parse", so the exact-name short-circuit is off
    // and the tiered scorer runs. "Parse" matches the whole term exactly
    // (case-folded), "parseConfig" by prefix, "xmlparser" by substring only.
    const hits = rank(
      { Parse: "src/a.ts", parseConfig: "src/b.ts", xmlparser: "src/c.ts" },
      "parse",
    );
    expect(hits.indexOf("Parse")).toBeLessThan(hits.indexOf("parseConfig"));
    expect(hits.indexOf("parseConfig")).toBeLessThan(hits.indexOf("xmlparser"));
  });

  it("ranks a rare name above a common one at the same tier (IDF)", () => {
    // "zeta" occurs in one name (rare, high IDF); "node" in nine (common). Both
    // matched names are a prefix hit, so only IDF separates them.
    const defs: Record<string, string> = { zetaProcessor: "src/p.ts", nodeX: "src/n.ts" };
    for (let i = 0; i < 8; i++) defs[`node${i}`] = `src/n${i}.ts`;
    const hits = rank(defs, "zeta node");
    expect(hits.indexOf("zetaProcessor")).toBeLessThan(hits.indexOf("nodeX"));
  });

  it("breaks ties by shorter name", () => {
    const hits = rank({ renderAB: "src/r1.ts", renderA: "src/r0.ts" }, "render");
    expect(hits.indexOf("renderA")).toBeLessThan(hits.indexOf("renderAB"));
  });

  it("does not credit coverage for a term found only in the def file path", () => {
    // "widget backend": widgetBackend matches both terms in its NAME (2/2);
    // widgetThing matches only "widget" in its name, with "backend" appearing
    // solely in its def path (a source hit — a small bonus, no coverage);
    // widgetX matches "widget" alone. The genuine 2/2 match leads; the source
    // hit lifts widgetThing just above widgetX but never to full coverage.
    const hits = rank(
      { widgetBackend: "src/a/wb.ts", widgetThing: "src/backend/thing.ts", widgetX: "src/plain/x.ts" },
      "widget backend",
    );
    expect(hits[0]).toBe("widgetBackend");
    expect(hits.indexOf("widgetThing")).toBeLessThan(hits.indexOf("widgetX"));
    expect(hits.indexOf("widgetBackend")).toBeLessThan(hits.indexOf("widgetThing"));
  });
});

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
let OUT: string;

beforeAll(() => {
  OUT = join(mkdtempSync(join(tmpdir(), "ui-si-")), ".ultraindex");
  runBuild({ repo: REPO, out: OUT, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
});

describe("symbols command", () => {
  it("finds a symbol's definition sites with owning module and export flag", () => {
    const res = runSymbols(OUT, "HttpClient")!;
    const hit = res.hits.find((h) => h.name === "HttpClient")!;
    expect(hit).toBeTruthy();
    const def = hit.defs.find((d) => d.file === "src/client.ts")!;
    expect(def.kind).toBe("class");
    expect(def.exported).toBe(true);
    expect(def.module).toBe("src");
    expect(typeof def.line).toBe("number");
  });

  it("reports the files that reference a symbol", () => {
    const hit = runSymbols(OUT, "HttpClient")!.hits.find((h) => h.name === "HttpClient")!;
    expect(hit.refs.length).toBeGreaterThan(0);
  });

  it("matches by identifier sub-token when there is no exact name", () => {
    // "Client" is a sub-token of HttpClient — a fuzzy hit, no exact def.
    const res = runSymbols(OUT, "Client")!;
    expect(res.hits.some((h) => h.name === "HttpClient")).toBe(true);
  });

  it("returns an empty hit list for an unknown symbol (no throw)", () => {
    expect(runSymbols(OUT, "NoSuchSymbolXYZ")!.hits).toEqual([]);
  });

  it("returns undefined when there is no index", () => {
    expect(runSymbols(join(tmpdir(), "ui-nope-si"), "X")).toBeUndefined();
  });
});

describe("impact command", () => {
  it("lists the files that depend on a target file", () => {
    const res = runImpact(OUT, "src/client.ts")!;
    expect(res.scope).toBe("file");
    expect(res.files.some((f) => f.rel === "src/index.ts")).toBe(true);
    expect(res.files.every((f) => f.depth >= 1)).toBe(true);
  });

  it("accepts a module slug and seeds from its members", () => {
    const res = runImpact(OUT, "src")!;
    expect(res.scope).toBe("module");
    expect(res.seeds.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown target", () => {
    expect(runImpact(OUT, "no/such/file.ts")).toBeUndefined();
  });
});
