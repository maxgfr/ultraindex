import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { FileNode, Graph, ModuleNode } from "../src/types.js";
import { runBuild } from "../src/build.js";
import { loadGraph } from "../src/store.js";
import { BODY_WEIGHT, findModules, runFind, runFindHybrid, scoreModules } from "../src/find.js";
import { renderSearchCache, searchBodies } from "../src/search.js";
import type { BodyHit } from "../src/search.js";
import { scanRepo, searchIndex } from "../src/engine.js";
import { callTool } from "../src/mcp/handlers.js";

const tool = async (name: string, args: Record<string, unknown>): Promise<unknown> =>
  JSON.parse((await callTool(name, args)).text);

// find/ask fold the engine's BM25F search over file contents into the module
// ranking (src/search.ts, src/find.ts). The fixture's `/health` route lives
// only inside src/server.ts — no path, symbol, title or summary says "health".

const SHOP = resolve("evals/multilingual/fixtures/shop-express-prisma");
const TIME = "2026-01-01T00:00:00.000Z";
const HEALTH = "what does the health check return";
// "What does the health check return?" in French: no word the code shares.
const HEALTH_FR = "que renvoie la vérification de santé ?";

const temps: string[] = [];
const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
const build = (repo: string, noCache = false): string => {
  const out = join(tmp("ui-body-out-"), ".ultraindex");
  runBuild({ repo, out, mermaid: false, json: false, noCache }, TIME);
  return out;
};

let OUT: string;
beforeAll(() => {
  OUT = build(SHOP);
}, 120_000);
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe("find over function bodies", () => {
  it("finds the /health route that only a body mentions", () => {
    // Metadata alone matches nothing: this is the bug.
    expect(findModules(loadGraph(OUT)!, HEALTH)).toEqual([]);
    const rows = runFind(OUT, HEALTH)!;
    expect(rows[0]!.slug).toBe("src");
    expect(rows[0]!.files[0]).toBe("src/server.ts");
    expect(rows[0]!.matched).toContain("health");
    expect(rows[0]!.score).toBeGreaterThan(0);
  });

  it("ranks the engine's own way: same hits as `search` over a fresh scan", () => {
    const fresh = searchIndex(scanRepo(SHOP, {}), HEALTH, { limit: 40, fuzzy: false });
    expect(fresh.length).toBeGreaterThan(0);
    expect(searchBodies(OUT, HEALTH)).toEqual(fresh.map((r) => ({ rel: r.file, score: r.score, terms: r.matchedTerms })));
    const orders = searchIndex(scanRepo(SHOP, {}), "cancel an order", { limit: 40, fuzzy: false });
    expect(searchBodies(OUT, "cancel an order")).toEqual(orders.map((r) => ({ rel: r.file, score: r.score, terms: r.matchedTerms })));
  });

  it("forwards --terms to the engine query", () => {
    expect((searchBodies(OUT, HEALTH_FR) ?? []).map((h) => h.rel)).not.toContain("src/server.ts");
    expect(searchBodies(OUT, HEALTH_FR, "health check")![0]!.rel).toBe("src/server.ts");
    const plain = runFind(OUT, HEALTH_FR)!.filter((r) => r.score > 0);
    expect(plain.flatMap((r) => r.files)).not.toContain("src/server.ts");
    const bridged = runFind(OUT, HEALTH_FR, 8, "health check")!;
    expect(bridged[0]!.files[0]).toBe("src/server.ts");
  });

  it("keeps the rarest terms that fit the budget on a large corpus", () => {
    const lines = readFileSync(join(OUT, "search.jsonl"), "utf8").split("\n");
    const header = JSON.parse(lines[0]!) as { terms: string[]; fileOffsets: number[] };
    const recs = lines.slice(1 + header.terms.length).filter(Boolean);
    const id = recs.findIndex((l) => JSON.parse(l).rel === "src/server.ts");
    expect(id).toBeGreaterThanOrEqual(0);
    const serverBytes = header.fileOffsets[id + 1]! - header.fileOffsets[id]!;
    expect(serverBytes).toBeGreaterThan(0);
    // Room for server.ts alone: "health" (one file) fits, "orders" does not and
    // is left out of the engine query.
    const hits = searchBodies(OUT, "health orders", undefined, serverBytes)!;
    expect(hits.map((h) => h.rel)).toEqual(["src/server.ts"]);
    expect(hits[0]!.terms).toEqual(["health"]);
    // No room at all: nothing is searched.
    expect(searchBodies(OUT, "health orders", undefined, 1)).toEqual([]);
  });

  it("degrades to metadata-only without a usable search.jsonl", () => {
    const out = join(tmp("ui-body-copy-"), ".ultraindex");
    cpSync(OUT, out, { recursive: true });
    const path = join(out, "search.jsonl");
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace('"version":1', '"version":9'));
    expect(searchBodies(out, HEALTH)).toBeUndefined();
    writeFileSync(path, text.slice(0, text.length - 10));
    expect(searchBodies(out, HEALTH)).toBeUndefined();
    unlinkSync(path);
    expect(searchBodies(out, HEALTH)).toBeUndefined();
    expect(runFind(out, HEALTH)).toEqual([]);
  });

  it("writes search.jsonl deterministically, --no-cache included", () => {
    const a = readFileSync(join(OUT, "search.jsonl"), "utf8");
    runBuild({ repo: SHOP, out: OUT, mermaid: false, json: false }, TIME);
    expect(readFileSync(join(OUT, "search.jsonl"), "utf8")).toBe(a);
    expect(readFileSync(join(build(SHOP, true), "search.jsonl"), "utf8")).toBe(a);
    expect(renderSearchCache([])).toBe(renderSearchCache([]));
  });
});

