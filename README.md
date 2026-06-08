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

It ships as **two skills.sh agent skills** sharing one bundle:

- **`ultraindex`** (generator) — `skills/ultraindex/`. Scans and writes the index;
  you then do a *light*, module-by-module pass to fill the business prose.
- **`ultraindex-nav`** (light navigator) — `skills/ultraindex-nav/`. Consumes the
  index so an agent opens only the handful of entries/files a task needs.

## CLI

```
ultraindex build  --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--no-mermaid]
ultraindex find   "<query>" [--out <dir>] [--k <n>]
ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
ultraindex map    [--out <dir>] [--module <slug>]
ultraindex check  [--out <dir>] [--repo <dir>]
```

- **build** — scan + (re)write the index. Idempotent: regenerates the code view
  and graph, **preserves** your enriched prose (matched by region key even across
  module renames; truly-removed modules' prose is kept under `encyclopedia/_orphaned/`).
- **find** — rank modules for a task and print the **exact files to open**.
- **neighbors** — walk the graph from a file or module.
- **map** — print `INDEX.md` (or one module's entry) cheaply.
- **check** — report staleness (content changed since build) + integrity. Non-zero
  exit ⇒ stale or broken.

Default output is `<repo>/.ultraindex` (gitignored). Use `--out docs/ultraindex`
to commit a PR-reviewable index — deterministic, byte-stable rebuilds keep diffs small.

## How it works

Fully deterministic, no model, no network:

- **Scan** — gitignore-aware walk; per-file extraction of markdown (title /
  headings / links) and code (exported symbols + signatures, top doc-comment,
  local imports).
- **Resolve** — markdown relative links, and local imports for **JS/TS** (incl.
  `tsconfig` path aliases), **Python**, and **Go** (via `go.mod`). Unresolved
  local targets become **dangling** edges (surfaced, never silently dropped);
  third-party/stdlib specifiers are external (no edge).
- **Graph** — typed edges (`doc-link`, `import`, conservative `mention`),
  file-level and lifted to module level; degree centrality picks the hubs.
- **Render** — a budgeted `INDEX.md`, per-module entries split into tool-owned
  `ui:gen` regions and author-owned `ui:human` regions, plus `graph.json` /
  `graph.mmd` / `manifest.json`.

ripgrep is used when present (faster); without it a built-in scanner is used.
Without `git`, the manifest just omits the commit.

## Develop

```
pnpm install
pnpm build        # tsup → scripts/ultraindex.mjs, mirrored into both skill dirs
pnpm test         # vitest
pnpm typecheck
pnpm check:build  # asserts the three committed bundles are reproducible
```

Releases are Conventional-Commit-driven via semantic-release (GitHub releases).

## License

MIT
