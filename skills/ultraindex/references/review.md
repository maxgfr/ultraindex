# Review: turn a branch/PR diff into a prioritized, grounded review

`delta` is mechanical triage, not judgment. The engine maps the git diff onto
the index — changed files → enclosing symbols → blast radius → a risk-scored
worklist with explained reasons — and **you** do the per-item judgment: read
the risky changes, decide whether they are correct, and write grounded findings.

## Workflow

1. **Build fresh — a hard precondition.** `delta` maps diff line numbers onto
   the indexed symbols, so it FAILS CLOSED (exit 1) when any changed file
   drifted since the last build:

   ```
   node scripts/ultraindex.mjs build --repo <dir> [--out <dir>]
   ```

   Build is incremental; re-running it after each fix round is cheap.

2. **Get the worklist.**

   ```
   node scripts/ultraindex.mjs delta --json [--base <ref>] [--staged] [--depth <n>]
   ```

   - Reviewing a PR/branch: name the base explicitly (`--base origin/main`).
     The comparison point is the MERGE-BASE with HEAD, so commits already on
     the base branch never count as yours. Default base: `origin/HEAD` →
     `origin/main` → `origin/master` → `main` → `master`.
   - Pre-commit: `--staged` reviews the staged changeset against HEAD.
   - Save the JSON — it is your worklist. An empty diff exits 0 with empty
     arrays; treat that as "clean", not as an error.

3. **Walk the modules bucket by bucket.** Rows are sorted risk-first and each
   reason names its evidence. Per **HIGH** module:
   - `dossier <slug>` for the grounding packet; open the `open:` files at the
     changed symbols (`changes[].symbols` has exact `line`/`endLine`).
   - Widen the radius when the reasons warrant it: `impact <changed-file>
     --json` (delta's default is depth 2).
   - `neighbors <changed-file> --kind import` to see who consumes it.
   - Check `tests: gap` items first — a risky change with no covering test is
     where regressions hide.

   **MEDIUM**: read the entry + the changed hunks only. **LOW**: skim the
   panel line; open nothing unless a reason surprises you.

4. **Write findings grounded.** Each claim in your review cites `[file:line]`,
   then gate it mechanically:

   ```
   node scripts/ultraindex.mjs check --answer REVIEW.md
   ```

5. **High-assurance reviews** (security, correctness-critical): escalate to the
   semantic verify gate — see [verify.md](verify.md) — so every cited excerpt
   is proven to *support* its claim.

## Reading the reasons

| Reason | It means | Follow up with |
|---|---|---|
| `exported symbol X changed` | Public API touched — consumers may break | `symbols "X"` for every reference site |
| `pagerank pNN hub` | The module is structurally load-bearing | `dossier <slug>`, review with extra care |
| `N dependent files across M modules` | The blast radius itself | `impact <file> --json`, raise `--depth` |
| `no test covers this module` | Nothing catches a regression here | ask for a test, or verify behavior by hand |
| `cross-community edge to Y (surprising)` | The change sits on a near-unique link between subsystems | `neighbors <slug>`; check the coupling is intentional |
| `dangling import "..." in <file>` | The diff likely broke a path — a finding in itself | open the file and confirm; report it |

## What delta does NOT do

- It does not judge semantics or correctness — a LOW score is "structurally
  quiet", never "safe".
- No git-history signals: churn/age/authorship are out of scope
  (`linesAdded`/`linesDeleted` are display-only and never scored).
- It writes nothing: the panel and `--json` go to stdout; persist the JSON
  yourself if the review spans sessions.
