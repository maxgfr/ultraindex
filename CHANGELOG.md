# Changelog

All notable changes to this project are documented here, generated automatically from the [Conventional Commits](https://www.conventionalcommits.org/) by [semantic-release](https://github.com/semantic-release/semantic-release).

# [5.4.0](https://github.com/maxgfr/ultraindex/compare/v5.3.0...v5.4.0) (2026-07-24)


### Features

* **engine:** re-pin codeindex v2.13.0 ([814dfb1](https://github.com/maxgfr/ultraindex/commit/814dfb11ee9d146612a01d9fba1f8f4058c01650))

# [5.3.0](https://github.com/maxgfr/ultraindex/compare/v5.2.1...v5.3.0) (2026-07-24)


### Features

* **engine:** re-pin codeindex v2.13.0 ([0a74925](https://github.com/maxgfr/ultraindex/commit/0a74925d595ca64adf5f04884c34e4b63ca569c2))

## [5.2.1](https://github.com/maxgfr/ultraindex/compare/v5.2.0...v5.2.1) (2026-07-23)


### Bug Fixes

* **engine:** ship the codeindex v2.12.0 re-pin in a release ([fcb8dc0](https://github.com/maxgfr/ultraindex/commit/fcb8dc08bd7cc6d8c6840931c56ba038cc42c629)), closes [#9](https://github.com/maxgfr/ultraindex/issues/9)

# [5.2.0](https://github.com/maxgfr/ultraindex/compare/v5.1.0...v5.2.0) (2026-07-23)


### Features

* **engine:** re-pin the codeindex engine at v2.10.0 ([23acc3d](https://github.com/maxgfr/ultraindex/commit/23acc3db21aa0c234eb7b28196d4827180648da2))

# [5.1.0](https://github.com/maxgfr/ultraindex/compare/v5.0.0...v5.1.0) (2026-07-21)


### Features

* **ast:** extract CommonJS assignment-style JS/TS definitions ([7a8df94](https://github.com/maxgfr/ultraindex/commit/7a8df944d6a232b38f77a8234dffc94ce27056be))
* **community:** put Louvain clusters to work in find and surface surprises ([8d3b5c3](https://github.com/maxgfr/ultraindex/commit/8d3b5c36959e17d94ad4646d6cbc5accb5d0e26b))
* **delta:** diff-driven, risk-scored review command ([59346f0](https://github.com/maxgfr/ultraindex/commit/59346f099a54fd7c41b517a590f6e36e8d2163f8))
* **graph:** add PageRank + betweenness centrality to graph.json (schema v4) ([7552046](https://github.com/maxgfr/ultraindex/commit/7552046cf4038259597ab8481eb93b2bf0e2be9a))
* **render:** rank Hubs by pagerank and surface Bridges in INDEX.md ([4d3f59d](https://github.com/maxgfr/ultraindex/commit/4d3f59de328fb6cebb51d889d92d360d9dc6aa1a)), closes [hi#betweenness](https://github.com/hi/issues/betweenness)
* **tests-map:** derive tests→code coverage from the graph ([e7a9e84](https://github.com/maxgfr/ultraindex/commit/e7a9e84b80d406cb2bee7ec0556fd910a31eaab9))

# [5.0.0](https://github.com/maxgfr/ultraindex/compare/v4.1.1...v5.0.0) (2026-07-10)


* feat(graph)!: resolve cross-file call edges with import-evidence confidence ([f1b23db](https://github.com/maxgfr/ultraindex/commit/f1b23db1ad8f016b0175efe0d87ecfe369f0de99))


### Bug Fixes

* address whole-branch review (schema comment, call-edge tests, via/budget polish) ([ed0de38](https://github.com/maxgfr/ultraindex/commit/ed0de38d7c38a182cd03bd27ed8ff3d9d2e38450))
* **check:** fail closed on unadjudicated claims in the --semantic coverage gate ([0e3a2b7](https://github.com/maxgfr/ultraindex/commit/0e3a2b700ed820e0d5d4576ebe3bdbd6f9d4c1ac)), closes [hi#assurance](https://github.com/hi/issues/assurance)
* **extract:** stop deriving the summary "!" from a `/*!` preserve banner ([93a68ce](https://github.com/maxgfr/ultraindex/commit/93a68ce07675e2bb8b6079d1bbacb21f03c9b489))
* **render:** don't claim "No exported symbols detected" when the module has symbols ([3066b57](https://github.com/maxgfr/ultraindex/commit/3066b574d266f6cc04d31149bd533e1ec1be7ea2))
* **verify:** backfill the worklist pair for digest-less skeptic verdicts ([8870420](https://github.com/maxgfr/ultraindex/commit/887042064ae2d781a92a6fd62639a652566ceb82))


### Features

* budget-capped evidence, neighbors --kind + hub-gating, stat fastpath ([b1b6609](https://github.com/maxgfr/ultraindex/commit/b1b66096820332a207d87bb72b6e7ea8647238ed))
* **find:** fold diacritics, square coverage, add full-query tier + tiered symbol ranking ([f12ea6f](https://github.com/maxgfr/ultraindex/commit/f12ea6f11645b4a92ed4b9004d59e12ab56f57ac))
* **find:** index exported symbol names and expand seed hits over the module graph ([8045d01](https://github.com/maxgfr/ultraindex/commit/8045d01411ead39c7cf167244b2fadb020d07017))
* **graph:** cluster modules into communities for navigation ([bd660bb](https://github.com/maxgfr/ultraindex/commit/bd660bb13ee815791f8f35ceeea8262cff7790fa))
* **impact,neighbors:** traverse call edges and surface their confidence ([de738e1](https://github.com/maxgfr/ultraindex/commit/de738e145def899c03b09e923811c0bbf3a3115b))


### BREAKING CHANGES

* the on-disk artifact grows a `call` edge kind and an optional
`Edge.confidence`, and the extraction record grows `FileRecord.calls` /
`importedNames` — SCHEMA_VERSION and EXTRACTOR_VERSION both bump 2 → 3, so an
index or cache written by an older engine is rejected and rebuilt.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

## [4.1.1](https://github.com/maxgfr/ultraindex/compare/v4.1.0...v4.1.1) (2026-07-09)


### Bug Fixes

* **orchestrate:** reject foreign answer worklists; derive CLI join line per phase ([#3](https://github.com/maxgfr/ultraindex/issues/3)) ([24a3a5f](https://github.com/maxgfr/ultraindex/commit/24a3a5f49f7605618bb19b43dbc0affb57d23c70))

# [4.1.0](https://github.com/maxgfr/ultraindex/compare/v4.0.0...v4.1.0) (2026-07-09)


### Features

* **orchestrate:** emit the enrich fan-out workflow + contracts + runbook ([#2](https://github.com/maxgfr/ultraindex/issues/2)) ([2e3a2db](https://github.com/maxgfr/ultraindex/commit/2e3a2db5b22a34d6866ca264d5b17f23bcc8500d))

# [4.0.0](https://github.com/maxgfr/ultraindex/compare/v3.0.0...v4.0.0) (2026-07-08)


* feat(verify)!: re-reduce verdicts and re-validate cited excerpts at check time ([b609f6e](https://github.com/maxgfr/ultraindex/commit/b609f6e406091782309b698a310b269d6c13fdfc))


### BREAKING CHANGES

* check --answer --semantic now exits non-zero when the cited
source changed after adjudication or when VERIFY.json lacks verdicts[];
re-run `verify` and re-adjudicate after any source change.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

# [3.0.0](https://github.com/maxgfr/ultraindex/compare/v2.2.0...v3.0.0) (2026-07-07)


* feat(engine)!: extract symbols via tree-sitter (AST-first, regex fallback) ([9310047](https://github.com/maxgfr/ultraindex/commit/9310047406d56b345f95ac7bc4b948975a704a01))
* feat(verify)!: harden the grounding gates against silent bypasses ([e5ad37c](https://github.com/maxgfr/ultraindex/commit/e5ad37cee678496dd8493bf8aca000ebb43e8bf0)), closes [hi#assurance](https://github.com/hi/issues/assurance)


### Features

* **ast:** tree-sitter extraction engine (loader + programmatic extractor) ([d5b7ec9](https://github.com/maxgfr/ultraindex/commit/d5b7ec91082f99623b812d7eb3a25bf5443b3e7d))
* **build:** incremental extraction cache (cache.json) ([6141311](https://github.com/maxgfr/ultraindex/commit/6141311a996606acbf87ef081f0ab16d38af8213))
* **cli:** `symbols` and `impact` navigation commands ([8633ce4](https://github.com/maxgfr/ultraindex/commit/8633ce4f79cd96699d34539e138a1d9e0c15cc9e))
* **engine:** schema v2 socle — surfaced caps, O(module) entry rendering ([09bf3c3](https://github.com/maxgfr/ultraindex/commit/09bf3c3fdeb6721473db84dc2e5a12e60ddba642))
* **find:** IDF term weighting, cosine floor, hybrid ask ([86aecca](https://github.com/maxgfr/ultraindex/commit/86aecca7155179199843cfd6da61384aa51482b7))
* **graph:** code→code `use` edges + symbols.json refs ([fd6ee56](https://github.com/maxgfr/ultraindex/commit/fd6ee5653bcf07a5fe251b674836c4246badf736))
* **index:** emit symbols.json — persisted symbol definition table ([0f59cca](https://github.com/maxgfr/ultraindex/commit/0f59cca7fe4f4d7d379de4d88b417be917df31d7))
* **resolve:** import edges for C/C++, Ruby, PHP, C# ([9a1251e](https://github.com/maxgfr/ultraindex/commit/9a1251eb3fd17860f414546dada7173352c54609)), closes [#include](https://github.com/maxgfr/ultraindex/issues/include)


### BREAKING CHANGES

* check --answer --semantic without a VERIFY.json now exits
non-zero instead of skipping the semantic gate.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
* the index is schema v2 and symbol extraction changed; existing
indexes must be rebuilt.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

# [2.2.0](https://github.com/maxgfr/ultraindex/compare/v2.1.0...v2.2.0) (2026-06-16)


### Bug Fixes

* harden grounding and verify gates against bypass and false coverage ([d901a1f](https://github.com/maxgfr/ultraindex/commit/d901a1f9edee8f12e829b521bb1277cbe10ddc29))


### Features

* **skill:** document the semantic verify gate and subagent orchestration ([082b4ff](https://github.com/maxgfr/ultraindex/commit/082b4ffd9fd3c0b47f3b476895a6382ccf9d617d)), closes [hi#assurance](https://github.com/hi/issues/assurance) [hi#assurance](https://github.com/hi/issues/assurance) [#4](https://github.com/maxgfr/ultraindex/issues/4)

# [2.1.0](https://github.com/maxgfr/ultraindex/compare/v2.0.0...v2.1.0) (2026-06-15)


### Features

* semantic verify gate — verify + check --semantic ([#1](https://github.com/maxgfr/ultraindex/issues/1)) ([53eba85](https://github.com/maxgfr/ultraindex/commit/53eba8534f7057a3521e7b0006948c0b5ed2b7dd))

# [2.0.0](https://github.com/maxgfr/ultraindex/compare/v1.3.0...v2.0.0) (2026-06-11)


* feat!: merge navigator into a single auto-routing ultraindex skill ([3ca32e8](https://github.com/maxgfr/ultraindex/commit/3ca32e803f316771d54fe1ae4d05df83ced4671e))


### Features

* **find:** identifier splitting, light stemming, synonyms in lexical ranking ([a21dc42](https://github.com/maxgfr/ultraindex/commit/a21dc42cfb66ab628290dfa6630204ed69a3bb2e))
* **semantic:** docker-compose for a local, key-free embeddings provider ([1365705](https://github.com/maxgfr/ultraindex/commit/1365705e400e2e397762a2e23185948ddf4a8ca7))
* **semantic:** optional embeddings provider, embed command, hybrid find via RRF ([4aefbea](https://github.com/maxgfr/ultraindex/commit/4aefbeaab8219cae68b0f4a7e1975778aea9d696))


### BREAKING CHANGES

* the ultraindex-nav skill is removed — its navigator
workflow now lives inside the ultraindex skill. Reinstall with
`npx skills add maxgfr/ultraindex`.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

# [1.3.0](https://github.com/maxgfr/ultraindex/compare/v1.2.0...v1.3.0) (2026-06-10)


### Bug Fixes

* **resolve:** support exports maps, root tsconfig.base.json, multi-module go with replace ([ba63b2c](https://github.com/maxgfr/ultraindex/commit/ba63b2c1f54f458e36f5d54d577b7903f581235b))


### Features

* **cli:** agent-facing surface — status command, find over enriched prose, map --json, reasonHints ([caefb8e](https://github.com/maxgfr/ultraindex/commit/caefb8e9a55c1161855f29cb18d730918683c052))
* **e2e:** empirical validation harness against real public monorepos ([fda1fe2](https://github.com/maxgfr/ultraindex/commit/fda1fe2c678bc9818b8eae0fae37781f0035ebd8))
* **resolve:** import edges for Rust (mod/use, cross-crate) and Java (package mapping) ([ce65a79](https://github.com/maxgfr/ultraindex/commit/ce65a79e4e4307124184ff703490ad78fe867c82))

# [1.2.0](https://github.com/maxgfr/ultraindex/compare/v1.1.0...v1.2.0) (2026-06-09)


### Bug Fixes

* harden monorepo resolution, import extraction, grounding & encoding ([d133a16](https://github.com/maxgfr/ultraindex/commit/d133a16ac300c6e891c98bc507ed743f11a8b64e))
* harden the index against real monorepos (tsconfig parsing, aliases, BOM) ([ef79cee](https://github.com/maxgfr/ultraindex/commit/ef79cee830fb7545872ad57891850b32a1a81ad6))


### Features

* **cli:** report resolution diagnostics in `build --json` ([ee2d6be](https://github.com/maxgfr/ultraindex/commit/ee2d6be04e2ff352ab2cd475b455c1df24858b29))

# [1.1.0](https://github.com/maxgfr/ultraindex/compare/v1.0.0...v1.1.0) (2026-06-09)


### Bug Fixes

* harden the grounding gate (adversarial audit findings) ([1f75752](https://github.com/maxgfr/ultraindex/commit/1f7575226c24f94e409d50858f30d698e2808d08))


### Features

* grounded, citation-checked AI analysis (ultradoc-style) ([ff815d3](https://github.com/maxgfr/ultraindex/commit/ff815d3102805567979d4596e4d3135fe598403b))

# 1.0.0 (2026-06-09)


### Bug Fixes

* monorepo + extraction/ranking fixes from adversarial audit ([bdbfca2](https://github.com/maxgfr/ultraindex/commit/bdbfca250fb467321132e8d0d17c066e698fef02))
* pass --repo to check in demo + CI; align docs ([eb8c290](https://github.com/maxgfr/ultraindex/commit/eb8c290a67fb5ce216020ddaba4c224defa68eaa))
* sharpen extraction, resolution and ranking on large real repos ([320d404](https://github.com/maxgfr/ultraindex/commit/320d404276b43b5065819dcd25f1c7a220f587eb))


### Features

* initial ultraindex — repo encyclopedia generator + light navigator ([a31518a](https://github.com/maxgfr/ultraindex/commit/a31518a921bcdd29d32af15a7aa1cc7e021f54d0))
