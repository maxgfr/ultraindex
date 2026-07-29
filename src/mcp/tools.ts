import { ANNOTATIONS_SINCE, RICH_TOOLS_SINCE, type JsonSchema, type JsonSchemaProp, type ProtocolVersion } from "./protocol.js";

// What the server advertises. Pure data — nothing here imports the index
// pipeline, so the declarations can be asserted in a test without building
// anything. handlers.ts is where these names become work.

export interface ToolDecl {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  title?: string;
  outputSchema?: JsonSchema;
  annotations?: Record<string, boolean>;
}

const repoProp: JsonSchemaProp = {
  type: "string",
  description: "Absolute path to the repository root.",
};
const outProp: JsonSchemaProp = {
  type: "string",
  description: "The index directory. Defaults to <repo>/.ultraindex, then <repo>/docs/ultraindex, whichever exists.",
};
const depthProp: JsonSchemaProp = { type: "number", description: "How many graph hops to follow (default: unbounded)." };
const budgetProp: JsonSchemaProp = {
  type: "number",
  description: "Rough character budget for the inlined source. Lower it when the packet is bigger than you need.",
};

// The line every read tool carries. ultraindex answers from an index that must
// exist first, and a model that does not know this reads "no index" as a broken
// tool rather than as a missing step.
const INDEX_NOTE = "Requires an index: run ultraindex_build once per repo first (it is incremental afterwards).";

