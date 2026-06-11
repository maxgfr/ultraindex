import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { FileNode, Graph, ModuleNode, Tier } from "../src/types.js";
import { loadSemanticConfig, embeddingsUrl, embedTexts, cosine } from "../src/semantic.js";
import { loadVectors, runEmbed } from "../src/vectors.js";
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

// An OpenAI-shaped /v1/embeddings mock: vector chosen per input text.
function embeddingsFetch(vecFor: (text: string) => number[]) {
  return vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const inputs = (JSON.parse(init.body) as { input: string[] }).input;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: inputs.map((t, i) => ({ index: i, embedding: vecFor(t) })) }),
      text: async () => "",
    };
  });
}

const ENV_KEYS = ["ULTRAINDEX_EMBED_BASE_URL", "ULTRAINDEX_EMBED_MODEL", "ULTRAINDEX_EMBED_API_KEY"] as const;
const CFG = { baseUrl: "http://localhost:8080/v1", model: "test-model" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uidx-sem-"));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("loadSemanticConfig", () => {
  it("returns undefined with neither env nor file", () => {
    expect(loadSemanticConfig(dir)).toBeUndefined();
  });

  it("reads semantic.json and lets env override it", () => {
    writeFileSync(join(dir, "semantic.json"), JSON.stringify({ baseUrl: "http://file:1", model: "file-model", apiKey: "fk" }));
    expect(loadSemanticConfig(dir)).toEqual({ baseUrl: "http://file:1", model: "file-model", apiKey: "fk" });
    process.env.ULTRAINDEX_EMBED_BASE_URL = "http://env:2";
    expect(loadSemanticConfig(dir)?.baseUrl).toBe("http://env:2");
    expect(loadSemanticConfig(dir)?.model).toBe("file-model");
  });

  it("requires both baseUrl and model", () => {
    process.env.ULTRAINDEX_EMBED_BASE_URL = "http://env:2";
    expect(loadSemanticConfig(dir)).toBeUndefined();
  });
});

describe("embeddingsUrl", () => {
  it("normalizes with/without /v1 and trailing slashes", () => {
    expect(embeddingsUrl("http://x:8080")).toBe("http://x:8080/v1/embeddings");
    expect(embeddingsUrl("http://x:8080/")).toBe("http://x:8080/v1/embeddings");
    expect(embeddingsUrl("http://x:8080/v1")).toBe("http://x:8080/v1/embeddings");
    expect(embeddingsUrl("http://x:8080/v1/")).toBe("http://x:8080/v1/embeddings");
  });
});

describe("embedTexts", () => {
  it("batches inputs (97 -> 4 calls) and keeps order", async () => {
    const f = embeddingsFetch((t) => [Number(t)]);
    vi.stubGlobal("fetch", f);
    const texts = Array.from({ length: 97 }, (_, i) => String(i));
    const out = await embedTexts(CFG, texts);
    expect(f).toHaveBeenCalledTimes(4);
    expect(out).toHaveLength(97);
    expect(out[96]).toEqual([96]);
  });

  it("sends the Authorization header only when apiKey is set", async () => {
    const f = embeddingsFetch(() => [1]);
    vi.stubGlobal("fetch", f);
    await embedTexts(CFG, ["a"]);
    expect(f.mock.calls[0]![1].headers).not.toHaveProperty("authorization");
    await embedTexts({ ...CFG, apiKey: "sk-x" }, ["a"]);
    expect((f.mock.calls[1]![1].headers as Record<string, string>).authorization).toBe("Bearer sk-x");
  });

  it("throws a clear error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "overloaded" })));
    await expect(embedTexts(CFG, ["a"])).rejects.toThrow(/503.*overloaded/s);
  });
});

describe("cosine", () => {
  it("computes similarity and guards dimension mismatch", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [1, 0, 0])).toBe(-1);
    expect(cosine([], [])).toBe(-1);
  });
});

