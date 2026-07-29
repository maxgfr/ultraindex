import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { runBuild } from "../build.js";
import { checkAnswer, runCheck } from "../check.js";
import { runDelta, formatDeltaPanel } from "../delta.js";
import { ensureGrammars, allGrammarKeys, resolveGrammarsTier } from "../engine.js";
import { runAsk, runDossier } from "../explain.js";
import { runFindHybrid } from "../find.js";
import { runImpact } from "../impact.js";
import { runMap } from "../mapcmd.js";
import { runNeighbors } from "../neighbors.js";
import { resolveEmbedTier } from "../semantic.js";
import { runStatus } from "../status.js";
import { loadManifest } from "../store.js";
import { runSymbols } from "../symbols.js";
import { buildClaimPairs, VERIFY_MAX } from "../verify.js";
import { runEmbed } from "../vectors.js";
import { withIndexLock } from "../index-lock.js";

// Where a tool name becomes work. Every handler calls the same library
// functions the CLI does — nothing here shells out to `ultraindex`, and nothing
// here calls cli.ts, whose `fail()` would take the server process down with a
// process.exit on a bad argument.

export interface HandlerDefaults {
  defaultRepo?: string;
  allowWrite?: boolean;
}

// Thrown for anything the caller can fix by calling again differently. The
// server turns it into an `isError` tool result, never a JSON-RPC error: the
// tool ran, the request was wrong or the world didn't cooperate.
export class ToolError extends Error {}

export interface ToolOutcome {
  // The tool result, JSON-encoded. The MCP content block carries this verbatim.
  text: string;
  // An on-disk file holding the same thing, when one exists. Only used if the
  // payload is too large to send, so the refusal can point somewhere useful.
  artifact?: string;
}

// A file read cannot return more than this many lines in one call, however big
// the window asked for.
const MAX_READ_LINES = 2000;
// Hard ceiling on a file ultraindex will open at all.
const MAX_READ_BYTES = 8 * 1024 * 1024;

// --------------------------------------------------------------------------
// Argument coercion
// --------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

function positive(v: unknown, key: string): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  if (n <= 0) throw new ToolError(`\`${key}\` must be greater than 0.`);
  return n;
}

function requiredRepo(args: Record<string, unknown>, defaults: HandlerDefaults): string {
  const repo = str(args.repo) ?? defaults.defaultRepo;
  if (!repo) throw new ToolError("`repo` is required: an absolute path to the repository root.");
  const abs = resolve(repo);
  if (!existsSync(abs)) throw new ToolError(`repo not found: ${abs}`);
  return abs;
}

function requiredStr(args: Record<string, unknown>, key: string, hint: string): string {
  const v = str(args[key]);
  if (!v) throw new ToolError(`\`${key}\` is required — ${hint}`);
  return v;
}

// The MCP counterpart of cli.ts's resolveOut. Same precedence — explicit `out`,
// then <repo>/.ultraindex, then <repo>/docs/ultraindex — but it THROWS where
// the CLI exits, so one bad argument cannot end a long-lived session.
function resolveOut(args: Record<string, unknown>, repo: string): string {
  const explicit = str(args.out);
  if (explicit) {
    if (!isAbsolute(explicit)) throw new ToolError("`out` must be an absolute path.");
    return resolve(explicit);
  }
  const dotted = join(repo, ".ultraindex");
  if (existsSync(dotted)) return dotted;
  const docs = join(repo, "docs", "ultraindex");
  if (existsSync(docs)) return docs;
  return dotted;
}

// Every read tool lands here first. "No index" is the single most likely reason
// a call fails, and a model told only "undefined" retries the same call — so it
// is named as the missing STEP it is, with the tool that fixes it.
function requireIndex(out: string, repo: string): void {
  if (!existsSync(join(out, "manifest.json"))) {
    throw new ToolError(
      `no index at ${out} — build one first with ultraindex_build (repo: ${repo}). ` +
        `If the index lives elsewhere, pass \`out\` explicitly.`,
    );
  }
}

// The server's counterpart of cli.ts's `warmGrammars`. Same intent — load the
// tree-sitter grammars so symbol extraction is precise — but it must not do
// what the CLI's version does: write to stderr and set `process.exitCode`. In a
// server, the first is noise on a stream a client may be parsing and the second
// silently poisons the process's eventual exit status.
//
// So the downgrade comes back as a STRING instead. Offline, the engine's regex
// extractor takes over: still a full, searchable index, just less precise
// symbols — a fact the caller should fold into its confidence, not an error to
// retry around. Attempted once per process; a second failure is not re-reported.
let grammarNote: string | undefined;
let grammarsTried = false;

