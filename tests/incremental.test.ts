import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
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

  // A fixed whole-second mtime so the (size,mtime) fastpath key round-trips
  // through utimesSync/statSync exactly on any filesystem.
  const MT = new Date("2026-06-01T00:00:00.000Z");

  it("stat fastpath: an unchanged (size,mtime) NON-DOC file reuses its stale record; --full-hash catches the edit", () => {
    const root = repo({ "src/a.ts": "export function alpha() {}\n" });
    const out = outDir();
    const a = join(root, "src", "a.ts");
    utimesSync(a, MT, MT);
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME); // cold — cache carries size+mtime
    expect(JSON.parse(read(out, "symbols.json")).defs.alpha).toBeTruthy();

    // Edit the content but keep the SAME byte size (alpha→gamma) and restore mtime,
    // so the fastpath's (size,mtime) key still matches and skips the re-hash.
    writeFileSync(a, "export function gamma() {}\n");
    utimesSync(a, MT, MT);
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME); // warm — fastpath reuses stale record
    const stale = JSON.parse(read(out, "symbols.json")).defs;
    expect(stale.alpha).toBeTruthy(); // proves no re-hash happened
    expect(stale.gamma).toBeUndefined();

    // --full-hash disables the fastpath, re-reads, and catches the change.
    runBuild({ repo: root, out, fullHash: true, mermaid: false, json: false }, TIME);
    const fresh = JSON.parse(read(out, "symbols.json")).defs;
    expect(fresh.gamma).toBeTruthy();
    expect(fresh.alpha).toBeUndefined();
  });

  it("docs are EXEMPT from the fastpath — a size/mtime-preserving doc edit is still re-read", () => {
    const root = repo({ "README.md": "# Alpha\n", "src/x.ts": "export const x = 1;\n" });
    const out = outDir();
    const rd = join(root, "README.md");
    utimesSync(rd, MT, MT);
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    writeFileSync(rd, "# Bravo\n"); // same byte length as "# Alpha\n"
    utimesSync(rd, MT, MT);
    runBuild({ repo: root, out, mermaid: false, json: false }, TIME);
    const title = loadGraph(out)!.files.find((f) => f.rel === "README.md")!.title;
    expect(title).toBe("Bravo"); // re-read despite an unchanged (size,mtime) key
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
        schemaVersion: 3,
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
