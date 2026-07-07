#!/usr/bin/env node
// Mirror the source-of-truth bundle (scripts/ultraindex.mjs, produced by tsup)
// byte-for-byte into the skill directory. The skill ships standalone — `npx
// skills add` copies the skill dir — so it needs its own copy of the bundle
// next to its SKILL.md. A plain copy (no transform) keeps the two files
// identical, which is what `check:build` asserts.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "scripts", "ultraindex.mjs");
const targets = [
  join(root, "skills", "ultraindex", "scripts", "ultraindex.mjs"),
];

for (const target of targets) {
  copyFileSync(source, target);
  console.log(`copy-bundle: ${source} -> ${target}`);
}

// Mirror the committed tree-sitter grammar wasms next to the skill's bundle so
// the skill installs standalone (the engine loads grammars/<key>.wasm relative
// to itself). Rebuilt from scratch so a removed grammar never lingers.
const grammarsSrc = join(root, "scripts", "grammars");
const grammarsDst = join(root, "skills", "ultraindex", "scripts", "grammars");
rmSync(grammarsDst, { recursive: true, force: true });
mkdirSync(grammarsDst, { recursive: true });
let n = 0;
for (const f of readdirSync(grammarsSrc)) {
  if (!f.endsWith(".wasm")) continue;
  copyFileSync(join(grammarsSrc, f), join(grammarsDst, f));
  n++;
}
console.log(`copy-bundle: mirrored ${n} grammar wasm(s) -> ${grammarsDst}`);
