import { join, extname } from "node:path";
import type { Graph, ModuleNode } from "./types.js";
import { readText } from "./walk.js";
import { extractCode } from "./extract/code.js";
import { extToLang } from "./lang/registry.js";
import { clip } from "./util.js";
import { byStr } from "./sort.js";

const HEAD_LINES = 60;
const MAX_SYMS = 25;

// Real source pulled from disk for grounding — the agent reads THIS, not its
// memory, before writing analysis (the ultradoc "evidence, not training data"
// principle, applied to a local index).
export interface EvidenceFile {
  rel: string;
  lines: number;
  exported: { kind: string; name: string; line: number; signature?: string }[];
  head: string;
  headTo: number;
}

// Read the given files and extract, for each, its exported surface + a head
// excerpt. Pure read — never mutates the repo.
export function gatherEvidence(repo: string, rels: string[], headLines = HEAD_LINES): EvidenceFile[] {
  const out: EvidenceFile[] = [];
  for (const rel of rels) {
    const content = readText(join(repo, rel));
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    const code = extractCode(rel, extname(rel).toLowerCase(), content);
    const exported = code.symbols
      .filter((s) => s.exported)
      .slice(0, MAX_SYMS)
      .map((s) => ({ kind: s.kind, name: s.name, line: s.line, signature: s.signature }));
    out.push({
      rel,
      lines: lines.length,
      exported,
      head: lines.slice(0, headLines).join("\n"),
      headTo: Math.min(lines.length, headLines),
    });
  }
  return out;
}

function fence(rel: string): string {
  const lang = extToLang(extname(rel).toLowerCase());
  const map: Record<string, string> = { typescript: "ts", javascript: "js", python: "py", markdown: "md" };
  return map[lang] ?? (lang === "other" ? "" : lang);
}

function renderFile(e: EvidenceFile): string {
  const parts = [`### \`${e.rel}\` (${e.lines} lines)`];
  if (e.exported.length) {
    parts.push("", "Exported:");
    for (const s of e.exported) {
      const sig = s.signature ? ` — \`${clip(s.signature, 100).split("\n")[0]}\`` : "";
      parts.push(`- \`${s.kind} ${s.name}\` @ line ${s.line}${sig}`);
    }
  }
  parts.push("", `Source (lines 1-${e.headTo}${e.headTo < e.lines ? ", file continues…" : ""}):`, "```" + fence(e.rel), e.head, "```");
  return parts.join("\n");
}

// Pick the most informative code files of a module (most exported symbols, then
// most-connected), capped — the agent shouldn't read the whole module.
function keyFiles(graph: Graph, module: ModuleNode, cap: number): string[] {
  const nodes = new Map(graph.files.map((f) => [f.rel, f]));
  return module.members
    .filter((rel) => nodes.get(rel)?.fileKind === "code")
    .sort((a, b) => {
      const fa = nodes.get(a)!;
      const fb = nodes.get(b)!;
      return fb.symbols - fa.symbols || fb.degIn + fb.degOut - (fa.degIn + fa.degOut) || byStr(a, b);
    })
    .slice(0, cap);
}

const MAX_NEIGHBORS = 15; // keep the dossier bounded for hubs with many consumers

function neighborLines(graph: Graph, slug: string): string[] {
  const byId = new Map(graph.modules.map((m) => [m.slug, m]));
  const line = (s: string, dir: string): string => `- ${dir} \`${s}\` — ${clip(byId.get(s)?.summary ?? "", 80).split("\n")[0]}`;
  const side = (ids: string[], dir: string): string[] => {
    const uniq = [...new Set(ids)].sort(byStr);
    const shown = uniq.slice(0, MAX_NEIGHBORS).map((s) => line(s, dir));
    if (uniq.length > MAX_NEIGHBORS) shown.push(`- …and ${uniq.length - MAX_NEIGHBORS} more ${dir.includes("depends") ? "dependencies" : "consumers"}`);
    return shown;
  };
  return [
    ...side(graph.moduleEdges.filter((e) => e.from === slug).map((e) => e.to), "→ depends on"),
    ...side(graph.moduleEdges.filter((e) => e.to === slug).map((e) => e.from), "← used by"),
  ];
}

const CITE_HELP =
  "Cite every factual claim with the file it rests on, in brackets: `[path]`, `[path:line]`, or `[path:start-end]` " +
  "(e.g. `[src/api/client.ts:42-58]`). `ultraindex check` fails if a citation does not resolve to a real file/line.";

// A grounding packet for ONE module — fed to the agent before it writes the
// module's business analysis (the `ui:human` regions of its entry).
export function renderModuleDossier(repo: string, graph: Graph, module: ModuleNode): string {
  const files = keyFiles(graph, module, 6);
  const evidence = gatherEvidence(repo, files);
  const neighbors = neighborLines(graph, module.slug);
  const lines = [
    `# Dossier — module \`${module.slug}\`  (\`${module.path}\`, tier ${module.tier})`,
    "",
    `${module.members.length} files · ${module.symbols} symbols · entry: encyclopedia/${module.slug}.md`,
    "",
    "## Task",
    `Read the REAL code below and write a grounded business analysis into the \`ui:human\` regions of \`encyclopedia/${module.slug}.md\`: what this module does for the product, how it connects to the rest, and any gotchas. ${CITE_HELP}`,
  ];
  if (neighbors.length) {
    lines.push("", "## Graph neighbours", ...neighbors);
  }
  lines.push("", "## Key source");
  if (evidence.length) for (const e of evidence) lines.push("", renderFile(e));
  else lines.push("", "_(no code files in this module — likely docs/config)_");
  return lines.join("\n") + "\n";
}

// A grounding packet for a QUESTION — the relevant modules' key source, so the
// agent answers from real code and cites it.
export function renderAskDossier(
  repo: string,
  graph: Graph,
  question: string,
  modules: { slug: string; files: string[] }[],
): string {
  const byId = new Map(graph.modules.map((m) => [m.slug, m]));
  const lines = [
    `# Evidence dossier for: "${question}"`,
    "",
    "## Task",
    `Answer the question USING ONLY the source below (and files you open from it) — not your own memory of the codebase. Write your answer to \`ANSWER.md\`, then run \`ultraindex check --answer ANSWER.md\`. ${CITE_HELP} An answer must carry at least one citation.`,
    "",
    `## Relevant modules`,
    ...modules.map((m) => `- \`${m.slug}\` (\`${byId.get(m.slug)?.path ?? m.slug}\`) — open: ${m.files.join(", ") || "(none)"}`),
    "",
    "## Source",
  ];
  const seen = new Set<string>();
  const rels = modules.flatMap((m) => m.files).filter((r) => (seen.has(r) ? false : (seen.add(r), true))).slice(0, 12);
  const evidence = gatherEvidence(repo, rels);
  if (evidence.length) for (const e of evidence) lines.push("", renderFile(e));
  else lines.push("", "_(no readable source for the matched files)_");
  return lines.join("\n") + "\n";
}
