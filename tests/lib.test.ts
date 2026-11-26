import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// The BUILT library bundle, exactly as a downstream skill vendors it — not
// src/lib.ts. `pnpm run check:build` keeps it reproducible from src.
import * as lib from "../scripts/engine.mjs";
import { VERSION as SRC_VERSION, SCHEMA_VERSION as SRC_SCHEMA_VERSION } from "../src/types.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));
const DTS = fileURLToPath(new URL("../scripts/engine.d.mts", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../scripts/engine.mjs", import.meta.url));
const ENGINE_META = fileURLToPath(new URL("../src/vendor/engine.meta.json", import.meta.url));
// Verbatim from `webindex skill vendor|check` (maxgfr/webindex
// src/skillkit/vendor.ts): a vendored bundle's version is the FIRST match.
const VENDOR_ENGINE_VERSION = /(?:^|\n)\s*(?:(?:var|const|let)\s+)?ENGINE_VERSION\s*=\s*"([^"]+)"/;
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

// Every write the library could make to the terminal, or to the process's exit
// status. The contract: a library call does none of it.
function silenceSpies() {
  const writes: string[] = [];
  const record = (label: string) => (...args: unknown[]) => {
    writes.push(`${label}: ${args.map(String).join(" ")}`);
    return true;
  };
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(record("stdout") as never),
    vi.spyOn(process.stderr, "write").mockImplementation(record("stderr") as never),
    ...(["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(record(`console.${m}`)),
    ),
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) called`);
    }) as never),
  ];
  const exitCode = process.exitCode;
  return {
    writes,
    exitCode,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

describe("library entry (scripts/engine.mjs)", () => {
  let tmp: string;
  let out: string;
  let silence: ReturnType<typeof silenceSpies>;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "ui-lib-"));
    out = join(tmp, ".ultraindex");
    silence = silenceSpies();
  });

  afterAll(() => {
    silence.restore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reports the same version and schema as the source tree", () => {
    expect(lib.VERSION).toBe(SRC_VERSION);
    expect(lib.SCHEMA_VERSION).toBe(SRC_SCHEMA_VERSION);
  });

  it("announces ultraindex's own ENGINE_VERSION first, for vendoring tools", () => {
    // The skill kit reads the first ENGINE_VERSION statement of the vendored
    // file; it must be ultraindex's, not the embedded codeindex engine's.
    const text = readFileSync(BUNDLE, "utf8");
    expect(VENDOR_ENGINE_VERSION.exec(text)?.[1]).toBe(SRC_VERSION);
    expect(lib.ENGINE_VERSION).toBe(SRC_VERSION);
    // The embedded engine keeps its own version under the namespace.
    const meta = JSON.parse(readFileSync(ENGINE_META, "utf8")) as { engineVersion: string };
    expect(lib.codeindex.ENGINE_VERSION).toBe(meta.engineVersion);
    expect(lib.codeindex.ENGINE_VERSION).not.toBe(SRC_VERSION);
  });

  it("warms the grammars without printing, so the build takes the AST path", async () => {
    // tests/setup.ts points CODEINDEX_GRAMMARS_DIR at offline grammars; the
    // bundle carries its own engine copy, so it must load them itself.
    const res = await lib.prepareGrammars({ pull: false });
    expect(res.ready).toBe(true);
    expect(res.pulled).toBe(false);
  });

  it("builds an index and finds it clean", () => {
    const res = lib.runBuild({ repo: REPO, out, mermaid: false, json: false }, FIXED_TIME);
    expect(res.outDir).toBe(out);
    expect(res.capped).toBe(false);
    expect(res.graph.modules.map((m) => m.slug)).toContain("src");
    expect(lib.indexExists(out)).toBe(true);

    const check = lib.runCheck(out, REPO);
    expect(check.ok).toBe(true);
    expect(check.stale).toBe(false);
    expect(check.errors).toEqual([]);
  });

  it("loads the persisted artifacts", () => {
    const graph = lib.loadGraph(out)!;
    expect(graph.schemaVersion).toBe(lib.SCHEMA_VERSION);
    expect(graph.files.some((f) => f.rel === "src/util.ts")).toBe(true);
    expect(lib.loadManifest(out)!.repo).toBe(REPO);
    expect(lib.loadSymbols(out)).toBeDefined();
    expect(lib.indexPaths(out).graph).toBe(join(out, "graph.json"));
  });

  it("reports enrichment status", () => {
    const status = lib.runStatus(out)!;
    expect(status.total).toBe(lib.loadGraph(out)!.modules.length);
    expect(status.enriched).toBe(0);
    expect(status.suggestedNext.length).toBeGreaterThan(0);
  });

  it("finds a module by the fixture's vocabulary", () => {
    const hits = lib.runFind(out, "retry backoff")!;
    expect(hits[0]!.slug).toBe("src");
    expect(hits[0]!.files).toContain("src/util.ts");
  });

  it("resolves a real citation and rejects a broken one", () => {
    const text = "Backoff is capped [src/util.ts:2], see also [src/util.ts:999].";
    const cites = lib.parseCitations(text);
    expect(cites.map((c) => c.raw)).toEqual(["src/util.ts:2", "src/util.ts:999"]);
    const res = lib.checkCitations(text, lib.fileLineTable(lib.loadGraph(out)!));
    expect(res.ok).toBe(false);
    expect(res.resolved.map((c) => c.raw)).toEqual(["src/util.ts:2"]);
    expect(res.unresolved.map((u) => u.citation.raw)).toEqual(["src/util.ts:999"]);
  });

  it("walks neighbors and impact on a real module", () => {
    const nb = lib.runNeighbors(out, "src")!;
    expect(nb.scope).toBe("module");
    expect(nb.members).toContain("src/util.ts");
    expect(nb.links.length).toBeGreaterThan(0);

    const impact = lib.runImpact(out, "src/util.ts")!;
    expect(impact.files.map((f) => f.rel)).toContain("src/client.ts");
  });

  it("re-exports the pinned codeindex engine as one namespace", () => {
    expect(typeof lib.codeindex.buildGraph).toBe("function");
    expect(typeof lib.codeindex.ENGINE_VERSION).toBe("string");
    // The parallel extractor's workers import this bundle by name and call its
    // top-level runExtractWorker, so it must be the engine's, not a copy.
    expect(lib.runExtractWorker).toBe(lib.codeindex.runExtractWorker);
  });

  it("ships a self-contained declaration file", () => {
    const dts = readFileSync(DTS, "utf8");
    // No import/re-export statement may point outside the file: consumers
    // vendor this .d.mts alone, next to engine.mjs.
    expect(dts).not.toMatch(/^\s*(?:import|export)\b[^\n]*\bfrom\s+["']/m);
    expect(dts).not.toMatch(/\bimport\(\s*["']/);
    expect(dts).not.toContain("./vendor");
    expect(dts).toMatch(/\bcodeindex\b/);
  });

  it("wrote nothing to stdout/stderr and left the exit status alone", () => {
    expect(silence.writes).toEqual([]);
    expect(process.exitCode).toBe(silence.exitCode);
  });
});
