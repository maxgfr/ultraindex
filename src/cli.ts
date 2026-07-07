import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { VERSION } from "./types.js";
import { runBuild } from "./build.js";
import { runFindHybrid } from "./find.js";
import { loadSemanticConfig } from "./semantic.js";
import { runEmbed } from "./vectors.js";
import { runNeighbors } from "./neighbors.js";
import { runMap } from "./mapcmd.js";
import { runStatus } from "./status.js";
import { runCheck, checkAnswer } from "./check.js";
import { runVerify, applyVerdicts, formatVerifyReport, VERIFY_MAX } from "./verify.js";
import { runDossier, runAsk } from "./explain.js";
import { indexExists, loadGraph, loadManifest } from "./store.js";
import { ensureGrammars, allGrammarKeys } from "./ast/loader.js";

const HELP = `ultraindex v${VERSION}
Deterministically index a whole repo (code + docs) into a navigable encyclopedia
— a small map, per-module entries, and a typed link-graph — so an AI can work in
huge codebases without filling its context window. Zero deps, no keys.

Usage:
  ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--no-mermaid]
  ultraindex find    "<query>" [--out <dir>] [--k <n>]
  ultraindex embed   [--out <dir>] [--force]
  ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
  ultraindex map     [--out <dir>] [--module <slug>]
  ultraindex status  [--out <dir>]
  ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>]
  ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>]
  ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>] [--semantic]
  ultraindex verify  --answer <file> [--repo <dir>] [--apply <verdicts.json>] [--max-verify <n>]

Commands:
  build      Scan the repo and (re)write the layered index to --out (default
             <repo>/.ultraindex). Idempotent: refreshes generated sections,
             preserves your enriched prose.
  find       Rank modules for a task and print the exact files to open. Hybrid
             (lexical + semantic) when vectors.json exists; pure lexical otherwise.
  embed      Build/refresh vectors.json: embed each module through the configured
             provider (see Semantic below). Incremental — unchanged modules keep
             their vectors.
  neighbors  Show graph neighbours of a file or module (what links to/from it).
  map        Print INDEX.md (the map) or one module's entry. With --json, emit
             the module table (slug, path, tier, degree, summary) for parsing.
  status     Show enrichment progress and the suggested order to enrich next —
             unenriched first, foundations/features before tail, hubs first.
  dossier    Print a grounding packet for a module (its real key source + graph
             neighbours) so you can write a cited business analysis into its entry.
  ask        Assemble grounded evidence for a question (real source of the
             relevant modules) so you can answer it with citations.
  check      Report staleness + integrity + grounding (cited prose must resolve).
             With --answer <file>, validate that answer's citations instead;
             add --semantic to also fail on a claim its cited excerpt doesn't support.
  verify     Emit a claim↔citation worklist for adversarial support-checking of
             an answer, then (--apply <verdicts.json>) gate on refuted/unsupported.

Options:
  --repo <dir>      Repo to index / check / read source from  (default: .)
  --out <dir>       Index output dir   (default: <repo>/.ultraindex, else docs/ultraindex if present)
  --include <glob>  Only index paths matching (comma-separated globs)
  --exclude <glob>  Skip paths matching (comma-separated globs)
  --max-bytes <n>   Skip files larger than n bytes                (default: 1 MiB)
  --max-files <n>   Stop the scan after n files; the index warns if hit (default: 20000)
  --no-cache        build: ignore cache.json and re-extract every file
  --no-mermaid      Do not write graph.mmd
  --k <n>           find/ask: number of modules to return      (default: 8 / 5)
  --depth <n>       neighbors: hops to traverse                (default: 1)
  --module <slug>   map: print this module's entry instead of INDEX.md
  --answer <file>   check/verify: the answer file whose citations to validate
  --apply <file>    verify: reduce a filled verdicts file to a pass/fail gate
  --max-verify <n>  verify: cap the claim↔citation worklist           (default: 40)
  --force           embed: re-embed every module even if unchanged
  --json            Machine-readable output
  --quiet           check: print nothing, use the exit code only
  -h, --help        Show this help
  -v, --version     Show version

Semantic (optional):
  \`find\` stays deterministic and offline by default. To add semantic ranking,
  point ultraindex at any OpenAI-compatible /v1/embeddings endpoint — e.g. the
  local container in docker-compose.yml (\`docker compose up -d\`) — via env
  (ULTRAINDEX_EMBED_BASE_URL, ULTRAINDEX_EMBED_MODEL, ULTRAINDEX_EMBED_API_KEY)
  or <out>/semantic.json, then run \`ultraindex embed\`. If the provider is down,
  \`find\` degrades to pure lexical with a warning. Delete vectors.json to turn
  the semantic layer off entirely.

Grounding:
  Analysis is verified, not trusted. Cite claims with [path], [path:line] or
  [path:start-end]. \`check\` (encyclopedia prose) and \`check --answer\` fail if a
  citation does not resolve to a real file/line — the anti-hallucination guard.
`;

