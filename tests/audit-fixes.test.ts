import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { classify, extractCode, extractMarkdown, tierForPath, buildModules, scanRepo, buildResolveContext, resolveImport, readText, compileGlobs } from "../src/engine.js";
import { runBuild } from "../src/build.js";
import { runCheck } from "../src/check.js";
import { parseCitations } from "../src/cite.js";
import { findModules } from "../src/find.js";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, FileNode, ModuleNode, Tier } from "../src/types.js";

// Regressions found by stress-testing on code-du-travail-numerique.

// Build a throwaway repo on disk from a {relpath: contents} map; returns its root.
function scratchRepo(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "ui-audit-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

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

// code-du-travail-numerique is a lerna/pnpm monorepo where each package keeps its
// OWN tsconfig (the frontend aliases `@styled-system/*`). v1 read only the root
// tsconfig, so those intra-repo aliases silently fell through to "external".
describe("resolveImport: per-package tsconfig path aliases (monorepo)", () => {
  it("resolves a package-local alias via that package's own tsconfig (globby JSONC and all)", () => {
    const root = scratchRepo({
      // The path target "./src/components/*" (a `/*`) plus the "**/*.ts" include
      // (a `*/`) is exactly the combination that broke the naive comment stripper.
      "packages/web/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@ui/*": ["./src/components/*"] } },
        include: ["**/*.ts", "**/*.tsx"],
      }),
      "packages/web/src/components/Button.tsx": "export const Button = () => null;\n",
      "packages/web/src/app.tsx": 'import { Button } from "@ui/Button";\n',
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(ctx.warnings).toEqual([]); // a valid globby tsconfig must NOT be flagged unparseable
      expect(resolveImport("packages/web/src/app.tsx", ".tsx", "@ui/Button", ctx)).toEqual({
        kind: "resolved",
        target: "packages/web/src/components/Button.tsx",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats an alias to an absent (generated) target tree as external, not a false dangling", () => {
    const root = scratchRepo({
      "packages/web/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@styled/*": ["./src/styled-system/*"] } },
      }),
      "packages/web/src/app.tsx": 'import { css } from "@styled/css";\n',
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      // src/styled-system/ is codegen output, not committed → no edge, no false dangling.
      expect(resolveImport("packages/web/src/app.tsx", ".tsx", "@styled/css", ctx).kind).toBe("external");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags an alias into a REAL in-repo dir but missing file as dangling", () => {
    const root = scratchRepo({
      "packages/web/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@ui/*": ["./src/components/*"] } },
      }),
      "packages/web/src/components/Button.tsx": "export const Button = () => null;\n",
      "packages/web/src/app.tsx": 'import { Missing } from "@ui/Missing";\n',
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(resolveImport("packages/web/src/app.tsx", ".tsx", "@ui/Missing", ctx)).toEqual({
        kind: "dangling",
        reason: "alias-unresolved",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildResolveContext: an unparseable tsconfig is surfaced, not silently dropped", () => {
  it("records a warning that flows into the build manifest notes", () => {
    const root = scratchRepo({
      "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["src/*"] ', // truncated → unparseable
      "src/x.ts": "export const x = 1;\n",
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(ctx.warnings.some((w) => /unparseable.*tsconfig\.json/.test(w))).toBe(true);
      const { manifest } = runBuild({ repo: root, out: join(root, ".ui"), mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
      expect(manifest.notes.some((n) => /unparseable.*tsconfig\.json/.test(n))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// A French repo has accented filenames AND can ship files with a Unicode BOM.
describe("readText: Unicode BOM handling", () => {
  it("strips a UTF-8 BOM so line-1 symbol extraction (and `[file:1]`) still works", () => {
    const root = scratchRepo({
      "a.ts": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("export const x = 1;\n")]),
    });
    try {
      const txt = readText(join(root, "a.ts"));
      expect(txt.startsWith("export")).toBe(true); // no leading ﻿ glued to the token
      const info = extractCode("a.ts", ".ts", txt);
      expect(info.symbols.some((s) => s.name === "x" && s.line === 1)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("decodes a UTF-16LE file instead of dropping it as binary", () => {
    const root = scratchRepo({
      "b.ts": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("export const y = 2;\n", "utf16le")]),
    });
    try {
      expect(readText(join(root, "b.ts"))).toContain("export const y = 2;");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("recovers a UTF-16BE file with an odd trailing byte instead of throwing/dropping it", () => {
    // FE FF BOM + UTF-16BE "ab" (00 61 00 62) + one stray byte → odd post-BOM length.
    const root = scratchRepo({ "c.ts": Buffer.from([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62, 0x00]) });
    try {
      expect(readText(join(root, "c.ts"))).toContain("ab");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("decodes a Latin-1 source instead of baking in U+FFFD mojibake", () => {
    const root = scratchRepo({ "d.ts": Buffer.from([0x2f, 0x2f, 0x20, 0xe9, 0x0a]) }); // "// é\n" in Latin-1
    try {
      const txt = readText(join(root, "d.ts"));
      expect(txt).toContain("é");
      expect(txt).not.toContain("�");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("treats a NUL byte AFTER the first 4 KiB as binary (whole-buffer sniff)", () => {
    const root = scratchRepo({ "e.bin": Buffer.concat([Buffer.alloc(5000, 0x61), Buffer.from([0x00])]) });
    try {
      expect(readText(join(root, "e.bin"))).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// tsconfig `extends` is the dominant monorepo layout (Nx/Turborepo/lerna): the
// package config holds only `{ "extends": "../../tsconfig.base.json" }` and the
// base declares baseUrl+paths. v1 read each config's own compilerOptions only.
describe("resolveImport: tsconfig `extends` chain", () => {
  it("resolves an alias declared in a shared base config", () => {
    const root = scratchRepo({
      "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@app/*": ["./src/*"] } } }),
      "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),
      "src/utils/helper.ts": "export const helper = () => 42;\n",
      "src/main.ts": 'import { helper } from "@app/utils/helper";\n',
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(ctx.warnings).toEqual([]);
      expect(resolveImport("src/main.ts", ".ts", "@app/utils/helper", ctx)).toEqual({
        kind: "resolved",
        target: "src/utils/helper.ts",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("resolves a cross-package alias when the package config extends the root base", () => {
    const root = scratchRepo({
      "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["packages/shared/src/*"] } } }),
      "packages/app/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json" }),
      "packages/app/src/main.ts": 'import { x } from "@shared/index";\n',
      "packages/shared/src/index.ts": "export const x = 1;\n",
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(resolveImport("packages/app/src/main.ts", ".ts", "@shared/index", ctx)).toEqual({
        kind: "resolved",
        target: "packages/shared/src/index.ts",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("warns (does not crash) when a relative extends base is missing", () => {
    const root = scratchRepo({
      "tsconfig.json": JSON.stringify({ extends: "./nope.base.json", compilerOptions: {} }),
      "src/main.ts": "export const x = 1;\n",
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(ctx.warnings.some((w) => /extends .*nope\.base\.json.* missing/.test(w))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("extractCode: imports wrapped across lines (formatter output)", () => {
  it("captures the `from` target of a multiline import, a multiline re-export, and two on one line", () => {
    const src =
      "import {\n  A,\n  B,\n} from './x';\n" +
      "export {\n  C,\n} from './y';\n" +
      "import a from './p'; import b from './q';\n" +
      "const m = await import('./dyn');\n";
    const specs = extractCode("f.ts", ".ts", src).refs.map((r) => r.spec);
    for (const s of ["./x", "./y", "./p", "./q", "./dyn"]) expect(specs).toContain(s);
  });
});

describe("compileGlobs: a trailing `**` matches files, not nothing", () => {
  it("`src/**` matches everything beneath src/", () => {
    const m = compileGlobs(["src/**"])!;
    expect(m("src/a.ts")).toBe(true);
    expect(m("src/a/b/c.ts")).toBe(true);
    expect(m("other.ts")).toBe(false);
  });
  it("`packages/**/*.ts` still matches across and at zero depth", () => {
    const m = compileGlobs(["packages/**/*.ts"])!;
    expect(m("packages/x/src/a.ts")).toBe(true);
    expect(m("packages/a.ts")).toBe(true);
  });
});

describe("check: a filtered build is not reported as perpetually stale", () => {
  it("re-applies the build's --exclude when hashing for staleness", () => {
    const root = scratchRepo({ "src/keep.ts": "export const k = 1;\n", "vendor/big.ts": "export const b = 1;\n" });
    try {
      const out = join(root, ".ui");
      runBuild({ repo: root, out, exclude: ["vendor/**"], mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
      const res = runCheck(out, root);
      expect(res.added).toEqual([]); // vendor/big.ts was excluded from the build AND the check
      expect(res.stale).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveImport: workspace robustness", () => {
  it("parses a JSONC/trailing-comma package.json so its cross-package edges survive", () => {
    const root = scratchRepo({
      "packages/a/package.json": '{ "name": "@x/a", }', // trailing comma — bare JSON.parse would drop it
      "packages/a/src/index.ts": "export const a = 1;\n",
      "packages/b/src/consumer.ts": 'import "@x/a";\n',
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(resolveImport("packages/b/src/consumer.ts", ".ts", "@x/a", ctx)).toEqual({
        kind: "resolved",
        target: "packages/a/src/index.ts",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("falls through to a workspace package when an overlapping alias prefix resolves to nothing", () => {
    const root = scratchRepo({
      // alias "@lib/*" → a generated dir that isn't committed; ALSO a workspace pkg "@lib/core".
      "packages/app/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./generated/*"] } } }),
      "packages/app/src/x.ts": 'import "@lib/core";\n',
      "packages/core/package.json": JSON.stringify({ name: "@lib/core" }),
      "packages/core/src/index.ts": "export const c = 1;\n",
    });
    try {
      const ctx = buildResolveContext(scanRepo(root));
      expect(resolveImport("packages/app/src/x.ts", ".ts", "@lib/core", ctx)).toEqual({
        kind: "resolved",
        target: "packages/core/src/index.ts",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("parseCitations: Next.js catch-all routes are not truncated", () => {
  it("keeps the full path of a `[...catch]` segment (grounding gate must accept it)", () => {
    const cs = parseCitations("Auth is wired at [app/api/auth/[...nextauth]/route.ts:2].");
    expect(cs.map((c) => c.path)).toContain("app/api/auth/[...nextauth]/route.ts");
  });
});

describe("buildModules: slugs are injective and order-independent", () => {
  it("gives colliding dir bases distinct, stable slugs (not positional)", () => {
    const root = scratchRepo({ "a/b/f.ts": "export const x = 1;\n", "a-b/g.ts": "export const y = 1;\n" });
    try {
      const slugs1 = buildModules(scanRepo(root)).modules.map((m) => m.slug);
      expect(new Set(slugs1).size).toBe(slugs1.length); // injective
      const slugs2 = buildModules(scanRepo(root)).modules.map((m) => m.slug);
      expect(slugs2).toEqual(slugs1); // deterministic across rebuilds
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("gives an all-non-ASCII directory a stable content-derived slug (not 'module')", () => {
    const root = scratchRepo({ "日本語/f.ts": "export const x = 1;\n" });
    try {
      const m = buildModules(scanRepo(root)).modules.find((x) => x.path === "日本語")!;
      expect(m.slug).toMatch(/^module-[0-9a-f]{8}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("walk: a directory symlink cycle does not loop or duplicate", () => {
  it("skips a symlinked dir that resolves to an already-walked directory", () => {
    const root = scratchRepo({ "pkg/a.ts": "export const a = 1;\n" });
    try {
      symlinkSync(join(root, "pkg"), join(root, "pkg", "loop"), "dir"); // pkg/loop -> pkg (cycle)
      const scan = scanRepo(root);
      const rels = scan.files.map((f) => f.rel);
      expect(new Set(rels).size).toBe(rels.length); // no phantom duplicates
      expect(rels.some((r) => r.includes("loop"))).toBe(false); // the cycle was not descended
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
