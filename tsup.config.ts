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
    dts: true,
  },
]);
