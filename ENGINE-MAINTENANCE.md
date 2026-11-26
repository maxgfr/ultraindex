## Shared engine maintenance

`skill.json` declares the runtime engines, minimum versions, import floors and justified adapters. The engine bundles are byte-identical upstream release artifacts, pinned by commit and SHA-256; the skill owns its domain policy and output. Prefer upstream engine primitives for generic work, and report incomplete coverage or unavailable web sources explicitly.

Run `node scripts/sync-engine.mjs --check` and `pnpm verify:engine` to audit the installed pins and source adoption. To update, run `pnpm exec webindex skill repin`, `pnpm install --no-frozen-lockfile`, then `pnpm engine:prepare`. Review the artifact differences, commit the candidate locally and run `pnpm engine:gate` before pushing. A failed recall check requires a semantic review; do not lower floors or replace expectations simply to pass.

The development CLI is pinned by an immutable commit and follows stable releases automatically. The daily workflow calls the shared shell through WebIndex’s `v1` major tag, which every WebIndex release moves forward, so it never needs editing here (GitHub’s automatic token cannot modify workflow definitions). It validates even when no pin changes, never rebases a tested candidate, and waits for CI and publication. `pnpm exec webindex skill finish` resumes incomplete publication on the current main commit. Runtime bundles remain self-contained; the maintenance package is development-only.

## Downstream consumers

ultraindex is itself an engine: `scripts/engine.mjs` + `scripts/engine.d.mts` (built from `src/lib.ts`) are what downstream skills vendor as `ultraindex-engine.mjs`. That bundle embeds the pinned codeindex engine and re-exports it as the `codeindex` namespace, so a re-pin here changes both files; `pnpm engine:prepare` regenerates them and `check:build` asserts they are committed and reproducible. Consumers pick up a new codeindex by re-pinning ultraindex, never by vendoring codeindex beside it — two engine copies in one tree produce graphs neither side can trust. The library surface is curated by name in `src/lib.ts`; nothing reachable from it may print or touch the exit status.
