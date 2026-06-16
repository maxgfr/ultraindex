import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClaimEvidencePair, Verdict, VerdictKind, VerifyResult } from "./types.js";
import { parseCitations, type Citation } from "./cite.js";

// Bounds the verification loop (claim↔citation pairs adjudicated per run).
export const VERIFY_MAX = 40;
const VALID_VERDICTS: VerdictKind[] = ["supported", "partial", "refuted", "unsupported"];

export interface VerifyWorklist {
  answer: string;
  pairs: ClaimEvidencePair[];
}

// ---- claim-unit splitting (a citation in a code fence/comment can't ground) ----
type ClaimUnit =
  | { kind: "text"; text: string; display: string }
  | { kind: "list"; items: string[]; itemsD: string[] };

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}
// Mask inline code to spaces (length-preserving). Used for block-structure
// detection AND fed to parseCitations, so a `[file:line]` inside backticks is
// NOT read as a real citation.
function stripInlineCode(line: string): string {
  return line.replace(/`[^`\n]*`/g, " ");
}
// Same spans, but KEEP the inner text (drop only the backticks) — for the
// human-facing claim digest, which must retain the identifier the citation is
// about. Display-only; never fed to parseCitations.
function stripInlineCodeText(line: string): string {
  return line.replace(/`([^`\n]*)`/g, "$1");
}
function codeMask(lines: string[]): boolean[] {
  const mask = new Array(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) {
      mask[i] = true;
      inFence = !inFence;
      continue;
    }
    mask[i] = inFence;
  }
  return mask;
}
function isHeadingOrRule(t: string): boolean {
  return /^#{1,6}\s/.test(t) || /^([-*_])\1{2,}$/.test(t);
}
function isTableSep(line: string): boolean {
  return /\|/.test(line) && /^[\s:|-]+$/.test(line.trim()) && /-/.test(line);
}
function isTableRow(line: string): boolean {
  return /\|/.test(line.trim()) && !isTableSep(line);
}
function tableCells(line: string): string {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).join(" ");
}
function isListItem(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s+\S/.test(line);
}

function extractClaimUnits(text: string): ClaimUnit[] {
  const lines = stripHtmlComments(text).split("\n");
  const code = codeMask(lines);
  const units: ClaimUnit[] = [];
  let prose: string[] = []; // masked (drives structure + parsing)
  let proseD: string[] = []; // display (identifiers kept)
  const flush = () => {
    if (prose.length) units.push({ kind: "text", text: prose.join(" "), display: proseD.join(" ") });
    prose = [];
    proseD = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (code[i]) {
      flush();
      i++;
      continue;
    }
    const line = stripInlineCode(lines[i]!);
    const lineD = stripInlineCodeText(lines[i]!);
    const t = line.trim();
    if (t === "" || isHeadingOrRule(t) || isTableSep(line)) {
      flush();
      i++;
      continue;
    }
    if (isTableRow(line)) {
      flush();
      units.push({ kind: "text", text: tableCells(line), display: tableCells(lineD) });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const dq = line.replace(/^\s*>\s?/, "").trim();
      const dqD = lineD.replace(/^\s*>\s?/, "").trim();
      if (dq) {
        prose.push(dq);
        proseD.push(dqD || dq);
      }
      i++;
      continue;
    }
    if (isListItem(line)) {
      flush();
      const items: string[] = [];
      const itemsD: string[] = [];
      while (i < lines.length && !code[i]) {
        const l = stripInlineCode(lines[i]!);
        const lD = stripInlineCodeText(lines[i]!);
        const tt = l.trim();
        const ttD = lD.trim();
        if (tt === "" || isHeadingOrRule(tt) || isTableSep(l) || isTableRow(l)) break;
        if (isListItem(l)) {
          items.push(l.replace(/^\s*([-*+]|\d+\.)\s+/, "").trim());
          itemsD.push(lD.replace(/^\s*([-*+]|\d+\.)\s+/, "").trim());
        } else if (items.length) {
          items[items.length - 1] += " " + tt;
          itemsD[itemsD.length - 1] += " " + ttD;
        } else {
          items.push(tt);
          itemsD.push(ttD);
        }
        i++;
      }
      units.push({ kind: "list", items, itemsD });
      continue;
    }
    prose.push(line);
    proseD.push(lineD);
    i++;
  }
  flush();
  return units;
}

