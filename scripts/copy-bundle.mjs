#!/usr/bin/env node
// Mirror the source-of-truth bundle (scripts/ultraindex.mjs, produced by tsup)
// byte-for-byte into the skill directory. The skill ships standalone — `npx
// skills add` copies the skill dir — so it needs its own copy of the bundle
// next to its SKILL.md. A plain copy (no transform) keeps the two files
// identical, which is what `check:build` asserts.
//
// The tree-sitter grammar wasms are NOT mirrored (or committed) anymore: the
// engine pulls them into a shared per-machine cache on first use (see
// `warmGrammars` in src/cli.ts / `ultraindex grammars pull`), so the shipped
// skill dir carries only the bundle, not ~17 MiB of wasm.
//
// It also gives the library declaration its final name. tsup emits the dts of
// the library entry (src/lib.ts) as scripts/engine.d.ts: the declaration build
// runs in a worker that never sees the config's `outExtension` function, and a
// `"type": "module"` package defaults ESM declarations to `.d.ts`. Consumers
// vendor `scripts/engine.mjs` + `scripts/engine.d.mts` (the shared vendoring
// convention), so the file is renamed here, on every build, before anything
// compares it. The skill dir does not need the library bundle.
import { copyFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "scripts", "ultraindex.mjs");
const targets = [
  join(root, "skills", "ultraindex", "scripts", "ultraindex.mjs"),
];

const dtsEmitted = join(root, "scripts", "engine.d.ts");
const dtsFinal = join(root, "scripts", "engine.d.mts");
if (existsSync(dtsEmitted)) {
  renameSync(dtsEmitted, dtsFinal);
  console.log(`copy-bundle: ${dtsEmitted} -> ${dtsFinal}`);
} else if (!existsSync(dtsFinal)) {
  console.error("copy-bundle: tsup emitted no library declaration (expected scripts/engine.d.ts)");
  process.exit(1);
}

for (const target of targets) {
  copyFileSync(source, target);
  console.log(`copy-bundle: ${source} -> ${target}`);
}
