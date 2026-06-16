# Generate & enrich: build the index, then analyze the repo into it

The engine does the scan; you do the grounded analysis.

## 1. Build the index — and read the report

```
node scripts/ultraindex.mjs build --repo <path-to-repo> --json
```

Add `--out docs/ultraindex` if the team wants it committed and reviewed in PRs.
Fast even on huge repos — pure file I/O, no model involvement. The `--json`
report is self-diagnosing: if `dangling > 0`, read `danglingByReason` and its
`reasonHints`, and check `notes` (unparseable tsconfig/package.json files are
listed there). Fix what's fixable before enriching: `--exclude` vendored or
generated trees, flag repo config issues. Dangling edges usually mean **the
repo itself** has broken imports or stale doc links — report that to the user
rather than papering over it.

## 2. Skim the map

`node scripts/ultraindex.mjs map` prints `INDEX.md`: project summary, the
**hub** modules (highest-connected), and the module table. Read it once to
understand the shape of the repo.

## 3. Enrich under a budget — let `status` drive

```
node scripts/ultraindex.mjs status --json
```

The work-queue lists every module in the exact order to enrich: unenriched
first; then the tail (tier 2 — tests, docs, examples, fixtures) sorts last;
every other module is ranked most-connected first (degree-descending), so a
well-connected feature can outrank a less-connected foundation. Work the list
top-down. On a large repo, enriching the **top 10–20** entries captures most of
the navigation value — trivial leaves can stay as stubs (partial enrichment is
fine). Re-run `status` between modules to track progress. For each module:

```
node scripts/ultraindex.mjs dossier <slug>
```

This prints its **real source** + neighbours (a docs/config-only module — often
`root` — has no code, so cite its README/config files instead). Read it, then edit
`encyclopedia/<slug>.md`: fill the `ui:human` regions (`business` — what it
does for the product and how it connects; `gotchas` — caveats) with 2–5
sentences of genuine analysis, **citing the evidence** as `[file]`,
`[file:line]`, or `[file:start-end]` (e.g. `Resolves IDCC redirects
[packages/utils/src/idcc.ts:30-44]`). Write only what the source supports — no
guessing. Leave the `ui:gen` regions alone.

## 4. Verify grounding

`node scripts/ultraindex.mjs check`. It fails if any citation you wrote doesn't
resolve to a real file/line (or the index is stale / broken). Fix and re-run
until it passes — this is the guard against analyzing from memory.

## 5. Re-run `build` any time

It refreshes the code view, graph and manifest from the current code and
**keeps** every `ui:human` analysis you wrote, matching by key even across
module renames (renames migrate; truly-removed modules' prose is preserved
under `encyclopedia/_orphaned/`).

If a semantic layer is set up (vectors.json exists), re-run
`node scripts/ultraindex.mjs embed` after enrichment or rebuilds so the
vectors reflect the new prose — `check` warns when they drift.

## Scale: enrich in parallel with subagents

Each module is an independent unit of work — its own `dossier`, its own
`encyclopedia/<slug>.md`. So when many modules need enriching and your host
supports subagents (e.g. Claude Code's Task/Workflow), fan out rather than read
every dossier into one context — reading them all yourself is exactly the
context blow-up this skill exists to avoid. Without subagents the sequential loop
above is the fallback: same steps, one module at a time.

The orchestrator's sequence:

1. Run `build` **once**, then `node scripts/ultraindex.mjs status --json` for the
   work-queue.
2. Dispatch one subagent per module (or a small batch of *distinct* slugs),
   giving each only its slug. Each subagent:
   - runs `node scripts/ultraindex.mjs dossier <slug> --out <abs-index-dir>` and
     reads **only** that packet;
   - writes 2–5 sentences of cited `ui:human` prose into its **own**
     `encyclopedia/<slug>.md`, citing only files inside that module (it may open
     a file the dossier lists to cite a line past the excerpt — never a file
     outside its module);
   - does **not** run `build`, does **not** edit another module's entry, and does
     **not** touch `graph.json` / `manifest.json` / `vectors.json` / `INDEX.md`.
3. **The one hard rule:** no `build` runs while subagents are working. `build`
   rewrites *every* entry, so a mid-fan-out rebuild races and clobbers their
   writes. Build once before; never during.
4. When all return, the orchestrator runs a single `node scripts/ultraindex.mjs
   check`. There is no per-module check — it is repo-wide, so it reports every
   problem at once and keys each grounding failure to `encyclopedia/<slug>.md
   [region]`. Route each failure back to the subagent that wrote that entry, fix,
   and re-run `check`.
5. After `check` passes, the orchestrator alone runs `embed` if a semantic layer
   exists (it writes the single shared `vectors.json`).

`status` reads entries straight from disk, so re-running it after the join
reflects the subagents' writes without a rebuild.

## When something fails

- **`check` rejects a citation** — re-run `dossier <slug>` and fix the
  file/line numbers against the real source. **Never delete a citation just to
  make `check` pass** — an uncited claim is worse than a failing one; if the
  evidence moved, re-read it and re-cite.
- **`check` reports stale** — re-run `build`; your prose survives. Then run
  `status` and re-visit only the modules whose member files changed
  (`check --json` lists `changed`/`added`/`removed`).
- **`build` reports orphaned prose** — a module was removed (or renamed in a
  way the migrator missed). Review `encyclopedia/_orphaned/<slug>.md` and fold
  anything still true into the successor module's entry by hand.
- **A region fence got mangled** (hand-edit gone wrong) — `build` refuses to
  rewrite that entry and notes a conflict in the manifest; fix the fences
  (`<!-- ui:human key=… -->` … `<!-- /ui:human key=… -->`) and rebuild.

## Maintenance visits (the freshness loop)

On returning to an already-indexed repo:
`check --json` → if `stale`, `build` → `status` → enrich only what the change
touched (new modules surface as unenriched; changed hubs deserve a re-read).