// Each claim as a (parse, display) pair. `parse` masks inline code to spaces so
// citation extraction ignores a `[file:line]` written inside backticks; `display`
// keeps the inline-code text so the worklist shows the identifier the claim is about.
function claimPairs(text: string): { parse: string; display: string }[] {
  const out: { parse: string; display: string }[] = [];
  for (const u of extractClaimUnits(text)) {
    if (u.kind === "text") out.push({ parse: u.text, display: u.display });
    else for (let j = 0; j < u.items.length; j++) out.push({ parse: u.items[j]!, display: u.itemsD[j] ?? u.items[j]! });
  }
  return out;
}

// Read the cited excerpt from the repo: the lines [start..end] of the cited
// file (or the file head when no range), capped. The digest a skeptic reads.
function readExcerpt(repo: string, c: Citation): string {
  let full: string;
  try {
    full = readFileSync(join(repo, c.path), "utf8");
  } catch {
    return "";
  }
  const lines = full.split("\n");
  if (c.start === undefined) return lines.slice(0, 40).join("\n").slice(0, 800).trim();
  const s = Math.max(1, c.start) - 1;
  const e = Math.max(c.start, c.end ?? c.start);
  return lines.slice(s, e).join("\n").slice(0, 800).trim();
}

// Phase A — build the claim↔citation verification worklist. For every claim in
// the answer that cites a resolvable `[file:line]`, emit one pair per citation
// with the cited excerpt as the digest. Capped at maxVerify. Writes
// VERIFY.todo.json + VERIFY.md next to the answer file. Deterministic; the
// JUDGEMENT is the agent's.
// The (uncapped) claim↔citation pairs verify would adjudicate for an answer: one
// per claim-unit citation that resolves AND has a readable excerpt. This is the
// gate's true "universe" — narrower than the raw mechanical citation set, because
// a citation in a heading (dropped as a claim unit) or to an empty file (no
// excerpt) yields no pair. `check --semantic` sizes coverage off THIS, not the
// mechanical count, so it never demands verification it can't produce.
export function buildClaimPairs(answerText: string, repo: string): ClaimEvidencePair[] {
  const pairs: ClaimEvidencePair[] = [];
  let claimNo = 0;
  for (const { parse, display } of claimPairs(answerText)) {
    const cites = parseCitations(parse);
    if (!cites.length) continue;
    claimNo++;
    const claimId = `C${claimNo}`;
    const claimText = display.replace(/\s+/g, " ").trim().slice(0, 400);
    for (const c of cites) {
      const digest = readExcerpt(repo, c);
      if (!digest) continue; // unresolved/dangling — the mechanical check handles it
      pairs.push({ claimId, claim: claimText, citation: c.raw, path: c.path, digest });
    }
  }
  return pairs;
}

export function runVerify(answerPath: string, repo: string, opts: { maxVerify?: number } = {}): VerifyWorklist {
  const answer = readFileSync(answerPath, "utf8");
  const pairs = buildClaimPairs(answer, repo);
  const max = Math.max(1, Math.floor(opts.maxVerify ?? VERIFY_MAX));
  const kept = pairs.length > max ? pairs.slice(0, max) : pairs;
  const worklist: VerifyWorklist = { answer: answerPath, pairs: kept };

  const dir = dirname(answerPath);
  const todo = { answer: answerPath, pairs: kept.map((p) => ({ ...p, verdict: null as VerdictKind | null, note: "" })) };
  writeFileSync(join(dir, "VERIFY.todo.json"), JSON.stringify(todo, null, 2));
  writeFileSync(join(dir, "VERIFY.md"), renderWorklistMd(worklist, pairs.length, kept.length));
  return worklist;
}

function renderWorklistMd(wl: VerifyWorklist, total: number, kept: number): string {
  const out: string[] = [];
  out.push(`# Verification worklist`);
  out.push("");
  out.push(
    `For each pair, open the cited excerpt and judge whether it **supports** the claim. ` +
      `In \`VERIFY.todo.json\`, set each \`verdict\` to one of supported · partial · refuted · unsupported, ` +
      `add a short \`note\`, save it (e.g. as \`verdicts.json\`), then run ` +
      `\`ultraindex verify --apply verdicts.json --answer <file>\`.`,
  );
  if (kept < total) out.push(`\n_Showing ${kept} of ${total} pair(s) — capped._`);
  out.push("");
  for (const p of wl.pairs) {
    out.push(`## ${p.claimId} · ${p.citation}`);
    out.push(`**Claim:** ${p.claim}`);
    out.push("```");
    out.push(p.digest);
    out.push("```");
    out.push(`**Verdict:** _____ · **Note:** _____`);
    out.push("");
  }
  return out.join("\n");
}

