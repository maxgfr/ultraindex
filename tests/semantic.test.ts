import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { FileNode, Graph, ModuleNode, Tier } from "../src/types.js";
import { encode } from "../src/engine.js";
import type { StaticEmbedModel } from "../src/engine.js";
import { resolveEmbedTier, encodeQuery, embedTexts, similarity, moduleEmbedText } from "../src/semantic.js";
import type { EmbedTier } from "../src/semantic.js";
import { loadVectors, runEmbed, encodeVector, decodeVector } from "../src/vectors.js";
import { runFindHybrid } from "../src/find.js";

function fileNode(rel: string, module: string): FileNode {
  return {
    id: rel, kind: "file", rel, fileKind: "code", lang: "typescript", module,
    title: rel.split("/").pop()!, symbols: 1, lines: 10, degIn: 0, degOut: 0,
  };
}

function moduleNode(slug: string, path: string, tier: Tier, members: string[]): ModuleNode {
  return {
    id: slug, kind: "module", slug, path, title: path, summary: "", tier, members,
    symbols: members.length, degIn: 0, degOut: 0,
  };
}

function graph(modules: { slug: string; path: string; files: string[] }[]): Graph {
  const files = modules.flatMap((m) => m.files.map((r) => fileNode(r, m.slug)));
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
    languages: { typescript: files.length },
    files,
    modules: modules.map((m) => moduleNode(m.slug, m.path, 1, m.files)),
    fileEdges: [], moduleEdges: [],
  };
}

function writeIndex(dir: string, g: Graph): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "graph.json"), JSON.stringify(g));
}

// A hand-built StaticEmbedModel — the SAME shape `loadEmbedModel` returns, so
// these tests exercise the engine's real keyless encoder (tokenize → mean-pool →
// L2-normalize → int8) rather than a stand-in. dim 2 keeps the vectors readable:
// each vocabulary word points at one axis.
function staticModel(axes: Record<string, [number, number]>, modelId = "test-static-v1"): StaticEmbedModel {
  const words = Object.keys(axes);
  const dim = 2;
  const weights = new Float64Array((words.length + 1) * dim);
  const vocab = new Map<string, number>();
  words.forEach((w, i) => {
    vocab.set(w, i);
    weights[i * dim] = axes[w]![0];
    weights[i * dim + 1] = axes[w]![1];
  });
  return { modelId, dim, unk: "[UNK]", unkId: words.length, vocabSize: words.length + 1, vocab, weights };
}

function staticTier(model: StaticEmbedModel): EmbedTier {
  return { kind: "static", model, label: `${model.modelId} (dim ${model.dim})` };
}

// The engine's endpoint protocol: POST <base>/embed {texts} -> {vectors}.
function endpointFetch(vecFor: (text: string) => number[]) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const texts = (JSON.parse(init.body) as { texts: string[] }).texts;
    return { ok: true, status: 200, json: async () => ({ vectors: texts.map(vecFor) }), text: async () => "" };
  });
}

const ENDPOINT = "http://localhost:8756";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uidx-sem-"));
  delete process.env.CODEINDEX_EMBED_ENDPOINT;
  delete process.env.CODEINDEX_EMBED_DIR;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CODEINDEX_EMBED_ENDPOINT;
  delete process.env.CODEINDEX_EMBED_DIR;
  vi.unstubAllGlobals();
});

describe("resolveEmbedTier", () => {
  it("is off when neither a model nor an endpoint is resolvable", () => {
    expect(resolveEmbedTier(dir)).toBeUndefined();
  });

  it("prefers the endpoint — setting the env var is explicit intent", () => {
    process.env.CODEINDEX_EMBED_ENDPOINT = ENDPOINT;
    const tier = resolveEmbedTier(dir);
    expect(tier?.kind).toBe("endpoint");
    expect(tier?.label).toContain(ENDPOINT);
  });
});

