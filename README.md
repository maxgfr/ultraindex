# ultraindex

> **[codeindex](https://github.com/maxgfr/codeindex) tells you where things are.
> ultraindex tells you what they mean — and proves it.**
>
> The verified knowledge layer an AI agent writes on top of the codeindex
> engine: a durable, per-module encyclopedia of what a repo *means*, where every
> sentence must cite real source and every citation is mechanically checked.

Search answers questions whose answers are already in the code. *Why does this
module exist? What breaks in the product if it's wrong?* — nobody wrote that
down. A model has to work it out, and then it has to live somewhere that
survives the session, the context window, and the next refactor.

That is what `ultraindex` builds: a *layered* artifact you load piece by piece,
whose prose regions the model owns and the tooling refuses to let it fake.

```
.ultraindex/
  INDEX.md              # the map — always-loadable: summary, hubs, bridges, tests, module table
  encyclopedia/
    <module>.md         # per-module entry: business view + code view + links + sources
    _orphaned/<m>.md    # prose of a module that disappeared — kept, never deleted
  graph.json            # the full typed link-graph (file + module level)
  symbols.json          # symbol → definition sites + referencing files (`symbols` cmd)
  graph.mmd             # a Mermaid module diagram
  manifest.json         # per-file hashes (staleness) + merge bookkeeping
  cache.json            # incremental-build extraction cache (regenerable; gitignore for committed indexes)
  vectors.json          # optional per-module embeddings (`embed`, keyless)
  orchestration/        # optional multi-agent fan-out (`orchestrate`): workflows, contracts, RUNBOOK
```

## Two repos, one boundary

ultraindex is built on **[codeindex](https://github.com/maxgfr/codeindex)** and
vendors it verbatim — `src/vendor/codeindex-engine.mjs`, byte-pinned by sha256
in `engine.meta.json`, re-pinned automatically on every codeindex release. The
split between the two projects is a rule, not a habit:

- **codeindex is the engine, and no model is ever in the loop.** Walking the
  repo, extracting symbols (tree-sitter for 13 languages, regex for 15),
  resolving imports across 9 ecosystems, the typed link-graph, PageRank and
  betweenness, Louvain communities, the tests→code map, BM25 and keyless
  deterministic semantic search, SCIP output, repo maps, and its own MCP server.
  Deterministic, zero-dependency, keyless. **If a capability returns the same
  answer whether or not an AI is present, it belongs to codeindex.**

- **ultraindex exists only because a model is in the loop.** Its whole surface
  is about a model's *understanding* of a repo and whether that understanding
  can be trusted: the encyclopedia (durable memory that outlives every context
  window), grounded evidence assembly (`dossier`, `ask`), the citation and
  support-check gates (`check`, `verify`), the enrichment work-queue (`status`),
  multi-agent fan-out (`orchestrate`), and the skill prompt layer. **Nothing
  here would still make sense with no LLM present.**

The rule has a consequence we hold ourselves to: **when ultraindex needs a
deterministic capability, it gets contributed upstream to codeindex rather than
reimplemented here.** That is why ultraindex has no search engine, no parser and
no graph code of its own, why it is small enough to read in an afternoon, and
why "re-pin the engine" is a boring automated event rather than a merge.

**Which one do you want?**

| You want to… | Use |
|---|---|
| Find code, symbols, callers, references, a repo map — fast, offline, no model | **[codeindex](https://github.com/maxgfr/codeindex). You don't need ultraindex.** |
| Have an agent *understand* a codebase, write that understanding down so it survives the session, and be structurally unable to claim anything it can't back with a real `[file:line]` | **ultraindex** |

### Why not just codeindex, or its MCP server?

Use it. codeindex's MCP server is excellent and ultraindex ships the same engine
underneath: 26 deterministic tools answering *where* something is and *what
exists*. Every question already answered by the code, it answers — faster and
more cheaply than any model could.

ultraindex is for the questions whose answers are **not** in the code:

**"Why does this module exist, and what breaks if it's wrong?"** That is
`encyclopedia/<slug>.md`. Generated regions are the engine's and are rebuilt
every time; `ui:human` regions are yours — preserved across every rebuild,
migrated across module renames, and never deleted (a removed module's prose is
kept under `encyclopedia/_orphaned/`).

**"Is that explanation actually true?"** A tool that returns source cannot tell
you whether the paragraph a model wrote *about* it is supported by it. `check`
fails on any `[file:line]` that doesn't resolve — and decorative citations
inside code fences don't count. `verify` goes further: it emits a claim↔citation
worklist, a model adjudicates each pair against the real excerpt, and the gate
re-reduces the verdict from the raw `verdicts[]` while re-reading every excerpt
from the live repo — so a doctored `VERIFY.json` or drifted source fails rather
than passes.

**"What should the model do next, and in what order?"** `status` is a
work-queue ordered by where an explanation buys the most navigation value;
`orchestrate` fans it out to subagents with real contracts and a sequential
fallback. Retrieval has no notion of unfinished work.

Search retrieves. ultraindex **accumulates** — and refuses to accumulate
anything it can't prove.

## Install

It ships as **one [skills.sh](https://skills.sh) agent skill** with a committed
zero-dependency bundle:

```bash
npx skills add maxgfr/ultraindex             # this project
npx skills add maxgfr/ultraindex --global    # user-level, every project
```

The skill installs self-contained (its `SKILL.md` + workflow references + the
committed bundle), so it runs with `node` alone — no `npm install`, no API keys.
Works with Claude Code, Codex, and the other agents the `skills` CLI supports.

The skill **auto-routes** by situation: no index → it builds one; stale index →
it rebuilds (your prose survives); a task or question → it navigates, opening
only the files the index points at and answering with **grounded,
citation-checked** analysis (`dossier`/`ask` hand the agent the real source;
`check` rejects any citation that doesn't resolve).

## Use it as an MCP server

Two servers, along the same boundary as the rest of this README. **codeindex's**
serves the engine's 26 repo-analysis tools — where things are:

```bash
claude mcp add codeindex -- codeindex mcp      # brew install maxgfr/tap/codeindex
```

**ultraindex's** serves the knowledge layer on top — what things mean, and the
protocol that keeps it honest. Different tools, different name, no collision
when a client has both registered:

```bash
# stdio — the default, and what Claude Code / Claude Desktop / Cursor expect
claude mcp add ultraindex -- node /abs/path/to/scripts/ultraindex.mjs mcp

# or over HTTP, on loopback
node scripts/ultraindex.mjs mcp --transport http --port 7338
claude mcp add --transport http ultraindex http://127.0.0.1:7338/mcp
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```jsonc
// Claude Desktop takes stdio servers only — a remote URL here will not work.
{ "mcpServers": { "ultraindex": { "command": "node", "args": ["/abs/path/to/scripts/ultraindex.mjs", "mcp"] } } }
// Cursor, HTTP:
{ "mcpServers": { "ultraindex": { "url": "http://127.0.0.1:7338/mcp" } } }
```

It serves all three MCP primitives, because a skill is three things: the engine
(**tools**), the method (**prompts**), and the documentation the method refers
to (**resources**). A client given only the tools has to invent the rest.

### Tools

Twelve read tools. `ultraindex_map` is the one to reach for first:

| Tool | What it does |
|------|--------------|
| `ultraindex_map` | The always-loadable map, or one module's full entry |
| `ultraindex_find` | Rank modules for a task → the exact files to open |
| `ultraindex_ask` | Ranked modules **plus their real source**, as one grounding packet |
| `ultraindex_dossier` | One module's source + neighbours, for writing its analysis |
| `ultraindex_symbols` | Where a symbol is declared, and which files reference it |
| `ultraindex_neighbors` | Typed graph edges in and out of a file or module |
| `ultraindex_impact` | Reverse-dependency closure — what breaks if this changes |
| `ultraindex_delta` | Risk-scored review panel for a diff |
| `ultraindex_status` | The enrichment work-queue, in priority order |
| `ultraindex_read` | A file, or a line range, from the indexed repo |
| `ultraindex_check` | The grounding gate: every `[file:line]` must resolve |
| `ultraindex_verify` | Claim↔citation worklist for adversarial support-checking |

`--allow-write` additionally exposes `ultraindex_build` and `ultraindex_embed`,
the two tools that write into **your** repository. They are off by default so an
auto-approving agent cannot reach them — which is also where the read-only line
is drawn: at your tree, not at whether a tool touches a disk.

Pass `--repo <dir>` at startup to dedicate the server to one project — `repo`
then becomes optional on every tool.

### Prompts — the workflow, not just the tools

| Prompt | Arguments | What it drives |
|--------|-----------|----------------|
| `enrich_module` | `repo`, `slug?` | Pick the next module off the queue, read its dossier, write the analysis the engine cannot infer, prove it |
| `answer_grounded` | `repo`, `question` | Retrieve real source → cited answer → `ultraindex_check` |
| `review_changes` | `repo`, `base?` | Map the diff onto the graph, review by blast radius rather than line count |

Each carries the division of labour the whole skill rests on: the engine owns
the code view, you own the business view, and every claim cites `[file:line]`.

### Resources — the skill's own documentation

`SKILL.md` and all five `references/*.md` are served under `skill://`, read off
disk at request time — so a documentation fix reaches every client without a
rebuild. A build installed without its payload still serves every tool, with an
empty resource list.

Three things worth knowing:

- **Every read tool needs an index.** Run `ultraindex_build` once per repo
  (`--allow-write`); it is incremental afterwards. Without one, tools fail
  naming the missing step, not with "undefined".
- **`build` and `embed` are serialized per index directory.** Both read, merge
  and write the same files — and `build` explicitly preserves the prose you
  wrote, which two interleaved calls would lose.
- **The HTTP transport binds `127.0.0.1` and refuses anything else** unless you
  pass `--allow-remote`. This server reads local files; an exposed port is a
  read-anything primitive for whoever finds it. Browser `Origin`s are checked
  for the same reason.

## CLI

```
ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--full-hash] [--no-mermaid] [--no-gitignore]
ultraindex find    "<query>" [--out <dir>] [--k <n>]
ultraindex embed   [--out <dir>] [--force]
ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>] [--kind <k>]
ultraindex symbols "<name>" [--out <dir>] [--json]
ultraindex impact  <file|module-slug> [--out <dir>] [--depth <n>] [--json]
ultraindex delta   [--base <ref>] [--staged] [--out <dir>] [--repo <dir>] [--depth <n>] [--json]
ultraindex map     [--out <dir>] [--module <slug>] [--json]
ultraindex status  [--out <dir>]
ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>] [--budget <n>]
ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>] [--budget <n>]
ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>] [--semantic] [--quiet]
ultraindex verify  --answer <file> [--repo <dir>] [--apply <verdicts.json>] [--max-verify <n>]
ultraindex orchestrate [--out <dir>] [--repo <dir>] [--answer <file>] [--phase <name>] [--eco] [--list]
ultraindex grammars [status|pull]
```

- **build** — scan + (re)write the index. Idempotent: regenerates the code view
  and graph, **preserves** your enriched prose (matched by region key even across
  module renames; truly-removed modules' prose is kept under `encyclopedia/_orphaned/`).
  **Incremental**: a rebuild reuses the extraction of files whose content is
  unchanged (`--no-cache` forces a full re-extract). `--max-files` bounds the
  scan and the build **warns** (never silently truncates) when the cap is hit.
- **find** — rank modules for a task and print the **exact files to open**.
  Lexical by default (identifier splitting, light stemming, code-domain
  synonyms, **IDF** term weighting); hybrid lexical + semantic when `vectors.json`
  exists (below).
- **symbols** — where a symbol is defined (file:line, kind, owning module) and
  which files reference it, from `symbols.json` — exact then identifier-sub-token
  match, no repo re-scan.
- **impact** — the reverse dependency closure over import/use edges: everything
  that transitively depends on a file or module ("what breaks if I change this").
- **delta** — map the git diff (merge-base of `--base` vs the worktree, or
  `--staged`) onto the index: changed files → enclosing symbols → blast radius →
  a **risk-scored review panel** with explained reasons (exported API changed,
  PageRank-percentile hub, blast size, test gap, surprising cross-community
  coupling, dangling imports). Needs a fresh index — fails closed when a
  changed file drifted since the build. Empty diff exits 0.
- **embed** — build/refresh `vectors.json` for semantic `find` (optional, no key
  and no provider to run — see below). Incremental: unchanged modules keep their
  vectors.
- **neighbors** — walk the graph from a file or module.
- **map** — print `INDEX.md` (or one module's entry) cheaply.
- **status** — the enrichment work-queue: which modules to enrich next
  (unenriched first, the tail last, most-connected first).
- **dossier** — print a grounding packet for a module (its real key source + graph
  neighbours) so you can write a cited analysis into its entry.
- **ask** — assemble grounded evidence (real source of the relevant modules) for a
  question, so you can answer it with citations.
- **check** — report staleness + integrity + **grounding** (every `[file:line]`
  citation in your prose must resolve). With `--answer <file>`, validate that
  answer's citations instead; add `--semantic` to also fold the verify gate.
  Non-zero exit ⇒ stale, broken, or ungrounded.
- **verify** — the high-assurance gate *above* `check --answer`: emit a
  claim↔citation worklist, adjudicate each (supported / partial / refuted /
  unsupported), then `--apply` reduces the verdicts to a pass/fail — so a cited
  excerpt must actually *support* its claim, not merely resolve.
- **orchestrate** — emit the multi-agent fan-out for the CURRENT index state
  into `<out>/orchestration/`: one workflow script per ready phase (`enrich` =
  the `status` work-queue; `verify-answer` = the claim↔citation worklist), the
  dispatch contracts, and a sequential `RUNBOOK.md` fallback. Deterministic and
  idempotent — re-run it whenever the queue changes.
- **grammars** `[status|pull]` — inspect or pre-warm the tree-sitter wasm cache.
  `build` pulls on first use, so this is only for going offline or diagnostics.

Default output is `<repo>/.ultraindex` (gitignored). Use `--out docs/ultraindex`
to commit a PR-reviewable index — deterministic, byte-stable rebuilds keep diffs small.

## How it works

The **vendored codeindex engine** (no model, no keys) does all the mechanical
work below. None of it is authored here — see [Two repos, one
boundary](#two-repos-one-boundary):

- **Scan** — gitignore-aware walk; per-file extraction of markdown (title /
  headings / links) and code. Symbols come from **tree-sitter** (AST-exact: real
  nesting, precise kinds, structural export) for JS/TS/TSX, Python, Go, Rust,
  Java, C, C++, C#, Ruby, PHP. The grammar wasms are **not shipped in the
  bundle**: the first `build` on a machine pulls them (~17 MiB) into a shared
  cache (`<XDG_CACHE_HOME|~/.cache>/codeindex/grammars/<engine>/`),
  sha256-verified, and reuses them forever — so AST precision is on by default
  after one download, with no `npm install` at skill-use time and a much smaller
  installed skill. **Offline** with no cache yet ⇒ `build` says so and indexes
  with the regex extractor (never a silent downgrade); pre-warm with
  `ultraindex grammars pull`. Other languages use the regex extractors anyway.
  Barrel re-exports, top doc-comment and local imports come along too.
- **Resolve** — markdown relative links, and local imports for **JS/TS** (incl.
  `tsconfig` path aliases — even Nx-style root `tsconfig.base.json` — and
  **workspace packages** with their `exports` maps → in-repo source), **Python**,
  **Go** (multi-module `go.mod` incl. `replace` directives), **Rust**
  (`mod`/`use`, cross-crate), **Java** (package → source-root mapping),
  **C/C++** (`#include "..."`), **Ruby** (`require_relative`/`require`), **PHP**
  (composer PSR-4 + relative `require`) and **C#** (`using` → `namespace`). Plus
  conservative code→code **`use`** edges when a file references another file's
  unique exported symbol without importing it. Unresolved local targets become
  **dangling** edges (surfaced, never silently dropped); third-party/stdlib and
  asset imports are external (no edge).
- **Graph** — typed edges (`import`, `call`, `use`, `doc-link`, conservative
  `mention` — the set `neighbors --kind` filters on),
  file-level and lifted to module level; deterministic **PageRank** ranks the
  hubs and **Brandes betweenness** finds the bridges between subsystems, a
  derived **tests→code** map records which tests cover each module, and Louvain
  communities flag **surprising** near-unique cross-community couplings.
- **Render** — a budgeted `INDEX.md`, per-module entries split into tool-owned
  `ui:gen` regions and author-owned `ui:human` regions, plus `graph.json` /
  `graph.mmd` / `manifest.json`.

Then a **grounded AI layer** (this skill, via the agent) adds the *understanding*:
`dossier`/`ask` hand the agent the real source, it writes business analysis /
answers that cite `[file:line]`, and `check` mechanically **rejects any citation
that doesn't resolve** — the anti-hallucination guard (ultradoc's model, applied
to a local index). Citations inside code fences / inline code / markdown links
don't count, so a decorative cite can't satisfy the gate. For high-assurance
answers an optional **verify** gate goes further — `check --answer --semantic`
folds adjudicated verdicts and fails a claim whose cited excerpt refutes it (or,
once fully adjudicated, supports it nowhere), not merely that it resolves. The
gate takes nothing on file at its word: the verdict is re-reduced from the raw
`verdicts[]` on every check (a doctored summary can't pass), every adjudicated
excerpt is re-read from the live repo and compared with the digest that was
judged (content drift fails), and coverage is matched by identity, not count.

ripgrep is used when present (faster); without it a built-in scanner is used.
Without `git`, the manifest just omits the commit. Two builds of an unchanged repo
are byte-identical (apart from `manifest.json`'s `builtAt` provenance timestamp).

`find` is purely lexical but smarter than substring matching: queries split
camelCase/snake_case identifiers (`getUserProfile` finds `src/user/profile.ts`),
a conservative stemmer bridges plural/-ing variants, and a small code-domain
synonym table bridges `auth`↔`authentication`↔`login` — all deterministic,
offline, dependency-free.

## Measured cost of an explained, grounded answer

`evals/token-savings/run.mjs` meters what ultraindex alone provides. It used to
compare `symbols`/`impact` against ripgrep — but that is *retrieval*, which is
the codeindex engine's job and is benchmarked
[there](https://github.com/maxgfr/codeindex/blob/main/BENCHMARKS.md). Measuring
it here was crediting ultraindex with the engine's work.

What it measures now: the tokens an agent spends reaching an **explained** and
**founded** answer, counting every byte it would read (tokens = ceil(chars/4)),
against a naive read-the-source baseline. Run on **this repository**:

| Task | ultraindex tokens | baseline tokens | ratio (baseline / ultraindex) |
| --- | ---: | ---: | ---: |
| what does module `src` do, and why does it exist | 3 863 | 185 854 | 48.1× |
| how does the citation grounding gate work | 20 324 | 716 976 | 35.3× |
| **total** | **24 187** | **902 830** | **37.3×** |

Two things that table deliberately does not flatter:

- **It understates the first row.** After 185 854 tokens the baseline has read
  every file and still cannot say *why* the module exists — that is nowhere in
  the source. The entry answers it in 3 863.
- **On a small repo ultraindex LOSES, and the eval says so.** On the pinned
  fixture (`tests/fixtures/mini-repo`, 14 tiny files) the total is **0.43×** —
  the index costs more than the thing it indexes. The run prints that verdict
  rather than hiding it. If a repo fits in your context window, you do not need
  this tool.

The grounding gate is reported as a capability, not a ratio: a resolvable
citation exits 0, an unresolvable one exits 1, and the baseline has no
equivalent — a search tool has nothing to check a claim against. Inventing a
speedup there would be exactly the unearned claim this project exists to
prevent.

One-off costs are never folded into a task: index build ~600 ms / 86 output
tokens on this repo, plus the enrichment pass itself.

Reproduce with `node evals/token-savings/run.mjs` (defaults pin the fixture;
`--repo <dir> --module <slug> --module-path <dir> --question "<q>"` retarget it).

## Semantic search (optional, keyless)

Lexical search can't bridge a real vocabulary gap ("invoicing" vs a module that
only ever says "billing"). The optional semantic layer embeds each module and
makes `find` **hybrid**: lexical and semantic rankings fused with Reciprocal
Rank Fusion. It is strictly additive — without it, nothing changes.

There is **no API key and no provider to stand up**. The embedding tiers belong
to the vendored codeindex engine; ultraindex only decides what gets embedded —
one vector per module, folding in the prose you wrote, which is the one signal a
file-level index cannot have.

```bash
ultraindex embed                # pulls the keyless model on first use, writes vectors.json
ultraindex find "invoicing"     # now hybrid — results carry semanticRank
```

Precedence is the engine's: **endpoint > static > none**. Prefer a richer local
model? `codeindex embed serve` prints the container one-liner; then set
`CODEINDEX_EMBED_ENDPOINT` — setting it is explicit intent, so it wins over the
local model.

Degradation is graceful: endpoint unreachable ⇒ lexical-only results + a stderr
warning; no `vectors.json` ⇒ pure lexical, silent, zero network (delete the file
to switch the layer off). `check` warns when vectors drift stale.
**Reproducibility:** `manifest.json` is the only artifact outside the
byte-identical rebuild guarantee (its `builtAt` timestamp). `vectors.json` is
*inside* it on the static tier — the encoder is a pure lookup table with
banker's rounding and integer ranking. Only the endpoint tier, whose floats come
from a server, falls outside.

## Develop

```
pnpm install
pnpm build        # tsup → scripts/ultraindex.mjs, mirrored into the skill dir
pnpm test         # vitest
pnpm typecheck
pnpm check:build  # asserts the committed bundles are reproducible
```

Releases are Conventional-Commit-driven via semantic-release (GitHub releases).

## License

MIT