// Phase B — read an agent-filled verdicts file (a `{ pairs: Verdict[] }` object
// or a bare `Verdict[]`), validate it, reduce to a VerifyResult, and persist
// VERIFY.json in `dir` (the answer's directory) for `check --semantic` / render.
export function applyVerdicts(dir: string, verdictsPath: string): VerifyResult {
  const raw = JSON.parse(readFileSync(verdictsPath, "utf8"));
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.pairs) ? raw.pairs : [];
  const verdicts: Verdict[] = [];
  for (const v of list) {
    if (!v || typeof v.claimId !== "string" || typeof v.citation !== "string") continue;
    const verdict = VALID_VERDICTS.includes(v.verdict) ? (v.verdict as VerdictKind) : (undefined as unknown as VerdictKind);
    verdicts.push({
      claimId: v.claimId,
      claim: typeof v.claim === "string" ? v.claim : "",
      citation: v.citation,
      path: typeof v.path === "string" ? v.path : "",
      digest: typeof v.digest === "string" ? v.digest : "",
      verdict,
      note: typeof v.note === "string" ? v.note : "",
    });
  }
  const result = reduceVerdicts(verdicts);
  writeFileSync(join(dir, "VERIFY.json"), JSON.stringify({ ...result, verdicts }, null, 2));
  return result;
}

// Fold per-pair verdicts into pass/fail. A claim FAILS if a cited excerpt
// REFUTES it, or if every fully-adjudicated citation is `unsupported`. Pairs
// still missing a verdict are reported as unadjudicated (warn, not fail).
export function reduceVerdicts(verdicts: Verdict[]): VerifyResult {
  const counts: Record<VerdictKind, number> = { supported: 0, partial: 0, refuted: 0, unsupported: 0 };
  for (const v of verdicts) if (v.verdict && counts[v.verdict] !== undefined) counts[v.verdict]++;

  const byClaim = new Map<string, Verdict[]>();
  for (const v of verdicts) {
    const g = byClaim.get(v.claimId) ?? [];
    g.push(v);
    byClaim.set(v.claimId, g);
  }
  const failures: VerifyResult["failures"] = [];
  const unadjudicated: string[] = [];
  for (const [claimId, group] of byClaim) {
    const adjudicated = group.filter((g) => !!g.verdict);
    if (adjudicated.length < group.length) unadjudicated.push(claimId);
    const refuted = adjudicated.find((g) => g.verdict === "refuted");
    const hasSupport = adjudicated.some((g) => g.verdict === "supported" || g.verdict === "partial");
    if (refuted) {
      failures.push({ claimId, citation: refuted.citation, verdict: "refuted", note: refuted.note });
    } else if (adjudicated.length === group.length && adjudicated.length > 0 && !hasSupport) {
      const u = adjudicated.find((g) => g.verdict === "unsupported") ?? adjudicated[0]!;
      failures.push({ claimId, citation: u.citation, verdict: u.verdict, note: u.note });
    }
  }
  return {
    ok: failures.length === 0,
    pairs: verdicts.length,
    adjudicated: verdicts.filter((v) => !!v.verdict).length,
    supported: counts.supported,
    partial: counts.partial,
    refuted: counts.refuted,
    unsupported: counts.unsupported,
    failures,
    unadjudicated,
  };
}

// Read a persisted VERIFY.json (the gate result) from a directory, if present.
export function loadVerify(dir: string): VerifyResult | undefined {
  const p = join(dir, "VERIFY.json");
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as VerifyResult;
  } catch {
    return undefined;
  }
}

export function formatVerifyReport(r: VerifyResult): string {
  const lines: string[] = [];
  lines.push(`ultraindex verify: ${r.adjudicated}/${r.pairs} pair(s) adjudicated`);
  lines.push(`  supported: ${r.supported} · partial: ${r.partial} · refuted: ${r.refuted} · unsupported: ${r.unsupported}`);
  for (const f of r.failures.slice(0, 12)) lines.push(`  ✗ ${f.claimId} (${f.citation}): ${f.verdict}${f.note ? " — " + f.note : ""}`);
  if (r.unadjudicated.length) lines.push(`  ⚠ ${r.unadjudicated.length} claim(s) not fully adjudicated: ${r.unadjudicated.join(", ")}`);
  lines.push(r.ok ? `  ✓ every claim is backed by its cited excerpt` : `  ✗ some claims are refuted or unsupported`);
  return lines.join("\n");
}
