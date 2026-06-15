import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerify, applyVerdicts } from "../src/verify.js";
import { checkAnswer } from "../src/check.js";
import { runBuild } from "../src/build.js";

function miniRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ui-vrepo-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(
    join(repo, "src/retry.ts"),
    "export function retry() {\n  // exponential backoff doubles the delay each attempt\n  return backoff();\n}\n",
  );
  writeFileSync(join(repo, "src/util.ts"), "export const x = 1;\nexport const y = 2;\n");
  return repo;
}

const ANSWER = `# Answer
The retry uses exponential backoff that doubles the delay [src/retry.ts:2].

Two constants are exported from util [src/util.ts:1-2].`;

function writeVerdicts(dir: string, map: Record<string, string>): string {
  const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8"));
  const pairs = todo.pairs.map((p: any) => ({ ...p, verdict: map[p.citation] ?? "supported", note: "" }));
  const f = join(dir, "verdicts.json");
  writeFileSync(f, JSON.stringify({ pairs }));
  return f;
}

describe("runVerify (worklist)", () => {
  it("pairs each claim with its cited file:line excerpt", () => {
    const repo = miniRepo();
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    const r = runVerify(ans, repo);
    expect(r.pairs.length).toBe(2);
    expect(r.pairs.map((p) => p.citation).sort()).toEqual(["src/retry.ts:2", "src/util.ts:1-2"]);
    expect(r.pairs.find((p) => p.citation === "src/retry.ts:2")!.digest).toContain("exponential backoff");
    expect(existsSync(join(repo, "VERIFY.todo.json"))).toBe(true);
    expect(existsSync(join(repo, "VERIFY.md"))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("ignores a citation hidden in inline code", () => {
    const repo = miniRepo();
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, "# A\nA real claim about retry backoff [src/retry.ts:2].\n\nAn example `[src/util.ts:1]` only.");
    const r = runVerify(ans, repo);
    expect(r.pairs.map((p) => p.citation)).toEqual(["src/retry.ts:2"]);
    rmSync(repo, { recursive: true, force: true });
  });

  it("caps the worklist at maxVerify", () => {
    const repo = miniRepo();
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    const r = runVerify(ans, repo, { maxVerify: 1 });
    expect(r.pairs.length).toBe(1);
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("applyVerdicts (semantic gate)", () => {
  function setup() {
    const repo = miniRepo();
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    runVerify(ans, repo);
    return repo;
  }
  it("passes when all supported", () => {
    const repo = setup();
    const r = applyVerdicts(repo, writeVerdicts(repo, {}));
    expect(r.ok).toBe(true);
    expect(existsSync(join(repo, "VERIFY.json"))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });
  it("fails on a refuted claim", () => {
    const repo = setup();
    const r = applyVerdicts(repo, writeVerdicts(repo, { "src/retry.ts:2": "refuted" }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.verdict === "refuted")).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });
  it("fails when a claim's only citation is unsupported", () => {
    const repo = setup();
    const r = applyVerdicts(repo, writeVerdicts(repo, { "src/retry.ts:2": "unsupported" }));
    expect(r.ok).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("checkAnswer --semantic composition", () => {
  it("folds VERIFY.json: mechanical passes, semantic fails, plain unchanged", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    expect(checkAnswer(out, ans).ok).toBe(true);
    runVerify(ans, repo);
    applyVerdicts(repo, writeVerdicts(repo, { "src/retry.ts:2": "unsupported" }));
    const sem = checkAnswer(out, ans, { semantic: true });
    expect(sem.ok).toBe(false);
    expect(sem.semantic?.ok).toBe(false);
    expect(checkAnswer(out, ans).ok).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("warns (does not fail) when --semantic is set but no VERIFY.json exists", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });
});
