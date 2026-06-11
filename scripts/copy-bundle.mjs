#!/usr/bin/env node
// Mirror the source-of-truth bundle (scripts/ultraindex.mjs, produced by tsup)
// byte-for-byte into the skill directory. The skill ships standalone — `npx
// skills add` copies the skill dir — so it needs its own copy of the bundle
// next to its SKILL.md. A plain copy (no transform) keeps the two files
// identical, which is what `check:build` asserts.
import { copyFileSync } from "node:fs";
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
