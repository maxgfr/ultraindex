import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests build indexes into temp dirs and fixtures carry their own committed
    // `.ultraindex/` output — never collect tests from those trees.
    exclude: [...configDefaults.exclude, "**/.ultraindex/**", "tests/fixtures/**"],
  },
});
