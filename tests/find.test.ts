import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, FileNode, ModuleNode, Tier } from "../src/types.js";
import { findModules } from "../src/find.js";

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

// Implementation module + a much larger __tests__ sibling, both matching the query.
function graph(): Graph {
  const implFiles = ["src/calc/calc.ts", "src/calc/index.ts"];
  const testFiles = Array.from({ length: 12 }, (_, i) => `src/calc/__tests__/calc${i}.test.ts`);
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: implFiles.length + testFiles.length,
    languages: { typescript: implFiles.length + testFiles.length },
    files: [
      ...implFiles.map((r) => fileNode(r, "calc")),
      ...testFiles.map((r) => fileNode(r, "calc-tests")),
    ],
    modules: [
      moduleNode("calc", "src/calc", 1, implFiles),
      moduleNode("calc-tests", "src/calc/__tests__", 2, testFiles),
    ],
    fileEdges: [], moduleEdges: [],
  };
}

describe("findModules IDF", () => {
  it("weights a rare query term above a term common to many modules", () => {
    // "alpha" appears in 5 modules (common, low IDF); "zeta" in 1 (rare, high
    // IDF). Each module matches exactly one query term, so only IDF separates
    // them — the rare-term module must rank first.
    const mk = (slug: string, summary: string): ModuleNode => ({
      ...moduleNode(slug, `pkg/${slug}`, 1, [`pkg/${slug}/f.ts`]),
      summary,
    });
    const mods = [mk("m1", "alpha"), mk("m2", "alpha"), mk("m3", "alpha"), mk("m4", "alpha"), mk("m5", "alpha"), mk("m6", "zeta")];
    const files = mods.flatMap((m) => m.members.map((r) => fileNode(r, m.slug)));
    const g: Graph = {
      schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
      languages: { typescript: files.length }, files, modules: mods, fileEdges: [], moduleEdges: [],
    };
    expect(findModules(g, "alpha zeta", 6)[0]?.slug).toBe("m6");
  });
});

describe("findModules ranking", () => {
  it("ranks the implementation above its larger __tests__ sibling", () => {
    const results = findModules(graph(), "calc", 5);
    expect(results[0]?.slug).toBe("calc");
    expect(results.find((r) => r.slug === "calc-tests")).toBeDefined(); // still surfaced, just lower
    expect(results.findIndex((r) => r.slug === "calc")).toBeLessThan(
      results.findIndex((r) => r.slug === "calc-tests"),
    );
  });

  it("returns the exact files to open and only keyword-matched modules", () => {
    const results = findModules(graph(), "calc", 5);
    expect(results[0]?.files).toContain("src/calc/calc.ts");
    expect(results.every((r) => r.matched.length > 0)).toBe(true);
  });
});

describe("findModules lexical expansion", () => {
  function tinyGraph(): Graph {
    const userFiles = ["src/user/profile.ts", "src/user/index.ts"];
    const authFiles = ["src/middleware/session.ts"];
    const auth = moduleNode("middleware", "src/middleware", 1, authFiles);
    auth.summary = "authentication middleware";
    return {
      schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: 3,
      languages: { typescript: 3 },
      files: [
        ...userFiles.map((r) => fileNode(r, "user")),
        ...authFiles.map((r) => fileNode(r, "middleware")),
      ],
      modules: [moduleNode("user", "src/user", 1, userFiles), auth],
      fileEdges: [], moduleEdges: [],
    };
  }

  it("matches an identifier query against its split parts", () => {
    const results = findModules(tinyGraph(), "getUserProfile", 5);
    expect(results[0]?.slug).toBe("user");
    expect(results[0]?.files).toContain("src/user/profile.ts");
    expect(results[0]?.matched).toContain("getUserProfile");
  });

  it("matches 'auth' against 'authentication' via synonyms/stems", () => {
    const results = findModules(tinyGraph(), "auth", 5);
    expect(results[0]?.slug).toBe("middleware");
    expect(results[0]?.matched).toContain("auth");
  });
});

describe("findModules full-query tier", () => {
  it("ranks a module whose name is the whole query above a stronger partial match", () => {
    // "amod" owns a file whose basename tokenizes to exactly "widget gadget" —
    // the full query — so the full-query bonus lifts it over "widget", which
    // matches only one of the two terms but across five files.
    const files: FileNode[] = [];
    const modules: ModuleNode[] = [];
    modules.push(moduleNode("amod", "src/amod", 1, ["src/amod/widgetGadget.ts"]));
    files.push(fileNode("src/amod/widgetGadget.ts", "amod"));
    const bFiles = Array.from({ length: 5 }, (_, i) => `src/widget/widget${i}.ts`);
    modules.push(moduleNode("widget", "src/widget", 1, bFiles));
    bFiles.forEach((r) => files.push(fileNode(r, "widget")));
    // Fillers exist only to raise the module count so IDF is well-defined.
    for (let i = 0; i < 6; i++) {
      modules.push(moduleNode(`z${i}`, `pkg/z${i}`, 1, [`pkg/z${i}/q.ts`]));
      files.push(fileNode(`pkg/z${i}/q.ts`, `z${i}`));
    }
    const g: Graph = {
      schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
      languages: { typescript: files.length }, files, modules, fileEdges: [], moduleEdges: [],
    };
    const results = findModules(g, "widget gadget", 20);
    expect(results[0]?.slug).toBe("amod");
  });
});

describe("findModules coverage²", () => {
  it("ranks a full-coverage match above a strong single-term collision", () => {
    // mnarrow matches only the rare "alpha" (a strong single-term hit); mwide
    // matches all three query terms once each. Linear coverage would rank
    // mnarrow first — squaring the coverage fraction demotes the 1-of-3
    // collision below the 3-of-3 match.
    const files: FileNode[] = [];
    const modules: ModuleNode[] = [];
    modules.push({ ...moduleNode("mnarrow", "pkg/mnarrow", 1, ["pkg/mnarrow/a.ts"]), summary: "alpha" });
    files.push({ ...fileNode("pkg/mnarrow/a.ts", "mnarrow"), summary: "prealphax" }); // substring-only alpha
    modules.push(moduleNode("mwide", "pkg/mwide", 1, ["pkg/mwide/x.ts", "pkg/mwide/y.ts", "pkg/mwide/z.ts"]));
    files.push({ ...fileNode("pkg/mwide/x.ts", "mwide"), summary: "alpha" });
    files.push({ ...fileNode("pkg/mwide/y.ts", "mwide"), summary: "beta" });
    files.push({ ...fileNode("pkg/mwide/z.ts", "mwide"), summary: "gamma" });
    // Fillers carry the common terms so "beta"/"gamma" score low IDF while
    // "alpha" stays rare — the setup that makes mnarrow's single hit look strong.
    for (let i = 0; i < 7; i++) {
      modules.push(moduleNode(`f${i}`, `pkg/f${i}`, 1, [`pkg/f${i}/f.ts`]));
      files.push({ ...fileNode(`pkg/f${i}/f.ts`, `f${i}`), summary: "beta gamma" });
    }
    const g: Graph = {
      schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
      languages: { typescript: files.length }, files, modules, fileEdges: [], moduleEdges: [],
    };
    const results = findModules(g, "alpha beta gamma", 20);
    expect(results[0]?.slug).toBe("mwide");
    expect(results.findIndex((r) => r.slug === "mwide")).toBeLessThan(
      results.findIndex((r) => r.slug === "mnarrow"),
    );
  });
});
