#!/usr/bin/env node
// Token/time-savings eval: ultraindex (shipped bundle) vs a naive read-the-
// source baseline, on a deterministic pinned target (default:
// tests/fixtures/mini-repo).
//
// WHAT THIS DOES *NOT* MEASURE ANY MORE. Until v5.8.0 this eval compared
// `symbols` / `impact` / `map --module` against ripgrep. Those are retrieval,
// and retrieval is the vendored codeindex engine's job — the eval was proving
// the ENGINE's worth under ultraindex's name. codeindex benchmarks that itself.
//
// What is measured here is what ultraindex alone provides: the cost of reaching
// an EXPLAINED, GROUNDED answer.
//
//   1. "what does module Y do, and why" — one enriched encyclopedia entry vs
//      reading every file in the module. The source states what the code does;
//      only the entry states why it exists, so the baseline is doing strictly
//      less work for strictly more tokens. Enrichment is a one-off, reported
//      separately and never hidden inside a task — exactly like the build.
//   2. "answer a question from real source" — `ask` assembles a budget-capped
//      evidence packet vs searching and reading every matched file in full.
//   3. "is that answer actually founded?" — reported as a CAPABILITY, not a
//      ratio. `check --answer` exits non-zero on a citation that does not
//      resolve; the baseline has no equivalent, so the honest cell is n/a
//      rather than a fabricated speedup.
//
// Both strategies are metered by the tokens of EVERY byte the agent would read
// (all command stdout+stderr, plus full file contents for the baseline), with
// tokens = ceil(chars / 4). Wall-clock ms is recorded per strategy.
//
// Plain Node, zero dependencies. Whatever the ratios come out to be, they are
// printed as measured — no fabrication.
//
// Usage:
//   node evals/token-savings/run.mjs [--repo <dir>] [--module <slug>]
//                                    [--module-path <dir>] [--question "<q>"]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const BUNDLE = join(REPO_ROOT, "skills", "ultraindex", "scripts", "ultraindex.mjs");

// ---------------------------------------------------------------------------
// Arguments (defaults pin the smallest committed fixture, deterministic at any
// given commit of this repo).
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const target = resolve(REPO_ROOT, flag("--repo", "tests/fixtures/mini-repo"));
const moduleSlug = flag("--module", "src");
const modulePath = flag("--module-path", "src");
const question = flag("--question", "how does retry backoff work");

statSync(target); // fail fast on a bad --repo

// ---------------------------------------------------------------------------
// Metering primitives
// ---------------------------------------------------------------------------
const tokens = (text) => Math.ceil(text.length / 4);
const round1 = (n) => Math.round(n * 10) / 10;

/** Run a command, capture BOTH streams (agents read both), time it. */
function run(cmd, argv, opts = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, argv, { encoding: "utf8", ...opts });
  const ms = round1(performance.now() - t0);
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  return { status: r.status ?? 1, out, ms };
}

