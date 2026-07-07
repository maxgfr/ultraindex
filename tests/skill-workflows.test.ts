import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";

// Acceptance tests: drive the SHIPPED bundle (scripts/ultraindex.mjs) through the
// exact command sequences the skill documents (SKILL.md + references/*.md), and
// assert the documented behaviour AND exit codes. This is the "does the skill
// actually work end-to-end" layer the unit tests don't cover — a skill-following
// agent runs `node scripts/ultraindex.mjs <cmd>`, not the TS functions. Several
// cases are regression guards for bugs found by running the docs against reality.
const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../scripts/ultraindex.mjs", import.meta.url));
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

// Spawn the bundle exactly as the skill instructs. Captures exit code + both
// streams (some commands are gates that exit non-zero, which execFileSync throws on).
function run(args: string[]): { code: number; out: string; err: string } {
  try {
    const out = execFileSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8" });
    return { code: 0, out, err: "" };
  } catch (e: unknown) {
    const x = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: typeof x.status === "number" ? x.status : 1, out: String(x.stdout ?? ""), err: String(x.stderr ?? "") };
  }
}

function index(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "ui-acc-")), ".ultraindex");
  runBuild({ repo: REPO, out: dir, mermaid: false, json: false }, FIXED_TIME);
  return dir;
}

// Replace a module's business region with a well-formed body, as an agent would.
function setBusiness(dir: string, slug: string, body: string): void {
  const entry = join(dir, "encyclopedia", `${slug}.md`);
  const text = readFileSync(entry, "utf8");
  const updated = text.replace(
    /<!-- ui:human key=business -->[\s\S]*?<!-- \/ui:human key=business -->/,
    `<!-- ui:human key=business -->\n${body}\n<!-- /ui:human key=business -->`,
  );
  if (updated === text) throw new Error(`no business region in ${slug}`);
  writeFileSync(entry, updated);
}

describe("generate workflow (shipped CLI)", () => {
  it("build --json self-diagnoses dangling with reason hints", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-acc-"));
    const r = run(["build", "--repo", REPO, "--out", join(dir, ".ui"), "--json", "--no-mermaid"]);
    expect(r.code).toBe(0);
    const rep = JSON.parse(r.out);
    expect(rep.dangling).toBeGreaterThan(0); // mini-repo has a deliberate stale doc link
    for (const reason of Object.keys(rep.danglingByReason)) {
      expect(typeof rep.reasonHints[reason]).toBe("string");
    }
  });

  it("enrich → check passes; a non-resolving citation → check FAILS naming the entry", () => {
    const dir = index();
    setBusiness(dir, "src", "Handles the client core [src/util.ts:1].");
    expect(run(["check", "--out", dir]).code).toBe(0);

    setBusiness(dir, "src", "Handles the client core [src/util.ts:999].");
    const bad = run(["check", "--out", dir]);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/encyclopedia\/src\.md/);
    expect(bad.out).toMatch(/src\/util\.ts:999/);
  });

  // REGRESSION (high-sev): the grounding gate must fail CLOSED on mangled fences.
  // Previously a closing ui:human fence appended to a prose line made parseRegions
  // fail, and check silently skipped citation validation → FRESH/exit 0, letting a
  // bad citation through. Anti-hallucination must not be bypassable by a fence slip.
  it("a same-line closing fence does NOT bypass grounding (fails closed)", () => {
    const dir = index();
    const entry = join(dir, "encyclopedia", "src.md");
    const text = readFileSync(entry, "utf8");
    const mangled = text.replace(
      /<!-- ui:human key=business -->[\s\S]*?<!-- \/ui:human key=business -->/,
      "<!-- ui:human key=business -->\nClaims a thing [src/util.ts:999].<!-- /ui:human key=business -->",
    );
    expect(mangled).not.toBe(text);
    writeFileSync(entry, mangled);
    const r = run(["check", "--out", dir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/unparseable region fences/);
  });
});

