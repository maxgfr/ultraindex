import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentContracts, phaseWorkflowScript, runbookMd } from "./orchestrate-templates.js";
import { runStatus } from "./status.js";
import { indexPaths } from "./store.js";

// ---------------------------------------------------------------------------
// `ultraindex orchestrate` — emit the index's multi-agent orchestration from
// its CURRENT state (per-phase workflow scripts + dispatch contracts + a
// sequential RUNBOOK), so a subagent-capable harness fans the enrichment /
// verification work out. Per-phase emission is deliberate: the enrich queue
// only means anything after `build`, and the verify worklist only exists after
// `verify --answer` — a whole-pipeline script could only carry placeholders,
// exactly what the grounding gates exist to prevent.
//
// One family deviation, sanctioned and formalized here: enrichment is a
// DISJOINT-WRITE fan-out. Each enricher writes its OWN encyclopedia/<slug>.md
// entry (entries are independent units of work — see references/generate.md)
// and returns what it wrote; everything else stays one-writer, and the
// repo-wide `check` after the join is the orchestrator's alone.
// ---------------------------------------------------------------------------

export const PHASES = ["enrich", "verify-answer"] as const;
export type PhaseName = (typeof PHASES)[number];

/** Small queues don't amortize a fan-out — orchestrate says so and nudges --eco. */
export const SMALL_WORKLIST = 3;
/** One subagent per batch of at most this many queue items. */
export const BATCH_SIZE = 8;

export interface OrchestrateContext {
  /** Index dir (absolute) — orchestration is emitted into <out>/orchestration/. */
  out: string;
  /** Repo root (absolute) — where cited source is read from. */
  repo: string;
  /** Absolute path of the engine script, for the emitted commands. */
  engine: string;
  /** Answer file (absolute) — anchors verify-answer's worklist, which `verify` writes next to it. */
  answer?: string;
}

export interface PhaseInfo {
  name: PhaseName;
  ready: boolean;
  /** Absolute path of the artifact this phase fans out over. */
  worklist: string;
  items: number;
  /** The injected fan-out ids (module slugs for enrich, 1-based pair positions for verify-answer). */
  ids: string[];
  /** The engine command that produces the phase's input when it is missing. */
  prerequisite: string;
}

export function listPhases(ctx: OrchestrateContext): PhaseInfo[] {
  // enrich — the work-queue is derived EXACTLY the way `status` derives it (the
  // same runStatus call), read straight from disk: unenriched modules, in
  // enrichment order. No snapshot file: the index itself is the worklist.
  const st = runStatus(ctx.out);
  const enrichIds = st ? st.modules.filter((m) => !m.enriched).map((m) => m.slug) : [];

  // verify-answer — file-backed by the VERIFY.todo.json `verify --answer`
  // writes next to the answer file; --answer anchors it (default: repo root).
  const verifyWl = join(ctx.answer ? dirname(ctx.answer) : ctx.repo, "VERIFY.todo.json");
  let verifyIds: string[] = [];
  let verifyReady = false;
  if (existsSync(verifyWl)) {
    try {
      const todo = JSON.parse(readFileSync(verifyWl, "utf8")) as { pairs?: unknown };
      if (todo && Array.isArray(todo.pairs)) {
        verifyReady = true;
        verifyIds = todo.pairs.map((_, i) => String(i + 1));
      }
    } catch {
      /* unreadable worklist = not ready */
    }
  }

  return [
    {
      name: "enrich",
      ready: st !== undefined,
      worklist: indexPaths(ctx.out).graph,
      items: enrichIds.length,
      ids: enrichIds,
      prerequisite: `node ${ctx.engine} build --repo ${ctx.repo} --out ${ctx.out}`,
    },
    {
      name: "verify-answer",
      ready: verifyReady,
      worklist: verifyWl,
      items: verifyIds.length,
      ids: verifyIds,
      prerequisite:
        `node ${ctx.engine} verify --answer ${ctx.answer ?? "<answer.md>"} --repo ${ctx.repo}` +
        (ctx.answer ? "" : ` (then re-run orchestrate with --answer <answer.md>)`),
    },
  ];
}

export interface OrchestrateOptions {
  /** Emit only this phase (exit 2 if its input does not exist yet). */
  phase?: string;
  /** Emit only the RUNBOOK + contracts (the explicit low-token sequential path). */
  eco?: boolean;
}

export interface OrchestrateResult {
  exitCode: number;
  written: string[];
  notices: string[];
  errors: string[];
  phases: PhaseInfo[];
}

export function orchestrateRun(ctx: OrchestrateContext, opts: OrchestrateOptions = {}): OrchestrateResult {
  const phases = listPhases(ctx);

  // No index = nothing to anchor the orchestration to (and nowhere sane to
  // emit it). Fail with the exact command that produces the missing input.
  if (!phases[0]!.ready) {
    return {
      exitCode: 2,
      written: [],
      notices: [],
      errors: [`no index at ${ctx.out} — produce it first: ${phases[0]!.prerequisite}`],
      phases,
    };
  }

  let selected = phases.filter((p) => p.ready);
  if (opts.phase !== undefined) {
    const ph = phases.find((p) => p.name === opts.phase);
    if (!ph) {
      return {
        exitCode: 2,
        written: [],
        notices: [],
        errors: [`unknown phase "${opts.phase}" — expected one of: ${PHASES.join(", ")}.`],
        phases,
      };
    }
    if (!ph.ready) {
      return {
        exitCode: 2,
        written: [],
        notices: [],
        errors: [`phase "${ph.name}" is not ready — its worklist ${ph.worklist} does not exist yet. Produce it first: ${ph.prerequisite}`],
        phases,
      };
    }
    selected = [ph];
  }

  const orchDir = join(ctx.out, "orchestration");
  const agentsDir = join(orchDir, "agents");
  mkdirSync(join(orchDir, "out"), { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  const written: string[] = [];
  const notices: string[] = [];

  // Contracts: every role, every call (idempotent overwrite) — they double as the
  // RUNBOOK's self-pass checklists, so eco mode needs them too.
  for (const [name, content] of Object.entries(agentContracts(ctx))) {
    const p = join(agentsDir, `${name}.md`);
    writeFileSync(p, content);
    written.push(p);
  }

  if (!opts.eco) {
    for (const ph of selected) {
      if (ph.items === 0) {
        notices.push(`phase "${ph.name}": the queue is empty — nothing to orchestrate.`);
        continue;
      }
      if (ph.items <= SMALL_WORKLIST) {
        notices.push(`phase "${ph.name}": only ${ph.items} item(s) — the sequential --eco path is equivalent and cheaper.`);
      }
      const p = join(orchDir, `${ph.name}.workflow.mjs`);
      writeFileSync(p, phaseWorkflowScript(ph, ctx, BATCH_SIZE));
      written.push(p);
    }
  }

  const rb = join(orchDir, "RUNBOOK.md");
  writeFileSync(rb, runbookMd(phases, ctx));
  written.push(rb);

  return { exitCode: 0, written, notices, errors: [], phases };
}
