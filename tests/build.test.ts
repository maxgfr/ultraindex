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
    for (const f of ["graph.json", "INDEX.md", "graph.mmd", "encyclopedia/src.md", "encyclopedia/root.md"]) {
      expect(readFileSync(join(a, f), "utf8")).toBe(readFileSync(join(b, f), "utf8"));
    }
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
    // Modules with no keyword match must not surface.
    expect(results.every((r) => r.matched.length > 0)).toBe(true);
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
