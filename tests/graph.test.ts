import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "../src/scan.js";
import { buildResolveContext } from "../src/resolve.js";
import { buildModules } from "../src/modules.js";
import { buildGraph } from "../src/graph.js";
import type { Edge } from "../src/types.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));

function build() {
  const scan = scanRepo(REPO);
  const ctx = buildResolveContext(scan);
  const { modules, moduleOf } = buildModules(scan);
  return { scan, graph: buildGraph(scan, ctx, modules, moduleOf), modules, moduleOf };
}

const has = (edges: Edge[], from: string, to: string, kind: string) =>
  edges.some((e) => e.from === from && e.to === to && e.kind === kind && !e.dangling);

describe("buildModules", () => {
  const { modules } = build();
  const bySlug = new Map(modules.map((m) => [m.slug, m]));
  it("groups files by directory into slugged modules", () => {
    expect([...bySlug.keys()].sort()).toEqual(["docs", "gopkg", "gopkg-sub", "pkg", "root", "src"]);
  });
  it("assigns tiers: root=0 foundations, docs=2 tail, src=1 feature", () => {
    expect(bySlug.get("root")?.tier).toBe(0);
    expect(bySlug.get("docs")?.tier).toBe(2);
    expect(bySlug.get("src")?.tier).toBe(1);
  });
  it("derives a module summary from a directory's richest doc-comment", () => {
    expect(bySlug.get("src")?.summary).toBeTruthy();
  });
});

describe("buildGraph", () => {
  const { graph } = build();

  it("creates resolved import edges, including alias + cross-language", () => {
    expect(has(graph.fileEdges, "src/client.ts", "src/util.ts", "import")).toBe(true);
    expect(has(graph.fileEdges, "src/client.ts", "src/helpers.ts", "import")).toBe(true);
    expect(has(graph.fileEdges, "gopkg/main.go", "gopkg/sub/sub.go", "import")).toBe(true);
    expect(has(graph.fileEdges, "pkg/core.py", "pkg/util.py", "import")).toBe(true);
  });

  it("creates doc-link edges and flags the broken one as dangling", () => {
    expect(has(graph.fileEdges, "README.md", "docs/guide.md", "doc-link")).toBe(true);
    const broken = graph.fileEdges.find(
      (e) => e.from === "docs/guide.md" && e.kind === "doc-link" && e.dangling,
    );
    expect(broken?.to).toBe("./missing.md");
    expect(broken?.reason).toBe("missing-target");
  });

  it("creates conservative mention edges only for distinctive symbols", () => {
    expect(has(graph.fileEdges, "README.md", "src/client.ts", "mention")).toBe(true);
    // "backoff" is a plain lowercase word — must NOT produce a mention edge.
    expect(graph.fileEdges.some((e) => e.kind === "mention" && e.to === "src/util.ts")).toBe(false);
  });

  it("never emits self-loops and computes file in-degrees", () => {
    expect(graph.fileEdges.every((e) => e.from !== e.to)).toBe(true);
    const util = graph.files.find((f) => f.rel === "src/util.ts")!;
    expect(util.degIn).toBe(2); // imported by client.ts and index.ts
  });

  it("lifts file edges to module edges without self-loops", () => {
    expect(graph.moduleEdges.every((e) => e.from !== e.to)).toBe(true);
    expect(has(graph.moduleEdges, "gopkg", "gopkg-sub", "import")).toBe(true);
  });

  it("adds a `use` edge for an unimported cross-file symbol reference, but not when an import covers it", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-use-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "factory.ts"), "export class WidgetFactory {}\n");
    // uses WidgetFactory WITHOUT importing it → use edge
    writeFileSync(join(root, "src", "consumer.ts"), "export function make() {\n  return new WidgetFactory();\n}\n");
    // imports WidgetFactory → import edge should SUPPRESS the use edge
    writeFileSync(
      join(root, "src", "importer.ts"),
      "import { WidgetFactory } from './factory';\nexport function build() {\n  return new WidgetFactory();\n}\n",
    );
    const scan = scanRepo(root);
    const ctx = buildResolveContext(scan);
    const { modules, moduleOf } = buildModules(scan);
    const g = buildGraph(scan, ctx, modules, moduleOf);
    expect(has(g.fileEdges, "src/consumer.ts", "src/factory.ts", "use")).toBe(true);
    expect(has(g.fileEdges, "src/importer.ts", "src/factory.ts", "import")).toBe(true);
    expect(has(g.fileEdges, "src/importer.ts", "src/factory.ts", "use")).toBe(false);
  });

  it("is deterministic — two builds are deeply equal", () => {
    expect(buildGraph(...((): [any, any, any, any] => {
      const s = scanRepo(REPO);
      const c = buildResolveContext(s);
      const m = buildModules(s);
      return [s, c, m.modules, m.moduleOf];
    })())).toEqual(graph);
  });
});
