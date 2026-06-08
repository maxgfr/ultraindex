import { join } from "node:path";
import { indexPaths } from "./store.js";
import { readIfExists } from "./output.js";

// Print the map (INDEX.md) or a single module's entry — cheaply, straight from
// disk, without touching the repo. The navigator's "orient" step.
export function runMap(outDir: string, moduleSlug?: string): string | undefined {
  const paths = indexPaths(outDir);
  if (moduleSlug) {
    return readIfExists(join(paths.encyclopedia, `${moduleSlug}.md`));
  }
  return readIfExists(paths.index);
}
