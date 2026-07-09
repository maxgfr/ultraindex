import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";
import { runCheck } from "../src/check.js";
import { runFind } from "../src/find.js";
import { runNeighbors } from "../src/neighbors.js";
import { loadGraph, loadManifest } from "../src/store.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function out(): string {
  return join(mkdtempSync(join(tmpdir(), "ui-build-")), ".ultraindex");
}

function build(dir: string, mermaid = true) {
  return runBuild(
    { repo: REPO, out: dir, mermaid, json: false },
    FIXED_TIME,
  );
}

describe("runBuild", () => {
  it("writes the full layered artifact", () => {
    const dir = out();
    build(dir);
    expect(existsSync(join(dir, "INDEX.md"))).toBe(true);
    expect(existsSync(join(dir, "graph.json"))).toBe(true);
    expect(existsSync(join(dir, "graph.mmd"))).toBe(true);
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "encyclopedia", "src.md"))).toBe(true);
    const graph = loadGraph(dir)!;
    expect(graph.modules.length).toBe(6);
    expect(graph.fileEdges.some((e) => e.dangling)).toBe(true);
  });

  it("surfaces the --max-files cap instead of silently truncating", () => {
    const dir = out();
    const res = runBuild({ repo: REPO, out: dir, maxFiles: 3, mermaid: false, json: false }, FIXED_TIME);
    expect(res.capped).toBe(true);
    expect(res.graph.fileCount).toBeLessThanOrEqual(4); // soft cap: at most one dir's overshoot
    const manifest = loadManifest(dir)!;
    expect(manifest.notes.some((n) => /--max-files cap/.test(n))).toBe(true);
    expect(manifest.scan?.maxFiles).toBe(3);
  });

  it("does not report capped for an uncapped build", () => {
    const dir = out();
    expect(build(dir).capped).toBe(false);
  });

  it("writes the current schema version so an old index is rejected, not misread", () => {
    const dir = out();
    build(dir);
    expect(loadGraph(dir)!.schemaVersion).toBe(2);
    expect(loadManifest(dir)!.schemaVersion).toBe(2);
  });

  it("omits graph.mmd with mermaid disabled", () => {
    const dir = out();
    build(dir, false);
    expect(existsSync(join(dir, "graph.mmd"))).toBe(false);
    expect(loadManifest(dir)!.notes.some((n) => /mermaid/.test(n))).toBe(true);
  });

  it("is byte-identical across two builds of an unchanged repo (graph + entries)", () => {
    const a = out();
    const b = out();
    build(a);
    build(b);
    for (const f of ["graph.json", "symbols.json", "INDEX.md", "graph.mmd", "encyclopedia/src.md", "encyclopedia/root.md"]) {
      expect(readFileSync(join(a, f), "utf8")).toBe(readFileSync(join(b, f), "utf8"));
    }
  });

  it("emits symbols.json with definition sites for the symbols command", () => {
    const dir = out();
    build(dir);
    const idx = JSON.parse(readFileSync(join(dir, "symbols.json"), "utf8"));
    expect(idx.schemaVersion).toBe(2);
    // Every def entry carries a resolvable file:line so `symbols` can point at it.
    const someName = Object.keys(idx.defs)[0]!;
    expect(someName).toBeTruthy();
    const site = idx.defs[someName]![0];
    expect(typeof site.file).toBe("string");
    expect(typeof site.line).toBe("number");
    expect(typeof site.exported).toBe("boolean");
  });

  it("preserves enriched prose across a rebuild (idempotent merge end-to-end)", () => {
    const dir = out();
    build(dir);
    const entry = join(dir, "encyclopedia", "src.md");
    const enriched = readFileSync(entry, "utf8").replace(
      /<!-- ui:enrich --> _What this module does[^\n]*/,
      "This module is the HTTP client core.",
    );
    writeFileSync(entry, enriched);
    build(dir); // rebuild
    const after = readFileSync(entry, "utf8");
    expect(after).toContain("This module is the HTTP client core.");
    expect(after).toContain("## Code view"); // generated section still present
  });
});

describe("check after build", () => {
  it("is FRESH right after a build and STALE after a file changes", () => {
    const dir = out();
    build(dir);
    const fresh = runCheck(dir, REPO);
    expect(fresh.ok).toBe(true);
    expect(fresh.stale).toBe(false);

    // Tamper with the manifest's record for one file to simulate drift.
    const mPath = join(dir, "manifest.json");
    const m = JSON.parse(readFileSync(mPath, "utf8"));
    m.fileHashes["src/util.ts"] = "deadbeef";
    writeFileSync(mPath, JSON.stringify(m, null, 2));
    const stale = runCheck(dir, REPO);
    expect(stale.stale).toBe(true);
    expect(stale.changed).toContain("src/util.ts");
    expect(stale.ok).toBe(false);
  });
});

describe("find + neighbors after build", () => {
  it("find returns the right module and the exact files to open", () => {
    const dir = out();
    build(dir);
    const results = runFind(dir, "backoff retry", 5)!;
    expect(results[0]?.slug).toBe("src");
    expect(results[0]?.files).toContain("src/util.ts");
    // A module with no keyword match surfaces only as an appended graph/term row
    // (flagged with `via`) — never as an unflagged ranked hit.
    expect(results.every((r) => r.matched.length > 0 || r.via !== undefined)).toBe(true);
  });

  it("neighbors walks the graph for a module and a file", () => {
    const dir = out();
    build(dir);
    const modN = runNeighbors(dir, "gopkg", 1)!;
    expect(modN.scope).toBe("module");
    expect(modN.links.some((l) => l.node === "gopkg-sub")).toBe(true);
    const fileN = runNeighbors(dir, "src/util.ts", 1)!;
    expect(fileN.scope).toBe("file");
    expect(fileN.links.some((l) => l.node === "src/client.ts")).toBe(true);
  });
});