async function warmGrammars(): Promise<string | undefined> {
  if (grammarsTried) return grammarNote;
  grammarsTried = true;
  if (resolveGrammarsTier().tier !== "none") return undefined;
  try {
    await ensureGrammars(allGrammarKeys());
  } catch (e) {
    grammarNote = `tree-sitter grammars unavailable (${(e as Error).message}) — symbols were extracted with the regex fallback, so they are less precise.`;
    return grammarNote;
  }
  if (resolveGrammarsTier().tier === "none") {
    grammarNote = "tree-sitter grammars unavailable — symbols were extracted with the regex fallback, so they are less precise.";
  }
  return grammarNote;
}

// Test seam: forget that the warm-up already ran.
export function resetGrammarWarmup(): void {
  grammarsTried = false;
  grammarNote = undefined;
}

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

const WRITE_TOOL_NAMES = new Set(["ultraindex_build", "ultraindex_embed"]);
// Tools that never touch the tree-sitter grammars, so they need not pay for the
// warm-up. Everything that re-parses source does.
const GRAMMARLESS = new Set([
  "ultraindex_map",
  "ultraindex_status",
  "ultraindex_read",
  "ultraindex_check",
  "ultraindex_verify",
  "ultraindex_symbols",
  "ultraindex_neighbors",
  "ultraindex_impact",
]);

export async function callTool(name: string, args: Record<string, unknown>, defaults: HandlerDefaults = {}): Promise<ToolOutcome> {
  if (WRITE_TOOL_NAMES.has(name) && !defaults.allowWrite) {
    throw new ToolError(`${name} writes to your repository and is disabled — start the server with --allow-write to enable it.`);
  }

  const repo = requiredRepo(args, defaults);
  const out = resolveOut(args, repo);
  const notes: string[] = [];
  if (!GRAMMARLESS.has(name)) {
    const note = await warmGrammars();
    if (note) notes.push(note);
  }

  // Serialized per index directory: a long-lived server can have two calls
  // rebuilding or embedding the same index at once, which the one-shot CLI
  // never had to survive.
  const result = await withIndexLock(out, () => callIndexTool(name, args, repo, out));
  return outcome(name, notes.length ? { ...(result as object), notes } : result);
}

function outcome(name: string, result: unknown): ToolOutcome {
  return { text: JSON.stringify(result, null, 2) + "\n", artifact: artifactFor(name, result) };
}

// Where an oversized result already exists on disk, so an over-cap refusal can
// point at it instead of just saying no.
function artifactFor(name: string, result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as Record<string, unknown>;
  if (name === "ultraindex_map" || name === "ultraindex_build") return typeof r.index_md === "string" ? r.index_md : undefined;
  return undefined;
}

