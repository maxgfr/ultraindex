---
name: ultraindex
description: "Use when a repo is too large for the model to hold in context and you need a compact, navigable, AI-analyzed map of it — or when the user asks to 'index this repo', 'build a codebase map/encyclopedia', 'generate a knowledge graph of the code and docs', or 'make this huge project AI-navigable'. A deterministic zero-dependency engine scans the WHOLE repo (code + markdown) — no API keys, no LLM read of the repo — and emits a layered artifact: a small always-loadable INDEX.md (the map), per-module encyclopedia entries (business 'why/links' + code 'what/where'), a typed link-graph (graph.json + a Mermaid diagram) of imports, doc-links and mentions, and a manifest for staleness. You THEN write a grounded, citation-checked business analysis for each module: `ultraindex dossier <module>` hands you its real source, you explain what it does and how it connects, citing [file:line], and `ultraindex check` REJECTS any citation that doesn't resolve (anti-hallucination). Pairs with the ultraindex-nav skill, which navigates + answers questions over the index. Triggers: 'index/map/analyze this codebase', 'build the encyclopedia', 'graph the links between files', 'this repo is too big for context'."
license: MIT
metadata:
  version: 1.2.0
---

# ultraindex — an AI-analyzed, navigable encyclopedia of a whole repo

On a huge repo the context window fills before you can find what matters.
`ultraindex` fixes that with a **division of labour**: the deterministic,
zero-dependency engine (`scripts/ultraindex.mjs`) does the *mechanical* work —
scanning the entire project, building the link-graph, and laying out the
encyclopedia skeleton — **with code, never loading the repo into the model**; and
**you** do the *understanding* — a grounded, cited business analysis of each
module, written from its real source. The result is an index that is both
deterministically accurate (code view + graph) and genuinely explained.

> **The core rules:**
> 1. The engine owns the *code view* and the *graph* (`ui:gen` regions) — they
>    are regenerated every build; never hand-edit them, your edits are overwritten.
> 2. You own the *business view* (`ui:human` regions). `build` preserves your
>    prose across rebuilds and renames.
> 3. **Analyze from evidence, not memory.** Write a module's analysis only from
>    the real source `ultraindex dossier` shows you, and **cite** it `[file:line]`.
>    `ultraindex check` fails on any citation that doesn't resolve — so don't guess.

## The script

One committed, dependency-free bundle: `node scripts/ultraindex.mjs <command>`.
No `npm install`, no API keys. Run `--help` for the full surface. Commands:

- `build --repo <dir> [--out .ultraindex] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--no-mermaid]`
  Scan the repo and (re)write the index to `--out` (default `<repo>/.ultraindex`,
  gitignored). Produces `INDEX.md`, `encyclopedia/<module>.md`, `graph.json`,
  `graph.mmd`, `manifest.json`. Idempotent: refreshes generated sections, keeps
  your enriched prose. Use `--out docs/ultraindex` for a committed, PR-reviewable index.
- `dossier <module-slug> [--out <dir>] [--repo <dir>]` — print a **grounding packet**
  for a module: its real key source (with line numbers), exported surface, and
  graph neighbours. Read this, then write the analysis. This is how you analyze
  from evidence instead of memory.
- `map [--out <dir>] [--module <slug>]` — print `INDEX.md` (or one module's entry)
  to stdout cheaply, without reading the whole tree.
- `find <query…> [--out <dir>] [--k <n>]` — rank modules for a task, print the **exact files to open**.
- `neighbors <file|module> [--out <dir>] [--depth <n>]` — graph neighbours (what links to / from it).
- `check [--out <dir>] [--repo <dir>]` — report staleness, integrity, AND **grounding**:
  every `[file:line]` citation in your analysis must resolve. Exit non-zero ⇒
  stale, broken, or ungrounded.

## Workflow

You are invoked to **build the index and analyze the repo into it**. The engine
does the scan; you do the grounded analysis.

1. **Build the index.**
   ```
   node scripts/ultraindex.mjs build --repo <path-to-repo>
   ```
   Add `--out docs/ultraindex` if the team wants it committed and reviewed in PRs.
   Fast even on huge repos — pure file I/O, no model involvement. It prints where
   it wrote the artifact and a summary (file/module/edge counts, dangling links).

2. **Skim the map.** `node scripts/ultraindex.mjs map` prints `INDEX.md`: project
   summary, the **hub** modules (highest-connected), and the module table. Decide
   which modules matter — start with the hubs.

3. **Analyze each important module — grounded.** For a module `<slug>`:
   ```
   node scripts/ultraindex.mjs dossier <slug>
   ```
   This prints its **real source** + neighbours. Read it, then edit
   `encyclopedia/<slug>.md`: fill the `ui:human` regions (`business` — what it does
   for the product and how it connects; `gotchas` — caveats) with 2–5 sentences of
   genuine analysis, **citing the evidence** as `[file]`, `[file:line]`, or
   `[file:start-end]` (e.g. `Resolves IDCC redirects [packages/utils/src/idcc.ts:30-44]`).
   Write only what the source supports — no guessing. Leave the `ui:gen` regions alone.
   Scale effort to the repo: hubs and core modules deserve real analysis; trivial
   leaves can stay as stubs (partial enrichment is fine).

4. **Verify grounding.** `node scripts/ultraindex.mjs check`. It fails if any
   citation you wrote doesn't resolve to a real file/line (or the index is stale /
   broken). Fix and re-run until it passes — this is the guard against analyzing
   from memory.

5. **Re-run `build` any time.** It refreshes the code view, graph and manifest from
   the current code and **keeps** every `ui:human` analysis you wrote, matching by
   key even across module renames (renames migrate; truly-removed modules' prose is
   preserved under `encyclopedia/_orphaned/`).

6. **Hand off.** Tell the user where the index lives and that the **ultraindex-nav**
   skill (or any agent) can now navigate AND answer grounded questions over it —
   loading `INDEX.md` + the handful of entries/files a task needs, not the whole repo.

## Notes

- **No keys, no network, deterministic.** ripgrep is used when present (faster
  `find`); without it a built-in scanner is used. Without `git`, the manifest
  simply omits the commit. Two builds of an unchanged repo are byte-identical.
- **Scope (v1).** Link edges: `contains` (module→file), `doc-link` (markdown
  links), `import` (local imports for JS/TS incl. tsconfig `paths`, Python, Go),
  and conservative `mention` edges (a doc naming an exported symbol). Other
  languages are still scanned and searchable; they just get no import edges.
