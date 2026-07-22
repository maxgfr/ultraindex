import type { Graph, ModuleNode, Tier } from "../types.js";
import type { MermaidResult } from "./mermaid.js";
import { byStr, clip } from "../engine.js";

const TIER_LABEL: Record<Tier, string> = { 0: "Foundations", 1: "Features", 2: "Tail" };
const HUB_CAP = 12;
const BRIDGE_CAP = 8;
const BRIDGE_MIN_MODULES = 8; // below this, everything is trivially a bridge — no signal
const UNTESTED_CAP = 6; // untested modules named on the Tests line before overflow
const SURPRISE_SHOWN = 8; // unusual couplings listed in the Architecture section
const MODULE_CAP = 120; // keep INDEX.md always-loadable on huge repos
const ARCH_CAP = 12; // communities shown in the Architecture section
const ARCH_MEMBER_CAP = 12; // member slugs listed per community before overflow

const degree = (m: ModuleNode): number => m.degIn + m.degOut;

function histogram(languages: Record<string, number>): string {
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1] || byStr(a[0], b[0]))
    .slice(0, 8)
    .map(([k, v]) => `${k}:${v}`)
    .join(" · ");
}

function row(m: ModuleNode): string {
  const link = `[\`${m.slug}\`](encyclopedia/${m.slug}.md)`;
  return `| ${link} | \`${m.path}\` | ${clip(m.summary, 90).split("\n")[0]} | ${m.members.length} | ${degree(m)} |`;
}