describe("similarity", () => {
  const model = staticModel({ alpha: [1, 0], beta: [0, 1] });

  it("is 1 for identical text and 0 for orthogonal text", () => {
    const a = encodeVectorRoundTrip(model, "alpha");
    const b = encodeVectorRoundTrip(model, "beta");
    expect(similarity(a, a)).toBeCloseTo(1, 3);
    expect(similarity(a, b)).toBeCloseTo(0, 3);
  });

  it("guards a dimension mismatch instead of throwing", () => {
    expect(similarity(new Int8Array([127, 0]), new Int8Array([127, 0, 0]))).toBe(-1);
    expect(similarity(new Int8Array(), new Int8Array())).toBe(-1);
  });

  function encodeVectorRoundTrip(m: StaticEmbedModel, text: string): Int8Array {
    // Round-trips through the on-disk encoding too, so a base64 regression
    // shows up as a similarity failure rather than silently skewing ranking.
    return decodeVector(encodeVector(encode(m, text)));
  }
});

describe("vector serialization", () => {
  it("round-trips int8 exactly, including negatives", () => {
    const v = new Int8Array([127, -128, 0, 42, -7]);
    expect([...decodeVector(encodeVector(v))]).toEqual([...v]);
  });
});

describe("embedTexts", () => {
  it("runs offline on the static tier — no network at all", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const out = await embedTexts(staticTier(staticModel({ alpha: [1, 0], beta: [0, 1] })), ["alpha", "beta"]);
    expect(f).not.toHaveBeenCalled();
    expect(out).toHaveLength(2);
    expect(similarity(out[0]!, out[1]!)).toBeCloseTo(0, 3);
  });

  it("quantizes endpoint floats through the same path", async () => {
    const f = endpointFetch((t) => (t === "alpha" ? [1, 0] : [0, 1]));
    vi.stubGlobal("fetch", f);
    const tier: EmbedTier = { kind: "endpoint", url: ENDPOINT, label: `endpoint ${ENDPOINT}` };
    const out = await embedTexts(tier, ["alpha", "beta"]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(out[0]).toBeInstanceOf(Int8Array);
    expect(similarity(out[0]!, out[0]!)).toBeCloseTo(1, 3);
  });

  it("propagates an endpoint failure so callers can degrade", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "overloaded" })));
    const tier: EmbedTier = { kind: "endpoint", url: ENDPOINT, label: `endpoint ${ENDPOINT}` };
    await expect(embedTexts(tier, ["a"])).rejects.toThrow(/503/);
  });
});

describe("moduleEmbedText", () => {
  it("folds the agent-written prose in — the signal the engine's file-level index cannot have", () => {
    const m = moduleNode("alpha", "src/alpha", 1, ["src/alpha/a.ts"]);
    const withProse = moduleEmbedText(m, [fileNode("src/alpha/a.ts", "alpha")], "handles invoicing retries");
    expect(withProse).toContain("handles invoicing retries");
    expect(moduleEmbedText(m, [fileNode("src/alpha/a.ts", "alpha")])).not.toContain("invoicing");
  });
});

describe("runEmbed", () => {
  const g = () => graph([
    { slug: "alpha", path: "src/alpha", files: ["src/alpha/a.ts"] },
    { slug: "beta", path: "src/beta", files: ["src/beta/b.ts"] },
  ]);
  const model = staticModel({ alpha: [1, 0], beta: [0, 1], src: [0.5, 0.5], a: [1, 0], b: [0, 1], ts: [0.5, 0.5] });
  const tier = () => staticTier(model);

  it("embeds all modules, then reuses everything on a no-change re-run", async () => {
    writeIndex(dir, g());
    const first = await runEmbed(dir, tier());
    expect(first).toMatchObject({ total: 2, embedded: 2, reused: 0, removed: 0, dim: 2 });
    expect(loadVectors(dir)?.modelId).toBe("test-static-v1");
    expect(typeof loadVectors(dir)?.vectors.alpha?.v).toBe("string");

    const second = await runEmbed(dir, tier());
    expect(second).toMatchObject({ embedded: 0, reused: 2 });
  });

  it("prunes slugs gone from the graph", async () => {
    writeIndex(dir, g());
    await runEmbed(dir, tier());
    writeIndex(dir, graph([{ slug: "alpha", path: "src/alpha", files: ["src/alpha/a.ts"] }]));
    const report = await runEmbed(dir, tier());
    expect(report).toMatchObject({ total: 1, removed: 1 });
    expect(loadVectors(dir)?.vectors).not.toHaveProperty("beta");
  });

  it("re-embeds everything on a model change or --force", async () => {
    writeIndex(dir, g());
    await runEmbed(dir, tier());
    const other = staticTier(staticModel({ alpha: [0, 1], beta: [1, 0] }, "other-model"));
    const changed = await runEmbed(dir, other);
    expect(changed).toMatchObject({ embedded: 2, reused: 0 });
    expect(loadVectors(dir)?.modelId).toBe("other-model");
    const forced = await runEmbed(dir, other, true);
    expect(forced).toMatchObject({ embedded: 2, reused: 0 });
  });

  it("is byte-identical across runs on the static tier", async () => {
    writeIndex(dir, g());
    await runEmbed(dir, tier());
    const a = JSON.stringify(loadVectors(dir));
    await runEmbed(dir, tier(), true);
    expect(JSON.stringify(loadVectors(dir))).toBe(a);
  });
});

