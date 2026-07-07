# Semantic search (optional): hybrid `find` via a local embeddings provider

Lexical `find` already splits identifiers, stems, and knows common code
synonyms — but it can't bridge a real vocabulary gap ("invoicing" vs a module
that only ever says "billing"). The optional semantic layer fixes that: embed
each module once, and `find` fuses the lexical ranking with cosine similarity
(Reciprocal Rank Fusion). It is strictly additive: without it, nothing changes
and the engine never touches the network.

## 1. Start a provider (no API key needed)

The repo ships a `docker-compose.yml` running Ollama with a small embedding
model, multi-arch (Apple Silicon included):

```
docker compose up -d
export ULTRAINDEX_EMBED_BASE_URL=http://localhost:11434/v1
export ULTRAINDEX_EMBED_MODEL=nomic-embed-text
```

Any OpenAI-compatible `POST /v1/embeddings` endpoint works the same way:
huggingface text-embeddings-inference on amd64/GPU hosts
(`http://localhost:8080/v1`, model `BAAI/bge-small-en-v1.5`) or a hosted API
(`https://api.openai.com/v1`, model `text-embedding-3-small`, plus
`ULTRAINDEX_EMBED_API_KEY`). Instead of env vars you can write
`<index-dir>/semantic.json`:

```json
{ "baseUrl": "http://localhost:11434/v1", "model": "nomic-embed-text" }
```

Prefer env for the API key — never commit a key inside `semantic.json`
(remember `docs/ultraindex` indexes are committed).

## 2. Embed the modules

```
node scripts/ultraindex.mjs embed --out <index-dir> [--json]
```

Writes `vectors.json` next to the index: one vector per module, over the same
text lexical `find` scores (title, path, member files, enriched prose).
Incremental — unchanged modules keep their vectors, so re-running after a
small change embeds only what moved. A model change re-embeds everything.

Re-run `embed` after enrichment passes or rebuilds; `check` warns when
vectors drift stale (it never fails on them — stale vectors degrade ranking,
they don't break anything).

## 3. Use `find` as usual

When `vectors.json` exists, `find` **and** `ask` are hybrid automatically: the
`find` header says `(hybrid)` and results carry a 1-based `semanticRank`. A
module surfaced only semantically has `score 0` and `matched: []` — that's the
vocabulary-gap case working as intended. A cosine floor drops weak matches
before fusion, so a barely-related module never gets rank-boosted into the
top-k; below the floor the query simply behaves lexically for that term.

Degradation is graceful and explicit:

- Provider down → lexical-only results plus a stderr warning. Fix: restart the
  provider (`docker compose up -d`) or delete `vectors.json` to silence.
- `vectors.json` present but no config → lexical-only plus a warning telling
  you to set the env/`semantic.json`.
- No `vectors.json` → pure lexical, silent, zero network. This is the off
  switch: delete the file to turn the semantic layer off entirely.

## Reproducibility caveat

Two artifacts are excluded from ultraindex's byte-identical rebuild guarantee:
`manifest.json` (it embeds a fresh `builtAt` timestamp each build — provenance
only; staleness is computed from file hashes, not that field) and `vectors.json`
(its floats depend on the provider and model). Everything else (`INDEX.md`,
`graph.json`, encyclopedia entries) stays deterministic, and `find` without
`vectors.json` stays byte-identical too.
