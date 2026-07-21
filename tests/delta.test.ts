import { describe, it, expect } from "vitest";
import { computeDelta, formatDeltaPanel, RISK_WEIGHTS } from "../src/delta.js";
import type { DiffFile, Hunk } from "../src/git.js";
import type { Edge, FileNode, Graph, ModuleNode, SymbolIndex, Tier } from "../src/types.js";

const mod = (slug: string, opts: Partial<ModuleNode> = {}): ModuleNode => ({
  id: slug,
  kind: "module",
  slug,
  path: slug,
  title: slug,
  summary: "",
  tier: (opts.tier ?? 1) as Tier,
  members: [],
  symbols: 1,
  degIn: 0,
  degOut: 0,
  ...opts,
});

const file = (rel: string, module: string, fileKind: FileNode["fileKind"] = "code"): FileNode => ({
  id: rel,
  kind: "file",
  rel,
  fileKind,
  lang: "ts",
  module,
  symbols: 1,
  lines: 100,
  degIn: 0,
  degOut: 0,
});

const edge = (from: string, to: string, kind: Edge["kind"] = "import"): Edge => ({ from, to, kind, weight: 1 });

const graphOf = (modules: ModuleNode[], files: FileNode[], fileEdges: Edge[] = [], moduleEdges: Edge[] = []): Graph => ({
  schemaVersion: 4,
  version: "0.0.0",
  commit: "abc1234",
  fileCount: files.length,
  languages: {},
  files,
  modules,
  fileEdges,
  moduleEdges,
});

const symsOf = (defs: SymbolIndex["defs"]): SymbolIndex => ({ schemaVersion: 4, defs, refs: {} });

const changed = (path: string, status: DiffFile["status"] = "modified", extra: Partial<DiffFile> = {}): DiffFile => ({
  path,
  status,
  ...extra,
});

const BASE = { ref: "main", mergeBase: "0123456789abcdef0123456789abcdef01234567", staged: false };

const run = (
  graph: Graph,
  symbols: SymbolIndex | undefined,
  files: DiffFile[],
  hunks: [string, Hunk[]][] = [],
  depth = 2,
) => computeDelta(graph, symbols, { files, hunks: new Map(hunks), base: BASE }, depth);

describe("computeDelta — hunk → symbol mapping", () => {
  const g = graphOf([mod("src", { testedBy: ["src/a.test.ts"] })], [file("src/a.ts", "src")]);
  const syms = symsOf({
    alpha: [{ file: "src/a.ts", line: 10, endLine: 40, kind: "function", exported: true, lang: "ts" }],
    beta: [{ file: "src/a.ts", line: 12, endLine: 15, kind: "method", exported: false, lang: "ts", parent: "alpha" }],
    gamma: [{ file: "src/a.ts", line: 60, kind: "function", exported: false, lang: "ts" }],
  });

  it("maps a hunk to every enclosing symbol, innermost first", () => {
    const res = run(g, syms, [changed("src/a.ts")], [["src/a.ts", [{ start: 13, end: 13 }]]]);
    const names = res.changes[0]!.symbols.map((s) => s.name);
    expect(names).toEqual(["beta", "alpha"]);
    expect(res.changes[0]!.symbols[0]!.parent).toBe("alpha");
  });

  it("falls back to the nearest def above when endLine is absent, flagged approx", () => {
    const res = run(g, syms, [changed("src/a.ts")], [["src/a.ts", [{ start: 65, end: 66 }]]]);
    expect(res.changes[0]!.symbols).toEqual([
      { name: "gamma", kind: "function", exported: false, line: 60, approx: true },
    ]);
  });

  it("maps nothing for a hunk above the first def", () => {
    const res = run(g, syms, [changed("src/a.ts")], [["src/a.ts", [{ start: 1, end: 2 }]]]);
    expect(res.changes[0]!.symbols).toEqual([]);
  });
});

