#!/usr/bin/env node
// Dev/test only. The tree-sitter grammar wasms are NOT committed or shipped
// anymore — at skill-use time the engine pulls them into a shared per-machine
// cache (`ultraindex grammars pull`, or automatically on the first `build`).
// This script materializes the SAME grammars OFFLINE from the tree-sitter-*
// devDependencies in node_modules into a gitignored local dir, so the test
// suite (and the child-spawned bundles it drives) can exercise the AST path —
// the one the shipped bundle uses — with no network and full determinism.
//
//   node scripts/provision-grammars.mjs        # (re)build .grammars-cache/
//
// tests/setup.ts calls provisionLocalGrammars() and points the engine's
// CODEINDEX_GRAMMARS_DIR env tier at the returned dir before warming grammars.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsDir);
const nm = join(repoRoot, "node_modules");

// Gitignored: this is a rebuildable cache, not a committed artifact.
export const LOCAL_GRAMMARS_DIR = join(repoRoot, ".grammars-cache");

// Canonical language key -> source wasm under node_modules. The key is the file
// name the engine looks up (grammars/<key>.wasm), so it is part of the on-disk
// contract; keep it stable across grammar version bumps. Mirrors the set the
// engine's release tarball ships.
const GRAMMARS = {
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
  java: "tree-sitter-java/tree-sitter-java.wasm",
  c: "tree-sitter-c/tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp/tree-sitter-cpp.wasm",
  c_sharp: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
  ruby: "tree-sitter-ruby/tree-sitter-ruby.wasm",
  php: "tree-sitter-php/tree-sitter-php.wasm",
};
const RUNTIME = "web-tree-sitter/web-tree-sitter.wasm";

// Every file a complete provisioning must contain (grammars + the runtime).
const EXPECTED = [...Object.keys(GRAMMARS).map((k) => `${k}.wasm`), "web-tree-sitter.wasm"];

function fullyProvisioned(dir) {
  return existsSync(dir) && EXPECTED.every((f) => existsSync(join(dir, f)));
}

// Idempotent AND concurrency-safe: returns the ready dir. When it is missing or
// incomplete, assemble a COMPLETE copy in a private temp dir and atomically
// rename it into place — so the final dir only ever appears fully populated, and
// parallel callers (vitest runs setup.ts once per worker process, concurrently)
// can't clobber each other. The loser of the rename race simply reuses the
// winner's dir.
export function provisionLocalGrammars() {
  if (fullyProvisioned(LOCAL_GRAMMARS_DIR)) return LOCAL_GRAMMARS_DIR;
  const tmp = mkdtempSync(join(repoRoot, ".grammars-cache-tmp-"));
  try {
    for (const [key, rel] of Object.entries(GRAMMARS)) {
      copyFileSync(join(nm, rel), join(tmp, `${key}.wasm`));
    }
    copyFileSync(join(nm, RUNTIME), join(tmp, "web-tree-sitter.wasm"));
    // Atomic swap. If another worker already populated the final dir, our rename
    // fails (dir exists / not empty) — fall back to its result.
    try {
      renameSync(tmp, LOCAL_GRAMMARS_DIR);
    } catch {
      rmSync(tmp, { recursive: true, force: true });
      if (fullyProvisioned(LOCAL_GRAMMARS_DIR)) return LOCAL_GRAMMARS_DIR;
      throw new Error(`provision-grammars: could not place grammars at ${LOCAL_GRAMMARS_DIR}`);
    }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    if (fullyProvisioned(LOCAL_GRAMMARS_DIR)) return LOCAL_GRAMMARS_DIR;
    throw e;
  }
  return LOCAL_GRAMMARS_DIR;
}

// Direct invocation (`node scripts/provision-grammars.mjs`): force a clean
// rebuild and print a size table.
function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  rmSync(LOCAL_GRAMMARS_DIR, { recursive: true, force: true });
  provisionLocalGrammars();
  let total = 0;
  for (const f of readdirSync(LOCAL_GRAMMARS_DIR).sort()) {
    if (!f.endsWith(".wasm")) continue;
    const size = statSync(join(LOCAL_GRAMMARS_DIR, f)).size;
    total += size;
    process.stdout.write(`${f.padEnd(30)} ${(size / 1024).toFixed(0).padStart(6)} KiB\n`);
  }
  process.stdout.write(`${"TOTAL".padEnd(30)} ${(total / 1048576).toFixed(2).padStart(6)} MiB  -> ${LOCAL_GRAMMARS_DIR}\n`);
}
