# Semantic search (optional, keyless): hybrid `find`

Lexical `find` already splits identifiers, stems, and knows common code
synonyms — but it can't bridge a real vocabulary gap ("invoicing" vs a module
that only ever says "billing"). The optional semantic layer fixes that: embed
each module once, and `find` fuses the lexical ranking with the semantic one
(Reciprocal Rank Fusion). It is strictly additive: without it, nothing changes.

**There is no API key and no provider to stand up.** The embedding tiers belong
to the vendored codeindex engine; ultraindex only decides *what* gets embedded
(one vector per module, folding in the prose you wrote — the one signal a
file-level index cannot have).

## The three tiers

Precedence is **endpoint > static > none**, the engine's own rule.

| tier | trigger | determinism |
|---|---|---|
| **none** | no model, no endpoint | — (pure lexical, silent, zero network) |
| **static** | a model on disk | byte-deterministic — `vectors.json` is reproducible |
| **endpoint** | `CODEINDEX_EMBED_ENDPOINT` is set | per image digest, not byte-stable |

## 1. Embed the modules

```
node scripts/ultraindex.mjs embed --out <index-dir> [--force] [--json]
```

On first run, if no model is resolvable, `embed` pulls the engine's official
model asset (sha256-verified) into the shared per-machine cache and continues —
one download, then offline forever. Nothing to install, no key to obtain.

It writes `vectors.json` next to the index: one base64 int8 vector per module,
over the same text lexical `find` scores (title, path, member files, enriched
prose). Incremental — unchanged modules keep their vectors, so re-running after
a small change embeds only what moved. A model change re-embeds everything.

Re-run `embed` after enrichment passes or rebuilds; `check` warns when vectors
drift stale (it never fails on them — stale vectors degrade ranking, they don't
break anything).

**Prefer a richer local model?** Point the engine at a containerized embedding
server instead — `codeindex embed serve` prints the `docker compose`/`docker
run` one-liner — then set `CODEINDEX_EMBED_ENDPOINT`. Setting that variable is
explicit intent, so it wins over a local model. This tier is the only one
outside the byte-identical guarantee.

## 2. Use `find` as usual

When `vectors.json` exists, `find` **and** `ask` are hybrid automatically: the
`find` header says `(hybrid)` and results carry a 1-based `semanticRank`. A
module surfaced only semantically has `score 0` and `matched: []` — that's the
vocabulary-gap case working as intended. A similarity floor drops weak matches
before fusion, so a barely-related module never gets rank-boosted into the
top-k; below the floor the query simply behaves lexically for that term.

Degradation is graceful and explicit:

- Endpoint unreachable → lexical-only results plus a stderr warning. Fix:
  restart the server, unset `CODEINDEX_EMBED_ENDPOINT` to fall back to the
  static model, or delete `vectors.json` to silence.
- `vectors.json` present but no tier resolvable → lexical-only plus a warning
  naming the one-line fix (`codeindex embed pull`).
- No `vectors.json` → pure lexical, silent, zero network. This is the off
  switch: delete the file to turn the semantic layer off entirely.

## Reproducibility

`manifest.json` is excluded from ultraindex's byte-identical rebuild guarantee
(it embeds a fresh `builtAt` each build — provenance only; staleness is computed
from file hashes, not that field). `vectors.json` is **inside** the guarantee on
the static tier: the encoder is a pure lookup table with banker's rounding and
integer ranking, so the same repo produces the same bytes on any machine. Only
the endpoint tier, whose floats come from a server, falls outside it.