// ---------------------------------------------------------------------------
// Scoring, on graph literals with hand-written hits.

function fileNode(rel: string, module: string): FileNode {
  return {
    id: rel, kind: "file", rel, fileKind: "code", lang: "typescript", module,
    title: rel.split("/").pop()!, symbols: 1, lines: 10, degIn: 0, degOut: 0,
  };
}

function graph(mods: [slug: string, path: string, summary: string, files: string[]][]): Graph {
  const files: FileNode[] = [];
  const modules: ModuleNode[] = [];
  for (const [slug, path, summary, rels] of mods) {
    for (const rel of rels) files.push(fileNode(rel, slug));
    modules.push({
      id: slug, kind: "module", slug, path, title: path, summary, tier: 1, members: rels,
      symbols: rels.length, degIn: 0, degOut: 0,
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
    languages: { typescript: files.length }, files, modules, fileEdges: [], moduleEdges: [],
  };
}

const shop = (): Graph =>
  graph([
    ["billing", "src/billing", "Invoice totals and taxes", ["src/billing/invoice.ts", "src/billing/render.ts"]],
    ["invoices-api", "src/api/invoices", "HTTP routes for invoices", ["src/api/invoices/routes.ts"]],
    ["web", "src/web", "Server bootstrap", ["src/web/server.ts", "src/web/app.ts"]],
    ["catalog", "src/catalog", "Product listing", ["src/catalog/list.ts"]],
  ]);

describe("scoring with body hits", () => {
  const hits: BodyHit[] = [
    { rel: "src/web/app.ts", score: 4, terms: ["pdf"] },
    { rel: "src/billing/render.ts", score: 2, terms: ["invoice", "pdf"] },
  ];

  it("lifts a module only a body matches, and its matched file leads", () => {
    const g = shop();
    expect(findModules(g, "invoice pdf").map((r) => r.slug)).not.toContain("web");
    const rows = findModules(g, "invoice pdf", 8, undefined, undefined, undefined, hits);
    const web = rows.find((r) => r.slug === "web")!;
    expect(web).toBeDefined();
    expect(web.files).toEqual(["src/web/app.ts"]);
    expect(web.matched).toEqual(["pdf"]);
  });

  it("keeps metadata matches first, in their metadata order", () => {
    const g = shop();
    const plain = scoreModules(g, "invoice pdf").map((x) => x.r.slug);
    expect(plain).toEqual(["billing", "invoices-api"]);
    // Body hits only on a module no metadata matched: metadata rows keep their
    // order and their scores; the body-only row follows them.
    const webOnly: BodyHit[] = [{ rel: "src/web/app.ts", score: 4, terms: ["pdf"] }];
    const lifted = scoreModules(g, "invoice pdf", undefined, undefined, undefined, webOnly);
    expect(lifted.map((x) => x.r.slug)).toEqual([...plain, "web"]);
    const before = scoreModules(g, "invoice pdf");
    for (const row of before) expect(lifted.find((x) => x.r.slug === row.r.slug)!.r.score).toBe(row.r.score);
    // A full-strength body hit weighs less than the metadata match it sits under.
    expect(lifted.at(-1)!.r.score).toBeLessThan(lifted.at(-2)!.r.score);
  });

  it("adds body-matched files to a metadata match's open list, after the metadata ones", () => {
    const g = shop();
    expect(findModules(g, "invoice")[0]!.files).toEqual(["src/billing/invoice.ts"]);
    const rows = findModules(g, "invoice", 8, undefined, undefined, undefined, hits);
    expect(rows[0]!.slug).toBe("billing");
    expect(rows[0]!.files).toEqual(["src/billing/invoice.ts", "src/billing/render.ts"]);
  });

  it("scales a hit by its score relative to the query's top hit", () => {
    const g = shop();
    const one = (score: number): number =>
      scoreModules(g, "pdf", undefined, undefined, undefined, [
        { rel: "src/catalog/list.ts", score: 10, terms: ["pdf"] },
        { rel: "src/web/app.ts", score, terms: ["pdf"] },
      ]).find((x) => x.r.slug === "web")!.r.score;
    // Body-only: the 0.4 coverage floor applies.
    expect(one(10)).toBeCloseTo(BODY_WEIGHT * 0.4, 3);
    expect(one(5)).toBeCloseTo(BODY_WEIGHT * 0.5 * 0.4, 3);
  });

  it("is a no-op without hits", () => {
    const g = shop();
    expect(scoreModules(g, "invoice pdf", undefined, undefined, undefined, [])).toEqual(scoreModules(g, "invoice pdf"));
  });
});

describe("MCP parity", () => {
  let REPO: string;
  beforeAll(async () => {
    REPO = tmp("ui-body-mcp-");
    cpSync(SHOP, REPO, { recursive: true });
    await callTool("ultraindex_build", { repo: REPO }, { allowWrite: true });
  }, 120_000);

  it("ultraindex_find returns the same rows as find", async () => {
    const res = (await tool("ultraindex_find", { repo: REPO, query: HEALTH })) as {
      results: { slug: string; score: number; files: string[] }[];
    };
    const lib = (await runFindHybrid(join(REPO, ".ultraindex"), HEALTH, 8, REPO))!.results;
    expect(res.results).toEqual(lib.map((r) => ({ slug: r.slug, score: r.score, files: r.files })));
    expect(res.results[0]!.files[0]).toBe("src/server.ts");
  });

  it("ultraindex_find and ultraindex_ask forward terms", async () => {
    const res = (await tool("ultraindex_find", { repo: REPO, query: HEALTH_FR, terms: "health check" })) as {
      results: { files: string[] }[];
    };
    expect(res.results[0]!.files[0]).toBe("src/server.ts");
    const ask = (await tool("ultraindex_ask", { repo: REPO, question: HEALTH_FR, terms: "health check" })) as {
      modules: string[];
      evidence: string;
    };
    expect(ask.modules[0]).toBe("src");
    expect(ask.evidence).toContain('app.get("/health"');
  });
});