// Render INDEX.md — the always-loadable map. Kept small: a summary line, the hub
// modules, and a tier-grouped module table (capped, with an explicit overflow
// note). Per-file detail lives in the entries and graph.json, never here.
export function renderIndex(
  graph: Graph,
  opts: { repoName: string; mermaid?: MermaidResult },
): string {
  const dangling = graph.fileEdges.filter((e) => e.dangling).length;
  const lines: string[] = [];

  lines.push(`# ${opts.repoName} — ultraindex map`);
  lines.push("");
  lines.push(
    `${graph.fileCount} files · ${graph.modules.length} modules · ${graph.fileEdges.length} links` +
      `${dangling ? ` (${dangling} dangling)` : ""}${graph.commit ? ` · @ ${graph.commit}` : ""}`,
  );
  lines.push("");
  lines.push(`**Languages:** ${histogram(graph.languages)}`);

  // Tests — one line from the stamped tests→code fields: how much of the code
  // is covered at all, and the most load-bearing uncovered modules. "Testable"
  // means tier ≤ 1 with at least one non-test code member and declared symbols.
  const nonTestCode = new Set<string>();
  for (const f of graph.files) {
    if (f.fileKind === "code" && !f.testFile) nonTestCode.add(f.module);
  }
  const testable = graph.modules.filter((m) => m.tier <= 1 && m.symbols > 0 && nonTestCode.has(m.slug));
  if (testable.length) {
    const testFileCount = graph.files.filter((f) => f.testFile).length;
    const untested = testable.filter((m) => !m.testedBy?.length);
    const top = untested
      .slice()
      .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0) || byStr(a.slug, b.slug))
      .slice(0, UNTESTED_CAP);
    let line =
      `**Tests:** ${testFileCount} test file${testFileCount === 1 ? "" : "s"} · ` +
      `${testable.length - untested.length}/${testable.length} code modules tested`;
    if (top.length) {
      const overflow = untested.length > top.length ? ` _(+${untested.length - top.length} more)_` : "";
      line += ` · untested: ${top.map((m) => `\`${m.slug}\``).join(", ")}${overflow}`;
    }
    lines.push("");
    lines.push(line);
  }

  lines.push("");
  lines.push(
    "**Navigate:** `ultraindex find \"<task>\"` lists the exact files to open · " +
      "`ultraindex neighbors <file|module>` walks the graph · entries are in `encyclopedia/` · " +
      "the module diagram is in `graph.mmd`.",
  );

  // Hubs — the most important modules, where understanding usually starts.
  // Ranked by pagerank (what the graph structurally depends on) when the build
  // stamped it; graphs without centrality (older or hand-built) fall back to the
  // original degree ranking so the section never disappears.
  const hasPagerank = graph.modules.some((m) => m.pagerank !== undefined);
  const hubs = graph.modules
    .slice()
    .filter((m) => degree(m) > 0)
    .sort((a, b) =>
      hasPagerank
        ? (b.pagerank ?? 0) - (a.pagerank ?? 0) || degree(b) - degree(a) || byStr(a.slug, b.slug)
        : degree(b) - degree(a) || byStr(a.slug, b.slug),
    )
    .slice(0, HUB_CAP);
  if (hubs.length) {
    lines.push("");
    lines.push("## Hubs");
    lines.push("");
    for (const m of hubs) {
      const d = degree(m);
      const links = `${d} link${d === 1 ? "" : "s"}`;
      const metrics = hasPagerank ? `pr ${(m.pagerank ?? 0).toFixed(2)} · ${links}` : links;
      lines.push(`- [\`${m.slug}\`](encyclopedia/${m.slug}.md) (${metrics}) — ${clip(m.summary, 100).split("\n")[0]}`);
    }
  }

  // Bridges — high-betweenness connectors between subsystems that the Hubs list
  // (pagerank/degree) misses. A change here has few alternative paths around it.
  if (graph.modules.length >= BRIDGE_MIN_MODULES) {
    const hubSet = new Set(hubs.map((m) => m.slug));
    const bridges = graph.modules
      .filter((m) => (m.betweenness ?? 0) > 0 && !hubSet.has(m.slug))
      .sort((a, b) => b.betweenness! - a.betweenness! || degree(b) - degree(a) || byStr(a.slug, b.slug))
      .slice(0, BRIDGE_CAP);
    if (bridges.length) {
      lines.push("");
      lines.push("## Bridges");
      lines.push("");
      lines.push("Connectors between subsystems — few alternative paths route around these; review changes here with extra care.");
      lines.push("");
      for (const m of bridges) {
        const d = degree(m);
        lines.push(
          `- [\`${m.slug}\`](encyclopedia/${m.slug}.md) (betweenness ${m.betweenness!.toFixed(2)} · ${d} link${d === 1 ? "" : "s"}) — ${clip(m.summary, 100).split("\n")[0]}`,
        );
      }
    }
  }

  // Architecture — the module communities (a coarse clustering into subsystems),
  // for navigation only. Each is labelled by its highest-degree member's path.
  // Omitted when there is a single community (tiny repos): no signal.
  const byCommunity = new Map<number, ModuleNode[]>();
  for (const m of graph.modules) {
    if (m.community === undefined) continue;
    (byCommunity.get(m.community) ?? byCommunity.set(m.community, []).get(m.community)!).push(m);
  }
  if (byCommunity.size > 1) {
    lines.push("");
    lines.push("## Architecture");
    lines.push("");
    const groups = [...byCommunity.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
      .slice(0, ARCH_CAP);
    for (const [, members] of groups) {
      const label = members.slice().sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug))[0]!.path;
      const slugs = members.map((m) => m.slug).sort(byStr);
      const shown = slugs.slice(0, ARCH_MEMBER_CAP).map((s) => `\`${s}\``).join(", ");
      const overflow = slugs.length > ARCH_MEMBER_CAP ? ` _(+${slugs.length - ARCH_MEMBER_CAP} more)_` : "";
      lines.push(`- \`${label}\` — ${shown}${overflow}`);
    }

    // Surprising couplings — near-unique dependency edges between communities.
    const surprises = (graph.surprises ?? []).slice(0, SURPRISE_SHOWN);
    if (surprises.length) {
      const labelOf = (cid: number): string => {
        const members = byCommunity.get(cid) ?? [];
        const top = members.slice().sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug))[0];
        return top ? top.path : String(cid);
      };
      lines.push("");
      lines.push("**Unusual couplings:**");
      for (const s of surprises) {
        const w = s.weight > 1 ? ` ×${s.weight}` : "";
        const linkPhrase = s.pairEdges === 1 ? "the only link" : `1 of ${s.pairEdges} links`;
        lines.push(
          `- ⚠ \`${s.from}\` → \`${s.to}\` (${s.kind}${w}) — ${linkPhrase} between \`${labelOf(s.communities[0])}\` and \`${labelOf(s.communities[1])}\``,
        );
      }
    }
  }

  // Modules, grouped by tier. Cap total rows to keep the map loadable.
  lines.push("");
  lines.push("## Modules");
  const ranked = graph.modules
    .slice()
    .sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug));
  const shown = ranked.slice(0, MODULE_CAP);
  const shownSet = new Set(shown.map((m) => m.slug));
  for (const tier of [0, 1, 2] as Tier[]) {
    const inTier = shown.filter((m) => m.tier === tier).sort((a, b) => byStr(a.slug, b.slug));
    if (!inTier.length) continue;
    lines.push("");
    lines.push(`### ${TIER_LABEL[tier]}`);
    lines.push("");
    lines.push("| module | path | summary | files | links |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const m of inTier) lines.push(row(m));
  }
  if (ranked.length > shown.length) {
    const more = ranked.length - shown.length;
    const omitted = ranked.slice(shown.length).map((m) => m.slug);
    lines.push("");
    lines.push(`_… and ${more} more module(s) not shown here (run \`ultraindex map\` for the full list, or \`ultraindex find\`): ${clip(omitted.join(", "), 300).split("\n")[0]}_`);
  }

  if (opts.mermaid && (opts.mermaid.shownModules < opts.mermaid.totalModules || opts.mermaid.shownEdges < opts.mermaid.totalEdges)) {
    lines.push("");
    lines.push(
      `_Diagram (\`graph.mmd\`) shows ${opts.mermaid.shownModules}/${opts.mermaid.totalModules} modules ` +
        `and ${opts.mermaid.shownEdges}/${opts.mermaid.totalEdges} edges; full graph in \`graph.json\`._`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
