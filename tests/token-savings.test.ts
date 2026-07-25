import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Smoke test for the eval (evals/token-savings/run.mjs): runs it end-to-end on
// the smallest committed fixture (its default target, tests/fixtures/mini-repo)
// through the SHIPPED bundle, and asserts it exits 0 and emits the documented
// shape. Absolute token counts and timings are environment-dependent
// measurements, so only the shape and the one CAPABILITY claim are asserted.
//
// Deliberately NOT asserted: that ultraindex reads fewer tokens than the
// baseline. On this fixture it does not, and it should not be made to — 14 tiny
// files are cheaper to read whole than to index. The eval prints that verdict
// itself; a test demanding a win here would only pressure the eval into picking
// a flattering target.
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

    // One-off costs are reported separately, never hidden inside a task.
    expect(report.indexBuild.ms).toBeGreaterThan(0);
    expect(report.indexBuild.tokens).toBeGreaterThan(0);
    expect(report.enrichCost.tokens).toBeGreaterThan(0);

    const tasks: Task[] = report.tasks;
    expect(tasks.map((t) => t.id)).toEqual(["module-purpose", "grounded-evidence"]);
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

    // THE claim worth pinning: the gate actually rejects an unfounded citation.
    // A resolvable citation passes, an unresolvable one fails, and the baseline
    // is reported as having no equivalent rather than a fabricated ratio.
    expect(report.grounding.ultraindex.resolvableCitationExit).toBe(0);
    expect(report.grounding.ultraindex.unresolvableCitationExit).not.toBe(0);
    expect(report.grounding.ultraindex.catchesUnfoundedCitation).toBe(true);
    expect(report.grounding.baseline.commands).toEqual([]);

    // When the target is too small to be worth indexing, the eval must SAY so
    // rather than quietly reporting a sub-1 ratio.
    if (report.totals.ratio < 1) expect(r.stdout).toContain("HONEST FLOOR");
  }, 120_000);
});
