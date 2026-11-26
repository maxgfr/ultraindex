import { basename } from "node:path";
import { indexPaths } from "./store.js";
import { readIfExists, writeFileIfChanged } from "./output.js";

// An index directory holds two kinds of file:
//
// - the REVIEWABLE index — INDEX.md, encyclopedia/, graph.json, graph.mmd,
//   manifest.json, symbols.json. This is what a PR reviewer reads and what the
//   read commands (map, find, neighbors, symbols, check, status…) answer from on
//   a fresh clone, so a committed index (`--out docs/ultraindex`) tracks it.
// - REGENERABLE state — large derived corpora and caches that `build` or `embed`
//   re-derive at will, and that cost hundreds of MB on a big repo. A committed
//   index must never drag them in, so `build` keeps `<out>/.gitignore` listing
//   them. Every command degrades gracefully when one is missing (see README).
//
// A new artifact written into the index dir must be classified here or in the
// reviewable set: tests/index-gitignore.test.ts fails on anything unclassified.
const REGENERABLE_KEYS = ["cache", "callers", "search", "vectors"] as const;

// Basenames of the regenerable artifacts, sorted for a deterministic block.
export function regenerableArtifacts(): string[] {
  const paths = indexPaths("");
  return REGENERABLE_KEYS.map((k) => basename(paths[k])).sort();
}

// Leftovers of an interrupted write: writeFileIfChanged writes `<path>.tmp` and
// renames it into place, so a crash mid-write can leave one at any depth.
export const TRANSIENT_PATTERNS = ["*.tmp"] as const;

export const GITIGNORE_BEGIN = "# BEGIN ultraindex (managed by `ultraindex build`; edits inside this block are overwritten)";
export const GITIGNORE_END = "# END ultraindex";

export function renderManagedBlock(): string {
  return (
    [
      GITIGNORE_BEGIN,
      "# Regenerable: `ultraindex build` / `ultraindex embed` re-derive these. Lines below the",
      "# block win, so `!vectors.json` there commits the semantic layer.",
      ...regenerableArtifacts(),
      ...TRANSIENT_PATTERNS,
      GITIGNORE_END,
    ].join("\n") + "\n"
  );
}

// Splice the managed block into an existing .gitignore. Everything outside the
// block is kept byte for byte. The block is the first BEGIN line followed by an
// END line; with none (or only a half-written one, which is then left alone as
// ordinary comment lines), the block goes FIRST, so user lines after it can
// override it with a `!pattern`. Pure and idempotent: rendering the output
// again returns it unchanged.
export function mergeGitignore(existing: string | undefined): string {
  const block = renderManagedBlock();
  if (existing === undefined || existing === "") return block;
  const lines = existing.split(/(?<=\n)/); // each line keeps its terminator
  const strip = (l: string) => l.replace(/\r?\n$/, "");
  const begin = lines.findIndex((l) => strip(l) === GITIGNORE_BEGIN);
  const end = begin < 0 ? -1 : lines.findIndex((l, i) => i > begin && strip(l) === GITIGNORE_END);
  if (begin < 0 || end < 0) return block + existing;
  const before = lines.slice(0, begin).join("");
  const after = lines.slice(end + 1).join("");
  return before + block + after;
}

// Write (or refresh) `<out>/.gitignore`. Written for every out dir, the default
// `.ultraindex` included: a repo that does not ignore that dir still never
// commits the regenerable state, and copying or moving an index keeps the rule.
export function writeIndexGitignore(outDir: string): void {
  const path = indexPaths(outDir).gitignore;
  writeFileIfChanged(path, mergeGitignore(readIfExists(path)));
}