function must(res, what) {
  if (res.status !== 0) {
    process.stderr.write(`eval: ${what} exited ${res.status}\n${res.out}\n`);
    process.exit(1);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Search tool for the baseline: ripgrep, with a grep/find fallback so the eval
// still runs where rg is not installed (recorded in the JSON either way).
// ---------------------------------------------------------------------------
const hasRg = spawnSync("rg", ["--version"], { encoding: "utf8" }).status === 0;
const searchTool = hasRg ? "rg" : "grep";

/** Search the query terms across the target repo; returns output + matched files. */
function baselineSearch(query) {
  const pattern = query.split(/\s+/).filter(Boolean).join("|");
  const res = hasRg
    ? run("rg", ["-n", "--no-heading", "-i", pattern, "."], { cwd: target })
    : run("grep", ["-rnIE", "-i", "--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude-dir=.ultraindex", pattern, "."], { cwd: target });
  if (res.status > 1) must(res, `${searchTool} ${pattern}`); // 1 = no matches, valid
  const files = [...new Set(
    res.out.split("\n")
      .map((l) => /^(.+?):\d+:/.exec(l)?.[1])
      .filter(Boolean)
      .map((f) => f.replace(/^\.\//, "")),
  )];
  return { res, files };
}

/** List the files of a module directory the way an index-less agent would. */
function baselineList(dir) {
  const res = hasRg
    ? run("rg", ["--files", dir], { cwd: target })
    : run("find", [dir, "-type", "f"], { cwd: target });
  if (res.status > 1) must(res, `list ${dir}`);
  const files = res.out.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
  return { res, files };
}

/** Read files in full (what the agent's Read tool returns), metered. */
function readAll(files) {
  const t0 = performance.now();
  let chars = 0;
  for (const f of files) chars += readFileSync(join(target, f), "utf8").length;
  return { tokens: Math.ceil(chars / 4), ms: round1(performance.now() - t0) };
}

// ---------------------------------------------------------------------------
// One-off setup: build, then enrich ONE entry. Both are amortized across every
// later question, so both are reported separately and never inside a task.
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), "ui-eval-"));
const idx = join(outDir, ".ultraindex");
const ui = (argv) => run(process.execPath, [BUNDLE, ...argv, "--out", idx]);
const build = must(
  run(process.execPath, [BUNDLE, "build", "--repo", target, "--out", idx, "--no-mermaid"]),
  "ultraindex build",
);
const indexBuild = { ms: build.ms, tokens: tokens(build.out) };

// The enrichment an agent would write, standing in for a real dossier→prose
// pass so the eval stays hermetic and deterministic. It cites a real line, so
// `check` genuinely validates it rather than waving it through.
const entryPath = join(idx, "encyclopedia", `${moduleSlug}.md`);
const firstMember = baselineList(modulePath).files[0];
if (!firstMember) {
  process.stderr.write(`eval: module path "${modulePath}" has no files\n`);
  process.exit(1);
}
const PROSE = `Owns the ${moduleSlug} behaviour this repo exists to provide, and is the module a change here starts from [${firstMember}:1].`;
{
  const before = readFileSync(entryPath, "utf8");
  const after = before.replace(
    /(<!-- ui:human key=business -->\n)[\s\S]*?(\n<!-- \/ui:human key=business -->)/,
    `$1${PROSE}$2`,
  );
  if (after === before) {
    process.stderr.write(`eval: no ui:human business region in ${entryPath}\n`);
    process.exit(1);
  }
  writeFileSync(entryPath, after);
}
const enrichCost = { tokens: tokens(PROSE), note: "one hand-written entry; a real pass costs a dossier read plus the prose" };

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
const tasks = [];

function record(id, question, ultra, base) {
  tasks.push({
    id,
    question,
    ultraindex: ultra,
    baseline: base,
    // >1 means ultraindex is cheaper than the baseline for this task.
    ratio: base.tokens !== null && ultra.tokens > 0 ? Math.round((base.tokens / ultra.tokens) * 100) / 100 : null,
  });
}

// Task 1 — "what does module Y do, and why".
{
  const m = must(ui(["map", "--module", moduleSlug]), `map --module ${moduleSlug}`);
  const { res, files } = baselineList(modulePath);
  const reads = readAll(files);
  record(
    "module-purpose",
    `what does module "${moduleSlug}" do, and why does it exist`,
    { commands: [`map --module ${moduleSlug}`], tokens: tokens(m.out), ms: m.ms },
    {
      commands: [`${searchTool} --files ${modulePath}`, `read all ${files.length} file(s) in full`],
      tokens: tokens(res.out) + reads.tokens,
      ms: round1(res.ms + reads.ms),
      filesRead: files.length,
      // Stated, not hidden: after all those tokens the baseline still has only
      // what the code DOES. "Why it exists" is not written down anywhere in it.
      answersWhy: false,
    },
  );
}

// Task 2 — "answer a question from real source".
{
  const a = must(ui(["ask", question, "--repo", target]), `ask ${question}`);
  const { res, files } = baselineSearch(question);
  const reads = readAll(files);
  record(
    "grounded-evidence",
    question,
    { commands: [`ask "${question}"`], tokens: tokens(a.out), ms: a.ms },
    {
      commands: [`${searchTool} -n -i "<terms>"`, `read ${files.length} matched file(s) in full`],
      tokens: tokens(res.out) + reads.tokens,
      ms: round1(res.ms + reads.ms),
      filesRead: files.length,
    },
  );
}

// Task 3 — the grounding gate. Reported as a capability, NOT as a token ratio:
// the baseline cannot do this at all, and inventing a speedup for it would be
// exactly the kind of unearned claim this project exists to prevent.
const grounding = (() => {
  const answerPath = join(outDir, "ANSWER.md");
  const good = `The module is described in its entry [${firstMember}:1].\n`;
  const bad = `The module is described in its entry [${firstMember}:99999].\n`;

  writeFileSync(answerPath, good);
  const okRes = ui(["check", "--answer", answerPath, "--repo", target]);
  writeFileSync(answerPath, bad);
  const badRes = ui(["check", "--answer", answerPath, "--repo", target]);

  return {
    id: "grounding-gate",
    question: "is that answer actually founded in the source it cites",
    ultraindex: {
      commands: ["check --answer ANSWER.md"],
      resolvableCitationExit: okRes.status,
      unresolvableCitationExit: badRes.status,
      catchesUnfoundedCitation: okRes.status === 0 && badRes.status !== 0,
      ms: round1(okRes.ms + badRes.ms),
    },
    baseline: { commands: [], note: "no equivalent — a search tool has nothing to check a claim against" },
  };
})();

rmSync(outDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const totals = {
  ultraindex: tasks.reduce((n, t) => n + t.ultraindex.tokens, 0),
  baseline: tasks.reduce((n, t) => n + t.baseline.tokens, 0),
};
totals.ratio = Math.round((totals.baseline / totals.ultraindex) * 100) / 100;

const report = {
  target: relative(REPO_ROOT, target) || ".",
  bundle: relative(REPO_ROOT, BUNDLE),
  searchTool,
  module: moduleSlug,
  question,
  tokenizer: "ceil(chars/4)",
  measures: "cost of an EXPLAINED, GROUNDED answer — retrieval is the codeindex engine's job and is benchmarked there",
  indexBuild,
  enrichCost,
  tasks,
  grounding,
  totals,
};

const rows = tasks.map((t) =>
  `| ${t.question} | ${t.ultraindex.tokens} | ${t.baseline.tokens} | ${t.ratio}x | ${t.ultraindex.ms} | ${t.baseline.ms} |`,
);

process.stdout.write(
  [
    "=== JSON ===",
    JSON.stringify(report, null, 2),
    "=== REPORT ===",
    `Target: ${report.target} (${searchTool} baseline, tokens = ceil(chars/4))`,
    "",
    "| Task | ultraindex tokens | baseline tokens | ratio (baseline/ultra) | ultraindex ms | baseline ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    `| **total** | **${totals.ultraindex}** | **${totals.baseline}** | **${totals.ratio}x** | | |`,
    "",
    `Grounding gate: resolvable citation exits ${grounding.ultraindex.resolvableCitationExit}, ` +
      `unresolvable exits ${grounding.ultraindex.unresolvableCitationExit} — ` +
      `${grounding.ultraindex.catchesUnfoundedCitation ? "the unfounded answer is REJECTED" : "GATE FAILED"}. ` +
      "No baseline equivalent, so no ratio is claimed.",
    "",
    `One-off, amortized across every later question (never counted inside a task): ` +
      `index build ${indexBuild.ms} ms / ${indexBuild.tokens} output tokens; enrichment ${enrichCost.tokens} tokens.`,
    "",
    "Note: the module-purpose baseline reads every file and still cannot answer WHY the module exists —",
    "that is not written in the source. The token ratio therefore understates the gap.",
    ...(totals.ratio < 1
      ? [
          "",
          `HONEST FLOOR: ratio ${totals.ratio}x — on THIS target the baseline is cheaper. That is the`,
          "expected result on a repo small enough to read whole (the default fixture is 14 tiny files):",
          "an index costs more than the thing it indexes. The value is a function of repo size, so this",
          "number is reported, not hidden. Re-run with --repo <a real repo> to see the other side of the",
          "crossover. If a repo fits in context, you do not need ultraindex — say so.",
        ]
      : []),
    "",
  ].join("\n"),
);
