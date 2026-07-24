import { provisionLocalGrammars } from "../scripts/provision-grammars.mjs";
import { ensureGrammars, allGrammarKeys } from "../src/engine.js";

// The grammar wasm is no longer vendored — at skill-use time the engine pulls
// it into a shared per-machine cache. For tests we instead materialize the SAME
// grammars OFFLINE from the tree-sitter-* devDependencies and point the engine's
// CODEINDEX_GRAMMARS_DIR tier at them (an absolute path, so the child-spawned
// bundles some suites drive inherit it too). This keeps the suite deterministic
// and network-free while still exercising the AST path the shipped bundle uses —
// without it the engine would silently fall back to regex under test.
//
// Warm every grammar before the test file is imported (setupFiles are awaited
// first), so scanRepo / extractCode exercise the AST path even for extraction a
// suite performs at module/describe scope (which runs before beforeAll).
// Idempotent and cached in-process, so it costs one wasm load per worker.
process.env.CODEINDEX_GRAMMARS_DIR = provisionLocalGrammars();
await ensureGrammars(allGrammarKeys());
