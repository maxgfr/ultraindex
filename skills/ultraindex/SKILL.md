---
name: ultraindex
description: "Use when a repo is too large to hold in context — to BUILD a compact, navigable, AI-analyzed map of it AND to NAVIGATE that map for any later task or question. One skill, auto-routed: if no index exists it builds one; if the index is stale it rebuilds; if the user has a task/question it navigates. A deterministic zero-dependency engine scans the WHOLE repo (code + markdown) — no API keys, no LLM read of the repo — and emits a layered artifact: a small always-loadable INDEX.md (the map), per-module encyclopedia entries (business 'why/links' + code 'what/where'), a typed link-graph (graph.json + Mermaid), and a manifest for staleness. You then write grounded, citation-checked analysis per module (`dossier` hands you real source; `check` REJECTS citations that don't resolve — anti-hallucination), and later answer questions over the index with `find`/`neighbors`/`ask`, loading only the handful of files a task needs. Optional semantic search via a local docker-compose embeddings provider. Triggers: 'index/map/analyze this codebase', 'build the encyclopedia', 'where is X handled', 'what touches Y', 'how does Z work in this repo', 'which files do I change for Z', 'this repo is too big for context'."
license: MIT
metadata:
  version: 2.2.0
---

# ultraindex — build and navigate an AI-analyzed encyclopedia of a whole repo

On a huge repo the context window fills before you find what matters.
`ultraindex` fixes that with a **division of labour**: the deterministic,
zero-dependency engine (`node scripts/ultraindex.mjs <command>` — no
`npm install`, no API keys, run `--help` for the full surface) does the
*mechanical* work — scanning the project, building the link-graph, laying out
the encyclopedia; **you** do the *understanding* — grounded, cited analysis —
and later **navigate** the result instead of reading the repo.

> **The core rules:**
> 1. The engine owns the *code view* and the *graph* (`ui:gen` regions) —
>    regenerated every build; never hand-edit them.
> 2. You own the *business view* (`ui:human` regions). `build` preserves your
>    prose across rebuilds and renames.
> 3. **Analyze from evidence, not memory.** Write analysis only from the real
>    source `dossier` shows you, cite it `[file:line]`, and `check` fails on any
>    citation that doesn't resolve — so don't guess.
> 4. **Load the minimum.** Read one entry (or one `dossier`) at a time — that is
>    the intended pattern, and exactly what a per-module enrichment subagent does.
>    Never bulk-load `graph.json` or the whole `encyclopedia/` directory into
>    context — that defeats the purpose.

Most commands accept `--json` — prefer it whenever you branch on the result
rather than read it as prose.

## Route by situation

Work out which situation you are in, in this order, and read the matching
reference for the detailed workflow:

1. **No index yet** — no `.ultraindex/` or `docs/ultraindex/` at the repo root
   (look for `graph.json` inside). Build it, then enrich the top modules:
   read [references/generate.md](references/generate.md).

2. **Index exists — check freshness first.**
   `node scripts/ultraindex.mjs check --out <index-dir> --json`. If it reports
   stale or broken, re-run `build` (your prose survives), then continue. If
   only files irrelevant to the task changed, you may proceed and note it.

3. **The user has a task or question** ("where is X", "how does Z work",
   "which files do I change") — navigate the index, open only the files it
   points at, ground answers with verified citations:
   read [references/navigate.md](references/navigate.md).

4. **The answer must be high-assurance** (audit, security, a correctness-critical
   claim), or the user asks you to *verify*/adjudicate an answer — after
   `check --answer` passes (citations resolve), escalate to the semantic verify
   gate so each cited excerpt is proven to *support* its claim, not just exist:
   read [references/verify.md](references/verify.md).

5. **The user asked to index/analyze/document, or `status --json` shows
   unenriched hubs and you have budget** — run the status-driven enrichment
   loop (dossier → write cited analysis → check). On a large repo this
   parallelizes: one subagent per module from the queue, if your host supports
   subagents — read [references/generate.md](references/generate.md).

6. **`find` keeps missing, or the user wants semantic/better search** — set up
   the optional embeddings layer (docker compose, `embed`, hybrid `find`):
   read [references/semantic.md](references/semantic.md).

A typical first visit chains 1 → 5 → 3; a return visit is usually 2 → 3; a
high-assurance answer adds → 4.

## Command cheat-sheet

- `build --repo <dir> [--out .ultraindex] [--include/--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--no-mermaid]` — scan and (re)write the index. Idempotent; keeps enriched prose. Incremental (reuses unchanged files' extraction); warns if `--max-files` truncates. `--out docs/ultraindex` for a committed, PR-reviewable index.
- `map [--module <slug>] [--json]` — print INDEX.md (or one entry, or the module table).
- `find "<query>" [--k <n>]` — rank modules, print the **exact files to open**. Lexical (with IDF term weighting) by default; hybrid (+ semantic) when vectors.json exists.
- `neighbors <file|module> [--depth <n>]` — what links to / from it.
- `symbols "<name>" [--json]` — where a symbol is **defined** (file:line, kind, owning module) and which files reference it. Fuzzy by identifier sub-token.
- `impact <file|module> [--depth <n>] [--json]` — the **reverse dependency closure**: everything that imports or uses the target. "What breaks if I change this."
- `status` — the enrichment **work-queue**, in the exact order to enrich.
- `dossier <slug>` — a module's grounding packet (real source + neighbours; a docs/config-only module, e.g. `root`, shows no code — enrich it by citing its README/config instead).
- `ask "<question>"` — assemble grounded evidence to answer from.
- `check [--answer <file>] [--semantic]` — staleness + integrity + **grounding** (citations must resolve). Non-zero exit ⇒ stale, broken, or ungrounded. `--semantic` also folds the verify gate (fails a claim whose cited excerpt refutes it, or that is fully adjudicated with no support).
- `verify --answer <file> [--apply <verdicts.json>] [--max-verify <n>]` — the high-assurance gate **above** `check --answer`: emit a claim↔citation worklist for adversarial support-checking, then `--apply` reduces your verdicts to a pass/fail gate. See [references/verify.md](references/verify.md).
- `embed [--force]` — build/refresh vectors.json for semantic `find` (needs a provider — see [references/semantic.md](references/semantic.md)).

## Scope notes

- **No keys, no network, deterministic** (the optional semantic layer is the
  one exception, and it degrades to lexical when its provider is absent). Two
  builds of an unchanged repo are byte-identical except for `manifest.json`'s
  `builtAt` provenance timestamp; `vectors.json` is also excluded (its floats
  depend on the provider).
- **AST-exact symbols** via committed tree-sitter grammars for JS/TS/TSX,
  Python, Go, Rust, Java, C, C++, C#, Ruby, PHP — real nesting, precise kinds,
  structural export. Other languages fall back to regex extractors (still
  searchable). The grammar wasms ship in the bundle, so there is still no
  `npm install` at skill-use time (the install is heavier — ~17 MiB of wasm).
- **Import edges** for JS/TS (tsconfig `paths`, package `exports` maps),
  Python, Go (multi-module + `replace`), Rust (`mod`/`use`), Java (packages),
  C/C++ (`#include "..."`), Ruby (`require_relative`/`require`), PHP (composer
  PSR-4 + relative `require`), C# (`using` → `namespace`). Plus conservative
  code→code `use` edges when a file references another file's unique exported
  symbol without importing it. Remaining languages get no import edges.
  Yarn PnP's virtual filesystem is out of scope (workspace names still resolve).
- Dangling edges usually mean **the repo itself** has broken imports or stale
  doc links — that's a finding to report, not to paper over.
