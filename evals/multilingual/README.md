# Multilingual find recall

Does `find` locate the right file when the question is not in English? This
eval asks the same questions in 11 languages against two small synthetic
repos and measures recall without and with `--terms`.

```bash
pnpm run eval:multilingual            # table + gate, exits 1 on failure
node evals/multilingual/run.mjs --json
node evals/multilingual/run.mjs --write-readme   # refresh the table below
```

## Corpus

- **12 question sets** (`cases/*.json`), 5 questions each, in **11 languages**:
  en, fr, es, de, it, pt, nl, ja, zh, ar, ru — 660 questions.
- **English and French** questions, the fixture and the expected targets come
  from the source eval cases, verbatim.
- **Every other question** (paraphrases of those, in es, de, it, pt, nl, ja, zh,
  ar, ru) and **every `terms` string** (one per question and language, English
  and French included: the English keywords an agent would pass) were generated
  by an open-weights model, **glm-5.3-flash** (MIT licence), and copied verbatim.
  Each case records `generator: "glm-5.3-flash"` and its provenance. No question
  or terms text was written by hand or by a proprietary model.
- **Fixtures** (`fixtures/`): `shop-express-prisma` (Express + Prisma, 9 files)
  and `next-drizzle` (Next.js app and pages routers + Drizzle, 25 files), both
  synthetic.

`import.mjs` produced `cases/` from the two inputs (see its header). The
expected file of a case is its `expect.cites` when present; otherwise each of
its `expect.nodes` is resolved, deterministically, to the fixture file that
declares it, and the result is recorded with `from: "nodes"`:

- `screen:/cart` → the app-router `page.tsx` serving `/cart` (route groups
  `(x)` and parallel slots `@x` add no segment, `_x` folders are private);
- `route:<METHOD> <path>` → the app-router `route.ts` serving `<path>` that
  exports `<METHOD>` (`[id]` is `:id`, `[...x]` is `*x`), or the `pages/api`
  handler serving it;
- `sym:<file>#<name>` → `<file>`; `entity:<Name>` → the `.prisma` file
  declaring `model <Name>`.

Exactly one file must declare each node, or the import fails.

## Measure

Each fixture is indexed by the shipped CLI (`scripts/ultraindex.mjs build`),
then every question is ranked by `runFindHybrid` from the library bundle built
from the same source — the exact call `find` makes (no `vectors.json`, so the
ranking is lexical: the index's metadata plus the engine's body search).

A question is a **hit** when one of its case's expected files is among the
**first 8 files** `find` returns: the `open:` files of the matched rows, in
output order, deduped. 8 is find's default output — 8 modules (`--k`), each
listing at most 8 files — so it is the first row's full list and never more
than an agent opening "the top hit" would read. Graph-context rows
(`via: graph`, score 0) matched no keyword and are not counted.

**Gate:** with `--terms`, every language's recall must be at least English
recall *without* terms minus 2 points. `run.mjs` exits 1 otherwise.

## Results

<!-- results:start -->
| language | questions | recall without --terms | recall with --terms |
| --- | ---: | ---: | ---: |
| en | 60 | 90.0% | 98.3% |
| fr | 60 | 66.7% | 96.7% |
| es | 60 | 73.3% | 96.7% |
| de | 60 | 43.3% | 96.7% |
| it | 60 | 51.7% | 95.0% |
| pt | 60 | 60.0% | 96.7% |
| nl | 60 | 70.0% | 98.3% |
| ja | 60 | 23.3% | 96.7% |
| zh | 60 | 23.3% | 98.3% |
| ar | 60 | 20.0% | 96.7% |
| ru | 60 | 16.7% | 96.7% |

Gate floor: 88.0% (English without terms − 2 points).
<!-- results:end -->

Without terms, recall falls with the distance from English, and what is left
is not understanding: the Spanish, French or Italian hits come largely from
short function words substring-matching inside longer words of paths and
summaries (`de`, `el`, `la`), the Japanese, Chinese, Arabic and Russian ones
from English words quoted inside the question (`API`, `ID`, `webhook`). With
terms, every language lands within a few points of English with terms
(95.0–98.3% against 98.3%): the question's language stops mattering.

Two engine changes lifted the table. Body search: `find` also ranks on the
engine's BM25F search over file contents, so the `/health` handler registered
inline in `src/server.ts`, which no path, name or summary mentions, is found;
`shop-health` went from 55 misses with terms to 3 (Italian and Japanese terms
that do not say "health"). Prisma symbols: codeindex 2.32.0 extracts `model`,
`enum`, `view` and `type` blocks from `.prisma` files as symbols, so the
`Order` and `Product` models in `prisma/schema.prisma` are visible and
`shop-order-data` and `shop-products` no longer miss. With the same questions
and terms, English read 65.0% / 76.7% on metadata only, 73.3% / 85.0% with body
search and 90.0% / 98.3% with Prisma symbols; the other languages
11.7–51.7% / 73.3–78.3%, then 16.7–58.3% / 80.0–85.0%, then
16.7–73.3% / 95.0–98.3%.

What this does not show: the fixtures are tiny (9 and 25 files), so a hit is
easier than in a real repo, and the terms were written by one model in one
pass. The 20 misses left with terms are mostly two questions whose terms miss
the words of the answer. "Can I rename an item in the catalogue?" misses in 7
languages, English included, wherever the terms say "item" rather than
"product": `renameProduct` is defined in `src/db/queries.ts`, so that file
ranks and the `PATCH` route that calls it does not. "What happens when someone
types the wrong password?" misses in 7 languages (and one Chinese lockout
question) wherever the terms do not say "login": the NextAuth route mentions
no password or credentials. The other 5 are single terms strings that drop the
key word (`shop-health` in it and ja, `next-webhook` in ja, `shop-place-order`
in fr). That is a limit of the terms and of what the code says, not of the
question's language.

## Weighting, measured

With `--terms`, the question's own words (other than identifier-shaped ones)
rank at half weight and without the raw-substring tier. On this corpus the
weight itself barely matters — 0 (terms only), 0.5 and 1 give the same table —
because untranslated words match nothing. The substring tier does: enabling it
for the question's words lifts fr (96.7% → 100.0%), es (96.7% → 98.3%), it
(95.0% → 96.7%) and nl (98.3% → 100.0%) here, but the extra hits we traced
come from short question words contained in unrelated names (`du` in
`products`, `el` in `deleteProduct`, `se` in `server`, `er` in `handler`):
luck on a 9-file fixture, noise at scale. It stays off.
