# ultraindex

> Deterministically index a whole repo (code **+** docs) into a navigable
> encyclopedia — a small map, per-module entries, and a typed link-graph — so an
> AI can work in huge codebases **without filling its context window**.

On a large project the model's context fills before it can find what matters.
`ultraindex` scans the entire repo **with code** (a zero-dependency Node bundle —
no `npm install`, no API keys, no LLM read of the repo) and writes a *layered*
artifact you load piece by piece:

```
.ultraindex/
  INDEX.md              # the map — always-loadable: summary, hubs, bridges, tests, module table
  encyclopedia/
    <module>.md         # per-module entry: business view + code view + links + sources
  graph.json            # the full typed link-graph (file + module level)
  symbols.json          # symbol → definition sites + referencing files (`symbols` cmd)
  graph.mmd             # a Mermaid module diagram
  manifest.json         # per-file hashes (staleness) + merge bookkeeping
  cache.json            # incremental-build extraction cache (regenerable; gitignore for committed indexes)
```

## Install

It ships as **one [skills.sh](https://skills.sh) agent skill** with a committed
zero-dependency bundle:

```bash
npx skills add maxgfr/ultraindex             # this project
npx skills add maxgfr/ultraindex --global    # user-level, every project
```

The skill installs self-contained (its `SKILL.md` + workflow references + the
committed bundle), so it runs with `node` alone — no `npm install`, no API keys.
Works with Claude Code and the other agents the `skills` CLI supports.

The skill **auto-routes** by situation: no index → it builds one; stale index →
it rebuilds (your prose survives); a task or question → it navigates, opening
only the files the index points at and answering with **grounded,
citation-checked** analysis (`dossier`/`ask` hand the agent the real source;
`check` rejects any citation that doesn't resolve).

## CLI

```
ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--no-mermaid]
ultraindex find    "<query>" [--out <dir>] [--k <n>]
ultraindex embed   [--out <dir>] [--force]
ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
ultraindex symbols "<name>" [--out <dir>] [--json]
ultraindex impact  <file|module-slug> [--out <dir>] [--depth <n>] [--json]
ultraindex delta   [--base <ref>] [--staged] [--out <dir>] [--repo <dir>] [--depth <n>] [--json]
ultraindex map     [--out <dir>] [--module <slug>]
ultraindex status  [--out <dir>]
ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>]
ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>]
ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>] [--semantic]
ultraindex verify  --answer <file> [--repo <dir>] [--apply <verdicts.json>] [--max-verify <n>]
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
- **embed** — build/refresh `vectors.json` for semantic `find` (optional, needs
  a provider — see below). Incremental: unchanged modules keep their vectors.
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

Default output is `<repo>/.ultraindex` (gitignored). Use `--out docs/ultraindex`
to commit a PR-reviewable index — deterministic, byte-stable rebuilds keep diffs small.

## How it works

A **deterministic engine** (no model, no network) does the mechanical work:

- **Scan** — gitignore-aware walk; per-file extraction of markdown (title /
  headings / links) and code. Symbols come from **tree-sitter** (AST-exact: real
  nesting, precise kinds, structural export) for JS/TS/TSX, Python, Go, Rust,
  Java, C, C++, C#, Ruby, PHP — the grammar wasms ship **in the bundle** (still no
  `npm install` at skill-use time; the install is ~17 MiB heavier). Other
  languages fall back to the regex extractors. Barrel re-exports, top doc-comment
  and local imports come along too.
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
- **Graph** — typed edges (`doc-link`, `import`, conservative `mention`),
  file-level and lifted to module level; deterministic **PageRank** ranks the
  hubs and **Brandes betweenness** finds the bridges between subsystems, a
  derived **tests→code** map records which tests cover each module, and Louvain
  communities flag **surprising** near-unique cross-community couplings.
- **Render** — a budgeted `INDEX.md`, per-module entries split into tool-owned
  `ui:gen` regions and author-owned `ui:human` regions, plus `graph.json` /
  `graph.mmd` / `manifest.json`.

Then a **grounded AI layer** (the skills, via the agent) adds the *understanding*:
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

## Semantic search (optional)

Lexical search can't bridge a real vocabulary gap ("invoicing" vs a module that
only ever says "billing"). The optional semantic layer embeds each module and
makes `find` **hybrid**: lexical and cosine rankings fused with Reciprocal Rank
Fusion. It is strictly additive — without it, nothing changes and the engine
never touches the network.

```bash
docker compose up -d                                    # local Ollama, no API key, multi-arch
export ULTRAINDEX_EMBED_BASE_URL=http://localhost:11434/v1
export ULTRAINDEX_EMBED_MODEL=nomic-embed-text
ultraindex embed                                        # writes vectors.json (incremental)
ultraindex find "invoicing"                             # now hybrid — results carry semanticRank
```

Any OpenAI-compatible `POST /v1/embeddings` endpoint is a drop-in provider:
huggingface text-embeddings-inference on amd64/GPU hosts
(`http://localhost:8080/v1`, `BAAI/bge-small-en-v1.5`), or a hosted API
(`https://api.openai.com/v1`, `text-embedding-3-small`, plus
`ULTRAINDEX_EMBED_API_KEY`). Instead of env vars you can write
`<out>/semantic.json` (`{"baseUrl": …, "model": …}`) — but keep API keys in the
env, never in a committed `semantic.json` (mind `docs/ultraindex` indexes).

Degradation is graceful: provider down ⇒ lexical-only results + a stderr
warning; no `vectors.json` ⇒ pure lexical, silent, zero network (delete the
file to switch the layer off). `check` warns when vectors drift stale.
**Reproducibility caveat:** two artifacts are excluded from the byte-identical
rebuild guarantee — `manifest.json` (its `builtAt` timestamp) and `vectors.json`
(its floats depend on the provider/model).

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
