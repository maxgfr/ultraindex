import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { runBuild } from "../src/build.js";
import { parseArgs } from "../src/cli.js";
import { BATCH_SIZE, PHASES, SMALL_WORKLIST, listPhases, orchestrateRun, type OrchestrateContext } from "../src/orchestrate.js";
import { runStatus } from "../src/status.js";
import { runVerify } from "../src/verify.js";

const ENGINE = "/opt/skills/ultraindex/scripts/ultraindex.mjs";
const MINI = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../scripts/ultraindex.mjs", import.meta.url));
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

/** A real index built by the REAL engine over a fixture repo. */
function makeCtx(repo = MINI): OrchestrateContext {
  const out = join(mkdtempSync(join(tmpdir(), "ui-orch-")), ".ultraindex");
  runBuild({ repo, out, mermaid: false, json: false }, FIXED_TIME);
  return { out, repo, engine: ENGINE };
}

/** A synthetic repo with n independent one-file modules (built through the real engine). */
function wideRepo(n: number): string {
  const repo = mkdtempSync(join(tmpdir(), "ui-orch-wide-"));
  for (let i = 1; i <= n; i++) {
    const d = join(repo, `mod${String(i).padStart(2, "0")}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "index.ts"), `export const value${i} = ${i};\n`);
  }
  return repo;
}

/** Fill a module's business region with real prose, exactly as an enriching agent would. */
function enrichEntry(out: string, slug: string, body = "Does its job [src/util.ts:1]."): void {
  const entry = join(out, "encyclopedia", `${slug}.md`);
  const text = readFileSync(entry, "utf8");
  const updated = text.replace(
    /<!-- ui:human key=business -->[\s\S]*?<!-- \/ui:human key=business -->/,
    `<!-- ui:human key=business -->\n${body}\n<!-- /ui:human key=business -->`,
  );
  if (updated === text) throw new Error(`no business region in ${slug}`);
  writeFileSync(entry, updated);
}

/** An answer with two cited claims + the REAL engine-written VERIFY.todo.json next to it. */
function makeAnswer(repo: string): string {
  const ans = join(mkdtempSync(join(tmpdir(), "ui-orch-ans-")), "ANSWER.md");
  writeFileSync(ans, "Constants are exported [src/util.ts:1].\n\nThe project has a readme [README.md:1].\n");
  runVerify(ans, repo, {});
  return ans;
}

function queueOf(out: string): string[] {
  const st = runStatus(out);
  if (!st) throw new Error("no status");
  return st.modules.filter((m) => !m.enriched).map((m) => m.slug);
}

const wf = (out: string, phase: string) => join(out, "orchestration", `${phase}.workflow.mjs`);
const readWf = (out: string, phase: string) => readFileSync(wf(out, phase), "utf8");
const stable = (src: string, c: OrchestrateContext) =>
  src.replaceAll(c.out, "<OUT>").replaceAll(c.repo, "<REPO>").replaceAll(ENGINE, "<ENGINE>");

describe("orchestrate — listPhases", () => {
  it("reports both phases not ready on a fresh dir, naming the producing command", () => {
    const c: OrchestrateContext = { out: join(mkdtempSync(join(tmpdir(), "ui-orch-")), ".ultraindex"), repo: MINI, engine: ENGINE };
    const phases = listPhases(c);
    expect(phases.map((p) => p.name)).toEqual(["enrich", "verify-answer"]);
    for (const p of phases) {
      expect(p.ready).toBe(false);
      expect(p.items).toBe(0);
    }
    expect(phases[0]!.prerequisite).toContain("build --repo");
    expect(phases[1]!.prerequisite).toContain("verify --answer");
  });

  it("derives the enrich queue EXACTLY the way `status` does (same ids, same order)", () => {
    const c = makeCtx();
    const phases = listPhases(c);
    const queue = queueOf(c.out);
    expect(queue.length).toBeGreaterThan(0);
    expect(phases[0]).toMatchObject({ name: "enrich", ready: true, items: queue.length });
    expect(phases[0]!.ids).toEqual(queue);
    for (const p of phases) expect(isAbsolute(p.worklist)).toBe(true);
    // Enriching a module removes it from the queue on the next listing — current state, not a snapshot.
    enrichEntry(c.out, queue[0]!);
    expect(listPhases(c)[0]!.ids).toEqual(queue.slice(1));
  });

  it("verify-answer keys off the worklist `verify` wrote next to --answer", () => {
    const c = makeCtx();
    const ans = makeAnswer(c.repo);
    const phases = listPhases({ ...c, answer: ans });
    expect(phases[1]).toMatchObject({ name: "verify-answer", ready: true, items: 2 });
    expect(phases[1]!.worklist).toBe(join(dirname(ans), "VERIFY.todo.json"));
    expect(phases[1]!.ids).toEqual(["1", "2"]);
  });
});

describe("orchestrate — emitted workflow", () => {
  it("emits one workflow per ready phase, plus contracts, runbook and the reserved out/ dir", () => {
    const c = makeCtx();
    const res = orchestrateRun({ ...c, answer: makeAnswer(c.repo) });
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(c.out, "enrich"))).toBe(true);
    expect(existsSync(wf(c.out, "verify-answer"))).toBe(true);
    expect(existsSync(join(c.out, "orchestration", "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(c.out, "orchestration", "agents", "enricher.md"))).toBe(true);
    expect(existsSync(join(c.out, "orchestration", "agents", "refuter.md"))).toBe(true);
    expect(existsSync(join(c.out, "orchestration", "out"))).toBe(true);
  });

  it("parses as JavaScript the way the Workflow harness evaluates it (meta export + async body)", () => {
    const c = makeCtx();
    orchestrateRun({ ...c, answer: makeAnswer(c.repo) });
    for (const phase of ["enrich", "verify-answer"]) {
      const [metaLine, ...body] = readWf(c.out, phase).split("\n");
      expect(() => new Script(metaLine!.replace("export const meta =", "const meta ="))).not.toThrow();
      expect(() => new Script(`(async () => {\n${body.join("\n")}\n})`)).not.toThrow();
    }
  });

  it("meta is a pure JSON literal on line 1 (name, description, phases)", () => {
    const c = makeCtx();
    orchestrateRun(c);
    const first = readWf(c.out, "enrich").split("\n")[0]!;
    expect(first.startsWith("export const meta = ")).toBe(true);
    const meta = JSON.parse(first.replace("export const meta = ", "")) as { name: string; description: string; phases: unknown[] };
    expect(meta.name).toBe("ultraindex-enrich");
    expect(meta.description.length).toBeGreaterThan(0);
    expect(Array.isArray(meta.phases)).toBe(true);
  });

  it("never contains Date.now / Math.random / new Date (forbidden under the Workflow tool)", () => {
    const c = makeCtx();
    orchestrateRun({ ...c, answer: makeAnswer(c.repo) });
    for (const phase of ["enrich", "verify-answer"]) {
      const src = readWf(c.out, phase);
      expect(src).not.toContain("Date.now(");
      expect(src).not.toContain("Math.random(");
      expect(src).not.toContain("new Date(");
    }
  });

  it("injects absolute OUT/REPO/ENGINE/WORKLIST constants matching the index", () => {
    const c = makeCtx();
    orchestrateRun(c);
    const src = readWf(c.out, "enrich");
    for (const name of ["OUT", "REPO", "ENGINE", "WORKLIST"]) {
      const m = src.match(new RegExp(`const ${name} = "([^"]+)"`));
      expect(m, `const ${name} missing`).not.toBeNull();
      expect(isAbsolute(m![1]!)).toBe(true);
    }
    expect(src).toContain(JSON.stringify(join(c.out, "graph.json")));
    expect(src).toContain(JSON.stringify(ENGINE));
  });

  it("injects the REAL current queue — enriching a module drops its slug on re-emit", () => {
    const c = makeCtx();
    const first = queueOf(c.out)[0]!;
    orchestrateRun(c);
    expect(readWf(c.out, "enrich")).toContain(JSON.stringify(first).slice(1, -1));
    enrichEntry(c.out, first);
    orchestrateRun(c);
    const m = readWf(c.out, "enrich").match(/const BATCHES = (\[.*?\])\n/s);
    expect((JSON.parse(m![1]!) as string[][]).flat()).not.toContain(first);
  });

  it("is deterministic — two runs over the same state emit byte-identical artifacts", () => {
    const c = makeCtx();
    const ans = makeAnswer(c.repo);
    const snap = () =>
      ["enrich", "verify-answer"].map((p) => readWf(c.out, p)).join("\0") +
      readFileSync(join(c.out, "orchestration", "RUNBOOK.md"), "utf8") +
      readFileSync(join(c.out, "orchestration", "agents", "enricher.md"), "utf8") +
      readFileSync(join(c.out, "orchestration", "agents", "refuter.md"), "utf8");
    orchestrateRun({ ...c, answer: ans });
    const one = snap();
    orchestrateRun({ ...c, answer: ans });
    expect(snap()).toBe(one);
  });

  it("batches large queues (~8 per agent) and dispatches one agent per batch", () => {
    const c = makeCtx(wideRepo(20));
    expect(queueOf(c.out).length).toBe(20);
    orchestrateRun(c);
    const src = readWf(c.out, "enrich");
    const m = src.match(/const BATCHES = (\[.*?\])\n/s);
    expect(m).not.toBeNull();
    const batches = JSON.parse(m![1]!) as string[][];
    expect(batches.length).toBe(Math.ceil(20 / BATCH_SIZE));
    expect(batches.flat().length).toBe(20);
    expect(src).toContain("pipeline(BATCHES");
    expect(src).toContain("agentType: 'general-purpose'");
    expect(src).toContain("schema: SCHEMA");
  });

  it("small queue (≤ SMALL_WORKLIST) → single agent + an eco notice", () => {
    const c = makeCtx();
    const queue = queueOf(c.out);
    for (const slug of queue.slice(0, queue.length - 2)) enrichEntry(c.out, slug);
    const res = orchestrateRun(c);
    const m = readWf(c.out, "enrich").match(/const BATCHES = (\[.*?\])\n/s);
    expect((JSON.parse(m![1]!) as string[][]).length).toBe(1);
    expect(res.notices.some((n) => n.includes("--eco"))).toBe(true);
    expect(SMALL_WORKLIST).toBeLessThan(BATCH_SIZE);
  });

  it("an empty queue is skipped with a notice, not emitted", () => {
    const c = makeCtx();
    for (const slug of queueOf(c.out)) enrichEntry(c.out, slug);
    const res = orchestrateRun({ ...c, answer: makeAnswer(c.repo) });
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(c.out, "enrich"))).toBe(false);
    expect(existsSync(wf(c.out, "verify-answer"))).toBe(true);
    expect(res.notices.some((n) => n.includes("enrich") && n.includes("empty"))).toBe(true);
  });

  it("every contract('<role>') referenced by a workflow has its agents/<role>.md", () => {
    const c = makeCtx();
    orchestrateRun({ ...c, answer: makeAnswer(c.repo) });
    const agents = readdirSync(join(c.out, "orchestration", "agents")).map((f) => f.replace(/\.md$/, ""));
    for (const phase of ["enrich", "verify-answer"]) {
      const refs = [...readWf(c.out, phase).matchAll(/contract\('([a-z-]+)'/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(agents).toContain(r);
    }
  });

  it("workflows collect fragments and never execute a write step; the no-build hard rule is stated", () => {
    const c = makeCtx();
    orchestrateRun({ ...c, answer: makeAnswer(c.repo) });
    for (const phase of ["enrich", "verify-answer"]) {
      const src = readWf(c.out, phase);
      expect(src).toMatch(/^return \{/m);
      // The mid-fan-out rebuild race is called out where the orchestrator will read it.
      expect(src).toMatch(/no `build` or `map`/);
      // build / --apply may appear only in comments (the orchestrator's own next step),
      // never as executed code.
      const code = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toContain("--apply");
      expect(code).not.toMatch(/\bbuild\b/);
      expect(code).not.toMatch(/\bmap\b/);
    }
  });
});

describe("orchestrate — contracts & runbook", () => {
  it("enricher carries the sanctioned disjoint-write exception (only-your-entry isolation)", () => {
    const c = makeCtx();
    orchestrateRun(c);
    const md = readFileSync(join(c.out, "orchestration", "agents", "enricher.md"), "utf8");
    expect(md).toContain("dossier");
    expect(md).toMatch(/2–5 sentences/);
    expect(md).toContain("ui:human");
    for (const untouchable of ["graph.json", "manifest.json", "INDEX.md", "vectors.json"]) expect(md).toContain(untouchable);
    expect(md).toMatch(/no `build` or `map`/);
    expect(md).toMatch(/own\b.*entr/i);
    expect(md).toContain('"entries"');
  });

  it("refuter is return-only (one-writer footer) and encodes the harsher-verdict rule", () => {
    const c = makeCtx();
    orchestrateRun(c);
    const md = readFileSync(join(c.out, "orchestration", "agents", "refuter.md"), "utf8");
    expect(md).toContain("Return, don't write");
    expect(md).toContain("sole writer");
    expect(md).toContain("orchestration/out/");
    for (const v of ["supported", "partial", "refuted", "unsupported"]) expect(md).toContain(v);
    expect(md).toMatch(/HARSHER/i);
    expect(md).toMatch(/note.*REQUIRED/i);
  });

  it("the runbook covers every phase with concrete paths and the phase status", () => {
    const c = makeCtx();
    orchestrateRun(c);
    const rb = readFileSync(join(c.out, "orchestration", "RUNBOOK.md"), "utf8");
    expect(rb).toContain("| enrich |");
    expect(rb).toContain("| verify-answer |");
    expect(rb).toContain("status");
    expect(rb).toContain("check --out");
    expect(rb).toContain(ENGINE);
    expect(rb).toContain("enricher.md");
    expect(rb).toContain("refuter.md");
    expect(rb).toContain(join(c.out, "graph.json"));
  });

  it("golden shape (paths normalized)", () => {
    const c = makeCtx();
    orchestrateRun(c);
    expect(stable(readWf(c.out, "enrich"), c)).toMatchSnapshot("enrich.workflow.mjs");
    expect(stable(readFileSync(join(c.out, "orchestration", "agents", "enricher.md"), "utf8"), c)).toMatchSnapshot("enricher.md");
    expect(stable(readFileSync(join(c.out, "orchestration", "RUNBOOK.md"), "utf8"), c)).toMatchSnapshot("RUNBOOK.md");
  });
});

describe("orchestrate — eco mode & phase gating", () => {
  it("--eco emits RUNBOOK + contracts only, no workflow scripts", () => {
    const c = makeCtx();
    const res = orchestrateRun(c, { eco: true });
    expect(res.exitCode).toBe(0);
    expect(existsSync(join(c.out, "orchestration", "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(c.out, "orchestration", "agents", "enricher.md"))).toBe(true);
    expect(existsSync(join(c.out, "orchestration", "agents", "refuter.md"))).toBe(true);
    expect(existsSync(wf(c.out, "enrich"))).toBe(false);
  });

  it("--phase on a not-ready phase exits 2 and names the producing command", () => {
    const c = makeCtx();
    const res = orchestrateRun(c, { phase: "verify-answer" });
    expect(res.exitCode).toBe(2);
    expect(res.errors.some((e) => e.includes("verify --answer"))).toBe(true);
    expect(existsSync(wf(c.out, "verify-answer"))).toBe(false);
  });

  it("--phase restricts emission to that phase", () => {
    const c = makeCtx();
    const res = orchestrateRun({ ...c, answer: makeAnswer(c.repo) }, { phase: "enrich" });
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(c.out, "enrich"))).toBe(true);
    expect(existsSync(wf(c.out, "verify-answer"))).toBe(false);
  });

  it("an unknown phase exits 2 naming the valid ones", () => {
    const c = makeCtx();
    const res = orchestrateRun(c, { phase: "nope" });
    expect(res.exitCode).toBe(2);
    expect(res.errors.some((e) => e.includes("enrich") && e.includes("verify-answer"))).toBe(true);
    expect(PHASES).toEqual(["enrich", "verify-answer"]);
  });

  it("no index → exit 2 naming the build command, and nothing is written", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ui-orch-")), ".ultraindex");
    const res = orchestrateRun({ out, repo: MINI, engine: ENGINE });
    expect(res.exitCode).toBe(2);
    expect(res.errors.some((e) => e.includes("build --repo"))).toBe(true);
    expect(existsSync(join(out, "orchestration"))).toBe(false);
  });
});

describe("orchestrate — CLI wiring (parser + shipped bundle)", () => {
  function run(args: string[]): { code: number; out: string; err: string } {
    try {
      const out = execFileSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8" });
      return { code: 0, out, err: "" };
    } catch (e: unknown) {
      const x = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      return { code: typeof x.status === "number" ? x.status : 1, out: String(x.stdout ?? ""), err: String(x.stderr ?? "") };
    }
  }

  it("parseArgs accepts orchestrate with --phase/--eco/--list/--answer", () => {
    const p = parseArgs(["orchestrate", "--out", "x", "--phase", "enrich", "--answer", "a.md", "--eco", "--list"]);
    expect(p.command).toBe("orchestrate");
    expect(p.values.phase).toBe("enrich");
    expect(p.values.answer).toBe("a.md");
    expect(p.bools.has("eco")).toBe(true);
    expect(p.bools.has("list")).toBe(true);
  });

  it("orchestrate on a dir with no index exits 2 naming build", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ui-orch-cli-")), ".ultraindex");
    const r = run(["orchestrate", "--out", out, "--repo", MINI]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/build --repo/);
  });

  it("orchestrate --list prints {phases:[...]} JSON; a full run emits and exits 0", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ui-orch-cli-")), ".ultraindex");
    expect(run(["build", "--repo", MINI, "--out", out, "--no-mermaid"]).code).toBe(0);
    const list = run(["orchestrate", "--out", out, "--list"]);
    expect(list.code).toBe(0);
    const parsed = JSON.parse(list.out) as { phases: { name: string; ready: boolean }[] };
    expect(parsed.phases.map((p) => p.name)).toEqual(["enrich", "verify-answer"]);
    const full = run(["orchestrate", "--out", out]);
    expect(full.code).toBe(0);
    expect(existsSync(wf(out, "enrich"))).toBe(true);
    expect(run(["--help"]).out).toMatch(/orchestrate/);
  });
});
