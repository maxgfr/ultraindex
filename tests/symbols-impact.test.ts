import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "../src/build.js";
import { runSymbols } from "../src/symbols.js";
import { runImpact } from "../src/impact.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
let OUT: string;

beforeAll(() => {
  OUT = join(mkdtempSync(join(tmpdir(), "ui-si-")), ".ultraindex");
  runBuild({ repo: REPO, out: OUT, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
});

describe("symbols command", () => {
  it("finds a symbol's definition sites with owning module and export flag", () => {
    const res = runSymbols(OUT, "HttpClient")!;
    const hit = res.hits.find((h) => h.name === "HttpClient")!;
    expect(hit).toBeTruthy();
    const def = hit.defs.find((d) => d.file === "src/client.ts")!;
    expect(def.kind).toBe("class");
    expect(def.exported).toBe(true);
    expect(def.module).toBe("src");
    expect(typeof def.line).toBe("number");
  });

  it("reports the files that reference a symbol", () => {
    const hit = runSymbols(OUT, "HttpClient")!.hits.find((h) => h.name === "HttpClient")!;
    expect(hit.refs.length).toBeGreaterThan(0);
  });

  it("matches by identifier sub-token when there is no exact name", () => {
    // "Client" is a sub-token of HttpClient — a fuzzy hit, no exact def.
    const res = runSymbols(OUT, "Client")!;
    expect(res.hits.some((h) => h.name === "HttpClient")).toBe(true);
  });

  it("returns an empty hit list for an unknown symbol (no throw)", () => {
    expect(runSymbols(OUT, "NoSuchSymbolXYZ")!.hits).toEqual([]);
  });

  it("returns undefined when there is no index", () => {
    expect(runSymbols(join(tmpdir(), "ui-nope-si"), "X")).toBeUndefined();
  });
});

describe("impact command", () => {
  it("lists the files that depend on a target file", () => {
    const res = runImpact(OUT, "src/client.ts")!;
    expect(res.scope).toBe("file");
    expect(res.files.some((f) => f.rel === "src/index.ts")).toBe(true);
    expect(res.files.every((f) => f.depth >= 1)).toBe(true);
  });

  it("accepts a module slug and seeds from its members", () => {
    const res = runImpact(OUT, "src")!;
    expect(res.scope).toBe("module");
    expect(res.seeds.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown target", () => {
    expect(runImpact(OUT, "no/such/file.ts")).toBeUndefined();
  });
});
