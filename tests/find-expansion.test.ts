import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, FileNode, ModuleNode, Tier, Edge, FindResult } from "../src/types.js";
import { scoreModules, pickSeeds, expandResults } from "../src/find.js";
import { queryTerms } from "../src/lex.js";

function fileNode(rel: string, module: string, summary?: string): FileNode {
  return {
    id: rel, kind: "file", rel, fileKind: "code", lang: "typescript", module,
    title: rel.split("/").pop()!, summary, symbols: 1, lines: 10, degIn: 0, degOut: 0,
  };
}

function moduleNode(
  slug: string, path: string, opts: { tier?: Tier; summary?: string; deg?: number; members?: string[] } = {},
): ModuleNode {
  const members = opts.members ?? [`${path}/f.ts`];
  return {
    id: slug, kind: "module", slug, path, title: path, summary: opts.summary ?? "",
    tier: opts.tier ?? 1, members, symbols: members.length,
    degIn: opts.deg ?? 0, degOut: 0,
  };
}

function edge(from: string, to: string): Edge {
  return { from, to, kind: "import", weight: 1 };
}

function graph(modules: ModuleNode[], edges: Edge[] = []): Graph {
  const files = modules.flatMap((m) => m.members.map((r) => fileNode(r, m.slug, m.summary || undefined)));
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
    languages: { typescript: files.length }, files, modules, fileEdges: [], moduleEdges: edges,
  };
}

function fr(slug: string, score: number, matched: string[]): FindResult {
  return { slug, path: `src/${slug}`, title: slug, tier: 1, score, matched, files: [], neighbors: [], enriched: false };
}

describe("pickSeeds", () => {
  it("stops as soon as a row falls below 0.2 × top score", () => {
    const scored = [
      { r: fr("a", 1.0, ["alpha"]), degree: 0 },
      { r: fr("b", 0.5, ["alpha"]), degree: 0 },
      { r: fr("c", 0.15, ["alpha"]), degree: 0 }, // 0.15 < 0.2 × 1.0 → cut here
    ];
    expect(pickSeeds(scored, queryTerms("alpha"))).toEqual(["a", "b"]);
  });

  it("takes at most 3 gap-surviving seeds", () => {
    const scored = [
      { r: fr("a", 1.0, ["alpha"]), degree: 0 },
      { r: fr("b", 0.9, ["alpha"]), degree: 0 },
      { r: fr("c", 0.8, ["alpha"]), degree: 0 },
      { r: fr("d", 0.7, ["alpha"]), degree: 0 },
    ];
    expect(pickSeeds(scored, queryTerms("alpha"))).toEqual(["a", "b", "c"]);
  });

  it("guarantees a seed for a term no gap-seed matched", () => {
    // top matches alpha (loud); only the low-ranked row matches zeta.
    const scored = [
      { r: fr("a", 1.0, ["alpha"]), degree: 0 },
      { r: fr("z", 0.05, ["zeta"]), degree: 0 }, // below the 0.2 gap → not a gap seed
    ];
    expect(pickSeeds(scored, queryTerms("alpha zeta"))).toEqual(["a", "z"]);
  });
});

describe("expandResults: per-term guarantee", () => {
  it("appends a below-top-k term-only module with via:term", () => {
    // amod matches 4 of 5 terms and dominates; zmod is the only zeta-bearer and
    // ranks well below the 0.2 gap and below top-k.
    const fillers = Array.from({ length: 5 }, (_, i) => moduleNode(`z${i}`, `pkg/z${i}`));
    const mods = [
      moduleNode("amod", "src/amod", { summary: "alpha beta gamma delta" }),
      moduleNode("zmod", "src/zmod", { summary: "zeta" }),
      ...fillers,
    ];
    const g = graph(mods);
    const terms = queryTerms("alpha beta gamma delta zeta");
    const full = scoreModules(g, "alpha beta gamma delta zeta");
    const k = 1;
    const top = full.slice(0, k).map((x) => x.r);
    expect(top.map((r) => r.slug)).toEqual(["amod"]);

    const seeds = pickSeeds(full, terms);
    expect(seeds).toContain("zmod"); // via the per-term guarantee, not the gap

    const out = expandResults(g, top, full, seeds, k);
    const z = out.find((r) => r.slug === "zmod");
    expect(z?.via).toBe("term");
    expect(z?.matched).toContain("zeta");
  });
});