describe("computeDelta — risk signals in isolation", () => {
  it("exported-change alone scores its exact weight, LOW", () => {
    const g = graphOf([mod("src", { testedBy: ["src/a.test.ts"] })], [file("src/a.ts", "src")]);
    const syms = symsOf({
      alpha: [{ file: "src/a.ts", line: 5, endLine: 9, kind: "function", exported: true, lang: "ts" }],
    });
    const res = run(g, syms, [changed("src/a.ts")], [["src/a.ts", [{ start: 6, end: 6 }]]]);
    const m = res.modules[0]!;
    expect(m.score).toBe(RISK_WEIGHTS.exportedChange);
    expect(m.bucket).toBe("LOW");
    expect(m.reasons).toEqual(["exported symbol alpha changed"]);
  });

  it("a top-pagerank module fires the hub signal with a percentile reason", () => {
    const modules = Array.from({ length: 21 }, (_, i) =>
      mod(`m${String(i).padStart(2, "0")}`, { pagerank: 1 + i * 0.1, testedBy: ["t.test.ts"] }),
    );
    const files = [file("m20/a.ts", "m20")];
    const res = run(graphOf(modules, files), undefined, [changed("m20/a.ts")]);
    const m = res.modules[0]!;
    expect(m.score).toBe(RISK_WEIGHTS.hubHigh);
    expect(m.reasons[0]).toMatch(/pagerank p\d+ hub/);
  });

  it("ties in the hub metric do not rank anyone above anyone", () => {
    const modules = Array.from({ length: 10 }, (_, i) =>
      mod(`m${i}`, { pagerank: 1, testedBy: ["t.test.ts"] }),
    );
    const res = run(graphOf(modules, [file("m9/a.ts", "m9")]), undefined, [changed("m9/a.ts")]);
    expect(res.modules[0]!.score).toBe(0);
  });

  it("a wide blast radius fires the blast signal with its numbers", () => {
    const files = [file("src/a.ts", "src")];
    const modules = [mod("src", { testedBy: ["t.test.ts"] })];
    const fileEdges: Edge[] = [];
    for (let i = 0; i < 25; i++) {
      const slug = `dep${String(i).padStart(2, "0")}`;
      modules.push(mod(slug, { testedBy: ["t.test.ts"] }));
      files.push(file(`${slug}/f.ts`, slug));
      fileEdges.push(edge(`${slug}/f.ts`, "src/a.ts"));
    }
    const res = run(graphOf(modules, files, fileEdges), undefined, [changed("src/a.ts")]);
    const m = res.modules[0]!;
    expect(m.score).toBe(RISK_WEIGHTS.blastHigh);
    expect(m.reasons[0]).toBe("25 dependent files across 25 modules (depth 2)");
    expect(m.impact).toEqual({ directFiles: 25, transitiveFiles: 25, modules: res.modules[0]!.impact.modules });
    expect(m.impact.modules.length).toBe(25);
  });

  it("an uncovered testable module fires the test-gap signal", () => {
    const g = graphOf([mod("src")], [file("src/a.ts", "src")]);
    const res = run(g, undefined, [changed("src/a.ts")]);
    const m = res.modules[0]!;
    expect(m.score).toBe(RISK_WEIGHTS.testGap);
    expect(m.reasons).toEqual(["no test covers this module"]);
    expect(m.tests).toEqual({ status: "gap", files: [] });
  });

  it("a surprising cross-community edge incident to the module fires the surprise signal", () => {
    const g = graphOf([mod("src", { testedBy: ["t.test.ts"] }), mod("far")], [file("src/a.ts", "src")]);
    g.surprises = [{ from: "src", to: "far", kind: "import", weight: 1, communities: [0, 1], pairEdges: 1 }];
    const res = run(g, undefined, [changed("src/a.ts")]);
    const m = res.modules[0]!;
    expect(m.score).toBe(RISK_WEIGHTS.surprise);
    expect(m.reasons[0]).toBe("cross-community edge to far (surprising)");
  });

  it("a dangling import from a changed file fires the dangling signal and is listed", () => {
    const g = graphOf(
      [mod("src", { testedBy: ["t.test.ts"] })],
      [file("src/a.ts", "src")],
      [{ ...edge("src/a.ts", "./missing"), dangling: true, reason: "missing-module" }],
    );
    const res = run(g, undefined, [changed("src/a.ts")]);
    const m = res.modules[0]!;
    expect(m.score).toBe(RISK_WEIGHTS.dangling);
    expect(m.reasons[0]).toBe('dangling import "./missing" in src/a.ts');
    expect(res.dangling).toEqual([{ from: "src/a.ts", spec: "./missing", reason: "missing-module" }]);
  });
});

