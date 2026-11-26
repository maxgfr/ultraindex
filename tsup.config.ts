import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Two bundles, both single-file, dependency-free ESM:
//
//   scripts/ultraindex.mjs — the CLI (src/cli.ts) that any agent sandbox can run
//     with `node`, no `npm install` required at skill-use time.
//     `scripts/copy-bundle.mjs` then mirrors it byte-exact into each skill dir
//     so they install standalone.
//   scripts/engine.mjs + scripts/engine.d.mts — the library (src/lib.ts) a
//     downstream skill vendors as `<vendor>/ultraindex-engine.mjs`, the same way
//     this repo vendors codeindex. The declaration file is self-contained: the
//     codeindex types it re-exports are inlined, so consumers copy only these
//     two files. tsup emits it as scripts/engine.d.ts; copy-bundle.mjs renames
//     it to .d.mts (see the note there).
//
// The committed bundles are verified reproducible in CI via `pnpm run check:build`.

// ultraindex's own version, read from the single source the bundle embeds
// (src/types.ts `VERSION`). The release flow stamps it there with
// scripts/sync-version.mjs and only then rebuilds, so the banner below can
// never disagree with the bytes it heads.
const VERSION = /export const VERSION = "([^"]+)";/.exec(
  readFileSync(new URL("./src/types.ts", import.meta.url), "utf8"),
)?.[1];
if (!VERSION) throw new Error("tsup.config.ts: no `export const VERSION` in src/types.ts");

// The library bundle's first lines. A vendoring tool (`webindex skill vendor`
// / `skill check`) reads a bundle's version as the FIRST
// `ENGINE_VERSION = "x.y.z"` statement in the file; without this header that
// is the embedded codeindex engine's, so pinning ultraindex is refused. A
// comment, not code: no runtime effect and no binding that could collide with
// the bundled codeindex `var ENGINE_VERSION`. The real constant is the
// `ENGINE_VERSION` export of src/lib.ts.
const ENGINE_BANNER = [
  "/*",
  `  ENGINE_VERSION = "${VERSION}"`,
  "  ultraindex's own version, announced first so vendoring tools that read the",
  "  first ENGINE_VERSION statement get ultraindex's, not the embedded codeindex",
  "  engine's (that one stays exported as codeindex.ENGINE_VERSION).",
  "*/",
].join("\n");
const shared = {
  outDir: "scripts",
  format: ["esm" as const],
  outExtension: () => ({ js: ".mjs" }),
  target: "node18",
  platform: "node" as const,
  bundle: true,
  clean: false,
  minify: false,
  splitting: false,
  sourcemap: false,
};

export default defineConfig([
  {
    ...shared,
    entry: { ultraindex: "src/cli.ts" },
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entry: { engine: "src/lib.ts" },
    banner: { js: ENGINE_BANNER },
    dts: true,
  },
]);
