import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { classify } from "../src/classify.js";
import { extractCode } from "../src/extract/code.js";
import { extractMarkdown } from "../src/extract/markdown.js";
import { tierForPath } from "../src/modules.js";
import { scanRepo } from "../src/scan.js";
import { buildResolveContext, resolveImport } from "../src/resolve.js";
import { findModules } from "../src/find.js";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, FileNode, ModuleNode, Tier } from "../src/types.js";

// Regressions found by stress-testing on code-du-travail-numerique.

describe("classify: code extension always wins", () => {
  it("classifies a code file with a doc-like name as code (not doc)", () => {
    expect(classify("src/modules/home/News.tsx", ".tsx")).toBe("code");
    expect(classify("docs/example.ts", ".ts")).toBe("code");
  });
  it("still classifies real markdown as doc and manifests as config", () => {
    expect(classify("README.md", ".md")).toBe("doc");
    expect(classify("package.json", ".json")).toBe("config");
  });
});

describe("extractCode: default + barrel exports", () => {
  it("extracts `export default class` and `export default Identifier`", () => {
    const a = extractCode("a.ts", ".ts", "export default class Engine {}");
    expect(a.symbols.find((s) => s.name === "Engine")).toMatchObject({ kind: "class", exported: true });
    const b = extractCode("b.ts", ".ts", "class Thing {}\nexport default Thing;");
    expect(b.symbols.some((s) => s.name === "Thing" && s.exported)).toBe(true);
  });
  it("extracts barrel re-exports (named, aliased, star)", () => {
    const info = extractCode("index.ts", ".ts", 'export { A, B as C } from "./x";\nexport * from "./y";');
    const names = info.symbols.map((s) => s.name);
    expect(names).toContain("A");
    expect(names).toContain("C");
    expect(names).not.toContain("B"); // the aliased source name isn't the export
    expect(info.symbols.some((s) => s.kind === "reexport-all")).toBe(true);
  });
  it("drops a jest test-environment pragma as a summary", () => {
    // Split the token so vitest's own docblock scanner doesn't read it as a
    // `@jest-environment` directive for THIS test file.
    const src = "/** @jest" + "-environment node */\nexport const x = 1;";
    const info = extractCode("x.test.ts", ".ts", src);
    expect(info.summary).toBeUndefined();
  });
});

describe("extractMarkdown: summary scoping", () => {
  it("does not take a sub-section paragraph as the document summary", () => {
    const info = extractMarkdown("# Title\n\n- a bullet\n\n## Sub\n\nThis belongs to the sub-section.");
    expect(info.summary).toBeUndefined(); // intro is only bullets; sub-section prose must not be promoted
    expect(info.title).toBe("Title");
  });
  it("rejects a list lead-in ending in a colon", () => {
    const info = extractMarkdown("# T\n\nExemple :\n\n- one\n- two");
    expect(info.summary).toBeUndefined();
  });
});

describe("tierForPath: tail anywhere", () => {
  it("treats e2e and singular __test__ as tail", () => {
    expect(tierForPath("packages/x/src/e2e/helpers")).toBe(2);
    expect(tierForPath("packages/x/src/__test__/common")).toBe(2);
  });
});

const MONOREPO = fileURLToPath(new URL("./fixtures/mini-monorepo", import.meta.url));

describe("resolveImport: workspace packages", () => {
  it("resolves a cross-package @scope/x import to in-repo source", () => {
    const ctx = buildResolveContext(scanRepo(MONOREPO));
    expect(resolveImport("packages/b/src/consumer.ts", ".ts", "@scope/a", ctx)).toEqual({
      kind: "resolved",
      target: "packages/a/src/index.ts",
    });
  });
  it("treats a genuinely third-party package as external", () => {
    const ctx = buildResolveContext(scanRepo(MONOREPO));
    expect(resolveImport("packages/b/src/consumer.ts", ".ts", "react", ctx).kind).toBe("external");
  });
});

// Synthetic graph: a real feature vs a mid-path "test-*" stub and a generic leaf.
function rankGraph(): Graph {
  const fileNode = (rel: string, module: string): FileNode => ({
    id: rel, kind: "file", rel, fileKind: "code", lang: "typescript", module,
    title: rel.split("/").pop()!, symbols: 1, lines: 10, degIn: 0, degOut: 0,
  });
  const modNode = (slug: string, path: string, members: string[], tier: Tier = 1): ModuleNode => ({
    id: slug, kind: "module", slug, path, title: path, summary: `${members.length} file(s) in \`${path}/\` (typescript).`,
    tier, members, symbols: members.length, degIn: 0, degOut: 0,
  });
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: 3, languages: { typescript: 3 },
    files: [
      fileNode("src/modules/sentry/error.ts", "sentry"),
      fileNode("app/api/test-sentry-error/route.ts", "test-sentry-error"),
      fileNode("src/feature/store/index.ts", "feature-store"),
    ],
    modules: [
      modNode("sentry", "src/modules/sentry", ["src/modules/sentry/error.ts"]),
      modNode("test-sentry-error", "app/api/test-sentry-error", ["app/api/test-sentry-error/route.ts"]),
      modNode("feature-store", "src/feature/store", ["src/feature/store/index.ts"]),
    ],
    fileEdges: [], moduleEdges: [],
  };
}

describe("findModules: path penalties", () => {
  it("ranks the real implementation above a mid-path test-* stub", () => {
    const results = findModules(rankGraph(), "sentry error", 5);
    expect(results[0]?.slug).toBe("sentry");
    expect(results.findIndex((r) => r.slug === "sentry")).toBeLessThan(
      results.findIndex((r) => r.slug === "test-sentry-error"),
    );
  });
});