describe("computeDelta — buckets, ordering, partitions", () => {
  it("hits the HIGH boundary at 60 and MEDIUM at 30", () => {
    // exported(25) + test-gap(20) + dangling(15) = 60 → HIGH.
    const high = graphOf(
      [mod("src")],
      [file("src/a.ts", "src")],
      [{ ...edge("src/a.ts", "./gone"), dangling: true, reason: "missing-module" }],
    );
    const hs = symsOf({
      alpha: [{ file: "src/a.ts", line: 5, endLine: 9, kind: "function", exported: true, lang: "ts" }],
    });
    const hres = run(high, hs, [changed("src/a.ts")], [["src/a.ts", [{ start: 6, end: 6 }]]]);
    expect(hres.modules[0]!.score).toBe(60);
    expect(hres.modules[0]!.bucket).toBe("HIGH");

    // blast-medium(10) + test-gap(20) = 30 → MEDIUM. All six dependents live in
    // ONE module so the ≥5-modules blast-high rule stays quiet.
    const files = [file("src/a.ts", "src")];
    const modules = [mod("src"), mod("dd", { testedBy: ["t.test.ts"] })];
    const fileEdges: Edge[] = [];
    for (let i = 0; i < 6; i++) {
      files.push(file(`dd/f${i}.ts`, "dd"));
      fileEdges.push(edge(`dd/f${i}.ts`, "src/a.ts"));
    }
    const mres = run(graphOf(modules, files, fileEdges), undefined, [changed("src/a.ts")]);
    expect(mres.modules[0]!.score).toBe(30);
    expect(mres.modules[0]!.bucket).toBe("MEDIUM");
  });

  it("orders modules by score desc then slug, deterministically under permutation", () => {
    const g = graphOf(
      [mod("aa", { testedBy: ["t.test.ts"] }), mod("bb"), mod("cc")],
      [file("aa/a.ts", "aa"), file("bb/b.ts", "bb"), file("cc/c.ts", "cc")],
    );
    const fwd = run(g, undefined, [changed("aa/a.ts"), changed("bb/b.ts"), changed("cc/c.ts")]);
    const rev = run(g, undefined, [changed("cc/c.ts"), changed("bb/b.ts"), changed("aa/a.ts")]);
    // bb and cc both score test-gap(20); aa scores 0 → last. Ties break by slug.
    expect(fwd.modules.map((m) => m.slug)).toEqual(["bb", "cc", "aa"]);
    expect(rev.modules).toEqual(fwd.modules);
  });

  it("partitions deleted, unindexed and binary changes", () => {
    const g = graphOf([mod("src", { testedBy: ["t.test.ts"] })], [file("src/a.ts", "src"), file("src/img.png", "src", "asset")]);
    const res = run(g, undefined, [
      changed("src/old.ts", "deleted"),
      changed(".github/ci.yml"),
      changed("src/img.png", "modified", { binary: true }),
      changed("src/a.ts"),
    ]);
    expect(res.deleted).toEqual(["src/old.ts"]);
    expect(res.unindexed).toEqual([".github/ci.yml"]);
    const bin = res.changes.find((c) => c.path === "src/img.png")!;
    expect(bin.binary).toBe(true);
    expect(bin.symbols).toEqual([]);
    expect(res.changes.some((c) => c.path === "src/old.ts")).toBe(true);
  });

  it("marks non-testable modules n/a instead of inventing a gap", () => {
    const g = graphOf([mod("docs", { symbols: 0 })], [file("docs/x.md", "docs", "doc")]);
    const res = run(g, undefined, [changed("docs/x.md")]);
    expect(res.modules[0]!.tests.status).toBe("n/a");
    expect(res.modules[0]!.score).toBe(0);
  });

  it("emits the full empty envelope on an empty diff", () => {
    const g = graphOf([mod("src")], [file("src/a.ts", "src")]);
    const res = run(g, undefined, []);
    expect(res).toEqual({
      base: BASE,
      indexCommit: "abc1234",
      depth: 2,
      changes: [],
      modules: [],
      dangling: [],
      deleted: [],
      unindexed: [],
      notes: ["symbols.json missing — symbol-level attribution disabled"],
    });
  });
});

describe("formatDeltaPanel", () => {
  it("prints the risk-ranked panel with reasons and pointers", () => {
    const g = graphOf([mod("src")], [file("src/a.ts", "src")]);
    const syms = symsOf({
      alpha: [{ file: "src/a.ts", line: 5, endLine: 9, kind: "function", exported: true, lang: "ts" }],
    });
    const res = run(g, syms, [changed("src/a.ts")], [["src/a.ts", [{ start: 6, end: 6 }]]]);
    const panel = formatDeltaPanel(res);
    expect(panel).toContain("delta vs main (merge-base 0123456)");
    expect(panel).toMatch(/MEDIUM +src +score 45/);
    expect(panel).toContain("exported symbol alpha changed");
    expect(panel).toContain("tests: GAP");
    expect(panel).toContain("entry: encyclopedia/src.md");
  });

  it("says so plainly when nothing changed", () => {
    const g = graphOf([mod("src")], [file("src/a.ts", "src")]);
    const panel = formatDeltaPanel(run(g, undefined, []));
    expect(panel).toContain("no changes vs main");
  });
});

// --- git integration -------------------------------------------------------

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDelta } from "../src/delta.js";
import { runBuild } from "../src/build.js";
import { sh, have } from "../src/util.js";

const TIME = "2026-01-01T00:00:00.000Z";