describe("navigate workflow (shipped CLI)", () => {
  it("find prints the exact files to open", () => {
    const dir = index();
    const r = run(["find", "backoff retry", "--out", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/open:/);
    expect(r.out).toMatch(/src\/util\.ts/);
  });

  it("check --answer gates Q&A: grounded passes; no citation / bad citation fail", () => {
    const dir = index();
    const ans = join(dirname(dir), "ANSWER.md");

    writeFileSync(ans, "The util module exports constants [src/util.ts:1].\n");
    expect(run(["check", "--answer", ans, "--out", dir]).code).toBe(0);

    writeFileSync(ans, "An uncited assertion about retries.\n");
    const none = run(["check", "--answer", ans, "--out", dir]);
    expect(none.code).not.toBe(0);
    expect(none.out).toMatch(/no citations/i);

    writeFileSync(ans, "A claim with a broken citation [src/util.ts:999].\n");
    expect(run(["check", "--answer", ans, "--out", dir]).code).not.toBe(0);
  });

  // REGRESSION: the docs once claimed any [text](path) form is ignored. The engine
  // intentionally counts a PATH-LIKE bracket even when a "(" follows it, and drops a
  // markdown link only when its bracket text is not a path. navigate.md now says so.
  it("a path-like bracket counts even if (…) follows; a non-path markdown link does not", () => {
    const dir = index();
    const ans = join(dirname(dir), "ANSWER.md");

    writeFileSync(ans, "Constants live in util [src/util.ts:1](anything).\n");
    expect(run(["check", "--answer", ans, "--out", dir]).code).toBe(0);

    writeFileSync(ans, "See [the guide](src/util.ts) for details.\n");
    const link = run(["check", "--answer", ans, "--out", dir]);
    expect(link.code).not.toBe(0);
    expect(link.out).toMatch(/no citations/i);
  });
});

describe("verify gate (shipped CLI) — references/verify.md", () => {
  // Build a fresh index + a two-claim answer; return the answer path.
  function setup(): { dir: string; ans: string } {
    const dir = index();
    const ans = join(dirname(dir), "ANSWER.md");
    writeFileSync(ans, "Constants are exported [src/util.ts:1].\n\nThe project has a readme [README.md:1].\n");
    return { dir, ans };
  }
  // Fill VERIFY.todo.json (written next to the answer) into a verdicts.json.
  function verdicts(ans: string, verdict: string, overrides: Record<string, string> = {}): string {
    const todo = JSON.parse(readFileSync(join(dirname(ans), "VERIFY.todo.json"), "utf8"));
    const pairs = todo.pairs.map((p: { citation: string }) => ({ ...p, verdict: overrides[p.citation] ?? verdict, note: "" }));
    const f = join(dirname(ans), "verdicts.json");
    writeFileSync(f, JSON.stringify(pairs));
    return f;
  }

  it("verify --answer writes the {answer, pairs} worklist + VERIFY.md", () => {
    const { dir, ans } = setup();
    expect(run(["verify", "--answer", ans, "--out", dir]).code).toBe(0);
    const todo = JSON.parse(readFileSync(join(dirname(ans), "VERIFY.todo.json"), "utf8"));
    expect(typeof todo.answer).toBe("string");
    expect(Array.isArray(todo.pairs)).toBe(true);
    expect(todo.pairs.length).toBe(2);
    expect(todo.pairs[0]).toMatchObject({ claimId: expect.any(String), citation: expect.any(String), verdict: null });
    expect(readFileSync(join(dirname(ans), "VERIFY.md"), "utf8")).toMatch(/Verification worklist/);
  });

  it("all-supported → apply passes and check --semantic passes", () => {
    const { dir, ans } = setup();
    run(["verify", "--answer", ans, "--out", dir]);
    expect(run(["verify", "--apply", verdicts(ans, "supported"), "--answer", ans, "--out", dir]).code).toBe(0);
    expect(run(["check", "--answer", ans, "--semantic", "--out", dir]).code).toBe(0);
  });

  it("a refuted claim → apply FAILS and check --semantic FAILS", () => {
    const { dir, ans } = setup();
    run(["verify", "--answer", ans, "--out", dir]);
    const v = verdicts(ans, "supported", { "src/util.ts:1": "refuted" });
    expect(run(["verify", "--apply", v, "--answer", ans, "--out", dir]).code).not.toBe(0);
    const sem = run(["check", "--answer", ans, "--semantic", "--out", dir]);
    expect(sem.code).not.toBe(0);
    expect(sem.out).toMatch(/refuted/);
  });

  it("--semantic with NO VERIFY.json FAILS closed (high-assurance gate)", () => {
    const { dir, ans } = setup(); // setup writes the answer but does not run verify
    const r = run(["check", "--answer", ans, "--semantic", "--out", dir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/no VERIFY\.json/);
    // Plain check --answer (no --semantic) still passes on resolution alone.
    expect(run(["check", "--answer", ans, "--out", dir]).code).toBe(0);
  });

  // REGRESSION: an EXISTING but empty/stale VERIFY.json must not read as "verified".
  it("an empty verdicts set → check --semantic FAILS (coverage guard)", () => {
    const { dir, ans } = setup();
    run(["verify", "--answer", ans, "--out", dir]);
    const empty = join(dirname(ans), "empty.json");
    writeFileSync(empty, "[]");
    run(["verify", "--apply", empty, "--answer", ans, "--out", dir]); // writes VERIFY.json with 0 pairs
    const r = run(["check", "--answer", ans, "--semantic", "--out", dir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/0 pair/);
  });

  it("--max-verify caps the worklist", () => {
    const { dir, ans } = setup();
    run(["verify", "--answer", ans, "--max-verify", "1", "--out", dir]);
    const todo = JSON.parse(readFileSync(join(dirname(ans), "VERIFY.todo.json"), "utf8"));
    expect(todo.pairs.length).toBe(1);
  });
});

describe("orchestration: enrichment fan-out (shipped CLI)", () => {
  // The skill documents enriching distinct modules in parallel, then ONE global
  // check that keys each failure to its entry so an orchestrator can route it back.
  it("distinct entries enrich independently; one global check pinpoints the bad one", () => {
    const dir = index();
    for (const slug of ["src", "gopkg", "pkg"]) setBusiness(dir, slug, `Does its job [src/util.ts:1].`);
    expect(run(["check", "--out", dir]).code).toBe(0);

    setBusiness(dir, "gopkg", "Broken claim [src/util.ts:999].");
    const r = run(["check", "--out", dir]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/encyclopedia\/gopkg\.md/);
    expect(r.out).not.toMatch(/encyclopedia\/src\.md/);
    expect(r.out).not.toMatch(/encyclopedia\/pkg\.md/);
  });
});

describe("self-index + help surface (shipped CLI)", () => {
  it("indexing this repo emits zero dangling doc-links inside skills/", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ui-self-")), ".ui");
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const r = run(["build", "--repo", repoRoot, "--out", out, "--json", "--no-mermaid"]);
    expect(r.code).toBe(0);
    const graph = JSON.parse(readFileSync(join(out, "graph.json"), "utf8"));
    const danglingInSkills = graph.fileEdges.filter(
      (e: { dangling?: boolean; from: string; to: string }) => e.dangling && (e.from.includes("skills/") || e.to.includes("skills/")),
    );
    expect(danglingInSkills).toEqual([]);
  });

  // REGRESSION: --max-verify is documented in the skill and wired in the parser; it
  // must also appear in --help (it silently drifted out before).
  it("--help documents --max-verify (usage line + options)", () => {
    const help = run(["--help"]).out;
    expect(help).toMatch(/--max-verify/);
    expect(help).toMatch(/verify .*\[--max-verify <n>\]/);
  });
});

describe("error & edge behaviour (shipped CLI)", () => {
  it("clean errors with non-zero exit, never a crash", () => {
    const empty = mkdtempSync(join(tmpdir(), "ui-empty-"));
    const dir = index();

    const noIndex = run(["find", "x", "--out", empty]);
    expect(noIndex.code).not.toBe(0);
    expect(noIndex.err + noIndex.out).toMatch(/no index/i);

    expect(run(["dossier", "no-such-slug", "--out", dir]).code).not.toBe(0);
    expect(run(["neighbors", "no-such-thing", "--out", dir]).code).not.toBe(0);
    expect(run(["map", "--module", "nope", "--out", dir]).code).not.toBe(0);
    expect(run(["verify", "--apply", "x.json"]).code).not.toBe(0); // missing --answer
    expect(run(["frobnicate"]).code).not.toBe(0); // unknown command
    expect(run(["build", "--bogus", "v"]).code).not.toBe(0); // unknown flag

    // None of the above should print a JS stack trace.
    for (const args of [["dossier", "no-such-slug", "--out", dir], ["frobnicate"]]) {
      const r = run(args);
      expect(r.err + r.out).not.toMatch(/at \w+.*\(.*:\d+:\d+\)/); // no V8 stack frame
    }
  });

  it("--version and --help exit 0", () => {
    expect(run(["--version"]).code).toBe(0);
    expect(run(["--help"]).code).toBe(0);
  });
});