describe("expandResults: graph expansion", () => {
  it("appends BFS neighbours (depth ≤ 2) with via:graph, ordered depth/degree/slug", () => {
    const mods = [
      moduleNode("smod", "src/smod", { summary: "alpha" }),
      moduleNode("a1mod", "src/a1", { deg: 3 }),
      moduleNode("a2mod", "src/a2", { deg: 1 }),
      moduleNode("bmod", "src/b", { deg: 0 }),
    ];
    // smod↔a1mod, smod↔a2mod, a1mod↔bmod (bmod is depth 2 from the seed).
    const g = graph(mods, [edge("smod", "a1mod"), edge("smod", "a2mod"), edge("a1mod", "bmod")]);
    const full = scoreModules(g, "alpha");
    const top = full.slice(0, 8).map((x) => x.r);
    expect(top.map((r) => r.slug)).toEqual(["smod"]);
    const out = expandResults(g, top, full, pickSeeds(full, queryTerms("alpha")), 8);

    const b = out.find((r) => r.slug === "bmod");
    expect(b?.via).toBe("graph");
    expect(b?.matched).toEqual([]);
    // depth 1 before depth 2; within depth 1, higher degree first.
    const order = out.map((r) => r.slug);
    expect(order).toEqual(["smod", "a1mod", "a2mod", "bmod"]);
    expect(out.filter((r) => r.via === "graph").every((r) => r.score === 0)).toBe(true);
  });

  it("does not expand through a hub, but the hub itself may surface", () => {
    // hub degree 60 ≥ threshold=max(50, p99); far is reachable ONLY through it.
    const mods = [
      moduleNode("smod", "src/smod", { summary: "alpha", deg: 2 }),
      moduleNode("hub", "src/hub", { deg: 60 }),
      moduleNode("far", "src/far", { deg: 0 }),
    ];
    const g = graph(mods, [edge("smod", "hub"), edge("hub", "far")]);
    const full = scoreModules(g, "alpha");
    const top = full.slice(0, 8).map((x) => x.r);
    const out = expandResults(g, top, full, pickSeeds(full, queryTerms("alpha")), 8);
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain("hub"); // hub is visited (depth 1)
    expect(slugs).not.toContain("far"); // depth 2 through the gated hub → unreached
  });
});

describe("expandResults: determinism and cap", () => {
  it("is deterministic and never exceeds k + 4 rows", () => {
    const neighbours = Array.from({ length: 7 }, (_, i) => moduleNode(`n${i}`, `src/n${i}`, { deg: i }));
    const mods = [moduleNode("smod", "src/smod", { summary: "alpha" }), ...neighbours];
    const g = graph(mods, neighbours.map((n) => edge("smod", n.slug)));
    const full = scoreModules(g, "alpha");
    const k = 1;
    const run = (): FindResult[] =>
      expandResults(g, full.slice(0, k).map((x) => x.r), full, pickSeeds(full, queryTerms("alpha")), k);
    const a = run();
    const b = run();
    expect(a.length).toBeLessThanOrEqual(k + 4);
    expect(a).toEqual(b);
  });
});

describe("expandResults: community affinity", () => {
  it("orders same-community neighbours before equal-degree strangers", () => {
    // Both neighbours sit at depth 1 with equal degree; without the affinity
    // key, slug order would put the stranger (afar) first.
    const seed = moduleNode("smod", "src/smod", { summary: "alpha" });
    const near = moduleNode("zsame", "src/zsame", { deg: 2 });
    const far = moduleNode("afar", "src/afar", { deg: 2 });
    seed.community = 7;
    near.community = 7;
    far.community = 3;
    const g = graph([seed, near, far], [edge("smod", "zsame"), edge("smod", "afar")]);
    const full = scoreModules(g, "alpha");
    const top = full.slice(0, 1).map((x) => x.r);
    expect(top.map((r) => r.slug)).toEqual(["smod"]);

    const out = expandResults(g, top, full, ["smod"], 1);
    const slugs = out.filter((r) => r.via === "graph").map((r) => r.slug);
    expect(slugs).toEqual(["zsame", "afar"]);
  });
});
