---
name: ultraindex
description: "Use when an AI agent must UNDERSTAND a big repo, not merely search it — and its claims must be provable. ultraindex is the verified knowledge layer over codeindex, the deterministic zero-dep engine it vendors: codeindex tells you WHERE things are, ultraindex tells you what they MEAN and proves it. It builds an encyclopedia (a small always-loadable INDEX.md plus per-module entries): generated regions rebuild every time, human regions hold YOUR cited analysis, preserved across rebuilds and renames. dossier/ask hand you real source to write from; check REJECTS any [file:line] citation that does not resolve; verify proves each cited excerpt supports its claim. status is the enrichment work-queue, orchestrate fans it out to subagents. Triggers: index/map/document/analyze this codebase, where is X handled, how does Z work in this repo, which files do I change for Z, review this branch/PR, this repo is too big for context. Want plain code search, no model in the loop? Use codeindex directly."
license: MIT
metadata:
  version: 7.2.0
---

# ultraindex — the verified knowledge layer over codeindex

The mechanical work is not ours. `ultraindex` vendors
**[codeindex](https://github.com/maxgfr/codeindex)** — a deterministic,
zero-dependency, keyless engine — and *it* does the scanning, symbol
extraction, import resolution and link-graph (`node scripts/ultraindex.mjs
<command>` — no `npm install`, no API keys, run `--help` for the full surface).

Everything ultraindex adds exists only because **you** are in the loop: the
encyclopedia is your durable memory of this repo — it outlives the session and
the context window — and the gates exist so nothing you write into it can be
unfounded. **If the user only needs to find code fast, say so and point them at
codeindex; they do not need this skill for that.**

> **The core rules:**
> 1. The **codeindex engine** owns the *code view* and the *graph* (`ui:gen`
>    regions) — regenerated every build; never hand-edit them.
> 2. You own the *business view* (`ui:human` regions). `build` preserves your
>    prose across rebuilds and renames.
> 3. **Analyze from evidence, not memory.** Write analysis only from the real
>    source `dossier` shows you, cite it `[file:line]`, and `check` fails on any
>    citation that doesn't resolve — so don't guess.
> 4. **Load the minimum.** Read one entry (or one `dossier`) at a time — that is
>    the intended pattern, and exactly what a per-module enrichment subagent does.
>    Never bulk-load `graph.json` or the whole `encyclopedia/` directory into
>    context — that defeats the purpose.
> 5. **Prose can go stale silently; code cannot.** The code view is regenerated
>    every build, so it can't drift — but an analysis written against source
>    that has since changed still reads as true, and downstream trusts it MORE.
>    `check` and `status` report, per entry, whether its prose predates its
>    source. A stale entry is **unverified**: don't quote it and don't build on
>    it. Re-run `dossier <slug>`, revise the prose, then `check`. An entry
>    reported as *unverifiable* (no recorded source state, or one stamped when
>    `manifest.json` was missing) is not a pass either — nothing proves it fresh.

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

   If it reports `proseStale` for some modules, the *code view* is fresh but a
   model's *explanation* of those modules was written against source that has
   since changed — rebuilding does NOT fix that. Those entries are unverified:
   re-enrich them (situation 6) before relying on them, or say explicitly that
   you did not.

3. **The user has a task or question** ("where is X", "how does Z work",
   "which files do I change") — navigate the index, open only the files it
   points at, ground answers with verified citations:
   read [references/navigate.md](references/navigate.md).

4. **The user asks to review a branch, PR, or staged changes** — build (fresh
   index is a hard precondition), then `delta` for the risk-ranked worklist
   (changed symbols → blast radius → explained reasons), then ground each risky
   item: read [references/review.md](references/review.md).

5. **The answer must be high-assurance** (audit, security, a correctness-critical
   claim), or the user asks you to *verify*/adjudicate an answer — after
   `check --answer` passes (citations resolve), escalate to the semantic verify
   gate so each cited excerpt is proven to *support* its claim, not just exist:
   read [references/verify.md](references/verify.md).

6. **The user asked to index/analyze/document, or `status --json` shows
   unenriched hubs and you have budget** — run the status-driven enrichment
   loop (dossier → write cited analysis → check). On a large repo this
   parallelizes: one subagent per module from the queue, if your host supports
   subagents — `orchestrate` emits that fan-out for you (see **Orchestration —
   route by harness** below) — read [references/generate.md](references/generate.md).

7. **`find` keeps missing, or the user wants semantic/better search** — set up
   the optional keyless embeddings layer (`embed`, hybrid `find`):
   read [references/semantic.md](references/semantic.md).

A typical first visit chains 1 → 6 → 3; a return visit is usually 2 → 3; a
review of a branch is 2 → 4; a high-assurance answer adds → 5.

## Command cheat-sheet

- `build --repo <dir> [--out .ultraindex] [--include/--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--full-hash] [--no-mermaid] [--no-gitignore]` — scan and (re)write the index. Idempotent; keeps enriched prose. Incremental (reuses unchanged files' extraction); warns if `--max-files` truncates. `--out docs/ultraindex` for a committed, PR-reviewable index.
- `map [--module <slug>] [--json]` — print INDEX.md (or one entry, or the module table).
- `find "<query>" [--k <n>]` — rank modules, print the **exact files to open**. Lexical (with IDF term weighting) by default; hybrid (+ semantic) when vectors.json exists.
- `neighbors <file|module> [--depth <n>] [--kind <k>]` — what links to / from it (`--kind` filters edge kinds: import,call,use,doc-link,mention).
- `symbols "<name>" [--json]` — where a symbol is **defined** (file:line, kind, owning module) and which files reference it. Fuzzy by identifier sub-token.
- `impact <file|module> [--depth <n>] [--json]` — the **reverse dependency closure**: everything that imports or uses the target. "What breaks if I change this."
- `delta [--base <ref>] [--staged] [--depth <n>] [--json]` — map the git diff onto the index: changed files → enclosing symbols → blast radius → a **risk-scored review panel** with explained reasons (exported API, hub centrality, blast size, test gap, surprising coupling, dangling imports). Needs a fresh index (fails closed on drift). See [references/review.md](references/review.md).
- `status` — the enrichment **work-queue**, in the exact order to enrich: entries whose prose went **stale** first (an outdated explanation misleads more than a missing one), then never-enriched, then done.
- `dossier <slug> [--budget <n>]` — a module's grounding packet (real source + neighbours; a docs/config-only module, e.g. `root`, shows no code — enrich it by citing its README/config instead).
- `ask "<question>" [--budget <n>]` — assemble grounded evidence to answer from; `--budget` caps the inlined source at ~n tokens (also on `dossier`).
- `check [--answer <file>] [--semantic] [--prose] [--quiet]` — staleness + integrity + **grounding** (citations must resolve). Non-zero exit ⇒ stale, broken, or ungrounded (`--quiet` suppresses output — exit code only). Stale **prose** is reported separately from a stale **index** — different failure, different remedy (re-enrich vs rebuild) — and is a warning unless you pass `--prose`, which promotes it to a failure. `--semantic` also folds the verify gate (fails a claim whose cited excerpt refutes it, or that is fully adjudicated with no support); it re-reduces the verdict from the raw `verdicts[]` and re-reads every adjudicated excerpt from the live repo — a doctored summary or drifted source fails, never passes.
- `verify --answer <file> [--apply <verdicts.json>] [--max-verify <n>]` — the high-assurance gate **above** `check --answer`: emit a claim↔citation worklist for adversarial support-checking, then `--apply` reduces your verdicts to a pass/fail gate. See [references/verify.md](references/verify.md).
- `embed [--force]` — build/refresh vectors.json for semantic `find`. Keyless: pulls the model on first use, no provider to stand up (see [references/semantic.md](references/semantic.md)).
- `orchestrate [--phase enrich|verify-answer] [--answer <file>] [--eco] [--list]` — emit the multi-agent fan-out (workflow scripts + dispatch contracts + a sequential RUNBOOK) into `<index>/orchestration/` from the CURRENT enrichment queue / verify worklist. See **Orchestration — route by harness**.
- `engine <engine-command> …` — run any vendored codeindex command, arguments passed through untouched. The commands above are the encyclopedia; this is the engine's own deterministic code view, and it answers questions the encyclopedia does not hold: `engine literals` (values with no single source of truth — one value written across many files while a constant already holds it), `engine deadcode`, `engine complexity`, `engine hotspots`, `engine rules` (architecture CI gate), `engine search "<q>"`. Run `engine --help` for the full surface. Use it when the question is about the CODE as it is, not about what a module MEANS — and remember its output is evidence you still have to cite.

## Orchestration — route by harness

The judgment work fans out: the enrichment queue `status --json` reports is one
independent dossier→prose unit per module, and `VERIFY.todo.json` (one pair per
claim↔citation, written by `verify --answer` next to the answer) fans out the same
way. The engine manages the fan-out — `orchestrate` emits the orchestration from the
CURRENT index state, with absolute paths and the real module slugs baked in:

```
node scripts/ultraindex.mjs orchestrate [--out <dir>] [--repo <dir>] [--answer <file>] [--phase enrich|verify-answer] [--eco] [--list]
```

| Your harness | How to run each phase |
|---|---|
| Has the Workflow tool | `orchestrate --phase <p>`, then `Workflow({ scriptPath: "<index>/orchestration/<p>.workflow.mjs" })`. Enrichers WRITE their own `encyclopedia/<slug>.md` entries (the sanctioned disjoint-write exception) and return what they wrote; refuters only RETURN verdict fragments you fold and `verify --apply` yourself. |
| Subagents but no Workflow tool | Same `orchestrate`; dispatch one subagent per batch following `<index>/orchestration/agents/<role>.md` (the workflow script shows batches + prompts). |
| Eco mode, or no subagents | `orchestrate --eco` → follow `<index>/orchestration/RUNBOOK.md` sequentially, playing each role yourself. Correctness-identical; only wall-clock differs. |

Fan-out is an optimization, never a requirement — the gates (`check`,
`verify --apply`) are harness-independent and every phase has a sequential fallback
with identical artifacts. The one hard rule: **no `build` or `map` runs while a
fan-out is in flight** — `build` rewrites every entry, so a mid-fan-out rebuild
races and clobbers the agents' writes; the orchestrator runs one repo-wide `check`
after the join and routes each grounding failure back to the entry that caused it.
Re-run `orchestrate` whenever the queue changes (emission is deterministic and
idempotent); `--phase <p>` before its input exists fails and names the command that
produces it.

## Scope notes

- **Everything below is the vendored codeindex engine's**, not ultraindex's.
  Report engine defects upstream; ultraindex owns the encyclopedia, the gates
  (`check`/`verify`), the work-queue and the fan-out — nothing else.
- **No keys, deterministic, offline after a one-time setup** — the only network
  touches are two first-use pulls into shared per-machine caches: the
  tree-sitter grammars (see AST-exact symbols below) and the optional embedding
  model. Both are sha256-verified and both degrade rather than fail (regex
  extractor; lexical-only `find`). Two builds of an unchanged repo are
  byte-identical except for `manifest.json`'s `builtAt` provenance timestamp —
  `vectors.json` included, since the static embedding tier is byte-deterministic.
  Only the optional `CODEINDEX_EMBED_ENDPOINT` tier, whose floats come from a
  server, falls outside that guarantee.
- **AST-exact symbols** via tree-sitter grammars for JS/TS/TSX, Python, Go,
  Rust, Java, C, C++, C#, Ruby, PHP — real nesting, precise kinds, structural
  export. Other languages fall back to regex extractors (still searchable). The
  grammar wasms are **no longer shipped in the bundle**: the first `build` on a
  machine pulls them (~17 MiB) into a shared cache
  (`<XDG_CACHE_HOME|~/.cache>/codeindex/grammars/<engine>/`), sha256-verified,
  then reuses them forever — so AST precision is on by default after a single
  download, and the installed skill is that much smaller. **Offline with no cache
  yet** ⇒ `build` says so and indexes with the regex extractor (never a silent
  downgrade). Pre-warm before going offline with `node scripts/ultraindex.mjs
  grammars pull` (inspect the active tier with `grammars status`), or point
  `CODEINDEX_GRAMMARS_DIR` at an existing grammars dir.
- **Import edges** for JS/TS (tsconfig `paths`, package `exports` maps),
  Python, Go (multi-module + `replace`), Rust (`mod`/`use`), Java (packages),
  C/C++ (`#include "..."`), Ruby (`require_relative`/`require`), PHP (composer
  PSR-4 + relative `require`), C# (`using` → `namespace`). Plus conservative
  code→code `use` edges when a file references another file's unique exported
  symbol without importing it. Remaining languages get no import edges.
  Yarn PnP's virtual filesystem is out of scope (workspace names still resolve).
- Dangling edges usually mean **the repo itself** has broken imports or stale
  doc links — that's a finding to report, not to paper over.
