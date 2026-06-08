import { posix } from "node:path";
import type { FileRecord, Tier } from "./types.js";
import type { RepoScan } from "./scan.js";
import { slugify } from "./util.js";
import { byStr } from "./sort.js";

// A module is a directory's worth of files — the unit a developer thinks in
// ("src/lang is the language extractors"). Grouping by immediate parent dir is
// deterministic and maps cleanly onto how repos are organized.
export interface ModuleInfo {
  slug: string;
  path: string; // directory path, or "(root)" for top-level files
  title: string;
  tier: Tier;
  members: string[]; // member file rels, sorted
  summary: string;
}

const ROOT_PATH = "(root)";

// Foundations: shared building blocks features depend on (matched on the leaf).
const TIER0 = /(^|\/)(types?|util|utils|lib|libs|common|core|config|configs|constants|shared|helpers|internal)$/i;
// Tail: supporting material, not the product itself. Matched on ANY path
// segment — `a/__tests__/b` is still test material, not a feature.
const TIER2_ANY = /(^|\/)(tests?|__tests__|spec|specs|__mocks__|__snapshots__|examples?|example|benchmark|benchmarks|fixtures?|docs?|documentation|\.github)(\/|$)/i;
// Scripts/CI only count as tail when they're the leaf (a `scripts/` dir), not
// when "scripts" merely appears mid-path.
const TIER2_LEAF = /(^|\/)(scripts?|bin|\.storybook)$/i;

function dirOf(rel: string): string {
  return rel.includes("/") ? posix.dirname(rel) : ROOT_PATH;
}

// Path-only tier decision; returns null when the path alone is undecided.
export function tierForPath(path: string): Tier | null {
  if (path === ROOT_PATH) return 0; // root manifests/READMEs are foundational context
  if (TIER2_ANY.test(path) || TIER2_LEAF.test(path)) return 2;
  if (TIER0.test(path)) return 0;
  return null;
}

function tierOf(path: string, members: FileRecord[]): Tier {
  const byPath = tierForPath(path);
  if (byPath !== null) return byPath;
  // A directory that is entirely docs/config is tail material regardless of name.
  if (members.every((m) => m.kind === "doc" || m.kind === "config")) return 2;
  return 1;
}

// Deterministic one-line summary for a module, with no model involvement:
// prefer a directory README/index's own summary, else the richest member's
// doc-comment, else a structural fallback.
function summaryOf(path: string, members: FileRecord[]): string {
  const readme = members.find((m) => /^(readme|index)\.(md|mdx)$/i.test(m.rel.split("/").pop()!));
  if (readme?.summary) return readme.summary;
  const withSummary = members
    .filter((m) => m.summary)
    .sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0));
  if (withSummary[0]?.summary) return withSummary[0].summary;
  const langs = [...new Set(members.map((m) => m.lang))].filter((l) => l !== "other");
  const where = path === ROOT_PATH ? "the repository root" : `\`${path}/\``;
  return `${members.length} file(s) in ${where}${langs.length ? ` (${langs.slice(0, 3).join(", ")})` : ""}.`;
}

// Group all scanned files into modules. Returns the modules (sorted by slug) and
// a rel → slug lookup the graph builder uses to lift file edges to module edges.
export function buildModules(scan: RepoScan): {
  modules: ModuleInfo[];
  moduleOf: Map<string, string>;
} {
  const byDir = new Map<string, FileRecord[]>();
  for (const f of scan.files) {
    const dir = dirOf(f.rel);
    let list = byDir.get(dir);
    if (!list) byDir.set(dir, (list = []));
    list.push(f);
  }

  const usedSlugs = new Set<string>();
  const uniqueSlug = (base: string): string => {
    let slug = base || "module";
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    return slug;
  };

  const modules: ModuleInfo[] = [];
  const moduleOf = new Map<string, string>();
  const dirs = [...byDir.keys()].sort(byStr);
  for (const dir of dirs) {
    const members = byDir.get(dir)!.slice().sort((a, b) => byStr(a.rel, b.rel));
    const slug = uniqueSlug(dir === ROOT_PATH ? "root" : slugify(dir));
    const info: ModuleInfo = {
      slug,
      path: dir,
      title: dir,
      tier: tierOf(dir, members),
      members: members.map((m) => m.rel),
      summary: summaryOf(dir, members),
    };
    modules.push(info);
    for (const m of members) moduleOf.set(m.rel, slug);
  }

  modules.sort((a, b) => byStr(a.slug, b.slug));
  return { modules, moduleOf };
}
