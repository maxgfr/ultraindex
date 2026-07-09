import { join } from "node:path";
import type { OrchestrateContext, PhaseInfo } from "./orchestrate.js";

// ---------------------------------------------------------------------------
// Templates for `ultraindex orchestrate` — the generator that turns the index's
// CURRENT state into a launchable multi-agent Workflow per phase, the dispatch
// contracts it references, and a sequential RUNBOOK fallback. Everything here
// is emitted by string concatenation with the index's constants injected as
// JSON literals, so the workflow runs as-is under the Workflow tool:
// `export const meta` stays a pure literal, and no emitted line ever calls
// Date.now()/Math.random()/new Date() (they throw in that harness).
// ---------------------------------------------------------------------------

// Structured-output schema for the enrich fan-out. Enrichers WRITE their own
// encyclopedia entries (the sanctioned disjoint-write exception — see the
// contract) and RETURN what they wrote, so the orchestrator can route the
// repo-wide `check`'s grounding failures back to the agent that owns each entry.
const ENRICH_SCHEMA = {
  type: "object",
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["slug", "entry", "note"],
        properties: {
          slug: { type: "string", description: "the module slug you enriched" },
          entry: { type: "string", description: "absolute path of the encyclopedia entry you wrote" },
          note: { type: "string", description: "one line on what you enriched, grounded in the dossier" },
        },
      },
    },
  },
};

// Structured-output schema for the verify-answer fan-out. Mirrors the row shape
// `verify --apply` validates fail-closed (claimId + citation + a valid verdict),
// so a fragment that validates here still gets re-checked at fold time.
const VERIFY_ANSWER_SCHEMA = {
  type: "object",
  required: ["pairs"],
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        required: ["claimId", "citation", "verdict", "note"],
        properties: {
          claimId: { type: "string" },
          citation: { type: "string" },
          verdict: { enum: ["supported", "partial", "refuted", "unsupported"] },
          note: { type: "string", description: "one line grounded in the source you read" },
        },
      },
    },
  },
};

interface PhaseSpec {
  role: string;
  title: string;
  schema: unknown;
  description: (items: number) => string;
  /** The orchestrator's own step after the join, shown as a comment in the workflow tail + in the runbook. */
  joinHint: (ctx: OrchestrateContext, ph: PhaseInfo) => string;
}

const PHASE_SPECS: Record<string, PhaseSpec> = {
  enrich: {
    role: "enricher",
    title: "Enrich",
    schema: ENRICH_SCHEMA,
    description: (n) => `Enrich the ${n} unenriched encyclopedia entr${n === 1 ? "y" : "ies"} of an ultraindex index with cited prose (disjoint-write fan-out)`,
    joinHint: (ctx) => `node ${ctx.engine} check --out ${ctx.out} --repo ${ctx.repo}`,
  },
  "verify-answer": {
    role: "refuter",
    title: "Verify",
    schema: VERIFY_ANSWER_SCHEMA,
    description: (n) => `Adversarially verify the ${n} claim↔citation pair(s) of an answer over an ultraindex index (skeptic fan-out)`,
    joinHint: (ctx) => `node ${ctx.engine} verify --apply <verdicts.json> --answer ${ctx.answer ?? "<answer.md>"}`,
  },
};

export function phaseSpec(name: string): PhaseSpec {
  const spec = PHASE_SPECS[name];
  if (!spec) throw new Error(`no phase spec for "${name}"`);
  return spec;
}

/** Chunk queue ids into batches, one subagent per batch (order-preserving, deterministic). */
export function toBatches(ids: string[], batchSize: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) out.push(ids.slice(i, i + batchSize));
  return out;
}

