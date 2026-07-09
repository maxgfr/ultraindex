import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAskDossier } from "../src/evidence.js";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, ModuleNode } from "../src/types.js";

function moduleNode(slug: string, path: string, members: string[]): ModuleNode {
  return { id: slug, kind: "module", slug, path, title: slug, summary: "", tier: 1, members, symbols: 0, degIn: 0, degOut: 0 };
}

// A repo whose code files are big enough that a small token budget cannot hold
// them all — so truncation is exercised deterministically.
function repoWithFiles(n: number): { repo: string; rels: string[] } {
  const repo = mkdtempSync(join(tmpdir(), "ui-budget-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  const rels: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `src/f${i}.ts`;
    const body = Array.from({ length: 20 }, (_, j) => `export const v${i}_${j} = ${j}; // padding to grow the file block`).join("\n");
    writeFileSync(join(repo, rel), body + "\n");
    rels.push(rel);
  }
  return { repo, rels };
}

function graphOf(rels: string[]): Graph {
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: rels.length,
    languages: { typescript: rels.length }, files: [], modules: [moduleNode("src", "src", rels)],
    fileEdges: [], moduleEdges: [],
  };
}

describe("renderAskDossier token budget", () => {
  const { repo, rels } = repoWithFiles(6);
  const graph = graphOf(rels);
  const modules = [{ slug: "src", files: rels }];
  const header = (rel: string): string => `### \`${rel}\``;

  it("emits every file and no truncation notice when no budget is given", () => {
    const out = renderAskDossier(repo, graph, "q", modules);
    expect(out).not.toMatch(/truncated/);
    for (const r of rels) expect(out).toContain(header(r));
  });

  it("an ample budget behaves exactly like no budget", () => {
    const full = renderAskDossier(repo, graph, "q", modules);
    const ample = renderAskDossier(repo, graph, "q", modules, 100_000);
    expect(ample).toBe(full);
  });

  it("caps the source section near budget*3 chars, drops the tail, and ends with a notice", () => {
    const budget = 250; // 750 chars — far under 6 files' worth
    const out = renderAskDossier(repo, graph, "q", modules, budget);
    const source = out.slice(out.indexOf("## Source"));
    // ~budget*3 plus slack for the "## Source" header, block separators, and the notice line.
    expect(source.length).toBeLessThanOrEqual(budget * 3 + 250);
    // Truncation notice reports the token budget and how many files were cut.
    expect(out).toMatch(/truncated — \d+ more file\(s\) cut by ~250-token budget/);
    // Most-informative files come first, so the LAST file is the one dropped.
    expect(out).not.toContain(header(rels[rels.length - 1]!));
    // Truncated output is strictly smaller than the full dossier.
    expect(out.length).toBeLessThan(renderAskDossier(repo, graph, "q", modules).length);
  });

  it("keeps the orienting header/task/module sections even when the source is truncated", () => {
    const out = renderAskDossier(repo, graph, "q", modules, 250);
    expect(out).toContain('# Evidence dossier for: "q"');
    expect(out).toContain("## Task");
    expect(out).toContain("## Relevant modules");
  });
});
