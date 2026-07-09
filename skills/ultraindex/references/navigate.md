# Navigate: find the right files and answer questions through the index

Instead of reading a large repo into context, ask the prebuilt index where to
look and open only what the task needs. The index is read-only here (apart
from your `ANSWER.md` scratch file) — refreshing/enriching is the generate
workflow's job.

## Workflow

1. **Locate the index.** `.ultraindex/` (default) or `docs/ultraindex/` at the
   repo root. Then check freshness:
   ```
   node scripts/ultraindex.mjs check --out <index-dir>
   ```
   - **Stale** (`check` reports changed files): run `check --json` and look at
     `changed`/`added`/`removed` — if none of those files touch the modules
     your task needs, proceed; otherwise rebuild first (see generate.md — your
     prose survives).
   - **Fresh:** continue.

2. **Orient (once, cheap).** `node scripts/ultraindex.mjs map --out <index-dir>`
   prints `INDEX.md` — project summary, hub modules, module table.

3. **Find the relevant files for the task.**
   ```
   node scripts/ultraindex.mjs find "<task keywords>" --out <index-dir>
   ```
   It returns the top modules with their **exact source files to open**, the
   matched terms, and graph neighbours. Results flagged `enriched` carry
   verified, citation-checked analysis in their entry — trust those entries
   first. `find` weights rare query terms above common ones (IDF), so a
   distinctive identifier discriminates better than a boilerplate word.
   **Exported symbol names are searchable:** a query naming an exported
   function/class/type finds its owning module even when no title, summary, or
   path mentions it — so you can search the identifier directly, not just prose
   about it. With a semantic layer set up, results may also carry a
   `semanticRank` (see semantic.md). Use `neighbors <file|module>` to expand
   along the graph ("what else touches this") — its links now include `call`
   edges (a resolved cross-file function/method call, not just imports/uses),
   and a call link is marked `·extracted` (an import between the files
   corroborates it) or `·inferred` (resolved by a unique name match with no
   import evidence) so you can judge how solid the connection is.

   **Appended context rows.** Beyond the ranked hits, `find` may add a few
   rows flagged with a `via` marker: `via: term` is a module that ranked below
   the top hits but is the best (sometimes only) bearer of one of your query
   terms — kept so a term is never silently dropped; `via: graph` is a module
   one or two edges from a strong hit, surfaced as graph context even though it
   matched no keyword (score 0, no matched terms). Treat `via: graph` rows as
   "nearby, worth a glance", not as direct matches.

   **When you already know the symbol, skip `find`:** `symbols "<name>"` points
   straight at every definition site (file:line, kind, owning module) and the
   files that reference it — no ranking, no guessing. Before you change a file
   or symbol, run `impact <file|module>` to see its reverse dependency closure
   (everything that imports, uses, or calls it) so you know the blast radius.

   **When `find` comes up empty or wrong, escalate in this order:**
   1. Re-query with synonyms and identifier-style terms (`auth login session`,
      `parseConfig`, the feature's route or flag name).
   2. `symbols "<name>"` if you know the identifier; `neighbors` or `impact`
      from any file or module you DO know is involved.
   3. If available, set up semantic search (semantic.md) — it catches
      vocabulary mismatches lexical search can't.
   4. Last resort: `rg` (or grep) **restricted to the module paths the index
      listed** — never whole-repo reads; that defeats the purpose.

4. **Load only those.** Open the listed `encyclopedia/<module>.md` entries (for
   the business + code overview) and the specific source files — one at a
   time, stopping as soon as you have what the task needs.

5. **Act and answer**, citing the concrete files. If you discover the index
   was wrong or stale enough to mislead, say so and rebuild.

## Answering a question (grounded mode)

When the user asks a *question* about the codebase (not "do a task"), answer
from real code, not memory — and prove it:

1. **Assemble evidence.**
   ```
   node scripts/ultraindex.mjs ask "<the question>" --out <index-dir>
   ```
   This finds the relevant modules and prints their **real source** (with line
   numbers) plus which files to open. Read it; open more files from the listed
   ones if a thread is thin.
2. **Write the answer to `ANSWER.md`**, citing every claim with the evidence
   it rests on, in **bare brackets**: `[file]`, `[file:line]`, or
   `[file:start-end]` (e.g. `Retries use exponential backoff
   [src/util.ts:2-4]`). A markdown link whose bracket text is **not** a path —
   `[the guide]` then `(docs/x.md)` — does **not** count, nor does a citation
   inside a code fence/inline-code; but a path-like bracket like
   `[src/util.ts:2-4]` still counts even if a `(…)` happens to follow it. Write
   the citation in the prose. Every answer needs at least one citation.
3. **Verify grounding.**
   ```
   node scripts/ultraindex.mjs check --answer ANSWER.md --out <index-dir>
   ```
   It fails if the answer has no citations or any citation doesn't resolve to
   a real file/line. Fix and re-run until it passes, then give the user the
   answer with its citations. Never present an answer that hasn't passed this
   check. For audit, security, or correctness-critical answers, escalate one
   step further once this passes: the semantic verify gate in verify.md proves
   each cited excerpt actually *supports* its claim, not merely that it resolves.

`find`/`neighbors`/`map`/`ask` print only the slice you asked for, so each
call is cheap. Chaining a few is still far less context than reading the repo.