export function phaseWorkflowScript(ph: PhaseInfo, ctx: OrchestrateContext, batchSize: number): string {
  const spec = phaseSpec(ph.name);
  const scriptPath = join(ctx.out, "orchestration", `${ph.name}.workflow.mjs`);
  const meta = { name: `ultraindex-${ph.name}`, description: spec.description(ph.items), phases: [{ title: spec.title }] };
  const source =
    ph.name === "enrich"
      ? "the CURRENT enrichment queue (exactly what `status --json` reports)"
      : "the CURRENT claim↔citation worklist";
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `// NOT a plain Node script: launch via the Workflow tool — Workflow({ scriptPath: ${JSON.stringify(scriptPath)} }).`,
    `// Emitted by \`ultraindex orchestrate\` from ${source}. The index is the`,
    `// source of truth: if it changes, re-run \`orchestrate --phase ${ph.name}\` before launching.`,
    `//`,
    `// HARD RULE: no \`build\` or \`map\` runs while this fan-out is in flight — \`build\``,
    `// rewrites every encyclopedia entry, so a mid-fan-out rebuild races and clobbers`,
    `// the agents' writes. Build once before; never during.`,
    ``,
    `// Constants for THIS index (injected at emit time; no Date.now/Math.random in this harness).`,
    `const OUT = ${JSON.stringify(ctx.out)}`,
    `const REPO = ${JSON.stringify(ctx.repo)}`,
    `const ENGINE = ${JSON.stringify(ctx.engine)}`,
    `const WORKLIST = ${JSON.stringify(ph.worklist)}`,
    `const AGENTS = OUT + '/orchestration/agents'`,
    `const BATCHES = ${JSON.stringify(toBatches(ph.ids, batchSize))}`,
    `const SCHEMA = ${JSON.stringify(spec.schema)}`,
    ``,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: OUT=' + OUT + '  REPO=' + REPO + '  ENGINE=' + ENGINE + '  WORKLIST=' + WORKLIST + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd> — read-only commands only.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultraindex ${ph.name}: ' + ${JSON.stringify(String(ph.items))} + ' item(s) across ' + BATCHES.length + ' agent(s)')`,
    ``,
    `phase(${JSON.stringify(spec.title)})`,
    `const results = await pipeline(BATCHES, (batch, _item, i) =>`,
    `  agent(contract('${spec.role}', 'ITEMS=' + batch.join(',')), { label: '${ph.name}:' + (i + 1), phase: ${JSON.stringify(spec.title)}, agentType: 'general-purpose', schema: SCHEMA }))`,
    ``,
    ...(ph.name === "enrich"
      ? [
          `// Disjoint-write exception: each enricher wrote ONLY its own encyclopedia/<slug>.md`,
          `// entries and returned the list. After the join, the orchestrator (you) runs the`,
          `// single repo-wide gate and routes each grounding failure back to the agent that`,
          `// owns that entry (never a mid-flight rebuild):`,
          `//   ${spec.joinHint(ctx, ph)}`,
        ]
      : [
          `// One-writer rule: this workflow only COLLECTS verdict fragments. The main agent folds`,
          `// them into a verdicts.json itself (your ITEMS are 1-based positions in the worklist's`,
          `// pairs[]), then runs the fail-closed fold:`,
          `//   ${spec.joinHint(ctx, ph)}`,
        ]),
    `return { phase: ${JSON.stringify(ph.name)}, worklist: WORKLIST, results: results.filter(Boolean) }`,
    ``,
  ].join("\n");
}

export function agentContracts(ctx: OrchestrateContext): Record<string, string> {
  const engine = `node ${ctx.engine}`;
  return {
    enricher: `# Contract: enricher

You enrich encyclopedia entries of an ultraindex index — the grounded business analysis the deterministic engine cannot write. Handle ONLY the module slugs named in your prompt (\`ITEMS=<slug,…>\`).

Index: \`${ctx.out}\` · Repo: \`${ctx.repo}\`. The queue you were drawn from is exactly what \`${engine} status --out ${ctx.out} --json\` reports (unenriched modules, most useful first).

For EACH of your slugs:

1. Run \`${engine} dossier <slug> --out ${ctx.out}\` (read-only) and read ONLY that packet — the module's real key source + graph neighbours. A docs/config-only module (often \`root\`) shows no code — cite its README/config files instead.
2. Edit \`${join(ctx.out, "encyclopedia")}/<slug>.md\`: fill the \`ui:human\` regions (\`business\` — what it does for the product and how it connects; \`gotchas\` — caveats) with 2–5 sentences of genuine analysis, **citing the evidence** as \`[file]\`, \`[file:line]\` or \`[file:start-end]\`. Write only what the source supports — no guessing. Remove the \`<!-- ui:enrich -->\` stub marker; leave every \`ui:gen\` region alone.
3. Cite only files inside that module (you may open a file the dossier lists to cite a line past the excerpt — never a file outside your module).

Return (structured output): \`{ "entries": [{ "slug", "entry", "note" }] }\` — the entries you wrote (absolute paths) + a one-line note per entry, so the orchestrator can route \`check\` failures back to you.

## Write ONLY your own entries (the sanctioned disjoint-write exception)

ultraindex relaxes the family one-writer rule in exactly one place, and you are it: each module's entry is an independent unit of work, so you write your cited prose DIRECTLY into your own \`encyclopedia/<slug>.md\` entries — and nothing else. Do NOT edit another module's entry; do NOT touch \`graph.json\` / \`manifest.json\` / \`INDEX.md\` / \`vectors.json\` / \`symbols.json\`. HARD RULE: no \`build\` or \`map\` runs while the fan-out is in flight — a mid-fan-out rebuild races and clobbers every agent's writes. There is no per-module check either: the orchestrator runs a single repo-wide \`check\` after the join and routes grounding failures back per entry.
`,
    refuter: `# Contract: refuter

You are an adversarial skeptic verifying the claims of an answer written over an ultraindex index. Your job is to try to REFUTE each claim: assume it is wrong until the cited source proves it.

Worklist: the \`VERIFY.todo.json\` named in your prompt's \`WORKLIST=\` constant (an object with \`answer\` and \`pairs[]\`; each pair has \`claimId\`, \`claim\`, \`citation\`, \`path\`, \`digest\`). Handle ONLY the pairs whose 1-based position in \`pairs[]\` is named in your prompt (\`ITEMS=<n,…>\`).

For EACH of your pairs:

1. Read the pair's \`digest\` (the cited excerpt, extracted verbatim at \`verify\` time) and open \`path\` in the repo (\`${ctx.repo}\`) at the cited lines whenever the digest alone cannot settle it.
2. Judge whether the excerpt SUPPORTS the claim:
   - \`supported\` — the cited source establishes the claim as stated.
   - \`partial\` — a real basis, but the claim overstates it (wrong scope, exaggerated behaviour).
   - \`unsupported\` — the source does not establish the claim.
   - \`refuted\` — the source contradicts the claim.
   When unsure, choose the HARSHER verdict — a false pass is worse than a false fail.
3. \`note\` is REQUIRED — one line grounded in what you read (quote or paraphrase the decisive code).

Return (structured output): \`{ "pairs": [{ "claimId", "citation", "verdict", "note" }] }\` — your ITEMS only.

## Return, don't write

Return ONLY the structured output specified above. Do NOT write, edit, or delete any file; do NOT run any engine command that writes (\`build\`, \`embed\`, \`verify --apply\`). The orchestrator is the sole writer — it folds your verdicts into a verdicts file itself and runs the fail-closed \`verify --apply\` gate. Exception: if a justification is prose too large to return, write ONLY to \`${join(ctx.out, "orchestration", "out")}/<role>-<batch>.md\` (a file namespaced to you alone) and return its path.
`,
  };
}

