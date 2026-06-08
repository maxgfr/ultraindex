import type { FileRecord, Graph, ModuleNode, Tier } from "../types.js";
import type { Region } from "../merge.js";
import { byStr } from "../sort.js";
import { clip } from "../util.js";

const TIER_LABEL: Record<Tier, string> = { 0: "Foundations", 1: "Features", 2: "Tail" };
const MAX_SYMBOLS_PER_FILE = 15;
const MAX_DANGLING = 12;

function headerRegion(m: ModuleNode): Region {
  const where = m.path === "(root)" ? "Repository root" : m.path;
  const body = [
    `# ${where}`,
    "",
    m.summary,
    "",
    `*Module \`${m.slug}\` · tier ${m.tier} (${TIER_LABEL[m.tier]}) · ${m.members.length} files · ${m.symbols} symbols*`,
  ].join("\n");
  return { type: "gen", key: "header", body };
}

function businessStub(): Region {
  return {
    type: "human",
    key: "business",
    body: "<!-- ui:enrich --> _What this module does for the product and how it connects to the rest of the system. Replace this paragraph during the enrichment pass._",
  };
}

function gotchasStub(): Region {
  return {
    type: "human",
    key: "gotchas",
    body: "<!-- ui:enrich --> _Caveats, invariants, or pitfalls worth knowing before changing this module. Optional._",
  };
}

function codeViewRegion(m: ModuleNode, records: Map<string, FileRecord>): Region {
  const lines: string[] = ["## Code view"];
  const langs = [...new Set(m.members.map((r) => records.get(r)?.lang).filter((l): l is string => !!l && l !== "other"))];
  if (langs.length) {
    lines.push("");
    lines.push(`**Languages:** ${langs.sort(byStr).join(", ")}`);
  }

  const apiBlocks: string[] = [];
  for (const rel of m.members) {
    const rec = records.get(rel);
    if (!rec || rec.kind !== "code") continue;
    const exported = rec.symbols.filter((s) => s.exported).sort((a, b) => a.line - b.line);
    const shown = exported.slice(0, MAX_SYMBOLS_PER_FILE);
    if (!shown.length) continue;
    const block = [`- \`${rel}\``];
    for (const s of shown) {
      const sig = s.signature ? ` — \`${clip(s.signature, 100).split("\n")[0]}\`` : "";
      block.push(`  - \`${s.kind} ${s.name}\`${sig}`);
    }
    if (exported.length > shown.length) block.push(`  - _…and ${exported.length - shown.length} more_`);
    apiBlocks.push(block.join("\n"));
  }

  lines.push("");
  if (apiBlocks.length) {
    lines.push("**Exported API:**");
    lines.push("");
    lines.push(apiBlocks.join("\n"));
  } else {
    lines.push("_No exported symbols detected (the module is docs/config, or its language has no extractor)._");
  }
  return { type: "gen", key: "code-view", body: lines.join("\n") };
}

function linksRegion(m: ModuleNode, graph: Graph, moduleOf: Map<string, string>): Region {
  const out = graph.moduleEdges
    .filter((e) => e.from === m.slug)
    .sort((a, b) => byStr(a.to, b.to))
    .map((e) => `[\`${e.to}\`](${e.to}.md) (${e.kind}${e.weight > 1 ? ` ×${e.weight}` : ""})`);
  const inc = graph.moduleEdges
    .filter((e) => e.to === m.slug)
    .sort((a, b) => byStr(a.from, b.from))
    .map((e) => `[\`${e.from}\`](${e.from}.md) (${e.kind}${e.weight > 1 ? ` ×${e.weight}` : ""})`);
  const dangling = graph.fileEdges
    .filter((e) => e.dangling && moduleOf.get(e.from) === m.slug)
    .sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to))
    .slice(0, MAX_DANGLING)
    .map((e) => `\`${e.to}\` (${e.kind}, ${e.reason}) — from \`${e.from}\``);

  const lines = ["## Links"];
  lines.push("");
  lines.push(`**Depends on / links out:** ${out.length ? out.join(", ") : "_none_"}`);
  lines.push("");
  lines.push(`**Used by / linked from:** ${inc.length ? inc.join(", ") : "_none_"}`);
  if (dangling.length) {
    lines.push("");
    lines.push("**Dangling references:**");
    for (const d of dangling) lines.push(`- ${d}`);
  }
  return { type: "gen", key: "links", body: lines.join("\n") };
}

function sourcePointersRegion(m: ModuleNode, records: Map<string, FileRecord>): Region {
  const lines = ["## Source pointers", "", "Open these files to work on this module:"];
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  for (const rel of m.members) {
    const rec = records.get(rel);
    const meta = rec
      ? `${plural(rec.lines, "line")}${rec.symbols.length ? `, ${plural(rec.symbols.length, "symbol")}` : ""}`
      : "";
    lines.push(`- \`${rel}\`${meta ? ` — ${meta}` : ""}`);
  }
  return { type: "gen", key: "source-pointers", body: lines.join("\n") };
}

// Build the ordered region spec for one module's encyclopedia entry. GEN regions
// (header, code view, links, source pointers) are recomputed every build; HUMAN
// regions (business, gotchas) are stubs the agent fills and the merge preserves.
export function renderEntrySpec(
  m: ModuleNode,
  graph: Graph,
  records: Map<string, FileRecord>,
  moduleOf: Map<string, string>,
): Region[] {
  return [
    headerRegion(m),
    businessStub(),
    codeViewRegion(m, records),
    linksRegion(m, graph, moduleOf),
    sourcePointersRegion(m, records),
    gotchasStub(),
  ];
}