const COMMANDS = new Set(["build", "find", "embed", "neighbors", "map", "status", "dossier", "ask", "check", "verify"]);
const VALUE_FLAGS = new Set(["repo", "out", "include", "exclude", "max-bytes", "max-files", "k", "depth", "module", "answer", "q", "question", "apply", "max-verify"]);
const BOOL_FLAGS = new Set(["json", "no-mermaid", "no-cache", "quiet", "force", "semantic"]);

// What each dangling reason means and what to do about it — emitted in
// `build --json` so the report is self-diagnosing.
const REASON_HINTS: Record<string, string> = {
  "missing-module": "a relative import's target file does not exist — usually a real broken import in the repo, worth reporting",
  "alias-unresolved": "a tsconfig path alias matched but its target file is missing — check the tsconfig paths or uncommitted build artifacts",
  "escapes-repo-root": "an import walks above the indexed root — index the parent directory, or ignore if intentional",
  "missing-package": "a Go import maps to a directory with no .go files — broken import or ungenerated code",
  "missing-include": 'a C/C++ `#include "..."` names a header with no in-repo file — a missing/renamed header or an external dep quoted like a local one',
  "missing-target": "a markdown link points at a file that does not exist — a stale doc link",
};

function fail(message: string): never {
  process.stderr.write(`ultraindex: ${message}\n`);
  process.exit(1);
}

interface Parsed {
  command: string;
  positional: string[];
  values: Record<string, string>;
  bools: Set<string>;
}

export function parseArgs(argv: string[]): Parsed {
  if (argv.length === 0) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    process.stdout.write(VERSION + "\n");
    process.exit(0);
  }

  const command = argv[0]!;
  if (!COMMANDS.has(command)) fail(`unknown command: ${command} (run --help for usage)`);

  const values: Record<string, string> = {};
  const bools = new Set<string>();
  const positional: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === "-v" || arg === "--version") {
      process.stdout.write(VERSION + "\n");
      process.exit(0);
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
      if (BOOL_FLAGS.has(key)) {
        if (eq !== -1) fail(`--${key} is a boolean flag and does not take a value`);
        bools.add(key);
        continue;
      }
      if (!VALUE_FLAGS.has(key)) fail(`unknown flag: --${key} (run --help for the supported options)`);
      let value: string;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) fail(`missing value for --${key}`);
        value = next;
        i++;
      }
      values[key] = value;
      continue;
    }
    positional.push(arg);
  }
  return { command, positional, values, bools };
}

function splitList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

// Resolve the index directory: explicit --out wins; else <base>/.ultraindex if
// it exists, else <base>/docs/ultraindex if it exists, else default .ultraindex.
function resolveOut(p: Parsed, base: string): string {
  if (p.values.out) return resolve(p.values.out);
  const dotted = join(base, ".ultraindex");
  if (existsSync(dotted)) return dotted;
  const docs = join(base, "docs", "ultraindex");
  if (existsSync(docs)) return docs;
  return dotted;
}

// Repo root for read commands: explicit --repo wins; else the absolute root the
// index recorded at build time (so an out-of-tree index still finds its source);
// else cwd. Without this, dossier/ask/check silently read the wrong directory.
function resolveRepoRoot(p: Parsed, out: string): string {
  if (p.values.repo) return resolve(p.values.repo);
  return loadManifest(out)?.repo ?? resolve(".");
}

