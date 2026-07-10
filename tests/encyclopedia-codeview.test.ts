import { describe, it, expect } from "vitest";
import { renderEntrySpec, buildEntryEdgeIndex } from "../src/render/encyclopedia.js";
import type { CodeSymbol, FileRecord, Graph, ModuleNode } from "../src/types.js";

// UIDX-2: for a CommonJS module whose public API is property assignment
// (`res.sendFile = function(){}`, `app.get = …`), those methods are not captured
// as symbols and every captured symbol is module-private (exported === false).
// The header still counts them ("N symbols"), so the code-view must NOT claim
// "No exported symbols detected" — that contradicts the header count.
describe("codeViewRegion: reconciles with the header symbol count (UIDX-2)", () => {
  const sym = (name: string, line: number, kind = "function"): CodeSymbol => ({
    name,
    kind,
    file: "response.js",
    line,
    signature: `${kind} ${name}()`,
    exported: false,
    lang: "javascript",
  });

  const rec: FileRecord = {
    rel: "response.js",
    ext: ".js",
    size: 100,
    lines: 40,
    hash: "h",
    kind: "code",
    lang: "javascript",
    title: "response.js",
    headings: [],
    symbols: [sym("res", 2, "const"), sym("helperOne", 6), sym("helperTwo", 7)],
    refs: [],
  };

  const mod: ModuleNode = {
    id: "lib",
    kind: "module",
    slug: "lib",
    path: "lib",
    title: "lib",
    summary: "Response helpers.",
    tier: 1,
    members: ["response.js"],
    symbols: 3, // header counts all 3 declared symbols
    degIn: 0,
    degOut: 0,
  };

  const emptyGraph: Graph = {
    schemaVersion: 0,
    version: "test",
    fileCount: 0,
    languages: {},
    files: [],
    modules: [],
    fileEdges: [],
    moduleEdges: [],
  };

  it("does not claim \"No exported symbols detected\" when the module has symbols", () => {
    const edgeIndex = buildEntryEdgeIndex(emptyGraph, new Map([["response.js", "lib"]]));
    const regions = renderEntrySpec(mod, edgeIndex, new Map([["response.js", rec]]));
    const codeView = regions.find((r) => r.key === "code-view")!;
    expect(codeView.body).not.toContain("No exported symbols detected");
    // The declared (module-private) symbols should be surfaced so the code-view
    // reconciles with the header's "3 symbols".
    expect(codeView.body).toContain("helperOne");
  });

  it("still shows the plain 'no symbols' note for a module with zero symbols", () => {
    const emptyRec: FileRecord = { ...rec, rel: "empty.js", symbols: [] };
    const emptyMod: ModuleNode = { ...mod, members: ["empty.js"], symbols: 0 };
    const edgeIndex = buildEntryEdgeIndex(emptyGraph, new Map([["empty.js", "lib"]]));
    const regions = renderEntrySpec(emptyMod, edgeIndex, new Map([["empty.js", emptyRec]]));
    const codeView = regions.find((r) => r.key === "code-view")!;
    expect(codeView.body).toContain("No exported symbols detected");
  });
});
