# Verify (high-assurance): prove each citation actually supports its claim

`check --answer` proves an answer's citations *resolve* — every `[file:line]`
points at a real line. The verify gate goes one level deeper: it proves each cited
excerpt actually **supports** the claim it is attached to. The engine only does the
mechanical work — splitting the answer into claim↔citation pairs and reducing your
verdicts into a pass/fail; **the judgement is yours** (or a skeptic subagent's).

Use it when an answer must be high-assurance — an audit, a security or
correctness-critical claim — or when the user asks you to verify or adjudicate an
answer. Prerequisite: a plain `check --answer` that already passes (verify never
replaces the resolve check; it adds to it).

## 1. Build the worklist

```
node scripts/ultraindex.mjs verify --answer ANSWER.md --out <index-dir>
```

For every claim that cites a resolvable `[file:line]`, this emits one pair per
citation — the claim text plus the cited excerpt (the "digest") — and writes two
files next to the answer:

- `VERIFY.todo.json` — the machine-readable worklist: an object
  `{ answer, pairs }` whose `pairs` are
  `{ claimId, claim, citation, path, digest, verdict, note }`, each `verdict`
  starting `null`.
- `VERIFY.md` — the same worklist as readable markdown.

The worklist is capped at 40 pairs; raise it with `--max-verify <n>` on a long
answer (a truncated worklist still gates only on what it shows — don't read a pass
as "every claim checked").

## 2. Adjudicate each pair

Open each pair's excerpt and judge whether it supports the claim. Set each
`verdict` to **exactly one** of these four tokens (a typo or a malformed row is a
hard error at `verify --apply` — nothing is silently dropped or coerced):

- `supported` — the excerpt clearly backs the claim.
- `partial` — it backs part of the claim, or backs it weakly. **Counts as support.**
- `refuted` — the excerpt contradicts the claim.
- `unsupported` — the excerpt neither supports nor contradicts it (wrong evidence).

Add a short `note` saying why. Save the filled list as `verdicts.json` — a bare
array, or `{ "pairs": [...] }`; both are accepted.

## 3. Apply the verdicts (the gate)

```
node scripts/ultraindex.mjs verify --apply verdicts.json --answer ANSWER.md --out <index-dir>
```

This reduces the verdicts to a pass/fail and writes `VERIFY.json`. A **claim fails**
if any of its citations is `refuted`, or if it is fully adjudicated with no
`supported`/`partial` citation. Pairs you left unadjudicated are reported as a
warning, not a failure — so confirm the report shows every pair adjudicated before
trusting a pass. Non-zero exit means at least one claim is refuted or unsupported.

## 4. Re-check with the gate folded in

```
node scripts/ultraindex.mjs check --answer ANSWER.md --semantic --out <index-dir>
```

`--semantic` re-checks citation resolution **and** folds `VERIFY.json`, failing on
any refuted/unsupported claim — the single command to gate a high-assurance answer
on. It **fails closed**: with no `VERIFY.json` next to the answer it exits non-zero
(steps 1–3 must actually have run), so `--semantic` can never pass on resolution
alone. Plain `check --answer` (no `--semantic`) remains the resolution-only gate.
A misspelled verdict token or a malformed verdict row is a hard error at
`verify --apply` time, not a silent skip. Present the answer only once this passes.

The gate takes nothing in `VERIFY.json` at its word:

- The pass/fail verdict is **re-reduced from the raw `verdicts[]` on every
  check** — the persisted `ok`/`failures` summary is never trusted, so a
  hand-edited or stale summary cannot flip the gate (a `VERIFY.json` without
  `verdicts[]` fails closed).
- Every adjudicated excerpt is **re-read from the live repo and compared with the
  digest that was judged**. If the cited content changed since `verify` (or the
  digest was edited), the adjudication attests nothing and the check fails —
  re-run `verify` and re-adjudicate.
- Coverage is matched by **identity** (claim + citation + digest), not by count:
  verdicts adjudicating a different answer never read as coverage of this one.

## Adjudicate in parallel with skeptic subagents

The worklist's pairs are independent, which makes adversarial verification a clean
fan-out when your host supports subagents (e.g. Claude Code's Task/Workflow):

1. The orchestrator runs `verify --answer` to produce `VERIFY.todo.json`.
2. Split the pairs into N batches and dispatch one skeptic subagent per batch. Each
   skeptic **reads only** its pairs (it may open the cited file for context), tries
   to *refute* each claim from its excerpt, and **returns** its verdicts as data —
   `{ claimId, citation, verdict, note }`. A skeptic writes nothing shared.
3. The orchestrator merges every returned verdict into **one** `verdicts.json`, then
   runs `verify --apply` and `check --answer --semantic` as above.

Keep the reduction in the orchestrator's hands: a single claim's citations can land
in different batches, so whether a claim passes is decided only after the merge — no
skeptic rules on its own claim's fate. Independent skeptics that each try to refute
beat one pass that tries to confirm.

## Gotchas

- Run **both** `verify --apply` and `check --answer --semantic`: `--apply` gives the
  verdict report and exit code; `--semantic` is the unified Q&A gate that also
  re-checks raw citation resolution.
- `partial` counts as support — a claim with one `partial` and the rest
  `unsupported` still passes. Use `refuted` only when the evidence contradicts.
- The four verdict tokens are exact: `supported`, `partial`, `refuted`,
  `unsupported`. Anything else (including `support`) hard-errors at
  `verify --apply`.
- Don't edit the repo between `verify` and `check --semantic`: the gate re-reads
  every cited excerpt and fails on drift. If sources changed, re-run `verify`.
