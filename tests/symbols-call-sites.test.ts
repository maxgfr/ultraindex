import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";
import { runSymbols, NO_CALL_SITES_NOTE } from "../src/symbols.js";
import { indexPaths } from "../src/store.js";
import { callTool } from "../src/mcp/handlers.js";

// A method whose name collides with a stdlib function: `Store.MkdirAll` next to
// files that only call `os.MkdirAll`. Those files contain the name, but nothing
// in them calls the method, so `symbols` must report them as mentions, never as
// uses, and list the bound call sites on their own.
const FILES: Record<string, string> = {
  "go.mod": "module example.com/collide\n\ngo 1.21\n",
  "store/store.go": `package store

// Store keeps files below a root directory.
type Store struct {
	root string
}

// MkdirAll creates a directory below the store root.
func (s *Store) MkdirAll(path string) error {
	return nil
}

// Prepare lays out the store's directories.
func (s *Store) Prepare() error {
	return s.MkdirAll("cache")
}
`,
  "store/layout.go": `package store

// Layout creates the default directories of a store.
func Layout(s *Store) error {
	if err := s.MkdirAll("data"); err != nil {
		return err
	}
	return s.MkdirAll("logs")
}
`,
  // Calls both: the stdlib function (unbound) and the method (bound).
  "app/app.go": `package app

import (
	"os"

	"example.com/collide/store"
)

// Setup prepares a scratch dir and the store's data dir.
func Setup(s *store.Store) error {
	if err := os.MkdirAll("tmp", 0o755); err != nil {
		return err
	}
	return s.MkdirAll("data")
}
`,
  "tools/fs.go": `package tools

import "os"

// Ensure creates dir with the stdlib function of the same name.
func Ensure(dir string) error {
	return os.MkdirAll(dir, 0o755)
}
`,
  "tools/tmp.go": `package tools

import "os"

// Scratch creates a scratch directory.
func Scratch() error {
	return os.MkdirAll("/tmp/scratch", 0o700)
}
`,
};

const BUNDLE = fileURLToPath(new URL("../scripts/ultraindex.mjs", import.meta.url));
let ROOT: string;
let REPO: string;
let OUT: string;

function writeRepo(dir: string): void {
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
}

function build(out: string, noCache = false): void {
  runBuild({ repo: REPO, out, mermaid: false, json: false, noCache }, "2026-01-01T00:00:00.000Z");
}

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), "ui-callsites-"));
  REPO = join(ROOT, "repo");
  writeRepo(REPO);
  OUT = join(REPO, ".ultraindex");
  build(OUT);
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("symbols: bound call sites vs name mentions", () => {
  it("lists the calls bound to the method, with their enclosing caller", () => {
    const res = runSymbols(OUT, "MkdirAll")!;
    expect(res.note).toBeUndefined();
    const hit = res.hits.find((h) => h.name === "MkdirAll")!;
    expect(hit.defs.map((d) => `${d.file}:${d.parent}`)).toEqual(["store/store.go:Store"]);
    // app/app.go:12 is `os.MkdirAll` — same name, different function, unbound.
    expect(hit.callSites).toEqual([
      { file: "app/app.go", line: 14, caller: "Setup" },
      { file: "store/layout.go", line: 5, caller: "Layout" },
      { file: "store/layout.go", line: 8, caller: "Layout" },
      { file: "store/store.go", line: 15, caller: "Store/Prepare" },
    ]);
  });

  it("reports files that only contain the name as mentions, not call sites", () => {
    const hit = runSymbols(OUT, "MkdirAll")!.hits.find((h) => h.name === "MkdirAll")!;
    expect(hit.mentions).toEqual(["tools/fs.go", "tools/tmp.go"]);
    const calling = new Set(hit.callSites.map((c) => c.file));
    for (const f of hit.mentions) expect(calling.has(f)).toBe(false);
    // `refs` keeps its old meaning for compatibility: every file naming it.
    expect(hit.refs).toEqual(["app/app.go", "store/layout.go", "tools/fs.go", "tools/tmp.go"]);
  });

  it("writes callers.jsonl deterministically: rebuild, --no-cache and a fresh dir agree", () => {
    const a = readFileSync(indexPaths(OUT).callers, "utf8");
    build(OUT);
    expect(readFileSync(indexPaths(OUT).callers, "utf8")).toBe(a);
    build(OUT, true);
    expect(readFileSync(indexPaths(OUT).callers, "utf8")).toBe(a);
    const other = join(ROOT, "other-out");
    build(other);
    expect(readFileSync(indexPaths(other).callers, "utf8")).toBe(a);
  });

  it("says call sites are unknown, not zero, on an index built before callers.jsonl", () => {
    const old = join(ROOT, "old-out");
    build(old);
    rmSync(indexPaths(old).callers);
    const res = runSymbols(old, "MkdirAll")!;
    expect(res.note).toBe(NO_CALL_SITES_NOTE);
    const hit = res.hits.find((h) => h.name === "MkdirAll")!;
    expect(hit.callSites).toEqual([]);
    expect(hit.mentions).toEqual(hit.refs);
  });

  it("treats a corrupt callers.jsonl as unavailable", () => {
    const bad = join(ROOT, "bad-out");
    build(bad);
    writeFileSync(indexPaths(bad).callers, '{"format":"ultraindex-callers","version":1}\n');
    expect(runSymbols(bad, "MkdirAll")!.note).toBe(NO_CALL_SITES_NOTE);
  });
});

describe("symbols CLI", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [BUNDLE, "symbols", ...args, "--out", OUT], { encoding: "utf8" });

  it("prints call sites first, then mentions labelled as unbound, and never says `used`", () => {
    const r = run("MkdirAll");
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines).toContain("  called  store/layout.go:5  (in Layout)");
    expect(lines).toContain("  called  store/store.go:15  (in Store/Prepare)");
    const mention = lines.find((l) => l.startsWith("  mentioned by name in 2 file(s)"))!;
    expect(mention).toContain("unbound name matches, not call sites");
    expect(mention).toContain("tools/fs.go");
    expect(lines.findIndex((l) => l.startsWith("  called"))).toBeLessThan(lines.indexOf(mention));
    expect(r.stdout).not.toMatch(/\bused\b/);
  });

  it("--json carries callSites and mentions distinctly, plus the legacy refs", () => {
    const r = run("MkdirAll", "--json");
    expect(r.status).toBe(0);
    const res = JSON.parse(r.stdout) as { query: string; hits: Record<string, unknown>[] };
    const hit = res.hits.find((h) => h.name === "MkdirAll")!;
    expect(Object.keys(hit).sort()).toEqual(["callSites", "defs", "mentions", "name", "refs"]);
    expect(hit.callSites).toHaveLength(4);
    expect(hit.mentions).toEqual(["tools/fs.go", "tools/tmp.go"]);
  });
});

describe("MCP ultraindex_symbols", () => {
  it("returns the same call sites and mentions as the CLI library call", async () => {
    const { text } = await callTool("ultraindex_symbols", { repo: REPO, name: "MkdirAll" }, {});
    const body = JSON.parse(text) as { hits: unknown[]; note?: string };
    const lib = runSymbols(OUT, "MkdirAll")!;
    expect(body.hits).toEqual(lib.hits);
    expect(body.note).toBeUndefined();
  });
});