export function runbookMd(phases: PhaseInfo[], ctx: OrchestrateContext): string {
  const status = phases
    .map((p) => `| ${p.name} | \`${p.worklist}\` | ${p.ready ? `ready (${p.items} item(s))` : "not ready"} | \`${p.prerequisite}\` |`)
    .join("\n");
  const engine = `node ${ctx.engine}`;
  const agents = join(ctx.out, "orchestration", "agents");
  return `# ultraindex — sequential RUNBOOK (eco / no-subagent fallback)

Index: \`${ctx.out}\` · Repo: \`${ctx.repo}\` · Engine: \`${engine}\`

Generated by \`ultraindex orchestrate\` from the CURRENT index state. This sequential path is
correctness-identical to the multi-agent workflows — same queue, same contracts, same
grounding gates; only wall-clock differs. Fan-out is an optimization, not a requirement.

## Phase status

| Phase | Worklist | Status | Produce it with |
|---|---|---|---|
${status}

## The loop (play every role yourself, one item at a time)

1. **Build** (if not done): \`${engine} build --repo ${ctx.repo} --out ${ctx.out}\` — once, before any enrichment.
2. **Queue**: \`${engine} status --out ${ctx.out} --json\` — every module in the exact order to enrich (unenriched first, hubs first). The enrich phase fans out over \`${join(ctx.out, "graph.json")}\` + the entries exactly as this queue reports them.
3. **Enrich each module** — apply \`${join(agents, "enricher.md")}\` yourself: \`${engine} dossier <slug> --out ${ctx.out}\`, then write 2–5 sentences of cited \`[file:line]\` prose into the \`ui:human\` regions of \`${join(ctx.out, "encyclopedia")}/<slug>.md\`. One module at a time; the hard rule holds here too — no \`build\` or \`map\` mid-loop.
4. **Gate**: \`${engine} check --out ${ctx.out} --repo ${ctx.repo}\` — repo-wide; it keys each grounding failure to its entry. Fix and re-run until green (never delete a citation just to pass).
5. **Semantic layer** (only if \`vectors.json\` exists): \`${engine} embed --out ${ctx.out}\`.
6. **Verify an answer** (high assurance): \`${engine} verify --answer <answer.md> --repo ${ctx.repo}\` writes \`VERIFY.todo.json\` next to the answer. For EVERY pair, apply \`${join(agents, "refuter.md")}\` yourself (verdict + note), save your rows as \`verdicts.json\`, then \`${engine} verify --apply verdicts.json --answer <answer.md>\` and gate with \`${engine} check --answer <answer.md> --semantic --out ${ctx.out}\`.

With subagents available, prefer the emitted workflows instead: \`orchestrate --out ${ctx.out} --phase <p>\` then \`Workflow({ scriptPath: "${join(ctx.out, "orchestration", "<p>.workflow.mjs")}" })\` — one repo-wide \`check\` after the join either way, and no \`build\` or \`map\` while agents are in flight.
`;
}
