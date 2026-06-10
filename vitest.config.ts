import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests build indexes into temp dirs, fixtures carry their own committed
    // `.ultraindex/` output, and the e2e cache holds whole cloned repos (with
    // their own test suites) — never collect tests from those trees.
    exclude: [...configDefaults.exclude, "**/.ultraindex/**", "tests/fixtures/**", "tests/.e2e-cache/**"],
  },
});
