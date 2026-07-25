import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests build indexes into temp dirs and fixtures carry their own committed
    // `.ultraindex/` output — never collect tests from those trees.
    exclude: [...configDefaults.exclude, "**/.ultraindex/**", "tests/fixtures/**"],
    // Load the tree-sitter grammars before every suite so unit tests extract via
    // the AST path, matching the shipped bundle.
    setupFiles: ["tests/setup.ts"],
  },
});
