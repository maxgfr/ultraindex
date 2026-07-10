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

  it("FAILS closed when --semantic is set but no VERIFY.json exists", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    // --semantic is an explicit high-assurance request: a missing VERIFY.json is
    // a failure, not a silent skip (plain check --answer is the resolution gate).
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /no VERIFY\.json/.test(e))).toBe(true);
    // Plain check --answer (no --semantic) still passes on resolution alone.
    expect(checkAnswer(out, ans).ok).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails when VERIFY.json adjudicates zero pairs (empty/stale coverage)", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER); // two resolvable citations
    runVerify(ans, repo);
    const empty = join(repo, "empty.json");
    writeFileSync(empty, "[]");
    applyVerdicts(repo, empty); // VERIFY.json with 0 pairs — must NOT read as "verified"
    expect(checkAnswer(out, ans, { semantic: true }).ok).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });

  it("does NOT hard-fail --semantic when citations are structurally unverifiable", () => {
    // A citation living only in a heading is dropped as a claim unit, so verify
    // yields 0 pairs forever. The coverage guard must size against the verifiable
    // pair set (also 0 here), not the raw mechanical citation count — otherwise it
    // would fail with an impossible "re-run verify" remedy.
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, "# The retry helper at [src/retry.ts:2]\n");
    expect(checkAnswer(out, ans).ok).toBe(true); // mechanically grounded
    runVerify(ans, repo); // 0 pairs (heading dropped)
    const v = join(repo, "v.json");
    writeFileSync(v, "[]");
    applyVerdicts(repo, v);
    expect(checkAnswer(out, ans, { semantic: true }).ok).toBe(true); // no false fail
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails when a doctored VERIFY.json summary says ok but verdicts[] holds a refuted row", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    runVerify(ans, repo);
    applyVerdicts(repo, writeVerdicts(repo, { "src/retry.ts:2": "refuted" }));
    // Doctor the persisted summary: ok:true / failures:[] while the raw verdicts
    // still hold the refuted row. The gate must re-reduce from verdicts[] and fail.
    const vPath = join(repo, "VERIFY.json");
    const v = JSON.parse(readFileSync(vPath, "utf8"));
    v.ok = true;
    v.failures = [];
    v.refuted = 0;
    v.supported = v.verdicts.length;
    writeFileSync(vPath, JSON.stringify(v, null, 2));
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.semantic?.ok).toBe(false);
    expect(r.warnings?.some((w) => /recomputed/.test(w))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails closed when VERIFY.json carries no verdicts[] to re-reduce from", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    runVerify(ans, repo);
    applyVerdicts(repo, writeVerdicts(repo, {}));
    // Strip the raw rows: a summary alone (however green) is not attestable.
    const vPath = join(repo, "VERIFY.json");
    const v = JSON.parse(readFileSync(vPath, "utf8"));
    delete v.verdicts;
    writeFileSync(vPath, JSON.stringify(v, null, 2));
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /verdicts\[\]/.test(e))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("sizes --semantic coverage against the explicit repo, not just the manifest", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER); // 2 prose citations, resolvable in `repo`
    runVerify(ans, repo);
    const empty = join(repo, "v.json");
    writeFileSync(empty, "[]");
    applyVerdicts(repo, empty); // VERIFY.json with 0 pairs

    // Default (manifest repo): the citations resolve to real excerpts → genuine
    // empty coverage → FAIL.
    expect(checkAnswer(out, ans, { semantic: true }).ok).toBe(false);

    // With an explicit repo that has no source: buildClaimPairs reads no excerpts
    // → expected 0 → guard must not fire. Proves opts.repo is honoured (was pinned
    // to the manifest before, ignoring --repo and risking a spurious verdict).
    const altRepo = mkdtempSync(join(tmpdir(), "ui-altrepo-"));
    expect(checkAnswer(out, ans, { semantic: true, repo: altRepo }).ok).toBe(true);
    rmSync(repo, { recursive: true, force: true });
    rmSync(altRepo, { recursive: true, force: true });
  });
});

describe("checkAnswer content-level grounding (digest re-validation)", () => {
  function greenSetup(): { repo: string; out: string; ans: string } {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    runVerify(ans, repo);
    applyVerdicts(repo, writeVerdicts(repo, {}));
    return { repo, out, ans };
  }

  it("passes a fresh honest verify→apply→check chain with no warnings", () => {
    const { repo, out, ans } = greenSetup();
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings ?? []).toEqual([]);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails --semantic when the cited source changed after the verdicts were adjudicated", () => {
    const { repo, out, ans } = greenSetup();
    // The adjudicated excerpt said "exponential backoff"; the repo now says otherwise.
    writeFileSync(
      join(repo, "src/retry.ts"),
      "export function retry() {\n  // linear backoff waits a fixed delay\n  return backoff();\n}\n",
    );
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /no longer matches/.test(e))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails --semantic when the verdicts adjudicate a different answer (identity, not count)", () => {
    const { repo, out, ans } = greenSetup();
    // Same NUMBER of verifiable pairs, entirely different claims/citations: the
    // count-based coverage guard would coincidentally pass; identity must not.
    writeFileSync(ans, "# Answer\nThe util exports a constant x [src/util.ts:1].\n\nAnd a second constant y [src/util.ts:2].");
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });

  it("warns (non-failing) on plain check --answer when a cited file changed since the build", () => {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER);
    writeFileSync(
      join(repo, "src/retry.ts"),
      "export function retry() {\n  // linear backoff waits a fixed delay\n  return backoff();\n}\n",
    );
    const r = checkAnswer(out, ans);
    expect(r.ok).toBe(true); // plain check stays the resolution-only gate
    expect(r.warnings?.some((w) => /changed since the index was built/.test(w))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });
});

