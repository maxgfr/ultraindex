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
ranking is lexical).

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
| en | 60 | 65.0% | 76.7% |
| fr | 60 | 50.0% | 75.0% |
| es | 60 | 51.7% | 73.3% |
| de | 60 | 28.3% | 75.0% |
| it | 60 | 38.3% | 75.0% |
| pt | 60 | 46.7% | 75.0% |
| nl | 60 | 48.3% | 76.7% |
| ja | 60 | 18.3% | 78.3% |
| zh | 60 | 18.3% | 76.7% |
| ar | 60 | 18.3% | 73.3% |
| ru | 60 | 11.7% | 75.0% |

Gate floor: 63.0% (English without terms − 2 points).
<!-- results:end -->

Without terms, recall falls with the distance from English, and what is left
is not understanding: the Spanish, French or Italian hits come largely from
short function words substring-matching inside longer words of paths and
summaries (`de`, `el`, `la`), the Japanese, Chinese, Arabic and Russian ones
from English words quoted inside the question (`API`, `ID`, `webhook`). With
terms, every language lands within a few points of English with terms (73–78%
against 76.7%): the question's language stops mattering.

What this does not show: the fixtures are tiny (9 and 25 files), so a hit is
easier than in a real repo, and the terms were written by one model in one
pass. The misses with terms are concentrated in three cases, in every
language, English included: `shop-health`, `shop-order-data` and
`shop-products`, whose answers live inside a file the index describes only by
its path — the `/health` handler in `src/server.ts`, the `Order` and `Product`
models in `prisma/schema.prisma`. That is a limit of the lexical haystack, not
of the question's language.

## Weighting, measured

With `--terms`, the question's own words (other than identifier-shaped ones)
rank at half weight and without the raw-substring tier. On this corpus the
weight itself barely matters — 0 (terms only), 0.5 and 1 give the same table —
because untranslated words match nothing. The substring tier does: enabling it
for the question's words lifts it (75.0% → 83.3%) and fr (75.0% → 80.0%)
here, but the extra hits we traced come from short question words contained
in unrelated names (`che` in `schema`, `se` in `server`, `du` in `products`):
luck on a 9-file fixture, noise at scale. It stays off.
