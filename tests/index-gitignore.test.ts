import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runBuild } from "../src/build.js";
import { runCheck } from "../src/check.js";
import { runStatus } from "../src/status.js";
import { runEmbed } from "../src/vectors.js";
import type { StaticEmbedModel } from "../src/engine.js";
import {
  GITIGNORE_BEGIN,
  GITIGNORE_END,
  TRANSIENT_PATTERNS,
  mergeGitignore,
  regenerableArtifacts,
  renderManagedBlock,
} from "../src/index-gitignore.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
const TIME = "2026-01-01T00:00:00.000Z";

// The reviewable, committed half of an index. Anything else a build + embed
// writes must be in the managed block, or this suite fails: a new artifact
// cannot be forgotten silently.
const COMMITTED = new Set(["INDEX.md", "graph.json", "graph.mmd", "manifest.json", "symbols.json", ".gitignore"]);
const isCommitted = (rel: string) => COMMITTED.has(rel) || rel.startsWith("encyclopedia/");

const temps: string[] = [];
function temp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function build(out: string, repo = REPO) {
  return runBuild({ repo, out, mermaid: true, json: false }, TIME);
}

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel + "/"));
    else out.push(rel);
  }
  return out.sort();
}

// A tiny hand-built static tier: the engine's real keyless encoder, no download.
function staticTier() {
  const words = ["src", "pkg", "docs", "go", "ts", "md"];
  const dim = 2;
  const weights = new Float64Array((words.length + 1) * dim);
  const vocab = new Map<string, number>();
  words.forEach((w, i) => {
    vocab.set(w, i);
    weights[i * dim] = i % 2;
    weights[i * dim + 1] = (i + 1) % 2;
  });
  const model: StaticEmbedModel = { modelId: "test-static-v1", dim, unk: "[UNK]", unkId: words.length, vocabSize: words.length + 1, vocab, weights };
  return { kind: "static" as const, model, label: "test-static-v1 (dim 2)" };
}

describe("<out>/.gitignore", () => {
  it("a fresh build writes exactly the managed block", () => {
    const out = join(temp("ui-gi-"), "docs", "ultraindex");
    build(out);
    const text = readFileSync(join(out, ".gitignore"), "utf8");
    expect(text).toBe(renderManagedBlock());
    expect(text.split("\n")[0]).toBe(GITIGNORE_BEGIN);
    for (const a of ["cache.json", "search.jsonl", "callers.jsonl", "vectors.json", "*.tmp"]) {
      expect(text.split("\n")).toContain(a);
    }
    expect(text.trimEnd().split("\n").at(-1)).toBe(GITIGNORE_END);
  });

  it("lists every regenerable file a build + embed produces, and nothing a reviewer reads", async () => {
    const out = join(temp("ui-gi-"), ".ultraindex");
    build(out);
    expect(await runEmbed(out, staticTier())).toBeDefined();
    const produced = listFiles(out);
    const regenerable = produced.filter((rel) => !isCommitted(rel));
    expect(regenerable).toEqual(regenerableArtifacts());
    // Every committed artifact actually exists (the split is not vacuous).
    for (const rel of COMMITTED) expect(produced).toContain(rel);
    expect(produced.some((rel) => rel.startsWith("encyclopedia/"))).toBe(true);
    // And the block names them all, plus the interrupted-write leftovers.
    const block = renderManagedBlock().split("\n");
    for (const a of [...regenerableArtifacts(), ...TRANSIENT_PATTERNS]) expect(block).toContain(a);
  });

  it("a rebuild updates the block in place and keeps the user's lines and order byte for byte", () => {
    const out = join(temp("ui-gi-"), "docs", "ultraindex");
    build(out);
    const path = join(out, ".gitignore");
    const stale = [GITIGNORE_BEGIN, "# an older block", "old-artifact.json", GITIGNORE_END, ""].join("\n");
    const userTop = "# team rules\r\nnotes/\n";
    const userBottom = "!vectors.json\n  # indented comment\nscratch.md";
    writeFileSync(path, userTop + stale + userBottom);
    build(out);
    const text = readFileSync(path, "utf8");
    expect(text).toBe(userTop + renderManagedBlock() + userBottom);
    build(out);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("a hand-written .gitignore without a block gets it prepended, the rest untouched", () => {
    const out = join(temp("ui-gi-"), "docs", "ultraindex");
    mkdirSync(out, { recursive: true });
    const mine = "# mine\nlocal/\n\n*.bak\n";
    writeFileSync(join(out, ".gitignore"), mine);
    build(out);
    expect(readFileSync(join(out, ".gitignore"), "utf8")).toBe(renderManagedBlock() + mine);
  });

  it("merge is pure and idempotent; a half-written block is left alone as user lines", () => {
    expect(mergeGitignore(undefined)).toBe(renderManagedBlock());
    expect(mergeGitignore("")).toBe(renderManagedBlock());
    const once = mergeGitignore("a\n" + GITIGNORE_BEGIN + "\nb\n");
    expect(once).toBe(renderManagedBlock() + "a\n" + GITIGNORE_BEGIN + "\nb\n");
    expect(mergeGitignore(once)).toBe(once);
  });

  it("is byte-identical across two builds and leaves check/status FRESH", () => {
    const root = temp("ui-gi-repo-");
    const repo = join(root, "repo");
    cpSync(REPO, repo, { recursive: true });
    const a = join(repo, "docs", "ultraindex");
    const b = join(root, "other");
    build(a, repo);
    build(b, repo);
    expect(readFileSync(join(a, ".gitignore"), "utf8")).toBe(readFileSync(join(b, ".gitignore"), "utf8"));
    const res = runCheck(a, repo);
    expect(res.errors).toEqual([]);
    expect(res.stale).toBe(false);
    expect(res.added).toEqual([]);
    expect(runStatus(a)).toBeDefined();
  });

  const hasGit = spawnSync("git", ["--version"]).status === 0;
  it.skipIf(!hasGit)("git sees only the reviewable index in a committed --out dir", async () => {
    const root = temp("ui-gi-git-");
    const repo = join(root, "repo");
    cpSync(REPO, repo, { recursive: true });
    const out = join(repo, "docs", "ultraindex");
    build(out, repo);
    await runEmbed(out, staticTier());
    writeFileSync(join(out, "graph.json.tmp"), "interrupted write\n");
    expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
    const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "docs/ultraindex"], { cwd: repo, encoding: "utf8" });
    expect(st.status).toBe(0);
    const tracked = st.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^docs\/ultraindex\//, ""))
      .sort();
    expect(tracked).toEqual(listFiles(out).filter(isCommitted));
  });
});
