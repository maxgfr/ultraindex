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
    _orphaned/<m>.md    # prose of a module that disappeared — kept, never deleted
  graph.json            # the full typed link-graph (file + module level)
  symbols.json          # symbol → definition sites + referencing files (`symbols` cmd)
  graph.mmd             # a Mermaid module diagram
  manifest.json         # per-file hashes (staleness) + merge bookkeeping
  cache.json            # incremental-build extraction cache (regenerable; gitignore for committed indexes)
  vectors.json          # optional per-module embeddings (`embed`, keyless)
  orchestration/        # optional multi-agent fan-out (`orchestrate`): workflows, contracts, RUNBOOK
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
Works with Claude Code, Codex, and the other agents the `skills` CLI supports.

The skill **auto-routes** by situation: no index → it builds one; stale index →
it rebuilds (your prose survives); a task or question → it navigates, opening
only the files the index points at and answering with **grounded,
citation-checked** analysis (`dossier`/`ask` hand the agent the real source;
`check` rejects any citation that doesn't resolve).

## MCP server — use codeindex's

ultraindex used to expose `ultraindex mcp`, which was a verbatim re-export of
the vendored engine's server: the same 26 repo-analysis tools, announcing
themselves under the engine's own name (`codeindex`). That is the engine's job,
so it now lives only in the engine — one server, one name, no collision when a
client has both registered:

```bash
claude mcp add codeindex -- codeindex mcp      # brew install maxgfr/tap/codeindex
```



## CLI

```
ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--full-hash] [--no-mermaid] [--no-gitignore]
ultraindex find    "<query>" [--out <dir>] [--k <n>]
ultraindex embed   [--out <dir>] [--force]
ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>] [--kind <k>]
ultraindex symbols "<name>" [--out <dir>] [--json]
ultraindex impact  <file|module-slug> [--out <dir>] [--depth <n>] [--json]
ultraindex delta   [--base <ref>] [--staged] [--out <dir>] [--repo <dir>] [--depth <n>] [--json]
ultraindex map     [--out <dir>] [--module <slug>] [--json]
ultraindex status  [--out <dir>]
ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>] [--budget <n>]
ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>] [--budget <n>]
ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>] [--semantic] [--quiet]
ultraindex verify  --answer <file> [--repo <dir>] [--apply <verdicts.json>] [--max-verify <n>]
ultraindex orchestrate [--out <dir>] [--repo <dir>] [--answer <file>] [--phase <name>] [--eco] [--list]
ultraindex grammars [status|pull]
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
- **embed** — build/refresh `vectors.json` for semantic `find` (optional, no key
  and no provider to run — see below). Incremental: unchanged modules keep their
  vectors.
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
- **orchestrate** — emit the multi-agent fan-out for the CURRENT index state
  into `<out>/orchestration/`: one workflow script per ready phase (`enrich` =
  the `status` work-queue; `verify-answer` = the claim↔citation worklist), the
  dispatch contracts, and a sequential `RUNBOOK.md` fallback. Deterministic and
  idempotent — re-run it whenever the queue changes.
- **grammars** `[status|pull]` — inspect or pre-warm the tree-sitter wasm cache.
  `build` pulls on first use, so this is only for going offline or diagnostics.

Default output is `<repo>/.ultraindex` (gitignored). Use `--out docs/ultraindex`
to commit a PR-reviewable index — deterministic, byte-stable rebuilds keep diffs small.

## How it works

A **deterministic engine** (no model, no keys) does the mechanical work:

- **Scan** — gitignore-aware walk; per-file extraction of markdown (title /
  headings / links) and code. Symbols come from **tree-sitter** (AST-exact: real
  nesting, precise kinds, structural export) for JS/TS/TSX, Python, Go, Rust,
  Java, C, C++, C#, Ruby, PHP. The grammar wasms are **not shipped in the
  bundle**: the first `build` on a machine pulls them (~17 MiB) into a shared
  cache (`<XDG_CACHE_HOME|~/.cache>/codeindex/grammars/<engine>/`),
  sha256-verified, and reuses them forever — so AST precision is on by default
  after one download, with no `npm install` at skill-use time and a much smaller
  installed skill. **Offline** with no cache yet ⇒ `build` says so and indexes
  with the regex extractor (never a silent downgrade); pre-warm with
  `ultraindex grammars pull`. Other languages use the regex extractors anyway.
  Barrel re-exports, top doc-comment and local imports come along too.
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
- **Graph** — typed edges (`import`, `call`, `use`, `doc-link`, conservative
  `mention` — the set `neighbors --kind` filters on),
  file-level and lifted to module level; deterministic **PageRank** ranks the
  hubs and **Brandes betweenness** finds the bridges between subsystems, a
  derived **tests→code** map records which tests cover each module, and Louvain
  communities flag **surprising** near-unique cross-community couplings.
- **Render** — a budgeted `INDEX.md`, per-module entries split into tool-owned
  `ui:gen` regions and author-owned `ui:human` regions, plus `graph.json` /
  `graph.mmd` / `manifest.json`.

Then a **grounded AI layer** (this skill, via the agent) adds the *understanding*:
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

## Measured token savings

`evals/token-savings/run.mjs` meters three representative agent tasks
end-to-end — counting every byte of output the agent would read, tokens =
ceil(chars/4) — against a naive baseline (ripgrep the symbol, read each matched
file in full). On the pinned fixture `tests/fixtures/mini-repo`:

| Task | ultraindex tokens | baseline tokens | ratio (baseline / ultraindex) |
| --- | ---: | ---: | ---: |
| where is symbol `backoff` defined | 30 | 296 | 9.87× |
| who calls `backoff` | 74 | 296 | 4× |
| overview of module `src` | 398 | 146 | 0.37× |
| **total** | **502** | **738** | **1.47×** |

The one-off index build costs ~60 ms and 84 output tokens on the fixture —
reported separately because it amortizes across every subsequent task. Two
honest caveats: the module-overview task *loses* on the fixture (the generated
encyclopedia entry, ~1.6 KB, is richer than the module's entire raw source,
~600 B), and per-query wall-clock is slower there (~25–50 ms vs ~5 ms — node
startup dominates on a tiny repo). Both are fixture-size artifacts: the same
eval run on this repository itself measured 4873×, 1364× and 47× (total 213×;
build overhead 532 ms / 86 tokens). Ratios grow with repo size; the tiny
fixture is the worst case.

Reproduce with `node evals/token-savings/run.mjs` (defaults pin the fixture;
`--repo <dir> --symbol <name> --module <slug> --module-path <dir>` retarget it).

## Semantic search (optional, keyless)

Lexical search can't bridge a real vocabulary gap ("invoicing" vs a module that
only ever says "billing"). The optional semantic layer embeds each module and
makes `find` **hybrid**: lexical and semantic rankings fused with Reciprocal
Rank Fusion. It is strictly additive — without it, nothing changes.

There is **no API key and no provider to stand up**. The embedding tiers belong
to the vendored codeindex engine; ultraindex only decides what gets embedded —
one vector per module, folding in the prose you wrote, which is the one signal a
file-level index cannot have.

```bash
ultraindex embed                # pulls the keyless model on first use, writes vectors.json
ultraindex find "invoicing"     # now hybrid — results carry semanticRank
```

Precedence is the engine's: **endpoint > static > none**. Prefer a richer local
model? `codeindex embed serve` prints the container one-liner; then set
`CODEINDEX_EMBED_ENDPOINT` — setting it is explicit intent, so it wins over the
local model.

Degradation is graceful: endpoint unreachable ⇒ lexical-only results + a stderr
warning; no `vectors.json` ⇒ pure lexical, silent, zero network (delete the file
to switch the layer off). `check` warns when vectors drift stale.
**Reproducibility:** `manifest.json` is the only artifact outside the
byte-identical rebuild guarantee (its `builtAt` timestamp). `vectors.json` is
*inside* it on the static tier — the encoder is a pure lookup table with
banker's rounding and integer ranking. Only the endpoint tier, whose floats come
from a server, falls outside.

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