export const TOOLS: ToolDecl[] = [
  {
    name: "ultraindex_map",
    title: "Read the encyclopedia map",
    description:
      "Get the repo's INDEX.md — the small always-loadable map naming every module, what it does and how the modules link — or one module's full entry with " +
      "`module`. Read this FIRST when you do not yet know how the repo is organised; it is what lets you work in a codebase too big to hold in context. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: { repo: repoProp, out: outProp, module: { type: "string", description: "A module slug — print that entry instead of the whole map." } },
      required: ["repo"],
    },
  },
  {
    name: "ultraindex_find",
    title: "Find the modules a task touches",
    description:
      "Rank the repo's modules against a task or question and return the exact files to open. This is the 'which files do I change for X' tool. Hybrid " +
      "lexical+semantic when vectors exist (see ultraindex_embed), pure lexical otherwise — which is never a failure, only a different ranking. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        query: { type: "string", description: "The task or question, in natural language." },
        k: { type: "number", description: "How many modules to return (default 8)." },
      },
      required: ["repo", "query"],
    },
  },
  {
    name: "ultraindex_ask",
    title: "Assemble evidence for a question",
    description:
      "Retrieve the real source needed to answer a question about this repo: the ranked modules plus their actual code, assembled into one grounding " +
      "packet. Returns EVIDENCE, not an answer — you write the answer from it, citing [file:line], and prove it with ultraindex_check. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        question: { type: "string", description: "The question to gather evidence for." },
        k: { type: "number", description: "How many modules to draw source from (default 5)." },
        budget: budgetProp,
      },
      required: ["repo", "question"],
    },
  },
  {
    name: "ultraindex_dossier",
    title: "Grounding packet for one module",
    description:
      "Get one module's real source plus its graph neighbours, assembled for writing that module's analysis. This is the input to enrichment: read it, " +
      "then write the business-level prose the engine cannot infer, citing [file:line]. Use ultraindex_status to find which module needs it. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: { repo: repoProp, out: outProp, slug: { type: "string", description: "The module slug (from ultraindex_status or ultraindex_map)." }, budget: budgetProp },
      required: ["repo", "slug"],
    },
  },
  {
    name: "ultraindex_symbols",
    title: "Resolve a symbol",
    description:
      "Find where a symbol is DECLARED — file:line, kind, owning module — and which files reference it, straight from the symbol index with no repo " +
      "re-scan. The tool for 'where is X defined', 'who uses X', 'is X dead code'. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: { repo: repoProp, out: outProp, name: { type: "string", description: "The exact symbol name (function, class, method, type, const)." } },
      required: ["repo", "name"],
    },
  },
  {
    name: "ultraindex_neighbors",
    title: "Graph neighbours of a file or module",
    description: "Show what links TO and FROM a file or module — imports, calls, references — as typed edges. Use it to see a unit's real coupling. " + INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        target: { type: "string", description: "A repo-relative file path or a module slug." },
        depth: depthProp,
        kind: { type: "string", description: "Keep only edges of this kind (e.g. import, call)." },
      },
      required: ["repo", "target"],
    },
  },
  {
    name: "ultraindex_impact",
    title: "Blast radius of a change",
    description:
      "The reverse-dependency closure: every file that transitively imports or calls the target, grouped by module. This is 'what breaks if I change this', " +
      "answered from the graph rather than guessed. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: { repo: repoProp, out: outProp, target: { type: "string", description: "A repo-relative file path or a module slug." }, depth: depthProp },
      required: ["repo", "target"],
    },
  },
  {
    name: "ultraindex_delta",
    title: "Risk-scored review panel for a diff",
    description:
      "Map a git diff onto the index: changed files → the symbols they touch → the blast radius of each, scored by risk. The tool for reviewing a branch or " +
      "a PR — it tells you what the diff actually reaches, not just what it edits. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        base: { type: "string", description: "Diff against the merge-base with this ref (e.g. main)." },
        staged: { type: "boolean", description: "Review the staged changes instead of a ref diff." },
        depth: depthProp,
      },
      required: ["repo"],
    },
  },
  {
    name: "ultraindex_status",
    title: "The enrichment work-queue",
    description:
      "What still needs human-level analysis, in priority order: which modules have generated structure but no written prose, and which prose has gone " +
      "stale against the code. Start an enrichment session here. " +
      INDEX_NOTE,
    inputSchema: { type: "object", properties: { repo: repoProp, out: outProp }, required: ["repo"] },
  },
  {
    name: "ultraindex_read",
    title: "Read a file from the indexed repo",
    description:
      "Read a file, or a line range of one, from the repository this index was built against. Use it to widen an excerpt that ultraindex_ask or " +
      "ultraindex_dossier returned. Reads are confined to the repo and its index directory — anything else is your own file tool's job.",
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        path: { type: "string", description: "Repo-relative path (e.g. 'src/index.ts'), or an absolute path inside the repo or its index directory." },
        start_line: { type: "number", description: "First line to return, 1-based (default 1)." },
        end_line: { type: "number", description: "Last line to return, inclusive (default: end of file, capped)." },
      },
      required: ["repo", "path"],
    },
    outputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        end_line: { type: "number" },
        total_lines: { type: "number" },
        truncated: { type: "boolean" },
        content: { type: "string" },
      },
      required: ["path", "start_line", "end_line", "total_lines", "truncated", "content"],
    },
  },
  {
    name: "ultraindex_check",
    title: "Validate an answer's citations",
    description:
      "The grounding gate. Prove every [file:line] in your answer resolves to a real line of the indexed repo, and report the index's own freshness. Pass " +
      "the answer inline as answer_text. A result with ok:false is a real verdict, not a tool failure — read `errors`, fix the answer, and check again. " +
      INDEX_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        answer_text: { type: "string", description: "The answer to validate, citing [file:line]. Omit to check the index's freshness only." },
        answer_file: { type: "string", description: "Absolute path to an answer file to validate instead of answer_text." },
        semantic: { type: "boolean", description: "Also fold in recorded verify verdicts, failing on a refuted or unsupported claim." },
        prose: { type: "boolean", description: "Promote stale enriched prose from a warning to a failure." },
      },
      required: ["repo"],
    },
  },
  {
    name: "ultraindex_verify",
    title: "Build a claim-support worklist",
    description:
      "Go past 'the citation resolves' to 'the cited code actually supports the claim'. Emits a deterministic claim-by-citation worklist from your answer, " +
      "for you to adjudicate each pair as supported / partial / refuted / unsupported. Returns the worklist; nothing is written to disk.",
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: outProp,
        answer_text: { type: "string", description: "The answer to build the worklist from, citing [file:line]." },
        max_verify: { type: "number", description: "Cap on the number of claim/citation pairs emitted (default 40)." },
      },
      required: ["repo", "answer_text"],
    },
  },
];