async function callIndexTool(name: string, args: Record<string, unknown>, repo: string, out: string): Promise<unknown> {
  switch (name) {
    case "ultraindex_build":
      return handleBuild(args, repo, out);
    case "ultraindex_embed":
      return await handleEmbed(args, repo, out);
    case "ultraindex_map":
      return handleMap(args, repo, out);
    case "ultraindex_find":
      return await handleFind(args, repo, out);
    case "ultraindex_ask":
      return await handleAsk(args, repo, out);
    case "ultraindex_dossier":
      return handleDossier(args, repo, out);
    case "ultraindex_symbols":
      return handleSymbols(args, repo, out);
    case "ultraindex_neighbors":
      return handleNeighbors(args, repo, out);
    case "ultraindex_impact":
      return handleImpact(args, repo, out);
    case "ultraindex_delta":
      return handleDelta(args, repo, out);
    case "ultraindex_status":
      return handleStatus(repo, out);
    case "ultraindex_read":
      return handleRead(args, repo, out);
    case "ultraindex_check":
      return handleCheck(args, repo, out);
    case "ultraindex_verify":
      return handleVerify(args, repo, out);
    default:
      // Unreachable: the server rejects an unknown tool before dispatch.
      throw new ToolError(`unknown tool: ${name}`);
  }
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------

function handleBuild(args: Record<string, unknown>, repo: string, out: string): unknown {
  const { graph, manifest, capped } = runBuild(
    {
      repo,
      out,
      include: strArray(args.include),
      exclude: strArray(args.exclude),
      maxBytes: positive(args.max_bytes, "max_bytes"),
      maxFiles: positive(args.max_files, "max_files"),
      noCache: bool(args.no_cache),
      ...(bool(args.no_gitignore) ? { gitignore: false } : {}),
      mermaid: true,
      json: true,
    },
    new Date().toISOString(),
  );

  const dangling = graph.fileEdges.filter((e) => e.dangling).length;
  return {
    out,
    repo,
    index_md: join(out, "INDEX.md"),
    modules: graph.modules.length,
    files: Object.keys(manifest.fileHashes).length,
    edges: graph.fileEdges.length,
    dangling_edges: dangling,
    capped: capped ?? false,
    next: `Read the map with ultraindex_map, or start enrichment from ultraindex_status.`,
  };
}

async function handleEmbed(args: Record<string, unknown>, repo: string, out: string): Promise<unknown> {
  requireIndex(out, repo);
  const tier = resolveEmbedTier(repo);
  if (!tier) {
    throw new ToolError(
      "no embedding backend is reachable — ultraindex_find and ultraindex_ask will keep ranking lexically, which is a different ranking, not a broken one.",
    );
  }
  const report = await runEmbed(out, tier, bool(args.force));
  if (!report) throw new ToolError(`no index at ${out} — build one first with ultraindex_build.`);
  return { out, tier: tier.label, ...report };
}

function handleMap(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const slug = str(args.module);
  const content = runMap(out, slug);
  if (content === undefined) {
    throw new ToolError(slug ? `no module entry for "${slug}" — list them with ultraindex_map (no module).` : `no index at ${out}.`);
  }
  return { out, module: slug ?? null, index_md: join(out, "INDEX.md"), content };
}

async function handleFind(args: Record<string, unknown>, repo: string, out: string): Promise<unknown> {
  requireIndex(out, repo);
  const query = requiredStr(args, "query", "the task or question to rank modules against.");
  const found = await runFindHybrid(out, query, positive(args.k, "k") ?? 8, repo);
  if (!found) throw new ToolError(`no index at ${out} — build one first with ultraindex_build.`);
  return {
    out,
    query,
    // A lexical-only ranking because no vectors exist is not a failure; it is a
    // fact about this answer's recall, and the caller should see it.
    ...(found.warning ? { note: found.warning } : {}),
    results: found.results.map((r) => ({ slug: r.slug, score: r.score, files: r.files })),
  };
}

async function handleAsk(args: Record<string, unknown>, repo: string, out: string): Promise<unknown> {
  requireIndex(out, repo);
  const question = requiredStr(args, "question", "the question to gather evidence for.");
  const res = await runAsk(out, repo, question, positive(args.k, "k") ?? 5, positive(args.budget, "budget"));
  if (!res) throw new ToolError(`no index at ${out} — build one first with ultraindex_build.`);
  return {
    out,
    question,
    modules: res.modules,
    ...(res.warning ? { note: res.warning } : {}),
    evidence: res.content,
    next: "Write the answer from this evidence, citing [file:line], then prove it with ultraindex_check.",
  };
}

function handleDossier(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const slug = requiredStr(args, "slug", "the module slug, from ultraindex_status or ultraindex_map.");
  const content = runDossier(out, repo, slug, positive(args.budget, "budget"));
  if (content === undefined) throw new ToolError(`no module "${slug}" in the index — list them with ultraindex_map.`);
  return {
    out,
    slug,
    dossier: content,
    next: "Write this module's analysis from the source above, citing [file:line], then prove it with ultraindex_check.",
  };
}

function handleSymbols(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const name = requiredStr(args, "name", "the exact symbol name to resolve.");
  const res = runSymbols(out, name);
  if (!res) throw new ToolError(`no index at ${out} — build one first with ultraindex_build.`);
  return { out, name, ...res };
}

function handleNeighbors(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const target = requiredStr(args, "target", "a repo-relative file path or a module slug.");
  const kind = str(args.kind);
  const res = runNeighbors(out, target, positive(args.depth, "depth") ?? 1, kind ? new Set([kind]) : undefined);
  if (!res) throw new ToolError(`nothing in the index matches "${target}" — check the path or slug with ultraindex_map.`);
  return { out, ...res };
}

function handleImpact(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const target = requiredStr(args, "target", "a repo-relative file path or a module slug.");
  const res = runImpact(out, target, positive(args.depth, "depth") ?? Number.POSITIVE_INFINITY);
  if (!res) throw new ToolError(`nothing in the index matches "${target}" — check the path or slug with ultraindex_map.`);
  return { out, ...res };
}

function handleDelta(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const res = runDelta(out, repo, { base: str(args.base), staged: bool(args.staged), depth: positive(args.depth, "depth") });
  if ("error" in res) throw new ToolError(String(res.error));
  return { out, panel: formatDeltaPanel(res), ...res };
}

function handleStatus(repo: string, out: string): unknown {
  requireIndex(out, repo);
  const res = runStatus(out);
  if (!res) throw new ToolError(`no index at ${out} — build one first with ultraindex_build.`);
  return { out, ...res };
}

function handleCheck(args: Record<string, unknown>, repo: string, out: string): unknown {
  requireIndex(out, repo);
  const answerText = str(args.answer_text);
  const answerFile = str(args.answer_file);

  // With no answer at all, `check` is the index-freshness gate — the CLI's
  // plain `check`. That is a real use, not a missing argument.
  if (!answerText && !answerFile) {
    const res = runCheck(out, repo, { prose: bool(args.prose) });
    return { out, mode: "index", ...res };
  }

  if (answerText && answerFile) throw new ToolError("pass `answer_text` or `answer_file`, not both.");
  if (answerFile && !isAbsolute(answerFile)) throw new ToolError("`answer_file` must be an absolute path.");

  const res = checkAnswer(out, answerFile ?? "<inline>", {
    semantic: bool(args.semantic),
    repo,
    ...(answerText ? { answerText } : {}),
  });
  // ok:false is a verdict, not a failure: the tool did its job and the answer
  // did not pass. Reporting it as an error would tell the model the gate is
  // broken instead of that its answer is.
  return { out, mode: "answer", answer_source: answerText ? "inline" : "file", ...res };
}

function handleVerify(args: Record<string, unknown>, repo: string, out: string): unknown {
  // No index needed: buildClaimPairs resolves each citation by reading the
  // repo file it names. Requiring one here would refuse a legitimate call for
  // a reason that isn't true.
  const answerText = requiredStr(args, "answer_text", "the answer to build the claim worklist from.");
  const max = Math.max(1, Math.floor(positive(args.max_verify, "max_verify") ?? VERIFY_MAX));
  const pairs = buildClaimPairs(answerText, repo);
  const kept = pairs.length > max ? pairs.slice(0, max) : pairs;
  return {
    out,
    total_pairs: pairs.length,
    emitted: kept.length,
    ...(pairs.length > kept.length ? { note: `${pairs.length - kept.length} pair(s) beyond max_verify were dropped — raise \`max_verify\` to see them.` } : {}),
    pairs: kept,
    next: "For each pair, read the cited excerpt and judge it supported / partial / refuted / unsupported. Rewrite any claim its evidence does not carry.",
  };
}

function handleRead(args: Record<string, unknown>, repo: string, out: string): unknown {
  const raw = requiredStr(args, "path", "a repo-relative path, or an absolute path inside the repo or its index.");
  const target = isAbsolute(raw) ? raw : join(repo, raw);

  // Containment on the REALPATH: a symlink inside the repo pointing at
  // ~/.ssh normalises cleanly as a string and only escapes once the
  // filesystem resolves it. This server can be reached over HTTP.
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    throw new ToolError(`no such file: ${raw}`);
  }
  const allowed = [repo, out].map((d) => {
    try {
      return realpathSync(d);
    } catch {
      return resolve(d);
    }
  });
  if (!allowed.some((root) => real === root || real.startsWith(root + sep))) {
    throw new ToolError(`path is outside the repo and its index: ${raw}. Use your own file tool for anything else.`);
  }

  const st = statSync(real);
  if (!st.isFile()) throw new ToolError(`not a file: ${raw}`);
  if (st.size > MAX_READ_BYTES) throw new ToolError(`file is too large to read (${st.size} bytes): ${raw}`);

  const lines = readFileSync(real, "utf8").split("\n");
  const total = lines.length;
  const start = Math.max(1, Math.floor(num(args.start_line) ?? 1));
  if (start > total) throw new ToolError(`start_line ${start} is past the end of the file (${total} lines).`);
  const requestedEnd = Math.floor(num(args.end_line) ?? total);
  const end = Math.min(total, Math.max(start, requestedEnd), start + MAX_READ_LINES - 1);

  return {
    path: isAbsolute(raw) ? real : raw,
    start_line: start,
    end_line: end,
    total_lines: total,
    truncated: end < Math.min(total, requestedEnd),
    content: lines.slice(start - 1, end).join("\n"),
  };
}

// Re-exported so the manifest helper stays available to callers that only
// import handlers — the CLI resolves a repo root from it the same way.
export { loadManifest };