// A partially-covered ledger must FAIL closed unless the shortfall is explained
// by the worklist cap. Two real fail-opens (wave-1 class watch on sibling
// skills): a verdict deleted for one cited claim, and a claim added/edited AFTER
// `verify --apply` (a stale ledger). Both leave a claim genuinely unadjudicated
// while the reducer stays green — an unadjudicated claim is NOT verified.
describe("checkAnswer --semantic coverage: unadjudicated claims fail closed", () => {
  function greenChain(): { repo: string; out: string; ans: string } {
    const repo = miniRepo();
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, ANSWER); // two claims, each one citation
    runVerify(ans, repo);
    applyVerdicts(repo, writeVerdicts(repo, {})); // all supported
    expect(checkAnswer(out, ans, { semantic: true }).ok).toBe(true); // baseline green
    return { repo, out, ans };
  }

  it("fails closed when ALL verdict rows for one cited claim are deleted (uncapped)", () => {
    const { repo, out, ans } = greenChain();
    // Delete every verdict row for claim C1 (cites src/retry.ts:2). The reducer
    // is now blind to C1, but C1 is still an unadjudicated claim in the answer.
    const vPath = join(repo, "VERIFY.json");
    const v = JSON.parse(readFileSync(vPath, "utf8"));
    v.verdicts = v.verdicts.filter((r: any) => r.citation !== "src/retry.ts:2");
    writeFileSync(vPath, JSON.stringify(v, null, 2));
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /adjudicated|no verdict|not.*verified/i.test(e))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails closed when a new cited claim is appended AFTER verify --apply (stale ledger)", () => {
    const { repo, out, ans } = greenChain();
    // Append a never-verified cited claim. Its pair is uncovered; the ledger is
    // stale, so the high-assurance gate must not pass on the old coverage.
    writeFileSync(ans, ANSWER + "\n\nThe retry entry point is a function [src/retry.ts:1].\n");
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });

  it("keeps partial coverage a WARNING (not a failure) only when the worklist cap truncated a large answer", () => {
    const repo = mkdtempSync(join(tmpdir(), "ui-cap-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    // 45 distinct exports → 45 verifiable claim↔citation pairs, above VERIFY_MAX=40.
    const src = Array.from({ length: 45 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
    writeFileSync(join(repo, "src/many.ts"), src);
    const out = join(repo, ".ultraindex");
    runBuild({ repo, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
    const body = Array.from({ length: 45 }, (_, i) => `Constant number ${i} is exported [src/many.ts:${i + 1}].`).join("\n\n");
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, "# Answer\n\n" + body + "\n");
    runVerify(ans, repo); // caps the worklist at 40
    applyVerdicts(repo, writeVerdicts(repo, {})); // 40 supported
    const r = checkAnswer(out, ans, { semantic: true });
    expect(r.ok).toBe(true); // capping is a legitimate, documented truncation
    expect(r.warnings?.some((w) => /cap|capped|truncat/i.test(w))).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("runVerify claim digest (display vs parse decoupling)", () => {
  function repoWith(answer: string): { repo: string; ans: string } {
    const repo = miniRepo();
    const ans = join(repo, "ANSWER.md");
    writeFileSync(ans, answer);
    return { repo, ans };
  }

  it("keeps backtick-wrapped identifiers in the claim (no blanked spans)", () => {
    const { repo, ans } = repoWith("The `retry` function uses `backoff` here [src/retry.ts:2].");
    const r = runVerify(ans, repo);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.claim).toContain("retry");
    expect(r.pairs[0]!.claim).toContain("backoff");
    expect(r.pairs[0]!.claim).not.toMatch(/\s{2,}/);
    expect(r.pairs[0]!.citation).toBe("src/retry.ts:2");
    rmSync(repo, { recursive: true, force: true });
  });

  it("still does NOT promote a backticked path inside brackets to a citation", () => {
    const { repo, ans } = repoWith("See [`src/util.ts`] then the real one [src/retry.ts:2].");
    const r = runVerify(ans, repo);
    expect(r.pairs.map((p) => p.citation)).toEqual(["src/retry.ts:2"]);
    rmSync(repo, { recursive: true, force: true });
  });
});
