import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Edge, Graph, ModuleNode, FileNode } from "../src/types.js";
import { renderIndex } from "../src/render/index-md.js";
import { renderMermaid } from "../src/render/mermaid.js";

// Fabricate a graph with N modules (each one file), chained so every module has
// degree, to exercise the budget caps and truncation notes.
function bigGraph(n: number): Graph {
  const modules: ModuleNode[] = [];
  const files: FileNode[] = [];
  const moduleEdges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const slug = `mod${String(i).padStart(3, "0")}`;
    modules.push({
      id: slug, kind: "module", slug, path: `pkg/${slug}`, title: `pkg/${slug}`,
      summary: `Module number ${i}.`, tier: 1, members: [`pkg/${slug}/f.ts`], symbols: 1,
      degIn: i > 0 ? 1 : 0, degOut: i < n - 1 ? 1 : 0,
    });
    files.push({
      id: `pkg/${slug}/f.ts`, kind: "file", rel: `pkg/${slug}/f.ts`, fileKind: "code",
      lang: "typescript", module: slug, title: "f.ts", symbols: 1, lines: 10,
      degIn: 0, degOut: 0,
    });
    if (i < n - 1) {
      const to = `mod${String(i + 1).padStart(3, "0")}`;
      moduleEdges.push({ from: slug, to, kind: "import", weight: 1 });
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: n,
    languages: { typescript: n }, files, modules, fileEdges: [], moduleEdges,
  };
}

describe("renderMermaid budget", () => {
  it("caps modules/edges and states the truncation explicitly", () => {
    const r = renderMermaid(bigGraph(130), { maxModules: 40, maxEdges: 80 });
    expect(r.shownModules).toBe(40);
    expect(r.totalModules).toBe(130);
    expect(r.content).toContain("40 of 130 modules");
    expect(r.content).toMatch(/truncated/);
    expect(r.content.startsWith("```mermaid")).toBe(true);
  });
  it("emits no truncation note when everything fits", () => {
    const r = renderMermaid(bigGraph(5));
    expect(r.shownModules).toBe(5);
    expect(r.content).not.toMatch(/truncated/);
  });
});

describe("renderIndex budget", () => {
  it("stays loadable: caps the module table and announces the overflow (no silent cap)", () => {
    const graph = bigGraph(130);
    const mermaid = renderMermaid(graph, { maxModules: 40 });
    const md = renderIndex(graph, { repoName: "big", mermaid });
    expect(md).toContain("130 files · 130 modules");
    expect(md).toMatch(/… and 10 more module/);
    expect(md).toMatch(/Diagram .*40\/130 modules/);
    // Budget: INDEX.md must not blow up — well under a few hundred lines.
    expect(md.split("\n").length).toBeLessThan(200);
  });
});
