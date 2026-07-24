// Types for provision-grammars.mjs (a plain-JS dev/test helper). tests/setup.ts
// imports it under tsc, so it needs a declaration; scripts/ itself is excluded
// from the TS program.

// Absolute path to the gitignored local grammars dir (rebuilt from node_modules).
export declare const LOCAL_GRAMMARS_DIR: string;

// Materialize the tree-sitter grammars from node_modules into LOCAL_GRAMMARS_DIR
// (idempotent) and return that dir. Used to point CODEINDEX_GRAMMARS_DIR at an
// offline, deterministic grammars set for the test suite.
export declare function provisionLocalGrammars(): string;