function git(dir: string, ...args: string[]): string {
  const r = sh("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args]);
  if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ui-delta-"));
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export function alpha(): number {\n  return 1;\n}\n");
  writeFileSync(join(repo, "src", "b.ts"), 'import { alpha } from "./a";\nexport const b = alpha();\n');
  writeFileSync(join(repo, "src", "old.ts"), "export const gone = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
}

const build = (repo: string): string => {
  const out = join(repo, ".ultraindex");
  runBuild({ repo, out, mermaid: false, json: false }, TIME);
  return out;
};

describe.skipIf(!have("git"))("runDelta — git integration", () => {
  it("maps a branch diff end to end: modified, renamed, deleted, added, untracked", () => {
    const repo = makeRepo();
    git(repo, "checkout", "-q", "-b", "feat");
    writeFileSync(join(repo, "src", "a.ts"), "export function alpha(): number {\n  return 42;\n}\n");
    git(repo, "mv", "src/b.ts", "src/b2.ts");
    git(repo, "rm", "-q", "src/old.ts");
    writeFileSync(join(repo, "src", "c.ts"), "export const c = 3;\n");
    git(repo, "add", "src/c.ts");
    git(repo, "commit", "-q", "-am", "work");
    writeFileSync(join(repo, "src", "u.ts"), "export const u = 9;\n"); // untracked
    const out = build(repo);

    const res = runDelta(out, repo, { base: "main" });
    if ("error" in res) throw new Error(res.error);
    expect(res.base.ref).toBe("main");
    expect(res.deleted).toEqual(["src/old.ts"]);
    const renamed = res.changes.find((c) => c.status === "renamed")!;
    expect(renamed.path).toBe("src/b2.ts");
    expect(renamed.oldPath).toBe("src/b.ts");
    expect(res.changes.some((c) => c.path === "src/u.ts" && c.status === "added")).toBe(true);
    const a = res.changes.find((c) => c.path === "src/a.ts")!;
    expect(a.symbols.map((s) => s.name)).toContain("alpha");
    const mod = res.modules.find((m) => m.changedFiles.includes("src/a.ts"))!;
    expect(mod.reasons.some((r) => r.includes("exported symbol"))).toBe(true);
  });

  it("fails closed when a diff-touched file drifted since the build", () => {
    const repo = makeRepo();
    const out = build(repo);
    appendFileSync(join(repo, "src", "a.ts"), "export const extra = 2;\n");
    const res = runDelta(out, repo, { base: "main" });
    expect("error" in res && res.error).toMatch(/stale.*run `ultraindex build` first/);
    expect("error" in res && res.stale).toEqual(["src/a.ts"]);
  });

  it("--staged sees only the staged changeset; unstaged drift elsewhere does not block", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "src", "a.ts"), "export function alpha(): number {\n  return 7;\n}\n");
    git(repo, "add", "src/a.ts");
    const out = build(repo); // fresh for a.ts's new content
    appendFileSync(join(repo, "src", "b.ts"), "// unstaged drift\n");
    const res = runDelta(out, repo, { staged: true });
    if ("error" in res) throw new Error(res.error);
    expect(res.base.staged).toBe(true);
    expect(res.changes.map((c) => c.path)).toEqual(["src/a.ts"]);
  });

  it("reports the error contracts: bad base, not a repo", () => {
    const repo = makeRepo();
    const out = build(repo);
    const bad = runDelta(out, repo, { base: "nope" });
    expect("error" in bad && bad.error).toContain('base ref "nope" not found');

    const plain = mkdtempSync(join(tmpdir(), "ui-plain-"));
    const noRepo = runDelta(out, plain, {});
    expect("error" in noRepo && noRepo.error).toContain("not inside one");
  });

  it("falls back to HEAD with a note when no default branch exists", () => {
    const repo = mkdtempSync(join(tmpdir(), "ui-trunk-"));
    git(repo, "init", "-q", "-b", "trunk");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    const out = build(repo);
    writeFileSync(join(repo, "src", "n.ts"), "export const n = 1;\n"); // untracked... but stale gate: new eligible file
    const res = runDelta(out, repo, {});
    // The untracked file was not in the build → stale gate fires (honest contract).
    expect("error" in res).toBe(true);
    // After a rebuild it flows through with the HEAD-fallback note.
    const out2 = build(repo);
    const res2 = runDelta(out2, repo, {});
    if ("error" in res2) throw new Error(res2.error);
    expect(res2.base.ref).toBe("HEAD");
    expect(res2.notes.some((n) => n.includes("no default branch"))).toBe(true);
    expect(res2.changes.some((c) => c.path === "src/n.ts" && c.status === "added")).toBe(true);
  });
});
