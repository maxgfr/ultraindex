import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuild } from "../src/build.js";
import { loadGraph } from "../src/store.js";

const TIME = "2026-01-01T00:00:00.000Z";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ui-inc-repo-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
const outDir = () => join(mkdtempSync(join(tmpdir(), "ui-inc-out-")), ".ultraindex");
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

const SRC = {
  "src/a.ts": "export function alpha() { return 1 }\nexport class Widget {}\n",
  "src/b.ts": "import { alpha } from './a';\nexport const two = alpha() + 1;\n",
  "README.md": "# Demo\n\nSee [a](src/a.ts).\n",
};

describe("incremental build (cache.json)", () => {
  it("writes cache.json carrying the extractor version", () => {
    const root = repo(SRC);
    const out = outDir();
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    expect(existsSync(join(out, "cache.json"))).toBe(true);
    const cache = JSON.parse(read(out, "cache.json"));
    expect(cache.extractorVersion).toBeTypeOf("number");
    expect(Object.keys(cache.files).length).toBeGreaterThan(0);
  });

  it("warm rebuild (cache present) is byte-identical to the cold build", () => {
    const root = repo(SRC);
    const out = outDir();
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME); // cold — writes cache
    const cold = read(out, "graph.json");
    const coldSyms = read(out, "symbols.json");
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME); // warm — reuses cache
    expect(read(out, "graph.json")).toBe(cold);
    expect(read(out, "symbols.json")).toBe(coldSyms);
  });

  it("--no-cache build is byte-identical to the cached build", () => {
    const root = repo(SRC);
    const a = outDir();
    const b = outDir();
    runBuild({ repo: root, out: a, mermaid: false, json: false }, TIME);
    runBuild({ repo: root, out: a, mermaid: false, json: false }, TIME); // now cached
    runBuild({ repo: root, out: b, noCache: true, mermaid: false, json: false }, TIME);
    expect(read(b, "graph.json")).toBe(read(a, "graph.json"));
    expect(read(b, "symbols.json")).toBe(read(a, "symbols.json"));
  });

  it("invalidates a file's record when its content changes", () => {
    const root = repo(SRC);
    const out = outDir();
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    // Add a new exported symbol to a.ts and rebuild against the warm cache.
    writeFileSync(join(root, "src", "a.ts"), "export function alpha() { return 1 }\nexport class Widget {}\nexport function beta() {}\n");
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    const fileNode = loadGraph(out)!.files.find((f) => f.rel === "src/a.ts")!;
    expect(fileNode.symbols).toBe(3); // alpha, Widget, beta — the edit was re-extracted
  });

  it("discards a cache written by a different extractor version", () => {
    const root = repo(SRC);
    const out = outDir();
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    // Poison the cache with a bogus record under a stale extractor version — a
    // correct build must ignore it, not surface its fake symbols.
    writeFileSync(
      join(out, "cache.json"),
      JSON.stringify({
        schemaVersion: 2,
        extractorVersion: -999,
        files: { "src/a.ts": { hash: "deadbeef", record: { rel: "src/a.ts", symbols: [{ name: "GHOST" }] } } },
      }),
    );
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    const syms = JSON.parse(read(out, "symbols.json"));
    expect(syms.defs.GHOST).toBeUndefined();
    expect(syms.defs.alpha).toBeTruthy();
  });
});
