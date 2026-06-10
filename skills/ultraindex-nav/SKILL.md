---
name: ultraindex-nav
description: "Use when working in a large repo that has an ultraindex index (a `.ultraindex/` or `docs/ultraindex/` folder with INDEX.md + graph.json) and you need to find the right files for a task — OR answer a question about the codebase — WITHOUT reading the whole thing into context. The light companion to the ultraindex generator skill: it consults the prebuilt map and link-graph to open only the handful of entries and source files that matter, and can answer questions grounded in real code with citations that `ultraindex check --answer` verifies. Triggers: 'where is X handled', 'what touches Y', 'how does Z work in this repo', 'navigate/work in this huge repo', 'which files do I change for Z', any task or question in a repo where loading everything would blow the context window. If no index exists yet, it tells you to run the ultraindex generator first."
license: MIT
metadata:
  version: 1.2.0
---

# ultraindex-nav — navigate a huge repo through its index

This is the **light** consumer of an `ultraindex` build. Instead of reading a
large repo into context, you ask the prebuilt index where to look and open only
what the task needs. The same zero-dependency bundle ships here:
`node scripts/ultraindex.mjs <command>`. No `npm install`, no keys.

> **The core rule:** load the minimum. Use `find` to get the exact files, open
> those entries/files one at a time, and answer. Do **not** read `graph.json` or
> the whole `encyclopedia/` directory — that defeats the purpose.

`find`, `neighbors`, `map`, `ask` and `check` all accept `--json`. Prefer it
whenever you **branch** on the result (is the index stale? which files matched?);
use the text form when you're reading evidence as prose.

## Workflow

1. **Locate the index.** Look for `.ultraindex/` (default) or `docs/ultraindex/`
   at the repo root. Then check freshness:
   ```
   node scripts/ultraindex.mjs check --out <index-dir>
   ```
   - **Missing** (no index dir): tell the user to build it first —
     `node scripts/ultraindex.mjs build --repo <repo>` (the **ultraindex** skill) —
     and stop. Do not auto-build; building also expects a light enrichment pass.
   - **Stale** (`check` reports changed files): run `check --json` and look at
     `changed`/`added`/`removed` — if none of those files touch the modules your
     task needs, proceed; otherwise warn that results may be out of date and
     suggest a rebuild.
   - **Fresh:** continue.

2. **Orient (once, cheap).** `node scripts/ultraindex.mjs map --out <index-dir>`
   prints `INDEX.md` — the project summary, hub modules, and module table. Read
   it to understand the shape of the repo.

3. **Find the relevant files for the task.**
   ```
   node scripts/ultraindex.mjs find "<task keywords>" --out <index-dir>
   ```
   It returns the top modules with their **exact source files to open**, the
   matched terms, and graph neighbours. Results flagged `enriched` carry
   verified, citation-checked analysis in their entry — trust those entries
   first. Use `neighbors <file|module>` to expand along the graph ("what else
   touches this").

   **When `find` comes up empty or wrong, escalate in this order:**
   1. Re-query with synonyms and identifier-style terms (`auth login session`,
      `parseConfig`, the feature's route or flag name).
   2. `neighbors` from any file or module you DO know is involved.
   3. Last resort: `rg` (or grep) **restricted to the module paths the index
      listed** — never whole-repo reads; that defeats the purpose.

4. **Load only those.** Open the listed `encyclopedia/<module>.md` entries (for
   the business + code overview) and the specific source files — one at a time,
   stopping as soon as you have what the task needs.

5. **Act and answer**, citing the concrete files. If you discover the index was
   wrong or stale enough to mislead, say so and recommend re-running the
   generator's `build`.

## Answering a question (grounded mode)

When the user asks a *question* about the codebase (not "do a task"), answer it
from real code, not memory — and prove it:

1. **Assemble evidence.**
   ```
   node scripts/ultraindex.mjs ask "<the question>" --out <index-dir>
   ```
   This finds the relevant modules and prints their **real source** (with line
   numbers) plus which files to open. Read it; open more files from the listed
   ones if a thread is thin.
2. **Write the answer to `ANSWER.md`**, citing every claim with the evidence it
   rests on, in **bare brackets**: `[file]`, `[file:line]`, or `[file:start-end]`
   (e.g. `Retries use exponential backoff [src/util.ts:2-4]`). A markdown link
   `[text](path)`, or a citation inside a code fence/inline-code, does **not**
   count — write the citation in the prose. Every answer needs at least one citation.
3. **Verify grounding.**
   ```
   node scripts/ultraindex.mjs check --answer ANSWER.md --out <index-dir>
   ```
   It fails if the answer has no citations or any citation doesn't resolve to a
   real file/line. Fix and re-run until it passes, then give the user the answer
   with its citations. Never present an answer that hasn't passed this check.

## Notes

- The index is read-only here — this skill never writes to it (apart from your
  `ANSWER.md` scratch file). Refreshing/enriching the index is the **ultraindex**
  (generator) skill's job.
- `find`/`neighbors`/`map`/`ask` print only the slice you asked for, so each call
  is cheap. Chaining a few is still far less context than reading the repo.
