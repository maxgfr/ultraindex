#!/usr/bin/env node
// Token/time-savings eval: ultraindex (shipped bundle) vs a naive search+read
// baseline, on a deterministic pinned target (default: tests/fixtures/mini-repo).
//
// For three representative agent tasks —
//   1. "where is symbol X defined"
//   2. "who calls X"
//   3. "overview of module Y"
// — both strategies are executed end-to-end and metered by the tokens of EVERY
// byte the agent would read (all command stdout+stderr, plus full file contents
// for the baseline), with tokens = ceil(chars / 4). Wall-clock ms is recorded
// per strategy; the one-off index build is timed and reported SEPARATELY (it
// amortizes across every subsequent task, so it is never hidden inside a task).
//
// Strategy (a) ultraindex: build once, then symbols / impact / map --module via
//   node skills/ultraindex/scripts/ultraindex.mjs — the exact bundle agents run.
// Strategy (b) baseline: ripgrep the symbol, then read each matched file IN
//   FULL (for the overview task: list the module's files, read each in full) —
//   the way an agent without an index works.
//
// Plain Node, zero dependencies. Whatever the ratios come out to be, they are
// printed as measured — no fabrication.
//
// Usage:
//   node evals/token-savings/run.mjs [--repo <dir>] [--symbol <name>]
//                                    [--module <slug>] [--module-path <dir>]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
const symbol = flag("--symbol", "backoff");
const moduleSlug = flag("--module", "src");
const modulePath = flag("--module-path", "src");

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

/** Search the symbol across the target repo; returns output + matched files. */
function baselineSearch(sym) {
  // Explicit "." path: under spawnSync stdin is a pipe, and rg without a path
  // argument would search (empty) stdin instead of the tree.
  const res = hasRg
    ? run("rg", ["-n", "--no-heading", sym, "."], { cwd: target })
    : run("grep", ["-rnI", "--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude-dir=.ultraindex", sym, "."], { cwd: target });
  if (res.status > 1) must(res, `${searchTool} ${sym}`); // 1 = no matches, valid
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
// One-off index build (amortized: reported separately, never inside a task).
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), "ui-eval-"));
const idx = join(outDir, ".ultraindex");
const ui = (argv) => run(process.execPath, [BUNDLE, ...argv, "--out", idx]);
const build = must(
  run(process.execPath, [BUNDLE, "build", "--repo", target, "--out", idx, "--no-mermaid"]),
  "ultraindex build",
);
const indexBuild = { ms: build.ms, tokens: tokens(build.out) };

// ---------------------------------------------------------------------------
// The three tasks
// ---------------------------------------------------------------------------
const tasks = [];

function record(id, question, ultra, base) {
  tasks.push({
    id,
    question,
    ultraindex: ultra,
    baseline: base,
    // >1 means ultraindex is cheaper than the baseline for this task.
    ratio: ultra.tokens > 0 ? Math.round((base.tokens / ultra.tokens) * 100) / 100 : null,
  });
}

// Task 1 — "where is symbol X defined"
{
  const s = must(ui(["symbols", symbol]), `symbols ${symbol}`);
  const { res, files } = baselineSearch(symbol);
  const reads = readAll(files);
  record(
    "symbol-definition",
    `where is symbol "${symbol}" defined`,
    { commands: [`symbols "${symbol}"`], tokens: tokens(s.out), ms: s.ms },
    {
      commands: [`${searchTool} -n "${symbol}"`, `read ${files.length} matched file(s) in full`],
      tokens: tokens(res.out) + reads.tokens,
      ms: round1(res.ms + reads.ms),
      filesRead: files.length,
    },
  );
}

// Task 2 — "who calls X": symbols to locate the definition, then impact on it.
{
  const s = must(ui(["symbols", symbol]), `symbols ${symbol}`);
  // Parse the definition file from the symbols output, as the agent would
  // (first non-reexport def; fall back to the first def).
  const defs = [...s.out.matchAll(/^\s+def\s+(\S+):\d+\s+\((\w+)/gm)]
    .map((m) => ({ file: m[1], kind: m[2] }));
  const def = defs.find((d) => d.kind !== "reexport") ?? defs[0];
  if (!def) {
    process.stderr.write(`eval: no definition of "${symbol}" in symbols output\n${s.out}\n`);
    process.exit(1);
  }
  const imp = must(ui(["impact", def.file]), `impact ${def.file}`);
  const { res, files } = baselineSearch(symbol);
  const reads = readAll(files);
  record(
    "callers",
    `who calls "${symbol}"`,
    {
      commands: [`symbols "${symbol}"`, `impact ${def.file}`],
      tokens: tokens(s.out) + tokens(imp.out),
      ms: round1(s.ms + imp.ms),
    },
    {
      commands: [`${searchTool} -n "${symbol}"`, `read ${files.length} matched file(s) in full`],
      tokens: tokens(res.out) + reads.tokens,
      ms: round1(res.ms + reads.ms),
      filesRead: files.length,
    },
  );
}

// Task 3 — "overview of module Y"
{
  const m = must(ui(["map", "--module", moduleSlug]), `map --module ${moduleSlug}`);
  const { res, files } = baselineList(modulePath);
  const reads = readAll(files);
  record(
    "module-overview",
    `overview of module "${moduleSlug}"`,
    { commands: [`map --module ${moduleSlug}`], tokens: tokens(m.out), ms: m.ms },
    {
      commands: [`${searchTool} --files ${modulePath}`, `read all ${files.length} file(s) in full`],
      tokens: tokens(res.out) + reads.tokens,
      ms: round1(res.ms + reads.ms),
      filesRead: files.length,
    },
  );
}

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
  symbol,
  module: moduleSlug,
  tokenizer: "ceil(chars/4)",
  indexBuild,
  tasks,
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
    `Index build (one-off, amortized across all subsequent tasks — reported separately, not included above): ${indexBuild.ms} ms, ${indexBuild.tokens} output tokens.`,
    "",
  ].join("\n"),
);
