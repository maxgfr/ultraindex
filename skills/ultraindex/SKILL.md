---
name: ultraindex
description: "Use when a repo is too large for the model to hold in context and you need a compact, navigable map of it before working — or when the user asks to 'index this repo', 'build a codebase map/encyclopedia', 'generate a knowledge graph of the code and docs', or 'make this huge project AI-navigable'. Deterministically scans the WHOLE repo (code + markdown) with zero-dependency Node — no API keys, no LLM read of the repo — and emits a layered artifact: a small always-loadable INDEX.md (the map), per-module encyclopedia entries (business 'why/links' + code 'what/where'), a typed link-graph (graph.json + a Mermaid diagram) of imports, doc-links and mentions, and a manifest for staleness. You then do a light, module-by-module enrichment pass to fill the business prose. Pairs with the ultraindex-nav skill, which consumes the index so you only load the files a task needs. Triggers: 'index/map this codebase', 'build the encyclopedia', 'graph the links between files', 'this repo is too big for context'."
license: MIT
metadata:
  version: 0.0.0
---

# ultraindex — a navigable encyclopedia of a whole repo

On a huge repo the context window fills before you can find what matters.
`ultraindex` fixes that by scanning the **entire** project **with code** (the
zero-dependency bundle `scripts/ultraindex.mjs`) and emitting a *layered* index:
a small map you can always load, per-module entries you load on demand, and a
typed link-graph between files. The deterministic engine does the scanning — it
never needs to read the repo into the model — so it stays cheap even at scale.
Your only model-side job is a **light** business-prose enrichment pass.

> **The core rule:** the engine owns the *code view* and the *graph* — they are
> regenerated every build and you must not hand-edit them. You own the *business
> view* (the `ui:human` regions). Re-running `build` refreshes the generated
> sections and **preserves** your prose; never paste analysis into a `ui:gen`
> region, it will be overwritten.

## The script

One committed, dependency-free bundle: `node scripts/ultraindex.mjs <command>`.
No `npm install`, no API keys. Run `--help` for the full surface. Commands:

- `build --repo <dir> [--out .ultraindex] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--no-mermaid]`
  Scan the repo and (re)write the index to `--out` (default `<repo>/.ultraindex`,
  gitignored). Produces `INDEX.md`, `encyclopedia/<module>.md`, `graph.json`,
  `graph.mmd`, `manifest.json`. Idempotent: refreshes generated sections, keeps
  your enriched prose. Use `--out docs/ultraindex` for a committed, PR-reviewable index.
- `map [--out <dir>] [--module <slug>]` — print `INDEX.md` (or one module's entry)
  to stdout cheaply, without reading the whole tree.
- `find <query…> [--out <dir>] [--k <n>]` — rank modules for a task and print the
  **exact files to open**. (This is mainly what the navigator skill uses.)
- `neighbors <file|module> [--out <dir>] [--depth <n>]` — show graph neighbours of
  a file/module (what links to / from it).
- `check [--out <dir>] [--repo <dir>]` — report staleness (files changed since the
  build) and integrity problems. Exit non-zero ⇒ stale or broken.

## Workflow

You are invoked to **produce (or refresh) the index** for a repo. Do it in code,
then lightly enrich the prose.

1. **Build the index.**
   ```
   node scripts/ultraindex.mjs build --repo <path-to-repo>
   ```
   Add `--out docs/ultraindex` if the team wants it committed and reviewed in PRs.
   On a first run for a very large repo this is still fast — it is pure file I/O,
   no model involvement. The command prints where it wrote the artifact and a
   summary (file/module/edge counts, any dangling links).

2. **Skim the map.** `node scripts/ultraindex.mjs map` prints `INDEX.md`: the
   project summary, the **hub** modules (highest-connected), and the module table.
   This is the document the navigator and future sessions load first.

3. **Light enrichment pass (module by module).** Each `encyclopedia/<module>.md`
   has empty `ui:human` regions (`business` — what it does and how it connects;
   `gotchas` — caveats) marked with `<!-- ui:enrich -->`. For each module that
   matters — start with the hubs —
   open **only that module's few key files** (the entry lists them under *Source
   pointers*), then write 2–4 sentences of business context into its `ui:human`
   regions and save. Do **not** load the whole repo; the point is to stay bounded.
   Leave low-value modules' stubs empty — partial enrichment is fine.

4. **Re-run `build` any time.** It refreshes the code view, graph and manifest
   from the current code and **keeps** every `ui:human` region you wrote, matching
   them by key even if a module was renamed (renames migrate; truly-removed
   modules' prose is preserved under `encyclopedia/_orphaned/`).

5. **Verify.** `node scripts/ultraindex.mjs check` — confirm the index is fresh
   and has no integrity problems (dangling entries, orphaned prose, merge
   conflicts) before you consider it done.

6. **Hand off.** Tell the user where the index lives and that the **ultraindex-nav**
   skill (or any agent) can now navigate the repo through it — loading
   `INDEX.md` + the handful of entries/files a task needs instead of the whole repo.

## Notes

- **No keys, no network, deterministic.** ripgrep is used when present (faster
  `find`); without it a built-in scanner is used. Without `git`, the manifest
  simply omits the commit. Two builds of an unchanged repo are byte-identical.
- **Scope (v1).** Link edges: `contains` (module→file), `doc-link` (markdown
  links), `import` (local imports for JS/TS incl. tsconfig `paths`, Python, Go),
  and conservative `mention` edges (a doc naming an exported symbol). Other
  languages are still scanned and searchable; they just get no import edges.
