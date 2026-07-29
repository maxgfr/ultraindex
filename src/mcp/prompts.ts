import { TOOLS, WRITE_TOOLS } from "./tools.js";

// The workflows, as MCP prompts.
//
// Tools are the half of this skill a client can discover on its own. The other
// half is the division of labour it rests on: the engine owns the CODE view —
// what imports what, which symbol lives where — and you own the BUSINESS view,
// which no static analysis can infer. A model handed twelve tools and no
// protocol writes plausible module summaries that cite nothing, which is the
// exact failure the citation gate exists to catch.
//
// Each prompt says three things, in this order: the contract, the exact tool
// sequence, and what the gate does on failure.

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDecl {
  name: string;
  title?: string;
  description: string;
  arguments: PromptArgument[];
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

// Thrown for an unknown prompt or a missing required argument — a client bug,
// which the server reports as a JSON-RPC error rather than as content.
export class PromptError extends Error {}

const repoArg: PromptArgument = { name: "repo", description: "Absolute path to the repository root.", required: true };

export const PROMPTS: PromptDecl[] = [
  {
    name: "enrich_module",
    title: "Write a module's analysis into the encyclopedia",
    description:
      "The enrichment workflow: take one module's grounding packet, write the business-level analysis the engine cannot infer, and prove every claim " +
      "against the real source. This is how the index stops being a map and becomes an encyclopedia.",
    arguments: [
      repoArg,
      { name: "slug", description: "The module slug to enrich (from ultraindex_status).", required: false },
    ],
  },
  {
    name: "answer_grounded",
    title: "Answer a question about this repo, cited",
    description:
      "The grounded-answer workflow: retrieve the real source behind a question, answer only from it, and prove every [file:line] resolves. Use for " +
      "'how does X work here', 'where is Y handled', 'which files do I change for Z'.",
    arguments: [repoArg, { name: "question", description: "The question to answer.", required: true }],
  },
  {
    name: "review_changes",
    title: "Review a branch by what it actually reaches",
    description:
      "The review workflow: map the diff onto the graph, judge each change by its real blast radius rather than by its line count, and ground every " +
      "concern in a citation.",
    arguments: [repoArg, { name: "base", description: "The ref to diff against (e.g. main). Omit to review staged changes.", required: false }],
  },
];

export function getPrompt(name: string, args: Record<string, unknown> = {}): PromptResult {
  const decl = PROMPTS.find((p) => p.name === name);
  if (!decl) throw new PromptError(`unknown prompt: ${name || "(none given)"}`);

  for (const arg of decl.arguments) {
    if (arg.required && !str(args[arg.name])) throw new PromptError(`\`${arg.name}\` is required for prompt "${name}"`);
  }

  const text = name === "enrich_module" ? enrichModule(args) : name === "answer_grounded" ? answerGrounded(args) : reviewChanges(args);
  return { description: decl.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

// The division of labour the whole skill rests on. Stated once, quoted into
// each prompt, so the two can never drift apart.
const CORE_RULE = `The engine owns the code view: what imports what, which symbol is declared where, what a change reaches. You own the business view: what this module is FOR, why it exists, what breaks conceptually if it goes wrong. Do not restate what the generated sections already say, and do not assert anything the source in front of you does not show. Every claim carries a [file:line] citation.`;

const GATE = `\`ultraindex_check\` returning \`ok: false\` is a VERDICT, not a tool failure. Read \`errors\`, fix the claim or drop it, and check again. A citation that does not resolve is a claim you invented — not a formatting problem.`;

function enrichModule(args: Record<string, unknown>): string {
  const repo = str(args.repo)!;
  const slug = str(args.slug);

  return `Write the human analysis for ${slug ? `the \`${slug}\` module` : "the next module that needs it"} in \`${repo}\`.

${CORE_RULE}

**Sequence:**

${slug ? "" : "0. `ultraindex_status` — take the highest-priority module that has generated structure but no written prose.\n"}1. \`ultraindex_dossier\` on ${slug ? `\`${slug}\`` : "that slug"} — the module's real source plus its graph neighbours.
2. \`ultraindex_neighbors\` and \`ultraindex_impact\` on it if the dossier leaves the module's role in the system unclear. What depends on it is usually what it is for.
3. \`ultraindex_read\` anything the dossier only excerpted and you need in full.
4. Write the analysis into the module entry's human region — the one preserved across rebuilds. Every claim cites \`[file:line]\`.
5. \`ultraindex_check\` with your prose as \`answer_text\`.

**What belongs in that region.** Why this module exists and what would be lost without it. The invariants it maintains that the types do not express. The decisions that look wrong until you know the constraint. The places a newcomer predictably gets it wrong.

**What does not.** A list of the exported functions — the generated section already has it. A restatement of the import graph. Anything of the form "handles the X logic", which says nothing and cites nothing.

${GATE}`;
}

function answerGrounded(args: Record<string, unknown>): string {
  const repo = str(args.repo)!;
  const question = str(args.question)!;

  return `Answer this question about \`${repo}\`:

> ${question}

${CORE_RULE}

**Sequence:**

1. \`ultraindex_map\` — only if you do not already know how this repo is laid out. Navigation, not evidence: cite the source, never the map.
2. \`ultraindex_ask\` with the question. It returns the ranked modules AND their real source, assembled as one packet.
3. Widen what is thin: \`ultraindex_symbols\` to resolve a name to its declaration and its callers, \`ultraindex_impact\` for what a change would reach, \`ultraindex_read\` for the full file behind an excerpt.
4. Write the answer, citing \`[file:line]\` on every claim.
5. \`ultraindex_check\` with the answer as \`answer_text\`.

**If the retrieved source does not settle the question**, say so and retrieve differently — a re-query with the code's own vocabulary beats reading further down a packet that came back off-topic. An unsettled question is an honest answer; a plausible one is not.

${GATE}`;
}

function reviewChanges(args: Record<string, unknown>): string {
  const repo = str(args.repo)!;
  const base = str(args.base);

  return `Review the ${base ? `changes against \`${base}\`` : "staged changes"} in \`${repo}\`.

${CORE_RULE}

**Sequence:**

1. \`ultraindex_delta\`${base ? ` with \`base: "${base}"\`` : " with `staged: true`"} — the changed files, the symbols they touch, and the blast radius of each, scored by risk.
2. Work the panel in risk order, not file order. For each change that matters: \`ultraindex_impact\` on the touched file to see everything downstream, and \`ultraindex_read\` to see the change in its real context.
3. \`ultraindex_symbols\` on any signature that changed — every call site is a place this diff can break, and the panel names them.
4. Write the review. Each concern names the file and line it is about, and what specifically breaks.
5. \`ultraindex_check\` with the review as \`answer_text\`.

**Review what the diff REACHES, not what it edits.** A three-line change to a hub module outranks a two-hundred-line change to a leaf, and the panel's risk score already tells you which is which. A concern you cannot cite is a hunch — either ground it or drop it.

${GATE}`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

// Every tool a prompt tells the model to call must actually be declared —
// otherwise a prompt survives a tool rename as a set of instructions that
// cannot be followed. Exported so the test can assert it rather than a human
// having to notice.
const DECLARED = new Set([...TOOLS, ...WRITE_TOOLS].map((t) => t.name));

export function toolNamesReferencedBy(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/ultraindex_[a-z_]+/g)) if (DECLARED.has(m[0])) found.add(m[0]);
  return [...found].sort();
}

export function unknownToolNamesIn(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(/ultraindex_[a-z_]+/g)) if (!DECLARED.has(m[0])) bad.add(m[0]);
  return [...bad].sort();
}
