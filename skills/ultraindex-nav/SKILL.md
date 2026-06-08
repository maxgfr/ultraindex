---
name: ultraindex-nav
description: "Use when working in a large repo that has an ultraindex index (a `.ultraindex/` or `docs/ultraindex/` folder with INDEX.md + graph.json) and you need to find the right files for a task WITHOUT reading the whole codebase into context. The light companion to the ultraindex generator skill: it consults the prebuilt map and link-graph, then opens only the handful of entries and source files the task actually needs. Triggers: 'where is X handled', 'what touches Y', 'navigate/work in this huge repo', 'which files do I change for Z', any task in a repo where loading everything would blow the context window. If no index exists yet, it tells you to run the ultraindex generator first."
license: MIT
metadata:
  version: 0.0.0
---

# ultraindex-nav — navigate a huge repo through its index

This is the **light** consumer of an `ultraindex` build. Instead of reading a
large repo into context, you ask the prebuilt index where to look and open only
what the task needs. The same zero-dependency bundle ships here:
`node scripts/ultraindex.mjs <command>`. No `npm install`, no keys.

> **The core rule:** load the minimum. Use `find` to get the exact files, open
> those entries/files one at a time, and answer. Do **not** read `graph.json` or
> the whole `encyclopedia/` directory — that defeats the purpose.

## Workflow

1. **Locate the index.** Look for `.ultraindex/` (default) or `docs/ultraindex/`
   at the repo root. Then check freshness:
   ```
   node scripts/ultraindex.mjs check --out <index-dir>
   ```
   - **Missing** (no index dir): tell the user to build it first —
     `node scripts/ultraindex.mjs build --repo <repo>` (the **ultraindex** skill) —
     and stop. Do not auto-build; building also expects a light enrichment pass.
   - **Stale** (`check` reports changed files): proceed, but warn the results may
     be slightly out of date and suggest a rebuild.
   - **Fresh:** continue.

2. **Orient (once, cheap).** `node scripts/ultraindex.mjs map --out <index-dir>`
   prints `INDEX.md` — the project summary, hub modules, and module table. Read
   it to understand the shape of the repo.

3. **Find the relevant files for the task.**
   ```
   node scripts/ultraindex.mjs find "<task keywords>" --out <index-dir>
   ```
   It returns the top modules with their **exact source files to open**, the
   matched terms, and graph neighbours. Use `neighbors <file|module>` to expand
   along the graph ("what else touches this").

4. **Load only those.** Open the listed `encyclopedia/<module>.md` entries (for
   the business + code overview) and the specific source files — one at a time,
   stopping as soon as you have what the task needs.

5. **Act and answer**, citing the concrete files. If you discover the index was
   wrong or stale enough to mislead, say so and recommend re-running the
   generator's `build`.

## Notes

- The index is read-only here — this skill never writes to it. Refreshing/enriching
  is the **ultraindex** (generator) skill's job.
- `find`/`neighbors`/`map` print only the slice you asked for, so each call is
  cheap. Chaining a few of them is still far less context than reading the repo.