async function cmdBuild(p: Parsed): Promise<void> {
  const repo = resolve(p.values.repo ?? ".");
  if (!existsSync(repo)) fail(`repo not found: ${repo}`);
  const out = p.values.out ? resolve(p.values.out) : join(repo, ".ultraindex");
  const maxBytes = p.values["max-bytes"] ? Number(p.values["max-bytes"]) : undefined;
  if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes <= 0)) fail("invalid --max-bytes");
  const maxFiles = p.values["max-files"] ? Number(p.values["max-files"]) : undefined;
  if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles <= 0)) fail("invalid --max-files");

  // Load the tree-sitter grammars once, up front — the only async step; the scan
  // pipeline itself stays synchronous and parses against the warmed grammars.
  await ensureGrammars(allGrammarKeys());

  const { graph, manifest, capped } = runBuild(
    {
      repo,
      out,
      include: splitList(p.values.include),
      exclude: splitList(p.values.exclude),
      maxBytes,
      maxFiles,
      noCache: p.bools.has("no-cache"),
      mermaid: !p.bools.has("no-mermaid"),
      json: p.bools.has("json"),
    },
    new Date().toISOString(),
  );

  const danglingEdges = graph.fileEdges.filter((e) => e.dangling);
  const dangling = danglingEdges.length;
  if (p.bools.has("json")) {
    const danglingByReason: Record<string, number> = {};
    for (const e of danglingEdges) {
      const r = e.reason ?? "unknown";
      danglingByReason[r] = (danglingByReason[r] ?? 0) + 1;
    }
    // One actionable sentence per reason actually present, so an agent reading
    // the report knows what each bucket means without opening the docs.
    const reasonHints: Record<string, string> = {};
    for (const r of Object.keys(danglingByReason)) {
      if (REASON_HINTS[r]) reasonHints[r] = REASON_HINTS[r];
    }
    process.stdout.write(
      JSON.stringify(
        {
          out,
          files: graph.fileCount,
          modules: graph.modules.length,
          edges: graph.fileEdges.length,
          dangling,
          ...(dangling ? { danglingByReason, reasonHints } : {}),
          ...(capped ? { truncated: true } : {}),
          orphaned: manifest.orphaned,
          ...(manifest.notes.length ? { notes: manifest.notes } : {}),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const lines = [
    `ultraindex: built index for ${graph.fileCount} files${capped ? " (PARTIAL — --max-files cap hit)" : ""}`,
    `  out:      ${out}${graph.commit ? `  (@ ${graph.commit})` : ""}`,
    `  modules:  ${graph.modules.length} · links: ${graph.fileEdges.length}${dangling ? ` · dangling: ${dangling}` : ""}`,
    ...(capped ? [`  WARNING:  scan hit --max-files — the index is partial; raise --max-files to index the whole repo`] : []),
    ...(manifest.orphaned.length ? [`  orphaned: ${manifest.orphaned.length} (see encyclopedia/_orphaned/)`] : []),
    ...(manifest.notes.length ? [`  notes:    ${manifest.notes.length} (see manifest.json)`] : []),
    `  next:     enrich encyclopedia/*.md (ui:human regions), then \`ultraindex check\``,
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

async function cmdFind(p: Parsed): Promise<void> {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const query = p.positional.join(" ").trim();
  if (!query) fail('missing query — usage: ultraindex find "<task keywords>"');
  const k = p.values.k ? Number(p.values.k) : 8;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");

  const found = await runFindHybrid(out, query, k);
  if (found === undefined) fail(`no index at ${out} — run \`ultraindex build\` first`);
  if (found.warning) process.stderr.write(`ultraindex: warning: ${found.warning}\n`);
  const results = found.results;
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }
  if (results.length === 0) {
    process.stdout.write(`No modules matched "${query}".\n`);
    return;
  }
  const lines: string[] = [`ultraindex: ${results.length} module(s) for "${query}"${found.semantic ? " (hybrid)" : ""}`, ""];
  for (const r of results) {
    lines.push(`▸ ${r.slug}  (${r.path}, tier ${r.tier}, score ${r.score}${r.semanticRank !== undefined ? `, semantic #${r.semanticRank}` : ""})`);
    if (r.matched.length) lines.push(`    matched: ${r.matched.join(", ")}`);
    lines.push(`    open:    ${r.files.join("  ") || "(no files)"}`);
    if (r.neighbors.length) lines.push(`    related: ${r.neighbors.join(", ")}`);
    lines.push(`    entry:   encyclopedia/${r.slug}.md`);
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
}

async function cmdEmbed(p: Parsed): Promise<void> {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const cfg = loadSemanticConfig(out);
  if (!cfg) {
    fail(
      `no semantic config — set ULTRAINDEX_EMBED_BASE_URL and ULTRAINDEX_EMBED_MODEL, or create ${join(out, "semantic.json")} ` +
        `({"baseUrl": "http://localhost:8080/v1", "model": "BAAI/bge-small-en-v1.5"}). ` +
        `To run a local provider: \`docker compose up -d\` (see docker-compose.yml)`,
    );
  }
  const report = await runEmbed(out, cfg, p.bools.has("force"));
  if (report === undefined) fail(`no index at ${out} — run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  const lines = [
    `ultraindex: embedded ${report.embedded}/${report.total} module(s) (${report.reused} reused, ${report.removed} pruned)`,
    `  model:    ${report.model} (dim ${report.dim})`,
    `  next:     \`ultraindex find "<query>"\` now ranks hybrid (lexical + semantic)`,
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

function cmdNeighbors(p: Parsed): void {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const target = p.positional[0];
  if (!target) fail("missing target — usage: ultraindex neighbors <file|module-slug>");
  if (!indexExists(out)) fail(`no index at ${out} — run \`ultraindex build\` first`);
  const depth = p.values.depth ? Number(p.values.depth) : 1;
  if (!Number.isFinite(depth) || depth <= 0) fail("invalid --depth");

  const res = runNeighbors(out, target, depth);
  if (!res) fail(`"${target}" is not a module slug or file in the index`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  const lines = [`ultraindex: neighbours of ${res.scope} "${res.target}" (depth ${depth})`, ""];
  if (res.members) lines.push(`  members: ${res.members.join("  ")}`, "");
  if (res.links.length === 0) lines.push("  (no neighbours)");
  for (const l of res.links) {
    const arrow = l.direction === "out" ? "→" : "←";
    lines.push(`  ${arrow} ${l.node}  (${l.kind}${l.weight > 1 ? ` ×${l.weight}` : ""}, depth ${l.depth})`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function cmdMap(p: Parsed): void {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  if (p.bools.has("json")) {
    // The machine-readable map: the module table agents would otherwise have to
    // parse out of INDEX.md. (--module entries are markdown by design — prose.)
    if (p.values.module) fail("--json applies to the map view, not a single entry (read the markdown)");
    const graph = loadGraph(out);
    if (!graph) fail(`no index at ${out} — run \`ultraindex build\` first`);
    const modules = graph.modules.map((m) => ({
      slug: m.slug,
      path: m.path,
      tier: m.tier,
      degree: m.degIn + m.degOut,
      files: m.members.length,
      summary: m.summary,
    }));
    process.stdout.write(JSON.stringify(modules, null, 2) + "\n");
    return;
  }
  const content = runMap(out, p.values.module);
  if (content === undefined) {
    fail(p.values.module ? `no entry for module "${p.values.module}" at ${out}` : `no index at ${out} — run \`ultraindex build\` first`);
  }
  process.stdout.write(content.endsWith("\n") ? content : content + "\n");
}

function cmdStatus(p: Parsed): void {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const res = runStatus(out);
  if (res === undefined) fail(`no index at ${out} — run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  const lines = [`ultraindex: ${res.enriched}/${res.total} modules enriched`];
  if (res.suggestedNext.length) lines.push(`  next:     ${res.suggestedNext.join(", ")}`);
  lines.push("");
  for (const m of res.modules.slice(0, 15)) {
    const state = m.enriched ? "✓" : "·";
    lines.push(`  ${state} ${m.slug}  (${m.path}, tier ${m.tier}, degree ${m.degree}) — ${m.regions.enriched}/${m.regions.total} regions`);
  }
  if (res.modules.length > 15) lines.push(`  …and ${res.modules.length - 15} more (use --json for all)`);
  lines.push("", `  enrich:   \`ultraindex dossier <slug>\` then fill the ui:human regions, then \`ultraindex check\``);
  process.stdout.write(lines.join("\n") + "\n");
}

function cmdDossier(p: Parsed): void {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  const slug = p.positional[0];
  if (!slug) fail("missing module slug — usage: ultraindex dossier <module-slug>");
  const content = runDossier(out, repo, slug);
  if (content === undefined) {
    fail(indexExists(out) ? `no module "${slug}" in the index (try \`ultraindex map\`)` : `no index at ${out} — run \`ultraindex build\` first`);
  }
  process.stdout.write(content);
}

async function cmdAsk(p: Parsed): Promise<void> {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  const question = (p.positional.join(" ") || p.values.q || p.values.question || "").trim();
  if (!question) fail('missing question — usage: ultraindex ask "<question>"');
  const k = p.values.k ? Number(p.values.k) : 5;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const res = await runAsk(out, repo, question, k);
  if (res === undefined) fail(`no index at ${out} — run \`ultraindex build\` first`);
  if (res.warning) process.stderr.write(`ultraindex: warning: ${res.warning}\n`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify({ modules: res.modules, content: res.content }, null, 2) + "\n");
    return;
  }
  process.stdout.write(res.content);
}

function cmdCheck(p: Parsed): void {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);

  if (p.values.answer) {
    const res = checkAnswer(out, resolve(p.values.answer), { semantic: p.bools.has("semantic"), repo });
    if (p.bools.has("json")) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    } else if (!p.bools.has("quiet")) {
      const lines = [`ultraindex: answer is ${res.ok ? "GROUNDED" : "NOT GROUNDED"} (${res.resolved}/${res.citations} citations resolve)`];
      if (res.semantic) {
        const s = res.semantic;
        lines.push(`  semantic: supported ${s.supported} · partial ${s.partial} · refuted ${s.refuted} · unsupported ${s.unsupported}`);
        for (const f of s.failures.slice(0, 8)) lines.push(`  ✗ semantic ${f.claimId} (${f.citation}): ${f.verdict}`);
      }
      for (const e of res.errors) lines.push(`  error:    ${e}`);
      for (const w of res.warnings ?? []) lines.push(`  warning:  ${w}`);
      process.stdout.write(lines.join("\n") + "\n");
    }
    if (!res.ok) process.exit(1);
    return;
  }

  const res = runCheck(out, repo);

  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    if (!res.ok) process.exit(1);
    return;
  }
  if (!p.bools.has("quiet")) {
    const lines: string[] = [];
    const status = res.errors.length ? "BROKEN" : res.stale ? "STALE" : "FRESH";
    lines.push(`ultraindex: index is ${status} (${out})`);
    if (res.changed.length) lines.push(`  changed:  ${res.changed.length} — ${res.changed.slice(0, 8).join(", ")}${res.changed.length > 8 ? " …" : ""}`);
    if (res.added.length) lines.push(`  added:    ${res.added.length} — ${res.added.slice(0, 8).join(", ")}${res.added.length > 8 ? " …" : ""}`);
    if (res.removed.length) lines.push(`  removed:  ${res.removed.length} — ${res.removed.slice(0, 8).join(", ")}${res.removed.length > 8 ? " …" : ""}`);
    for (const e of res.errors) lines.push(`  error:    ${e}`);
    for (const w of res.warnings) lines.push(`  warning:  ${w}`);
    if (res.stale) lines.push(`  fix:      re-run \`ultraindex build\` to refresh`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  if (!res.ok) process.exit(1);
}

function cmdVerify(p: Parsed): void {
  const answer = p.values.answer;
  if (!answer) fail("missing --answer <file> — usage: ultraindex verify --answer <file> [--repo <dir>]");
  const answerPath = resolve(answer);
  const dir = dirname(answerPath);

  if (p.values.apply) {
    const res = applyVerdicts(dir, resolve(p.values.apply));
    if (p.bools.has("json")) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    else if (!p.bools.has("quiet")) process.stdout.write(formatVerifyReport(res) + "\n");
    if (!res.ok) process.exit(1);
    return;
  }

  if (!existsSync(answerPath)) fail(`answer file not found: ${answerPath}`);
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  const maxVerify = p.values["max-verify"] ? Number(p.values["max-verify"]) : VERIFY_MAX;
  if (!Number.isFinite(maxVerify) || maxVerify <= 0) fail("invalid --max-verify");
  const wl = runVerify(answerPath, repo, { maxVerify });
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(wl, null, 2) + "\n");
    return;
  }
  process.stderr.write(
    `ultraindex: ${wl.pairs.length} claim↔citation pair(s) → ${dir}/VERIFY.md & VERIFY.todo.json\n` +
      `  adjudicate each verdict, save as verdicts.json, then: ultraindex verify --apply verdicts.json --answer ${answerPath}\n`,
  );
}

async function main(): Promise<void> {
  const p = parseArgs(process.argv.slice(2));
  switch (p.command) {
    case "build":
      return cmdBuild(p);
    case "find":
      return cmdFind(p);
    case "embed":
      return cmdEmbed(p);
    case "neighbors":
      return cmdNeighbors(p);
    case "map":
      return cmdMap(p);
    case "status":
      return cmdStatus(p);
    case "dossier":
      return cmdDossier(p);
    case "ask":
      return cmdAsk(p);
    case "check":
      return cmdCheck(p);
    case "verify":
      return cmdVerify(p);
  }
}

// Only run when invoked directly (node scripts/ultraindex.mjs), not when
// imported by tests. Realpath both sides: Node canonicalizes import.meta.url but
// leaves process.argv[1] as-typed, so on a symlinked path (macOS /tmp →
// /private/tmp, or a globally-linked skill folder) a raw URL compare silently
// fails and main() never runs.
function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    if (realpathSync(argv1) === realpathSync(modulePath)) return true;
  } catch {
    /* a path may be virtual — fall through */
  }
  return import.meta.url === pathToFileURL(argv1).href;
}

if (isInvokedDirectly()) {
  main().catch((e: unknown) => fail((e as Error).message));
}