describe("runEmbed", () => {
  const g = () => graph([
    { slug: "alpha", path: "src/alpha", files: ["src/alpha/a.ts"] },
    { slug: "beta", path: "src/beta", files: ["src/beta/b.ts"] },
  ]);
  const vecFor = (t: string) => (t.includes("alpha") ? [1, 0] : [0, 1]);

  it("embeds all modules, then reuses everything on a no-change re-run", async () => {
    writeIndex(dir, g());
    const f = embeddingsFetch(vecFor);
    vi.stubGlobal("fetch", f);
    const first = await runEmbed(dir, CFG);
    expect(first).toMatchObject({ total: 2, embedded: 2, reused: 0, removed: 0, dim: 2 });
    expect(loadVectors(dir)?.vectors.alpha?.v).toEqual([1, 0]);

    const second = await runEmbed(dir, CFG);
    expect(second).toMatchObject({ embedded: 0, reused: 2 });
    expect(f).toHaveBeenCalledTimes(1); // no network for the unchanged run
  });

  it("prunes slugs gone from the graph", async () => {
    writeIndex(dir, g());
    vi.stubGlobal("fetch", embeddingsFetch(vecFor));
    await runEmbed(dir, CFG);
    writeIndex(dir, graph([{ slug: "alpha", path: "src/alpha", files: ["src/alpha/a.ts"] }]));
    const report = await runEmbed(dir, CFG);
    expect(report).toMatchObject({ total: 1, removed: 1 });
    expect(loadVectors(dir)?.vectors).not.toHaveProperty("beta");
  });

  it("re-embeds everything on a model change or --force", async () => {
    writeIndex(dir, g());
    const f = embeddingsFetch(vecFor);
    vi.stubGlobal("fetch", f);
    await runEmbed(dir, CFG);
    const changed = await runEmbed(dir, { ...CFG, model: "other-model" });
    expect(changed).toMatchObject({ embedded: 2, reused: 0 });
    expect(loadVectors(dir)?.model).toBe("other-model");
    const forced = await runEmbed(dir, { ...CFG, model: "other-model" }, true);
    expect(forced).toMatchObject({ embedded: 2, reused: 0 });
  });

  it("rounds stored floats deterministically", async () => {
    writeIndex(dir, g());
    vi.stubGlobal("fetch", embeddingsFetch(() => [0.123456789, 0.9999999999]));
    await runEmbed(dir, CFG);
    expect(loadVectors(dir)?.vectors.alpha?.v).toEqual([0.123457, 1]);
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
    process.env.ULTRAINDEX_EMBED_BASE_URL = CFG.baseUrl;
    process.env.ULTRAINDEX_EMBED_MODEL = CFG.model;
    // "facturation" shares no keyword with the query but sits next to it in
    // embedding space — exactly the case lexical search can't cover.
    const vecFor = (t: string) => (t.includes("facturation") || t.includes("invoicing") ? [1, 0] : [0, 1]);
    vi.stubGlobal("fetch", embeddingsFetch(vecFor));
    await runEmbed(dir, CFG);

    const res = await runFindHybrid(dir, "invoicing", 5);
    expect(res?.semantic).toBe(true);
    const fact = res?.results.find((r) => r.slug === "facturation");
    expect(fact).toBeDefined();
    expect(fact?.matched).toEqual([]);
    expect(fact?.score).toBe(0);
    expect(fact?.semanticRank).toBe(1);
    expect(fact?.files).toContain("src/facturation/main.ts");
  });

  it("degrades to lexical with a warning when the provider is down", async () => {
    writeIndex(dir, g());
    process.env.ULTRAINDEX_EMBED_BASE_URL = CFG.baseUrl;
    process.env.ULTRAINDEX_EMBED_MODEL = CFG.model;
    vi.stubGlobal("fetch", embeddingsFetch(() => [1, 0]));
    await runEmbed(dir, CFG);
    expect(existsSync(join(dir, "vectors.json"))).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await runFindHybrid(dir, "billing", 5);
    expect(res?.semantic).toBe(false);
    expect(res?.warning).toMatch(/lexical-only/);
    expect(res?.results[0]?.slug).toBe("billing");
  });

  it("warns instead of fusing when vectors.json exists but config is gone", async () => {
    writeIndex(dir, g());
    process.env.ULTRAINDEX_EMBED_BASE_URL = CFG.baseUrl;
    process.env.ULTRAINDEX_EMBED_MODEL = CFG.model;
    vi.stubGlobal("fetch", embeddingsFetch(() => [1, 0]));
    await runEmbed(dir, CFG);
    delete process.env.ULTRAINDEX_EMBED_BASE_URL;
    delete process.env.ULTRAINDEX_EMBED_MODEL;

    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await runFindHybrid(dir, "billing", 5);
    expect(f).not.toHaveBeenCalled();
    expect(res?.warning).toMatch(/no semantic config/);
  });

  it("is deterministic across runs", async () => {
    writeIndex(dir, g());
    process.env.ULTRAINDEX_EMBED_BASE_URL = CFG.baseUrl;
    process.env.ULTRAINDEX_EMBED_MODEL = CFG.model;
    vi.stubGlobal("fetch", embeddingsFetch((t) => (t.includes("billing") ? [1, 0] : [0.6, 0.4])));
    await runEmbed(dir, CFG);
    const a = await runFindHybrid(dir, "billing invoice", 5);
    const b = await runFindHybrid(dir, "billing invoice", 5);
    expect(a).toEqual(b);
  });
});
