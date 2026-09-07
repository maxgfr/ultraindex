import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerify, applyVerdicts } from "../src/verify.js";
import { checkAnswer } from "../src/check.js";
import { runBuild } from "../src/build.js";

// A persisted VERIFY.json row is the ONLY evidence `check --semantic` has that a
// claim was adjudicated. A row whose `verdict` is null/misspelled/unreadable
// attests nothing, so it must neither count as coverage nor be reduced into a
// green summary — the high-assurance gate has to fail CLOSED, with a message a
// reader can act on, and never a stack trace on a malformed row.

function miniRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ui-ledger-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/util.ts"), "export const x = 1;\nexport function backoff() {\n  return 2;\n}\n");
  writeFileSync(
    join(repo, "src/retry.ts"),
    "export function retry() {\n  // exponential backoff doubles the delay each attempt\n  return backoff();\n}\n",
  );
  return repo;
}

const ONE_CLAIM = `# Answer
The backoff function is exported [src/util.ts:2].`;

const TWO_CLAIMS = `${ONE_CLAIM}

The retry helper uses exponential backoff [src/retry.ts:2].`;

function writeVerdicts(dir: string): string {
  const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8"));
  const pairs = todo.pairs.map((p: any) => ({ ...p, verdict: "supported", note: "" }));
  const f = join(dir, "verdicts.json");
  writeFileSync(f, JSON.stringify({ pairs }));
  return f;
}

// verify → adjudicate → apply → check, asserted GREEN. Every test below mutates
// the persisted ledger from this known-good baseline.
function greenChain(answer: string): { repo: string; out: string; ans: string } {
  const repo = miniRepo();
  const out = join(repo, ".ultraindex");
  runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
  const ans = join(repo, "ANSWER.md");
  writeFileSync(ans, answer);
  runVerify(ans, repo);
  applyVerdicts(repo, writeVerdicts(repo));
  expect(checkAnswer(out, ans, { semantic: true }).ok).toBe(true);
  return { repo, out, ans };
}

// Hand-edit VERIFY.json the way a doctored/half-filled ledger would look.
function patchVerdicts(repo: string, patch: (verdicts: any[]) => any[]): void {
  const p = join(repo, "VERIFY.json");
  const v = JSON.parse(readFileSync(p, "utf8"));
  v.verdicts = patch(v.verdicts);
  writeFileSync(p, JSON.stringify(v, null, 2));
}

describe("check --semantic: an incomplete persisted verdict fails closed", () => {
  it("fails when the only claim's persisted verdict is null", () => {
    const { repo, out, ans } = greenChain(ONE_CLAIM);
    patchVerdicts(repo, (rows) => rows.map((r, i) => (i === 0 ? { ...r, verdict: null } : r)));
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /verdict/i.test(e))).toBe(true);
    // A row with no verdict is not coverage: it must not be reduced in as adjudicated.
    expect(r.semantic?.adjudicated ?? 0).toBe(0);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails when one claim of several carries a null verdict", () => {
    const { repo, out, ans } = greenChain(TWO_CLAIMS);
    patchVerdicts(repo, (rows) => rows.map((r) => (r.citation === "src/retry.ts:2" ? { ...r, verdict: null } : r)));
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /verdict/i.test(e))).toBe(true);
    // The sibling claim's honest verdict still stands — only the null row is dropped.
    expect(r.semantic?.adjudicated ?? 0).toBe(1);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails on an unknown verdict token instead of ignoring it", () => {
    const { repo, out, ans } = greenChain(ONE_CLAIM);
    patchVerdicts(repo, (rows) => rows.map((r) => ({ ...r, verdict: "SUPPORTED-ish" })));
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /supported/.test(e))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails without a stack trace on malformed rows (primitive, null, missing fields)", () => {
    const { repo, out, ans } = greenChain(ONE_CLAIM);
    patchVerdicts(repo, (rows) => [...rows.map(() => "supported"), null, 42, { claimId: "C1" }]);
    let r!: ReturnType<typeof checkAnswer>;
    expect(() => {
      r = checkAnswer(out, ans, { semantic: true });
    }).not.toThrow();
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /re-run|verdict/i.test(e))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails when a row keeps its verdict but loses the digest it attests", () => {
    const { repo, out, ans } = greenChain(ONE_CLAIM);
    patchVerdicts(repo, (rows) =>
      rows.map((r) => {
        const { digest, ...rest } = r;
        return rest;
      }),
    );
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });

  it("control: an untouched, fully adjudicated ledger still passes green", () => {
    const { repo, out, ans } = greenChain(TWO_CLAIMS);
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings ?? []).toEqual([]);
    expect(r.semantic?.pairs).toBe(2);
    expect(r.semantic?.adjudicated).toBe(2);
    rmSync(repo, { recursive: true, force: true });
  });
});
