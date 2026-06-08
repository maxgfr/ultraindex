import { sh } from "./util.js";

// The short HEAD commit of a working tree, when it is a git repo. Recorded in
// the manifest so an index is pinned to an exact revision. Returns undefined
// when `git` is absent or the directory isn't a repo — the index still works.
export function headCommit(dir: string): string | undefined {
  const res = sh("git", ["-C", dir, "rev-parse", "--short", "HEAD"]);
  return res.ok ? res.stdout.trim() : undefined;
}
