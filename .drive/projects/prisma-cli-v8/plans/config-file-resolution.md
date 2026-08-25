# Config-file resolution — dispatch plan

Slice contract: `specs/config-file-resolution.md`. One PR into `main`. Sequential dispatches; each hands the next a state where `pnpm typecheck` and `pnpm exec turbo run test --concurrency=1` are green (the sequential run — the parallel `pnpm test` has a known engine-dist race). Engine-surface hazard applies to every dispatch: verify `@prisma/cli-engine`'s committed version is still unpublished before merging the PR; if a train shipped it, bump the engine version first.

## D1 — The loader discovers a chain

**Outcome:** `loadConfig` resolves an ordered chain of config files instead of one: anchor directory (cwd, or the `--config` file's directory) upward to the first `.git` directory; `parent: false` ends collection, `parent: "path"` names the next link explicitly (cycle-checked, may cross the boundary), no `.git` above means anchor-only. `parent` joins the reserved top-level keys (loader strips it like the marker; `reservedConfigSectionName` covers it; construction-time rejection includes it). Every file on the chain is evaluated with the existing marker/version/unreadable classification, each failure naming its file. `LoadedConfig` becomes a chain shape — per-file `{path, sections}` in nearest-first order plus file-level diagnostics — and every existing consumer (`needs.ts`, hosts, engine tests, the skills reader temporarily via a nearest-file adapter) compiles and passes against it with single-file behavior unchanged: one file in cwd behaves exactly as today.

**Builds on:** clean main. **Hands to D2:** the chain type, discovery green under new engine tests (boundary stop, `parent` forms, cycle guard, anchored fixtures per the spec's test-anchoring requirement), all suites green.

**Focus:** the loader doc comment says "cwd only, no walking up" — it and the `EVALUATE_ONE_FILE_ONLY` rationale need rewriting to the new truth. Symlink-resolve the anchor. Windows realpath on every chain comparison. The unknown-key check in `needs.ts` iterates the chain per file from this dispatch on.

## D2 — Sections merge per key with provenance

**Outcome:** `ConfigSection` gains optional `merge(parent, child)`; the engine default merges per key at the section's top level and replaces below. `checkConfiguration` folds each needed section over the chain nearest-first, validates the merged view (validators unchanged), and hands `ctx.config` the resolved value. Every resolved value carries provenance; post-merge validation diagnostics name the contributing file; relative-path resolution against the declaring file is provided as an engine helper the provenance makes possible (sections opt in by resolving paths through it). Merging never mutates the frozen exports.

**Builds on:** D1's chain. **Hands to D3:** engine tests covering shadowing, fall-through (nested file lacking a section the root has), partial merge (root `skills.check` + package `skills.agents`), provenance in error copy, and the ORM absence-error firing only on a chain with no `orm` section anywhere; all suites green.

**Focus:** `merge` must be optional and type-backward-compatible — the shipped orm/composer dists implement `ConfigSection` against the current engine and must keep working with the default. `__proto__`/`fromEntries` discipline extends to the merged object.

## D3 — One resolver in the product

**Outcome:** `readProjectSkillsConfig` and the out-of-handler reads (skills staleness notice, post-login tip) resolve through the engine's chain resolver; the hand-rolled `existsSync` + direct `loadConfig` path and D1's temporary adapter are deleted. From any subdirectory, the staleness notice and the skills commands agree on the governing config. The skills section keeps its null-collapsing contract for out-of-handler callers.

**Builds on:** D2's resolver. **Hands to D4:** exactly one resolution code path, skills unit tests green from nested-directory fixtures.

**Focus:** the "one stat before paying for transpile" property `readProjectSkillsConfig` had should survive — chain discovery is stat-only until a file exists; keep the no-config fast path.

## D4 — Subdirectory init scaffolds only

**Outcome:** `prisma init` run in a directory whose discovered chain contains an ancestor config skips the skills sync, the `postinstall` script, and the `prisma` devDependency by default, reporting each as skipped-with-reason; explicit flags still opt in; root init (no ancestor config) is byte-for-byte unchanged. Unit tests cover both shapes; the init e2e gains the subdirectory case. If D1's chain work removed the cause of the e2e rerun workaround (`e2e/init.e2e.ts:189-200`), the workaround comes out; otherwise its comment is updated to name what still forces it.

**Builds on:** D3 (init detects the ancestor through the same resolver as everything else). **Hands to D5:** init behavior finished, suites and init e2e green.

## D5 — Docs, records, full verification

**Outcome:** user-facing docs describe discovery, merging, `parent`, and the two-config layout (the config documentation surface plus `docs/product/*` touchpoints that mention config today); the ledger closes the stale pathe entry (the loader realpath fix shipped in engine 0.2.2) and records this slice's rulings; the spec's status line gains the landed date. Full verification per AGENTS.md, including conformance (`pnpm exec turbo run conformance --filter @prisma/cli --force`) and the sequential test run; the engine-version-unpublished check from the plan header re-verified at PR-open.

**Builds on:** D4. **Hands to:** slice-DoD; PR-open.

## Hazard inventory (2026-08-25)

- Engine surface changes ride the unpublished engine version or force the three-repo re-peer chain — check at start AND at merge; the version can publish out from under a long-running slice.
- This repository contains fixture `prisma.config.ts` files and will gain more; every loader/resolver test must pin its chain (temp dirs outside the repo, or explicit `parent: false` fixtures) or a real ancestor config leaks in — the exact failure the prior round's review caught.
- `tests/e2e-coverage.test.ts` parses `src/cli.ts` as text; D4 does not touch the mount table, but any drive-by edit there must keep the `mountedCommands` literal's shape.
- The parallel `pnpm test` race (engine dist rebuild vs cli tests) predates this slice; verify with the sequential run and do not chase it here.
