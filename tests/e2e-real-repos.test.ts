import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";
import { runCheck } from "../src/check.js";
import type { Graph } from "../src/types.js";

// Empirical validation against REAL public monorepos, pinned by commit. Opt-in
// (network + minutes of work): `pnpm run test:e2e`. The dangling-rate thresholds
// are a ratchet — pinned near the measured baseline so a resolution regression
// fails loudly, while upstream churn can't (the commits are pinned).
const E2E = !!process.env.ULTRAINDEX_E2E;

const CACHE = fileURLToPath(new URL("./.e2e-cache", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../scripts/ultraindex.mjs", import.meta.url));
const FIXED_TIME = "2026-01-01T00:00:00.000Z";
const KNOWN_REASONS = new Set([
  "missing-module",
  "alias-unresolved",
  "escapes-repo-root",
  "missing-package",
  "missing-target",
]);

interface RealRepo {
  slug: string; // owner/name on GitHub
  sha: string; // pinned commit — re-pin deliberately, never float
  maxDanglingRatio: number; // ratchet: dangling / total edges must stay below
  // A resolved cross-package edge that must exist (from-prefix, to-prefix) —
  // the regression teeth proving workspace resolution actually worked here.
  crossEdge: [RegExp, RegExp];
}

const REPOS: RealRepo[] = [
  {
    // The original adversarial-audit anchor: yarn workspaces + Next.js app dir.
    slug: "socialgouv/code-du-travail-numerique",
    sha: "886297ad7ce94d6377863d8fbf88e24f696dd3b7",
    maxDanglingRatio: 0.002, // measured baseline: 1/4437 edges (0.02%)
    crossEdge: [/^packages\/code-du-travail-frontend\//, /^packages\/(?!code-du-travail-frontend\/)/],
  },
  {
    // Turborepo + pnpm; packages route subpaths through conditional `exports`.
    slug: "t3-oss/create-t3-turbo",
    sha: "8f945b7bb3bfb3ca8358d48b1ff0214079bc11ee",
    maxDanglingRatio: 0.02, // measured baseline: 1/121 edges (0.83%)
    crossEdge: [/^apps\//, /^packages\//],
  },
  {
    // Canonical Nx layout: root tsconfig.base.json carrying the @org/* aliases.
    slug: "nrwl/nx-examples",
    sha: "0808ace9640cdae6fbbc9b000292383ea6d78c9f",
    maxDanglingRatio: 0.01, // measured baseline: 0/85 edges
    crossEdge: [/^apps\//, /^libs\//],
  },
];

// Shallow-fetch the pinned commit into the cache; re-runs are offline.
function clonePinned(repo: RealRepo): string {
  const dir = join(CACHE, `${repo.slug.replace("/", "__")}@${repo.sha.slice(0, 12)}`);
  if (existsSync(join(dir, ".git"))) return dir;
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("remote", "add", "origin", `https://github.com/${repo.slug}`);
  git("fetch", "-q", "--depth", "1", "origin", repo.sha);
  git("checkout", "-q", "FETCH_HEAD");
  return dir;
}

// Build once per repo per run; every assertion shares the result.
const built = new Map<string, { graph: Graph; outDir: string; repoDir: string }>();
function buildOnce(repo: RealRepo) {
  let b = built.get(repo.slug);
  if (!b) {
    const repoDir = clonePinned(repo);
    const outDir = join(mkdtempSync(join(tmpdir(), "ui-e2e-")), ".ultraindex");
    const { graph } = runBuild({ repo: repoDir, out: outDir, mermaid: false, json: true }, FIXED_TIME);
    built.set(repo.slug, (b = { graph, outDir, repoDir }));
  }
  return b;
}

describe.skipIf(!E2E).each(REPOS)("real monorepo: $slug", (repo) => {
  it("builds without throwing and keeps the dangling rate under the ratchet", { timeout: 900_000 }, () => {
    const { graph } = buildOnce(repo);
    const dangling = graph.fileEdges.filter((e) => e.dangling).length;
    const ratio = graph.fileEdges.length ? dangling / graph.fileEdges.length : 0;
    // eslint-disable-next-line no-console
    console.log(`${repo.slug}: ${graph.fileCount} files, ${graph.fileEdges.length} edges, ${dangling} dangling (${(ratio * 100).toFixed(2)}%)`);
    expect(ratio).toBeLessThan(repo.maxDanglingRatio);
  });

  it("only reports KNOWN dangling reasons (self-diagnosing contract)", { timeout: 60_000 }, () => {
    const { graph } = buildOnce(repo);
    const reasons = new Set(graph.fileEdges.filter((e) => e.dangling).map((e) => e.reason ?? ""));
    for (const r of reasons) expect(KNOWN_REASONS.has(r), `unknown dangling reason "${r}"`).toBe(true);
  });

  it("resolves a real cross-package edge (workspace resolution worked here)", { timeout: 60_000 }, () => {
    const { graph } = buildOnce(repo);
    const [fromRe, toRe] = repo.crossEdge;
    const hit = graph.fileEdges.some(
      (e) => e.kind === "import" && !e.dangling && fromRe.test(e.from) && toRe.test(e.to),
    );
    expect(hit, `no resolved import edge matching ${fromRe} → ${toRe}`).toBe(true);
  });

  it("is deterministic: a second build produces byte-identical graph.json", { timeout: 900_000 }, () => {
    const { outDir, repoDir } = buildOnce(repo);
    const outDir2 = join(mkdtempSync(join(tmpdir(), "ui-e2e-")), ".ultraindex");
    runBuild({ repo: repoDir, out: outDir2, mermaid: false, json: true }, FIXED_TIME);
    expect(readFileSync(join(outDir2, "graph.json"), "utf8")).toBe(readFileSync(join(outDir, "graph.json"), "utf8"));
  });

  it("reports fresh and structurally sound right after the build", { timeout: 300_000 }, () => {
    const { outDir, repoDir } = buildOnce(repo);
    const check = runCheck(outDir, repoDir);
    expect(check.errors).toEqual([]);
    expect(check.stale).toBe(false);
  });
});

describe.skipIf(!E2E)("committed bundle smoke", () => {
  it("the shipped ultraindex.mjs builds a real repo and emits valid --json", { timeout: 900_000 }, () => {
    const repoDir = clonePinned(REPOS[1]!); // the smallest of the matrix
    const outDir = join(mkdtempSync(join(tmpdir(), "ui-e2e-")), ".ultraindex");
    const stdout = execFileSync(
      process.execPath,
      [BUNDLE, "build", "--repo", repoDir, "--out", outDir, "--json", "--no-mermaid"],
      { encoding: "utf8" },
    );
    const report = JSON.parse(stdout) as { files: number; modules: number; edges: number; dangling: number };
    expect(report.files).toBeGreaterThan(0);
    expect(report.modules).toBeGreaterThan(0);
    expect(report.edges).toBeGreaterThan(0);
  });
});
