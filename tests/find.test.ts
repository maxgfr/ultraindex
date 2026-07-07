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
