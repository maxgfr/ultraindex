import type { Edge, FileRecord, Graph, ModuleNode, Tier } from "../types.js";
import { ENRICH_MARKER, type Region } from "../merge.js";
import { byStr } from "../sort.js";
import { clip } from "../util.js";

// Module edges and dangling refs pre-grouped by module, built ONCE per build so
// each entry is O(its own links) instead of re-scanning every graph edge — the
// difference between O(modules+edges) and O(modules×edges) on a hub-heavy repo.
export interface EntryEdgeIndex {
  out: Map<string, Edge[]>; // moduleEdges keyed by `from`
  inc: Map<string, Edge[]>; // moduleEdges keyed by `to`
  dangling: Map<string, Edge[]>; // dangling fileEdges keyed by the owning module slug
}

export function buildEntryEdgeIndex(graph: Graph, moduleOf: Map<string, string>): EntryEdgeIndex {
  const out = new Map<string, Edge[]>();
  const inc = new Map<string, Edge[]>();
  const dangling = new Map<string, Edge[]>();
  const push = (m: Map<string, Edge[]>, key: string, e: Edge): void => {
    const arr = m.get(key);
    if (arr) arr.push(e);
    else m.set(key, [e]);
  };
  for (const e of graph.moduleEdges) {
    push(out, e.from, e);
    push(inc, e.to, e);
  }
  for (const e of graph.fileEdges) {
    if (!e.dangling) continue;
    const slug = moduleOf.get(e.from);
    if (slug) push(dangling, slug, e);
  }
  return { out, inc, dangling };
}

const TIER_LABEL: Record<Tier, string> = { 0: "Foundations", 1: "Features", 2: "Tail" };
const MAX_SYMBOLS_PER_FILE = 15;
const MAX_DANGLING = 12;
const MAX_LINKS = 30; // cap per direction so a hub's entry stays readable / diffable

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
    body: `${ENRICH_MARKER} _What this module does for the product and how it connects to the rest of the system. Replace this paragraph during the enrichment pass._`,
  };
}

function gotchasStub(): Region {
  return {
    type: "human",
    key: "gotchas",
    body: `${ENRICH_MARKER} _Caveats, invariants, or pitfalls worth knowing before changing this module. Optional._`,
  };
}

function codeViewRegion(m: ModuleNode, records: Map<string, FileRecord>): Region {
  const lines: string[] = ["## Code view"];
  const langs = [...new Set(m.members.map((r) => records.get(r)?.lang).filter((l): l is string => !!l && l !== "other"))];
  if (langs.length) {
    lines.push("");
    lines.push(`**Languages:** ${langs.sort(byStr).join(", ")}`);
  }

  const renderBlock = (rel: string, syms: FileRecord["symbols"]): string => {
    const shown = syms.slice(0, MAX_SYMBOLS_PER_FILE);
    const block = [`- \`${rel}\``];
    for (const s of shown) {
      const sig = s.signature ? ` — \`${clip(s.signature, 100).split("\n")[0]}\`` : "";
      block.push(`  - \`${s.kind} ${s.name}\`${sig}`);
    }
    if (syms.length > shown.length) block.push(`  - _…and ${syms.length - shown.length} more_`);
    return block.join("\n");
  };

  const apiBlocks: string[] = [];
  // Fallback for modules whose symbols exist but none is structurally exported —
  // e.g. a CommonJS module whose public API is property assignment
  // (`res.sendFile = function(){}`), which the extractor records as private, or a
  // script. Without this the code-view would wrongly print "No exported symbols
  // detected" while the header still counts those symbols (the two contradict).
  const internalBlocks: string[] = [];
  for (const rel of m.members) {
    const rec = records.get(rel);
    if (!rec || rec.kind !== "code" || !rec.symbols.length) continue;
    const exported = rec.symbols.filter((s) => s.exported).sort((a, b) => a.line - b.line);
    if (exported.length) apiBlocks.push(renderBlock(rel, exported));
    else internalBlocks.push(renderBlock(rel, rec.symbols.slice().sort((a, b) => a.line - b.line)));
  }

  lines.push("");
  if (apiBlocks.length) {
    lines.push("**Exported API:**");
    lines.push("");
    lines.push(apiBlocks.join("\n"));
  } else if (internalBlocks.length) {
    // Symbols are present but none is marked exported — surface them so the entry
    // reconciles with the header's symbol count instead of claiming there are none.
    lines.push("**Symbols** (none marked exported — a CommonJS/script module, or the export is dynamic):");
    lines.push("");
    lines.push(internalBlocks.join("\n"));
  } else {
    lines.push("_No exported symbols detected (the module is docs/config, or its language has no extractor)._");
  }
  return { type: "gen", key: "code-view", body: lines.join("\n") };
}

function linksRegion(m: ModuleNode, edgeIndex: EntryEdgeIndex): Region {
  // Heaviest links first, capped — a hub can have hundreds of dependents and an
  // unbounded list makes the entry unreadable and its diffs enormous.
  const render = (edges: Edge[], other: (e: { from: string; to: string }) => string): string[] => {
    const sorted = edges.slice().sort((a, b) => b.weight - a.weight || byStr(other(a), other(b)));
    const shown = sorted.slice(0, MAX_LINKS).map((e) => {
      const o = other(e);
      return `[\`${o}\`](${o}.md) (${e.kind}${e.weight > 1 ? ` ×${e.weight}` : ""})`;
    });
    if (sorted.length > MAX_LINKS) shown.push(`…and ${sorted.length - MAX_LINKS} more`);
    return shown;
  };
  const out = render(edgeIndex.out.get(m.slug) ?? [], (e) => e.to);
  const inc = render(edgeIndex.inc.get(m.slug) ?? [], (e) => e.from);
  const dangling = (edgeIndex.dangling.get(m.slug) ?? [])
    .slice()
    .sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to))
    .slice(0, MAX_DANGLING)
    .map((e) => `\`${e.to}\` (${e.kind}, ${e.reason}) — from \`${e.from}\``);

  // One link per line (like dangling refs) so hub entries stay readable and their
  // git diffs scale with what actually changed, not the whole list.
  const bulletList = (items: string[]): string[] => (items.length ? items.map((i) => `- ${i}`) : ["_none_"]);
  const lines = ["## Links"];
  lines.push("");
  lines.push("**Depends on / links out:**");
  lines.push(...bulletList(out));
  lines.push("");
  lines.push("**Used by / linked from:**");
  lines.push(...bulletList(inc));
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
  edgeIndex: EntryEdgeIndex,
  records: Map<string, FileRecord>,
): Region[] {
  return [
    headerRegion(m),
    businessStub(),
    codeViewRegion(m, records),
    linksRegion(m, edgeIndex),
    sourcePointersRegion(m, records),
    gotchasStub(),
  ];
}
