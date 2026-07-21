import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";
import { runFind } from "../src/find.js";
import { runStatus } from "../src/status.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../scripts/ultraindex.mjs", import.meta.url));
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function freshIndex(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "ui-status-")), ".ultraindex");
  runBuild({ repo: REPO, out: dir, mermaid: false, json: false }, FIXED_TIME);
  return dir;
}

// Replace a module's business stub with real prose, the way an agent would.
function enrich(dir: string, slug: string, prose: string): void {
  const entry = join(dir, "encyclopedia", `${slug}.md`);
  const text = readFileSync(entry, "utf8");
  const updated = text.replace(/<!-- ui:human key=business -->[\s\S]*?<!-- \/ui:human key=business -->/, `<!-- ui:human key=business -->\n${prose}\n<!-- /ui:human key=business -->`);
  expect(updated).not.toBe(text);
  writeFileSync(entry, updated);
}

describe("runStatus: the enrichment work-queue", () => {
  it("reports every module as unenriched on a fresh build", () => {
    const dir = freshIndex();
    const res = runStatus(dir)!;
    expect(res.enriched).toBe(0);
    expect(res.total).toBeGreaterThan(0);
    expect(res.modules.every((m) => !m.enriched)).toBe(true);
    expect(res.suggestedNext.length).toBeGreaterThan(0);
    // Human regions exist but are all stubs.
    expect(res.modules[0]!.regions.total).toBeGreaterThan(0);
    expect(res.modules[0]!.regions.enriched).toBe(0);
  });

  it("orders unenriched before enriched, tail last, hubs first", () => {
    const dir = freshIndex();
    const fresh = runStatus(dir)!;
    // Unenriched ordering: non-tail before tail, then degree descending.
    const nonTail = fresh.modules.filter((m) => m.tier !== 2);
    for (let i = 1; i < nonTail.length; i++) {
      expect(nonTail[i - 1]!.degree).toBeGreaterThanOrEqual(nonTail[i]!.degree);
    }
    // Enrich the suggested-first module: it must drop to the back of the queue.
    const first = fresh.suggestedNext[0]!;
    enrich(dir, first, "Real prose, no stub marker left.");
    const after = runStatus(dir)!;
    expect(after.enriched).toBe(1);
    expect(after.suggestedNext).not.toContain(first);
    const entry = after.modules.find((m) => m.slug === first)!;
    expect(entry.enriched).toBe(true);
    expect(entry.regions.enriched).toBe(1);
    const idx = after.modules.findIndex((m) => m.slug === first);
    expect(after.modules.slice(0, idx).every((m) => !m.enriched)).toBe(true);
  });

  it("returns undefined without an index", () => {
    expect(runStatus(mkdtempSync(join(tmpdir(), "ui-empty-")))).toBeUndefined();
  });
});

describe("runFind: enriched prose is searchable", () => {
  it("ranks a module first when only its verified prose matches, flagged enriched", () => {
    const dir = freshIndex();
    enrich(dir, "src", "Frobnicates the billing reconciliation ledger nightly [src/util.ts:1].");
    const results = runFind(dir, "billing reconciliation")!;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.slug).toBe("src");
    expect(results[0]!.enriched).toBe(true);
    expect(results[0]!.matched).toContain("billing");
  });

  it("never matches stub placeholder text and reports enriched=false on stubs", () => {
    const dir = freshIndex();
    // Every fresh entry contains this stub phrase — excluded bodies must not match.
    expect(runFind(dir, "enrichment pass")!).toEqual([]);
    const results = runFind(dir, "client util")!;
    expect(results.every((r) => r.enriched === false)).toBe(true);
  });

  it("does not let citation brackets pollute matching", () => {
    const dir = freshIndex();
    enrich(dir, "src", "Handles payment retries [src/very-unique-name.ts:42].");
    // The citation's path tokens are stripped before scoring.
    expect(runFind(dir, "very-unique-name")!).toEqual([]);
  });
});

describe("CLI json surfaces (committed bundle)", () => {
  const run = (args: string[]): string =>
    execFileSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8" });

  it("map --json emits the parsable module table", () => {
    const dir = freshIndex();
    const modules = JSON.parse(run(["map", "--out", dir, "--json"])) as {
      slug: string; path: string; tier: number; degree: number; files: number; summary: string;
      pagerank: number; tested: boolean;
    }[];
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      expect(typeof m.slug).toBe("string");
      expect(typeof m.degree).toBe("number");
      expect(typeof m.files).toBe("number");
      expect(typeof m.pagerank).toBe("number");
      expect(typeof m.tested).toBe("boolean");
    }
  });

  it("status --json emits the work-queue", () => {
    const dir = freshIndex();
    const res = JSON.parse(run(["status", "--out", dir, "--json"])) as {
      enriched: number; total: number; untested: number; suggestedNext: string[]; modules: unknown[];
    };
    expect(res.enriched).toBe(0);
    expect(res.modules.length).toBe(res.total);
    expect(typeof res.untested).toBe("number");
  });

  it("build --json includes reasonHints only when something dangles", () => {
    // mini-repo carries a deliberate dangling doc link → hints present.
    const out1 = join(mkdtempSync(join(tmpdir(), "ui-json-")), ".ultraindex");
    const withDangling = JSON.parse(run(["build", "--repo", REPO, "--out", out1, "--json", "--no-mermaid"]));
    expect(withDangling.dangling).toBeGreaterThan(0);
    for (const reason of Object.keys(withDangling.danglingByReason)) {
      expect(typeof withDangling.reasonHints[reason]).toBe("string");
    }
    // A clean repo → no danglingByReason / reasonHints keys at all.
    const clean = mkdtempSync(join(tmpdir(), "ui-clean-"));
    writeFileSync(join(clean, "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
    writeFileSync(join(clean, "b.ts"), "export const b = 1;\n");
    const out2 = join(mkdtempSync(join(tmpdir(), "ui-json-")), ".ultraindex");
    const noDangling = JSON.parse(run(["build", "--repo", clean, "--out", out2, "--json", "--no-mermaid"]));
    expect(noDangling.dangling).toBe(0);
    expect(noDangling.reasonHints).toBeUndefined();
  });
});
