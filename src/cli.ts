import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { VERSION } from "./types.js";
import { runBuild } from "./build.js";
import { runFind } from "./find.js";
import { runNeighbors } from "./neighbors.js";
import { runMap } from "./mapcmd.js";
import { runCheck, checkAnswer } from "./check.js";
import { runDossier, runAsk } from "./explain.js";
import { indexExists, loadManifest } from "./store.js";

const HELP = `ultraindex v${VERSION}
Deterministically index a whole repo (code + docs) into a navigable encyclopedia
— a small map, per-module entries, and a typed link-graph — so an AI can work in
huge codebases without filling its context window. Zero deps, no keys.

Usage:
  ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--no-mermaid]
  ultraindex find    "<query>" [--out <dir>] [--k <n>]
  ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
  ultraindex map     [--out <dir>] [--module <slug>]
  ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>]
  ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>]
  ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>]

Commands:
  build      Scan the repo and (re)write the layered index to --out (default
             <repo>/.ultraindex). Idempotent: refreshes generated sections,
             preserves your enriched prose.
  find       Rank modules for a task and print the exact files to open.
  neighbors  Show graph neighbours of a file or module (what links to/from it).
  map        Print INDEX.md (the map) or one module's entry.
  dossier    Print a grounding packet for a module (its real key source + graph
             neighbours) so you can write a cited business analysis into its entry.
  ask        Assemble grounded evidence for a question (real source of the
             relevant modules) so you can answer it with citations.
  check      Report staleness + integrity + grounding (cited prose must resolve).
             With --answer <file>, validate that answer's citations instead.

Options:
  --repo <dir>      Repo to index / check / read source from  (default: .)
  --out <dir>       Index output dir   (default: <repo>/.ultraindex, else docs/ultraindex if present)
  --include <glob>  Only index paths matching (comma-separated globs)
  --exclude <glob>  Skip paths matching (comma-separated globs)
  --max-bytes <n>   Skip files larger than n bytes
  --no-mermaid      Do not write graph.mmd
  --k <n>           find/ask: number of modules to return      (default: 8 / 5)
  --depth <n>       neighbors: hops to traverse                (default: 1)
  --module <slug>   map: print this module's entry instead of INDEX.md
  --answer <file>   check: validate this answer file's citations against the index
  --json            Machine-readable output
  --quiet           check: print nothing, use the exit code only
  -h, --help        Show this help
  -v, --version     Show version

Grounding:
  Analysis is verified, not trusted. Cite claims with [path], [path:line] or
  [path:start-end]. \`check\` (encyclopedia prose) and \`check --answer\` fail if a
  citation does not resolve to a real file/line — the anti-hallucination guard.
`;

const COMMANDS = new Set(["build", "find", "neighbors", "map", "dossier", "ask", "check"]);
const VALUE_FLAGS = new Set(["repo", "out", "include", "exclude", "max-bytes", "k", "depth", "module", "answer", "q", "question"]);
const BOOL_FLAGS = new Set(["json", "no-mermaid", "quiet"]);

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

function cmdBuild(p: Parsed): void {
  const repo = resolve(p.values.repo ?? ".");
  if (!existsSync(repo)) fail(`repo not found: ${repo}`);
  const out = p.values.out ? resolve(p.values.out) : join(repo, ".ultraindex");
  const maxBytes = p.values["max-bytes"] ? Number(p.values["max-bytes"]) : undefined;
  if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes <= 0)) fail("invalid --max-bytes");

  const { graph, manifest } = runBuild(
    {
      repo,
      out,
      include: splitList(p.values.include),
      exclude: splitList(p.values.exclude),
      maxBytes,
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
    process.stdout.write(
      JSON.stringify(
        {
          out,
          files: graph.fileCount,
          modules: graph.modules.length,
          edges: graph.fileEdges.length,
          dangling,
          ...(dangling ? { danglingByReason } : {}),
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
    `ultraindex: built index for ${graph.fileCount} files`,
    `  out:      ${out}${graph.commit ? `  (@ ${graph.commit})` : ""}`,
    `  modules:  ${graph.modules.length} · links: ${graph.fileEdges.length}${dangling ? ` · dangling: ${dangling}` : ""}`,
    ...(manifest.orphaned.length ? [`  orphaned: ${manifest.orphaned.length} (see encyclopedia/_orphaned/)`] : []),
    ...(manifest.notes.length ? [`  notes:    ${manifest.notes.length} (see manifest.json)`] : []),
    `  next:     enrich encyclopedia/*.md (ui:human regions), then \`ultraindex check\``,
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

function cmdFind(p: Parsed): void {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const query = p.positional.join(" ").trim();
  if (!query) fail('missing query — usage: ultraindex find "<task keywords>"');
  const k = p.values.k ? Number(p.values.k) : 8;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");

  const results = runFind(out, query, k);
  if (results === undefined) fail(`no index at ${out} — run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }
  if (results.length === 0) {
    process.stdout.write(`No modules matched "${query}".\n`);
    return;
  }
  const lines: string[] = [`ultraindex: ${results.length} module(s) for "${query}"`, ""];
  for (const r of results) {
    lines.push(`▸ ${r.slug}  (${r.path}, tier ${r.tier}, score ${r.score})`);
    if (r.matched.length) lines.push(`    matched: ${r.matched.join(", ")}`);
    lines.push(`    open:    ${r.files.join("  ") || "(no files)"}`);
    if (r.neighbors.length) lines.push(`    related: ${r.neighbors.join(", ")}`);
    lines.push(`    entry:   encyclopedia/${r.slug}.md`);
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
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
  const content = runMap(out, p.values.module);
  if (content === undefined) {
    fail(p.values.module ? `no entry for module "${p.values.module}" at ${out}` : `no index at ${out} — run \`ultraindex build\` first`);
  }
  process.stdout.write(content.endsWith("\n") ? content : content + "\n");
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

function cmdAsk(p: Parsed): void {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  const question = (p.positional.join(" ") || p.values.q || p.values.question || "").trim();
  if (!question) fail('missing question — usage: ultraindex ask "<question>"');
  const k = p.values.k ? Number(p.values.k) : 5;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const res = runAsk(out, repo, question, k);
  if (res === undefined) fail(`no index at ${out} — run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  process.stdout.write(res.content);
}

function cmdCheck(p: Parsed): void {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);

  if (p.values.answer) {
    const res = checkAnswer(out, resolve(p.values.answer));
    if (p.bools.has("json")) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    } else if (!p.bools.has("quiet")) {
      const lines = [`ultraindex: answer is ${res.ok ? "GROUNDED" : "NOT GROUNDED"} (${res.resolved}/${res.citations} citations resolve)`];
      for (const e of res.errors) lines.push(`  error:    ${e}`);
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

function main(): void {
  const p = parseArgs(process.argv.slice(2));
  switch (p.command) {
    case "build":
      return cmdBuild(p);
    case "find":
      return cmdFind(p);
    case "neighbors":
      return cmdNeighbors(p);
    case "map":
      return cmdMap(p);
    case "dossier":
      return cmdDossier(p);
    case "ask":
      return cmdAsk(p);
    case "check":
      return cmdCheck(p);
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
  try {
    main();
  } catch (e) {
    fail((e as Error).message);
  }
}
