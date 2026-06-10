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
  to stdout cheaply, without reading the whole tree. `map --json` emits the module
  table (slug, tier, degree, summary) for parsing.
- `status [--out <dir>]` — the **enrichment work-queue**: which modules still hold
  stubs, in the exact order to enrich them (unenriched first, foundations/features
  before tail, most-connected first). Use `--json` to drive a loop.
- `find <query…> [--out <dir>] [--k <n>]` — rank modules for a task, print the **exact files to open**.
- `neighbors <file|module> [--out <dir>] [--depth <n>]` — graph neighbours (what links to / from it).
- `check [--out <dir>] [--repo <dir>]` — report staleness, integrity, AND **grounding**:
  every `[file:line]` citation in your analysis must resolve. Exit non-zero ⇒
  stale, broken, or ungrounded.

Most commands accept `--json` for machine-readable output — prefer it whenever
you branch on the result rather than read it as prose.

## Workflow

You are invoked to **build the index and analyze the repo into it**. The engine
does the scan; you do the grounded analysis.

1. **Build the index — and read the report.**
   ```
   node scripts/ultraindex.mjs build --repo <path-to-repo> --json
   ```
   Add `--out docs/ultraindex` if the team wants it committed and reviewed in PRs.
   Fast even on huge repos — pure file I/O, no model involvement. The `--json`
   report is self-diagnosing: if `dangling > 0`, read `danglingByReason` and its
   `reasonHints`, and check `notes` (unparseable tsconfig/package.json files are
   listed there). Fix what's fixable before enriching: `--exclude` vendored or
   generated trees, flag repo config issues. Dangling edges usually mean **the
   repo itself** has broken imports or stale doc links — that's a finding, report
   it to the user rather than papering over it.

2. **Skim the map.** `node scripts/ultraindex.mjs map` prints `INDEX.md`: project
   summary, the **hub** modules (highest-connected), and the module table. Read it
   once to understand the shape of the repo.

3. **Enrich under a budget — let `status` drive.**
   ```
   node scripts/ultraindex.mjs status --json
   ```
   It lists every module in the exact order to enrich: unenriched first,
   foundations/features before tail, most-connected first. Work the list
   top-down. On a large repo, enriching the **top 10–20** entries captures most
   of the navigation value — trivial leaves can stay as stubs (partial enrichment
   is fine). Re-run `status` between modules to track progress and pick the next
   one. For each module `<slug>`:
   ```
   node scripts/ultraindex.mjs dossier <slug>
   ```
   This prints its **real source** + neighbours. Read it, then edit
   `encyclopedia/<slug>.md`: fill the `ui:human` regions (`business` — what it does
   for the product and how it connects; `gotchas` — caveats) with 2–5 sentences of
   genuine analysis, **citing the evidence** as `[file]`, `[file:line]`, or
   `[file:start-end]` (e.g. `Resolves IDCC redirects [packages/utils/src/idcc.ts:30-44]`).
   Write only what the source supports — no guessing. Leave the `ui:gen` regions alone.

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

## When something fails

- **`check` rejects a citation** — re-run `dossier <slug>` and fix the file/line
  numbers against the real source. **Never delete a citation just to make
  `check` pass** — an uncited claim is worse than a failing one; if the evidence
  moved, re-read it and re-cite.
- **`check` reports stale** — re-run `build`; your prose survives. Then run
  `status` and re-visit only the modules whose member files changed
  (`check --json` lists `changed`/`added`/`removed`).
- **`build` reports orphaned prose** — a module was removed (or renamed in a way
  the migrator missed). Review `encyclopedia/_orphaned/<slug>.md` and fold
  anything still true into the successor module's entry by hand.
- **A region fence got mangled** (hand-edit gone wrong) — `build` refuses to
  rewrite that entry and notes a conflict in the manifest; fix the fences
  (`<!-- ui:human key=… -->` … `<!-- /ui:human key=… -->`) and rebuild.

## Maintenance visits (the freshness loop)

On returning to an already-indexed repo:
`check --json` → if `stale`, `build` → `status` → enrich only what the change
touched (new modules surface as unenriched; changed hubs deserve a re-read).

## Notes

- **No keys, no network, deterministic.** ripgrep is used when present (faster
  `find`); without it a built-in scanner is used. Without `git`, the manifest
  simply omits the commit. Two builds of an unchanged repo are byte-identical.
- **Scope (v1).** Link edges: `contains` (module→file), `doc-link` (markdown
  links), `import` (local imports for JS/TS incl. tsconfig `paths` and package
  `exports` maps, Python, Go incl. multi-module + `replace`), and conservative
  `mention` edges (a doc naming an exported symbol). Other languages are still
  scanned and searchable; they just get no import edges.
- **Yarn PnP** repos resolve workspace imports via package.json names (the same
  detection as every other monorepo), not `.pnp.cjs` — PnP's virtual filesystem
  is out of scope.
