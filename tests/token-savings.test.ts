import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Smoke test for the token-savings eval (evals/token-savings/run.mjs): runs it
// end-to-end on the smallest committed fixture (its default target,
// tests/fixtures/mini-repo) through the SHIPPED bundle, and asserts the eval
// exits 0, emits the documented JSON shape, and that on task 1 ("where is
// symbol X defined") ultraindex reads fewer tokens than the naive rg+read-
// files-in-full baseline. Absolute token counts and timings are environment-
// dependent measurements, so only the shape and that one directional claim —
// the skill's core claim — are asserted.
const RUN = fileURLToPath(new URL("../evals/token-savings/run.mjs", import.meta.url));

interface Strategy {
  commands: string[];
  tokens: number;
  ms: number;
}

interface Task {
  id: string;
  question: string;
  ultraindex: Strategy;
  baseline: Strategy & { filesRead: number };
  ratio: number;
}

describe("token-savings eval (smoke)", () => {
  it("runs on the mini-repo fixture, exits 0, and yields the documented shape", () => {
    const r = spawnSync(process.execPath, [RUN], { encoding: "utf8", timeout: 120_000 });
    expect(r.status).toBe(0);

    // stdout carries a delimited JSON block followed by a markdown report.
    const m = /=== JSON ===\n([\s\S]*?)\n=== REPORT ===/.exec(r.stdout);
    expect(m).not.toBeNull();
    const report = JSON.parse(m![1]!);

    expect(report.target).toBe("tests/fixtures/mini-repo");
    expect(report.tokenizer).toBe("ceil(chars/4)");

    // Index build overhead is reported separately, never hidden in a task.
    expect(report.indexBuild.ms).toBeGreaterThan(0);
    expect(report.indexBuild.tokens).toBeGreaterThan(0);

    const tasks: Task[] = report.tasks;
    expect(tasks.map((t) => t.id)).toEqual(["symbol-definition", "callers", "module-overview"]);
    for (const t of tasks) {
      expect(t.ultraindex.tokens).toBeGreaterThan(0);
      expect(t.ultraindex.ms).toBeGreaterThan(0);
      expect(t.ultraindex.commands.length).toBeGreaterThan(0);
      expect(t.baseline.tokens).toBeGreaterThan(0);
      expect(t.baseline.ms).toBeGreaterThan(0);
      expect(t.baseline.filesRead).toBeGreaterThan(0);
      expect(t.ratio).toBeCloseTo(t.baseline.tokens / t.ultraindex.tokens, 1);
    }

    expect(report.totals.ultraindex).toBe(tasks.reduce((n, t) => n + t.ultraindex.tokens, 0));
    expect(report.totals.baseline).toBe(tasks.reduce((n, t) => n + t.baseline.tokens, 0));

    // The markdown report follows the JSON block.
    expect(r.stdout).toContain("| Task | ultraindex tokens | baseline tokens |");

    // The core claim, on task 1: finding a definition through the index reads
    // fewer tokens than ripgrep + reading every matched file in full. Token
    // counts are byte-derived from deterministic outputs on a pinned fixture,
    // so this is stable across environments.
    const t1 = tasks.find((t) => t.id === "symbol-definition")!;
    expect(t1.ultraindex.tokens).toBeLessThan(t1.baseline.tokens);
  }, 120_000);
});
