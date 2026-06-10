# Changelog

All notable changes to this project are documented here, generated automatically from the [Conventional Commits](https://www.conventionalcommits.org/) by [semantic-release](https://github.com/semantic-release/semantic-release).

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