describe("runFindHybrid", () => {
  const g = () => graph([
    { slug: "billing", path: "src/billing", files: ["src/billing/invoice.ts"] },
    { slug: "facturation", path: "src/facturation", files: ["src/facturation/main.ts"] },
  ]);

  it("never touches the network without vectors.json and matches pure lexical", async () => {
    writeIndex(dir, g());
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await runFindHybrid(dir, "billing", 5);
    expect(f).not.toHaveBeenCalled();
    expect(res?.semantic).toBe(false);
    expect(res?.warning).toBeUndefined();
    expect(res?.results[0]?.slug).toBe("billing");
    expect(res?.results.every((r) => r.semanticRank === undefined)).toBe(true);
  });

  it("surfaces a semantic-only module with matched: [] and a semanticRank", async () => {
    writeIndex(dir, g());
    process.env.CODEINDEX_EMBED_ENDPOINT = ENDPOINT;
    // "facturation" shares no keyword with the query but sits next to it in
    // embedding space — exactly the case lexical search can't cover.
    const vecFor = (t: string) => (t.includes("facturation") || t.includes("invoicing") ? [1, 0] : [0, 1]);
    vi.stubGlobal("fetch", endpointFetch(vecFor));
    await runEmbed(dir, { kind: "endpoint", url: ENDPOINT, label: `endpoint ${ENDPOINT}` });

    const res = await runFindHybrid(dir, "invoicing", 5);
    expect(res?.semantic).toBe(true);
    const fact = res?.results.find((r) => r.slug === "facturation");
    expect(fact).toBeDefined();
    expect(fact?.matched).toEqual([]);
    expect(fact?.score).toBe(0);
    expect(fact?.semanticRank).toBe(1);
    expect(fact?.files).toContain("src/facturation/main.ts");
  });

  it("degrades to lexical with a warning when the endpoint is down", async () => {
    writeIndex(dir, g());
    process.env.CODEINDEX_EMBED_ENDPOINT = ENDPOINT;
    vi.stubGlobal("fetch", endpointFetch(() => [1, 0]));
    await runEmbed(dir, { kind: "endpoint", url: ENDPOINT, label: `endpoint ${ENDPOINT}` });
    expect(existsSync(join(dir, "vectors.json"))).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await runFindHybrid(dir, "billing", 5);
    expect(res?.semantic).toBe(false);
    expect(res?.warning).toMatch(/lexical-only/);
    expect(res?.results[0]?.slug).toBe("billing");
  });

  it("warns instead of fusing when vectors.json exists but no tier is resolvable", async () => {
    writeIndex(dir, g());
    process.env.CODEINDEX_EMBED_ENDPOINT = ENDPOINT;
    vi.stubGlobal("fetch", endpointFetch(() => [1, 0]));
    await runEmbed(dir, { kind: "endpoint", url: ENDPOINT, label: `endpoint ${ENDPOINT}` });
    delete process.env.CODEINDEX_EMBED_ENDPOINT;

    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await runFindHybrid(dir, "billing", 5);
    expect(f).not.toHaveBeenCalled();
    expect(res?.warning).toMatch(/no embedding model resolvable/);
  });

  it("is deterministic across runs", async () => {
    writeIndex(dir, g());
    process.env.CODEINDEX_EMBED_ENDPOINT = ENDPOINT;
    vi.stubGlobal("fetch", endpointFetch((t) => (t.includes("billing") ? [1, 0] : [0.6, 0.4])));
    await runEmbed(dir, { kind: "endpoint", url: ENDPOINT, label: `endpoint ${ENDPOINT}` });
    const a = await runFindHybrid(dir, "billing invoice", 5);
    const b = await runFindHybrid(dir, "billing invoice", 5);
    expect(a).toEqual(b);
  });
});
