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
  INDEX.md              # the map — always-loadable: summary, hubs, module table
  encyclopedia/
    <module>.md         # per-module entry: business view + code view + links + sources
  graph.json            # the full typed link-graph (file + module level)
  graph.mmd             # a Mermaid module diagram
  manifest.json         # per-file hashes (staleness) + merge bookkeeping
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
ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--no-mermaid]
ultraindex find    "<query>" [--out <dir>] [--k <n>]
ultraindex embed   [--out <dir>] [--force]
ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
ultraindex map     [--out <dir>] [--module <slug>]
ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>]
ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>]
ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>]
```

- **build** — scan + (re)write the index. Idempotent: regenerates the code view
  and graph, **preserves** your enriched prose (matched by region key even across
  module renames; truly-removed modules' prose is kept under `encyclopedia/_orphaned/`).
- **find** — rank modules for a task and print the **exact files to open**.
  Lexical by default (identifier splitting, light stemming, code-domain
  synonyms); hybrid lexical + semantic when `vectors.json` exists (below).
- **embed** — build/refresh `vectors.json` for semantic `find` (optional, needs
  a provider — see below). Incremental: unchanged modules keep their vectors.
- **neighbors** — walk the graph from a file or module.
- **map** — print `INDEX.md` (or one module's entry) cheaply.
- **dossier** — print a grounding packet for a module (its real key source + graph
  neighbours) so you can write a cited analysis into its entry.
- **ask** — assemble grounded evidence (real source of the relevant modules) for a
  question, so you can answer it with citations.
- **check** — report staleness + integrity + **grounding** (every `[file:line]`
  citation in your prose must resolve). With `--answer <file>`, validate that
  answer's citations instead. Non-zero exit ⇒ stale, broken, or ungrounded.

Default output is `<repo>/.ultraindex` (gitignored). Use `--out docs/ultraindex`
to commit a PR-reviewable index — deterministic, byte-stable rebuilds keep diffs small.

## How it works

A **deterministic engine** (no model, no network) does the mechanical work:

- **Scan** — gitignore-aware walk; per-file extraction of markdown (title /
  headings / links) and code (exported symbols + signatures incl. `export default`
  and barrel re-exports, top doc-comment, local imports).
- **Resolve** — markdown relative links, and local imports for **JS/TS** (incl.
  `tsconfig` path aliases — even Nx-style root `tsconfig.base.json` — and
  **workspace packages** with their `exports` maps → in-repo source), **Python**,
  **Go** (multi-module `go.mod` incl. `replace` directives), **Rust**
  (`mod`/`use`, cross-crate), and **Java** (package → source-root mapping).
  Unresolved local targets become **dangling** edges (surfaced, never silently
  dropped); third-party/stdlib and asset imports are external (no edge).
- **Graph** — typed edges (`doc-link`, `import`, conservative `mention`),
  file-level and lifted to module level; degree centrality picks the hubs.
- **Render** — a budgeted `INDEX.md`, per-module entries split into tool-owned
  `ui:gen` regions and author-owned `ui:human` regions, plus `graph.json` /
  `graph.mmd` / `manifest.json`.

Then a **grounded AI layer** (the skills, via the agent) adds the *understanding*:
`dossier`/`ask` hand the agent the real source, it writes business analysis /
answers that cite `[file:line]`, and `check` mechanically **rejects any citation
that doesn't resolve** — the anti-hallucination guard (ultradoc's model, applied
to a local index). Citations inside code fences / inline code / markdown links
don't count, so a decorative cite can't satisfy the gate.

ripgrep is used when present (faster); without it a built-in scanner is used.
Without `git`, the manifest just omits the commit. Two builds of an unchanged repo
are byte-identical.

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
**Reproducibility caveat:** `vectors.json` is the one artifact excluded from
the byte-identical rebuild guarantee — its floats depend on the provider/model.

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