// Registered only when the server is started with --allow-write. Both of these
// write into the USER'S repository, which is where the read-only line is drawn
// — not at whether the tool happens to touch a disk.
export const WRITE_TOOLS: ToolDecl[] = [
  {
    name: "ultraindex_build",
    title: "Build or refresh the index",
    description:
      "WRITES TO THE REPO: scans the repository and (re)writes the layered index into <repo>/.ultraindex — INDEX.md, per-module entries, the typed link " +
      "graph and the symbol table. Idempotent and incremental: generated regions are rebuilt every time, and prose YOU wrote is preserved across rebuilds " +
      "and renames. Run once before any other tool; expect seconds to minutes on a large repo.",
    inputSchema: {
      type: "object",
      properties: {
        repo: repoProp,
        out: { type: "string", description: "Where to write the index (default <repo>/.ultraindex)." },
        include: { type: "array", items: { type: "string" }, description: "Glob(s) to restrict the scan to." },
        exclude: { type: "array", items: { type: "string" }, description: "Glob(s) to skip." },
        max_bytes: { type: "number", description: "Skip files larger than this." },
        max_files: { type: "number", description: "Stop after this many files." },
        no_cache: { type: "boolean", description: "Ignore the incremental cache and rescan everything." },
        no_gitignore: { type: "boolean", description: "Do not honour .gitignore." },
      },
      required: ["repo"],
    },
  },
  {
    name: "ultraindex_embed",
    title: "Build the semantic vectors",
    description:
      "WRITES TO THE INDEX: embeds each module through a keyless local model so ultraindex_find and ultraindex_ask can match on meaning rather than " +
      "wording. Incremental — unchanged modules keep their vectors. The first run on a machine downloads the model. Everything stays local.",
    inputSchema: {
      type: "object",
      properties: { repo: repoProp, out: outProp, force: { type: "boolean", description: "Re-embed every module, not just the stale ones." } },
      required: ["repo"],
    },
  },
];

// Behavioural hints clients use to decide what needs a confirmation prompt.
//
// The read-only line is drawn at the USER'S repository. Every tool in TOOLS
// reads an index that already exists and writes nothing; `build` and `embed`
// create files inside the user's tree, so they are writes even though neither
// destroys anything a person authored — `build` explicitly preserves it.
export const TOOL_META: Record<string, { write?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }> = {
  ultraindex_map: { openWorld: false },
  ultraindex_find: { openWorld: false },
  ultraindex_ask: { openWorld: false },
  ultraindex_dossier: { openWorld: false },
  ultraindex_symbols: { openWorld: false },
  ultraindex_neighbors: { openWorld: false },
  ultraindex_impact: { openWorld: false },
  ultraindex_delta: { openWorld: false },
  ultraindex_status: { openWorld: false },
  ultraindex_read: { openWorld: false },
  ultraindex_check: { openWorld: false },
  ultraindex_verify: { openWorld: false },
  ultraindex_build: { write: true, destructive: false, idempotent: true, openWorld: false },
  // Not idempotent in the sense clients care about: the first call on a machine
  // reaches the network to pull the model.
  ultraindex_embed: { write: true, destructive: false, idempotent: false, openWorld: true },
};

export function annotationsFor(name: string): Record<string, boolean> | undefined {
  const meta = TOOL_META[name];
  if (!meta) return undefined;
  return {
    readOnlyHint: !meta.write,
    ...(meta.write ? { destructiveHint: meta.destructive === true, idempotentHint: meta.idempotent === true } : {}),
    openWorldHint: meta.openWorld === true,
  };
}

export interface ToolsForOptions {
  defaultRepo?: string;
  allowWrite?: boolean;
}

// The tool list as one client should see it: gated on what the server was
// started with, and on how new the negotiated protocol is.
export function toolsFor(protocolVersion: ProtocolVersion, opts: ToolsForOptions = {}): ToolDecl[] {
  const base = opts.allowWrite ? [...TOOLS, ...WRITE_TOOLS] : TOOLS;
  const withAnnotations = protocolVersion >= ANNOTATIONS_SINCE;
  const withRich = protocolVersion >= RICH_TOOLS_SINCE;

  return base.map((t) => {
    const decl: ToolDecl = {
      name: t.name,
      description: t.description,
      inputSchema: applyDefaultRepo(t.inputSchema, opts.defaultRepo),
    };
    if (withRich && t.title) decl.title = t.title;
    if (withRich && t.outputSchema) decl.outputSchema = t.outputSchema;
    if (withAnnotations) {
      const a = annotationsFor(t.name);
      if (a) decl.annotations = a;
    }
    return decl;
  });
}

// With a server-level default repo, `repo` stops being required and its
// description names the default — so a client can call every tool with no repo
// argument at all.
function applyDefaultRepo(schema: JsonSchema, defaultRepo?: string): JsonSchema {
  const existing = schema.properties.repo;
  if (!defaultRepo || !existing) return schema;
  return {
    type: "object",
    properties: {
      ...schema.properties,
      repo: { ...existing, description: `${existing.description} Optional — defaults to ${defaultRepo}.` },
    },
    required: schema.required.filter((r) => r !== "repo"),
  };
}
