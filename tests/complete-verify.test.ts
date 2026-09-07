import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBuild } from "../src/build.js";
import { runVerify, applyVerdicts } from "../src/verify.js";
import { checkAnswer } from "../src/check.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "ui-complete-")); dirs.push(repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/many.ts"), Array.from({ length: 41 }, (_, i) => `export const v${i} = ${i};`).join("\n"));
  const out = join(repo, ".ultraindex"), answer = join(repo, "ANSWER.md");
  runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
  writeFileSync(answer, Array.from({ length: 41 }, (_, i) => `Constant number ${i} is exported [src/many.ts:${i + 1}].`).join("\n\n"));
  return { repo, out, answer };
}
function adjudicate(repo: string, pairs: unknown[]) {
  const file = join(repo, "verdicts.json");
  writeFileSync(file, JSON.stringify({ pairs: pairs.map(p => ({ ...(p as object), verdict: "supported", note: "Fixture assertion against the exact export." })) }));
  applyVerdicts(repo, file);
}
describe("complete semantic verification", () => {
  it("emits every pair plus bounded batch files and verifies all 41", () => {
    const { repo, out, answer } = fixture();
    const wl = runVerify(answer, repo, { complete: true, batchSize: 20 });
    expect(wl.pairs).toHaveLength(41);
    expect(wl.batches).toHaveLength(3);
    const batches = wl.batches!.map(file => JSON.parse(readFileSync(join(repo, file), "utf8")));
    expect(batches.map(b => b.pairs.length)).toEqual([20,20,1]);
    expect(batches.flatMap(b => b.pairs)).toHaveLength(41);
    adjudicate(repo, wl.pairs);
    const check = checkAnswer(out, answer, { semantic: true, complete: true });
    expect(check.ok).toBe(true);
    expect(check.coverage).toEqual({ mode: "complete", expected: 41, covered: 41 });
  });
  it("rejects the 40-pair sample in complete mode, retaining legacy sampled behavior", () => {
    const { repo, out, answer } = fixture();
    adjudicate(repo, runVerify(answer, repo).pairs);
    expect(checkAnswer(out, answer, { semantic: true }).ok).toBe(true);
    const result = checkAnswer(out, answer, { semantic: true, complete: true });
    expect(result.ok).toBe(false);
    expect(result.coverage).toEqual({ mode: "complete", expected: 41, covered: 40 });
  });
  it("never labels citationless substantive prose complete", () => {
    const { repo, out, answer } = fixture();
    writeFileSync(answer, readFileSync(answer, "utf8") + "\n\nThis additional assertion has no citation supporting its behavior.");
    adjudicate(repo, runVerify(answer, repo, { complete: true }).pairs);
    expect(checkAnswer(out, answer, { semantic: true, complete: true }).ok).toBe(false);
  });
  it("accepts a multi-file batch fold but rejects duplicate pair rows", () => {
    const { repo, out, answer } = fixture();
    const wl = runVerify(answer, repo, { complete: true, batchSize: 20 });
    const files = wl.batches!.map(name => {
      const file = join(repo, name), doc = JSON.parse(readFileSync(file, "utf8"));
      doc.pairs.forEach((p: Record<string, unknown>) => { p.verdict = "supported"; });
      writeFileSync(file, JSON.stringify(doc)); return file;
    });
    applyVerdicts(repo, files);
    expect(checkAnswer(out, answer, { semantic: true, complete: true }).ok).toBe(true);
    expect(() => applyVerdicts(repo, [files[0]!,files[0]!])).toThrow(/duplicate/i);
  });
  it("rejects conflicting or invalid batching bounds", () => {
    const { repo, answer } = fixture();
    expect(() => runVerify(answer, repo, { complete: true, maxVerify: 1 })).toThrow();
    expect(() => runVerify(answer, repo, { complete: true, batchSize: 0 })).toThrow();
    expect(() => runVerify(answer, repo, { batchSize: 5 })).toThrow();
  });

  it("replaces stale generated batches when the answer shrinks from 41 to 25 claims", () => {
    const { repo, answer } = fixture();
    runVerify(answer, repo, { complete: true, batchSize: 20 });
    writeFileSync(answer, readFileSync(answer, "utf8").split("\n\n").slice(0, 25).join("\n\n"));
    const current = runVerify(answer, repo, { complete: true, batchSize: 20 });
    expect(readdirSync(repo).filter(name => /^VERIFY\.batch-\d+\.todo\.json$/.test(name)).sort()).toEqual(current.batches);
    expect(current.batches!.map(name => JSON.parse(readFileSync(join(repo, name), "utf8")).pairs.length)).toEqual([20, 5]);
  });

  it.each(["sampled", "empty"])("removes obsolete batches when regenerating a %s worklist", mode => {
    const { repo, answer } = fixture();
    const previous = runVerify(answer, repo, { complete: true, batchSize: 20 });
    if (mode === "empty") writeFileSync(answer, "# No claims\n");
    runVerify(answer, repo, { complete: mode === "empty" });
    expect(previous.batches!.every(name => !existsSync(join(repo, name)))).toBe(true);
  });

  it("cleans only regular generated batches owned by this answer, preserving unrelated files and links", () => {
    const { repo, answer } = fixture();
    runVerify(answer, repo, { complete: true, batchSize: 20 });
    const unrelated = ["VERIFY.batch-notes.todo.json", "VERIFY.batch-003.todo.json.backup", "verdicts.json", "VERIFY.batch-900.todo.json", "VERIFY.batch-901.todo.json"];
    for (const name of unrelated) writeFileSync(join(repo, name), name === "VERIFY.batch-901.todo.json" ? JSON.stringify({ answer: join(repo, "OTHER.md"), coverage: { mode: "complete" }, pairs: [] }) : "keep this");
    mkdirSync(join(repo, "VERIFY.batch-902.todo.json"));
    symlinkSync(join(repo, "verdicts.json"), join(repo, "VERIFY.batch-903.todo.json"));
    runVerify(answer, repo);
    expect(existsSync(join(repo, "VERIFY.batch-003.todo.json"))).toBe(false);
    for (const name of [...unrelated, "VERIFY.batch-902.todo.json", "VERIFY.batch-903.todo.json"]) expect(existsSync(join(repo, name))).toBe(true);
    expect(readFileSync(join(repo, "verdicts.json"), "utf8")).toBe("keep this");
  });

  it("rejects a cited claim whose in-range source line is empty in complete mode only", () => {
    const { repo, out, answer } = fixture();
    const source = join(repo, "src/many.ts");
    writeFileSync(source, readFileSync(source, "utf8").replace("export const v40 = 40;", ""));
    // Legacy sampled verification can still adjudicate its 40 nonempty pairs.
    adjudicate(repo, runVerify(answer, repo).pairs);
    expect(checkAnswer(out, answer, { semantic: true }).ok).toBe(true);
    expect(checkAnswer(out, answer, { complete: true }).ok).toBe(false);
    expect(() => runVerify(answer, repo, { complete: true })).toThrow(/empty|unreadable/i);
  });

  it("requires the entire long claim in complete mode and rejects a stale suffix verdict", () => {
    const { repo, out, answer } = fixture();
    const prefix = "The constant is exported from the implementation. ".repeat(12);
    const text = prefix + "The final behavior is supported [src/many.ts:1].";
    writeFileSync(answer, text);
    const sampled = runVerify(answer, repo);
    expect(sampled.pairs[0]!.claim.length).toBe(400);
    adjudicate(repo, sampled.pairs);
    expect(checkAnswer(out, answer, { semantic: true }).ok).toBe(true);
    expect(checkAnswer(out, answer, { complete: true }).ok).toBe(false);
    const complete = runVerify(answer, repo, { complete: true });
    expect(complete.pairs[0]!.claim).toBe(text);
    adjudicate(repo, complete.pairs);
    expect(checkAnswer(out, answer, { complete: true }).ok).toBe(true);
    writeFileSync(answer, prefix + "The final behavior is fabricated [src/many.ts:1].");
    expect(checkAnswer(out, answer, { complete: true }).ok).toBe(false);
  });
});
