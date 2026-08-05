import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/types.js";
// Read through the CONCRETE vendor path, not the curated barrel: src/engine.ts
// deliberately omits the engine's SCHEMA_VERSION because re-exporting it beside
// ultraindex's own would be a live TS2300. The concrete path is the sanctioned
// way to reach a name the barrel withholds.
import { SCHEMA_VERSION as ENGINE_SCHEMA_VERSION } from "../src/vendor/codeindex-engine.mjs";

// ultraindex declares its own SCHEMA_VERSION on purpose — the on-disk artifact
// shape is its to version. But the ENGINE writes graph.json and symbols.json,
// and src/store.ts rejects any artifact whose schemaVersion differs from
// ultraindex's constant. So "ours to version" does not mean "free to differ":
// the two numbers must be equal or every read fails.
//
// They did differ. The engine re-pin bot moved the vendored engine to schema 5
// and left this repo at 4, so loadGraph/loadSymbols rejected indexes the same
// process had just written: `symbols`, `impact` and `delta` returned undefined
// for every input, and CI stayed red from 2026-08-02. Nothing tied the two
// constants together, so nothing said why.
describe("engine schema parity", () => {
  it("ultraindex's SCHEMA_VERSION matches the vendored engine's", () => {
    expect(SCHEMA_VERSION).toBe(ENGINE_SCHEMA_VERSION);
  });
});
