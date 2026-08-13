# S5 cutover ledger — phase 1 (branch `s5-cutover-v2`)

Date: 2026-08-12. Untracked working document for the cutover restart. Test policy: tests use the in-process harness (`createTestCli`) and assert on data (settled envelope, events, exit code); one small smoke set uses the workspace-local bin; pure-formatting tests become presentation-model assertions or are deleted with a reason; a legacy test may only be deleted when the covered behaviour died with the commander shell or an equivalent engine test exists by name.

## 1. Test files deleted with the commander shell (commit `feat(cli)!: delete the commander shell`)

All paths relative to `packages/1-framework/3-tooling/cli/`.

### Commander duplicates — an equivalent engine test exists by name under `test/orm/`

| Deleted file | Engine test | Reason |
|---|---|---|
| test/commands/contract-emit.command.test.ts | test/orm/contract-emit.test.ts | Same command, harness asserts the settled envelope |
| test/commands/contract-infer.command.test.ts | test/orm/contract-infer.test.ts | Same |
| test/commands/db-schema.command.test.ts | test/orm/db-schema.test.ts | Same |
| test/commands/lsp.test.ts | test/orm/lsp.test.ts | Same |
| test/commands/migration-graph.test.ts | test/orm/migration-graph.test.ts | Same |
| test/commands/migration-list.test.ts | test/orm/migration-list.test.ts | Same |
| test/commands/migration-log.test.ts | test/orm/migration-log.test.ts | Same |
| test/commands/migration-plan.test.ts, migration-plan-command.test.ts | test/orm/migration-plan.test.ts | Same |
| test/commands/migration-show.test.ts | test/orm/migration-show.test.ts | Same |
| test/commands/migration-status.test.ts | test/orm/migration-status.test.ts | Same |
| test/commands/init/init.test.ts (2 366 lines) | test/orm/init-scaffold.test.ts, init-prompts.test.ts, init-reinit.test.ts, init-install.test.ts | Init flow ported to the engine command in earlier rounds |
| test/commands/init/skill-install.test.ts | test/orm/init-install.test.ts | Skill install folded into engine init port |
| test/commands/migration-read-commands-parity.test.ts | test/orm/migration-*.test.ts | Parity was between commander and engine copies; only one copy remains |
| test/commands/telemetry/telemetry-command.test.ts | engine-owned (`@prisma/cli-engine` telemetryCommandGroup ships its own suite) | The prisma-next telemetry command trio died with the shell |
| test/removed-verb-redirects.test.ts | test/orm/cli.test.ts (redirect pins) | Redirects are family data (`RedirectSpec`), asserted engine-side |

### Behaviour died with the commander shell — no replacement needed

| Deleted file | Reason |
|---|---|
| test/utils/global-flags.test.ts | Global-flag resolver deleted; the engine owns shared flags |
| test/utils/result-handler.test.ts | `handleResult` deleted; the engine settles envelopes |
| test/utils/shutdown.test.ts | Shutdown handler deleted; the engine owns signal policy (`onSignal` in runtime) |
| test/utils/suggest-command.test.ts | Suggestion module deleted; the engine owns "did you mean" |
| test/utils/progress-adapter.test.ts | Commander progress adapter deleted; engine step events replace it |
| test/utils/legend.test.ts | Legend renderer deleted with the commander renderers |
| test/utils/telemetry.test.ts | prisma-next telemetry wiring deleted; engine hooks (`resolveTelemetryHooks`) tested in the telemetry rewrite (see §3) |
| test/utils/test-helpers.ts | Commander test harness helper; superseded by `createTestCli` |
| test/commands/migration-plan-renderer.test.ts | Commander renderer deleted |
| test/commands/migration-read-help-text.test.ts | Commander help formatter deleted; engine owns help |
| test/commands/db-introspect-paths.test.ts | Path handling lives in `contract infer` (test/orm/contract-infer.test.ts) |
| test/commands/inspect-live-schema.test.ts | Command was never mounted in the engine family; `db schema` is the survivor |
| test/help.snapshot.test.ts (+ .snap) | Help formatting snapshot; help output is the engine's, and the policy bans snapshots |

### Pure-formatting tests — deleted (stdout parsing of the commander renderer; policy: presentation-model or delete)

| Deleted file | Reason |
|---|---|
| test/output.test.ts (964 lines) | Asserted styled stdout of the commander renderer; the renderer is gone. Data now asserted via settled envelopes in test/orm/*. |
| test/output.db-update.test.ts | Same — engine equivalent: test/orm/db-update.test.ts / db-update-consent.test.ts |
| test/output.errors.test.ts | Same — error envelope shape asserted in test/orm/normalize-error.test.ts and per-command tests |
| test/output.json-shapes.test.ts | Same — JSON shapes asserted as data in test/orm command tests |
| test/output.next-actions.test.ts | Same — nextActions asserted as envelope data in test/orm command tests |
| test/output.migration-commands.test.ts | Same |
| test/commands/migration-graph-coloured-output.test.ts (+ .snap) | Coloured-output snapshot of the deleted renderer; graph model/geometry keep their own tests (test/utils/formatters/migration-graph-*.test.ts, which pass) |

### Kept and moved

- test/version.test.ts — rewritten onto the engine bin (`dist/bin.mjs`), passes.
- test/migration-cli.exit-scheme.test.ts — cherry-picked pin of the authored-migration CLI's 0/1/2 exit scheme (kept; `src/migration-cli.ts` and clipanion stay per operator ruling 2026-08-12).

## 2. Pending legacy files — RESOLVED in phase 2a (all outcomes final)

### packages/1-framework/3-tooling/cli/test — 19 files

| File | Outcome | Commit |
|---|---|---|
| test/commands/cross-consumer-integrity.test.ts | ported → test/orm/cross-consumer-integrity.test.ts | cc336e39d3 (+50e6500b56) |
| test/commands/db-update-read-aggregate-json-golden.test.ts | data assertions → test/orm/db-update-to-resolution.test.ts | a087cd87cb |
| test/commands/format-status-summary.test.ts | replaced → test/orm/status-summary.test.ts (wt-diagnostics basis) | abe3d4d418 |
| test/commands/migrate-show.test.ts | ported → test/orm/migrate-show.test.ts | b98543fe0c |
| test/commands/migrate-to-contract.test.ts | ported → test/orm/migrate-to-contract.test.ts | b98543fe0c |
| test/commands/migration-check-multi-space-command.test.ts | consolidated → test/orm/migration-check-multi-space.test.ts | ea9cf77428 |
| test/commands/migration-check-multi-space.test.ts | consolidated → test/orm/migration-check-multi-space.test.ts | ea9cf77428 |
| test/commands/migration-check-path-target.test.ts | consolidated → test/orm/migration-check-multi-space.test.ts | ea9cf77428 |
| test/commands/migration-check-ref-error.test.ts | consolidated → test/orm/migration-check-multi-space.test.ts | ea9cf77428 |
| test/commands/migration-check-single-target-multi-space.test.ts | consolidated → test/orm/migration-check-multi-space.test.ts | ea9cf77428 |
| test/commands/migration-check-snapshot-consistency.test.ts | consolidated; extra cases folded into test/orm/migration-check.test.ts | ea9cf77428 (+50e6500b56) |
| test/commands/migration-invariants.test.ts | ported → test/orm/migration-invariants.test.ts | 4ed0e94fea |
| test/commands/migration-legend-commands.test.ts | legend pins as presentation-model data in test/orm/migration-status.test.ts / migration-graph.test.ts / migration-list.test.ts | c88ec15e1b |
| test/commands/migration-list-json-golden.test.ts | data assertions folded into test/orm/migration-list.test.ts | a087cd87cb |
| test/commands/migration-status-missing-db.test.ts | cases folded into test/orm/migration-status.test.ts | 4ed0e94fea |
| test/commands/migration-tamper.test.ts | ported → test/orm/migration-tamper.test.ts | ce92a36796 |
| test/commands/read-commands-json-golden.test.ts | data assertions folded into test/orm/db-sign.test.ts / migration-graph / migration-list / migration-status | c88ec15e1b |
| test/commands/init/probe-db.test.ts | kept as a unit test of src/commands/init/probe-db; dead `applyProbeOutcome` cases (died with the commander init) deleted | bed8cd26fe |
| test/utils/command-helpers.test.ts | `toPathDecisionResult` block deleted with the export; rest passes | abe3d4d418 |

### test/integration — helper + 20 files + 2 journeys

| File | Outcome | Commit |
|---|---|---|
| test/utils/cli-commands.ts | command re-exports dropped; engine surface via runOnEngine (cli-test-helpers) | 3c6fa2e736 |
| cli.config-section-requirements.test.ts | ported | 036a1d6e80 |
| cli.control-policy.mongo.e2e.test.ts | ported | eccca69139 |
| cli.control-policy.postgres.e2e.test.ts | ported | eccca69139 |
| cli.db-init.contract-space-verifier.test.ts | ported | b6322a93f1 |
| cli.db-introspect.e2e.test.ts | ported (its .snap deleted) | b6322a93f1 |
| cli.db-sign.e2e.test.ts | ported | b98543fe0c |
| cli.db-update.contract-space-verifier.test.ts | ported | b6322a93f1 |
| cli.db-update.e2e.test.ts | ported | 052c7ab2ae |
| cli.db-update.preflight-gaps.e2e.test.ts | ported | 052c7ab2ae |
| cli.db-verify.aggregate-schema.test.ts | ported | 052c7ab2ae |
| cli.db-verify.e2e.test.ts | ported; db-verify no-driver fixture now authored via defineConfig | 5eea922106 |
| cli.emit-cli-process.e2e.test.ts | folded into smoke set → cli.bin-smoke.e2e.test.ts | 322f712ad9 |
| cli.migrate-external-space.e2e.test.ts | ported (spawn parts → smoke set) | 5388bc53a3 |
| cli.migrate-ref-advancement.e2e.test.ts | ported (spawn parts → smoke set) | 5388bc53a3 |
| cli.migration-apply.e2e.test.ts | deleted — spawn coverage in cli.bin-smoke.e2e.test.ts, behaviour covered in-process (migrate ports + engine test/orm/migrate.test.ts) | 322f712ad9 |
| cli.mongo-db-schema.e2e.test.ts | ported | eccca69139 |
| cli.mongo-db-sign.e2e.test.ts | ported | eccca69139 |
| cli.mongo-db-verify.e2e.test.ts | ported | eccca69139 |
| cli.ref-pointer-integration.e2e.test.ts | ported | b6322a93f1 |
| ports/prisma/functional/relation-mode-gh-m-to-n/emit-map.test.ts | ported | 036a1d6e80 |
| cli-journeys/mongo-migration.e2e.test.ts | ported | 0ed4f8e4c7 |
| cli-journeys/invariant-routing.mongo.e2e.test.ts | ported | 0ed4f8e4c7 |
| cli.db-init.e2e.test.ts, cli.db-init.e2e.errors.test.ts, cli.db-ref-advancement.e2e.test.ts, cli.db-update.e2e.errors.test.ts | helper-fallout edits only (deleted commander surfaces dropped) | 3c6fa2e736 |

### Smoke set (final shape)

One suite, test/integration/test/cli.bin-smoke.e2e.test.ts (322f712ad9): spawns packages/1-framework/3-tooling/cli/dist/bin.mjs on plain Node and pins bin startup, argv→engine dispatch, exit-code surfacing, and the telemetry sender spawn. Generous `timeouts` budgets, no 500ms numbers. `cli.init-templates.e2e.test.ts` never imported deleted modules and stays as-is; the init-journey spawn coverage also stays.

## 3. Abandoned telemetry rewrite (wt-diagnostics, uncommitted) — verdict: usable basis

The diff (19 files, +137/−293) is a coherent increment on top of what phase 1 landed:

- Threads `exitCode` through the telemetry pipeline: `ParentToSenderPayload.exitCode?` (arktype schema updated), `RunTelemetryInputs.exitCode`, `TelemetryEvent.exitCode: number | null`, wired from the engine's `onSettled` summary in `src/orm/telemetry/reporting.ts`; backend contract (`apps/telemetry-backend` contract.prisma/json/d.ts, schema, handler) gains the column.
- Rewrites `cli-telemetry/test/cli-e2e.test.ts` to spawn the engine bin (51/64 lines swapped) and adjusts `backend-harness.ts` to `dist/bin.mjs` (phase 1 made the same harness edit, so that hunk is already applied here).
- Adds two engine-side test files: `test/orm/status-summary.test.ts` and `test/orm/telemetry-reporting.test.ts` (untracked in wt-diagnostics).
- Deletes `test/commands/format-status-summary.test.ts` and the `toPathDecisionResult` block of `test/utils/command-helpers.test.ts` — exactly the two stragglers in §2's first table.

Recommendation: re-apply it in the telemetry phase rather than redo it; only the backend-harness hunk and any drift in `reporting.ts` need re-basing.

**APPLIED in phase 2a** (commit abe3d4d418): the whole diff re-applied clean except the two files phase 1 had already drifted (backend-harness.ts, cli-e2e.test.ts), which were taken wholesale from the wt-diagnostics working copies — both were strict supersets of phase 1's bin-path edit. The two new test files landed as authored. The engine's telemetry command group is additionally mounted on the local bin (d7fca58a6a), with harness coverage that `telemetry status` settles as data.

## 4. Config consolidation (research this phase; implement next phase)

### What the unified `prisma` bin expects (evidence from the prisma-cli repo)

- **Shape**: explicit named top-level sections, one per command family, wrapped in `defineConfig` from `@prisma/cli-engine` (root export; `packages/cli-engine/src/exports/index.ts:47`). `defineConfig` stamps `$prismaConfig: 1` (`packages/cli-engine/src/config-loader.ts:60-71`; `PRISMA_CONFIG_VERSION` in `runtime.ts:185`). Unmarked file → hard error `CLI.CONFIG_MISSING_MARKER`; wrong version → `CLI.CONFIG_VERSION_UNSUPPORTED`. Reserved top-level keys: `extends`, `__proto__`, `$*`.
- **The ORM section**: today's flat prisma-next config object nests whole under `orm` (normative: prisma-cli `.drive/projects/prisma-cli-v8/specs/s5-orm.md:38`; test `packages/cli/tests/v8-orm-mount.test.ts:29-47,77,97`). The whole section validates at once via the family's `ormConfigSection` token before any ORM command runs (`CLI.CONFIG_SECTION_INVALID`, exit 2).
- **Filenames**: exactly one — `prisma.config.ts` (`config-loader.ts:33`), **cwd only, no upward walk, no extension variants, no prisma-next fallback** (`config-loader.ts:2-5`; test `config.test.ts:66-72`). `--config <path>` exists as a shared flag (`shared-flags.ts:87-94`); a missing `--config` file is `CLI.CONFIG_NOT_FOUND`, a missing default file is empty sections, not an error. Loader is c12 with every extra disabled (no rc, no extends, no env overlays, no dotenv — `config-loader.ts:163-208`).
- **Migration path**: no deprecated-fallback reading exists or is planned in the engine (`spec.md:119-122` rules the codemod post-rc). The engine loader is synchronous-structural; the prisma-next bin's c12 loader with configDir-relative path finalization is the bin adapter's job (`plans/s5-orm.md:88`).

Target user file:

```ts
import { defineConfig } from '@prisma/cli-engine';

export default defineConfig({
  orm: { /* the old prisma-next.config.ts object, unchanged */ },
});
```

### Before/after example (examples/retail-store/prisma-next.config.ts → prisma.config.ts)

Before:

```ts
import { defineConfig } from '@prisma/orm-mongo/config';

export default defineConfig({
  contract: './src/contract.prisma',
  db: {
    connection: process.env['DB_URL'] ?? 'mongodb://localhost:27017/retail-store',
  },
});
```

After (open question 3 below on which defineConfig users import):

```ts
import { defineConfig } from '@prisma/cli-engine';

export default defineConfig({
  orm: {
    contract: './src/contract.prisma',
    db: {
      connection: process.env['DB_URL'] ?? 'mongodb://localhost:27017/retail-store',
    },
  },
});
```

Note the collision: today's flat file also uses a helper named `defineConfig` (`@prisma/orm-<target>/config`, format-marker `Symbol.for('prisma-next.config-format-version')` from `packages/1-framework/1-core/config/src/config-types.ts:120-126`). The engine's marker is the enumerable `$prismaConfig` key. The two markers are different mechanisms (recorded R10 deviation, specs/s5-orm.md:38).

### Enumeration of prisma-next.config.* in this repo (226 files, excluding node_modules/dist/wip)

| Top-level dir | Count | Notes |
|---|---|---|
| test/ | 197 | test/integration 195 (ports/ 133, fixtures/ 46, sql-orm-client/ 10, authoring/ 2, 4 others), test/e2e 2; variants like `.with-db.ts`, `.no-db.ts`, `.emit.ts` share the stem |
| examples/ | 23 | 12 example apps incl. multi-extension-monorepo (3 configs) and prisma-8-demo (1 + 7 fixture configs + 1 odd `prisma-next.config.ts-contract.ts`) |
| packages/ | 5 | cli recordings fixture + 4 extension packs (paradedb, pgvector, postgis, supabase) |
| apps/ | 1 | apps/telemetry-backend |

### Generators that write the filename for users

- `src/orm/init-scaffold.ts:47` — `const CONFIG_FILE = 'prisma-next.config.ts';` (engine init command).
- `src/commands/init/templates/code-templates.ts:297-313` — `configFile()` renders the flat `defineConfig({ contract, db })` template (imports `defineConfig` from `@prisma/orm-<target>/config`).
- The duplicate scaffold in the deleted commander `src/commands/init/init.ts` died with the shell this phase; `init-scaffold.ts` is now the only writer.

### Loader changes needed next phase

1. **c12 walk** (`packages/1-framework/3-tooling/config-loader/src/load.ts`): `c12.loadConfig({ name: 'prisma-next', ... })` → prefer `prisma.config.ts` (c12 `name: 'prisma'` or explicit `configFile`), keep `prisma-next.config.ts` as deprecated fallback with a warning; `findNearestConfigPathForFile` (`load.ts:39-53`) walks only the old name — must walk both. Decide whether the nested `{ orm: ... }` shape is unwrapped here or in the bin adapter.
2. **Bin adapter** (`packages/1-framework/3-tooling/cli/src/orm/load-config.ts`): today it nests the flat config as the single `orm` section (`load-config.ts:41-45`). Once files are authored nested, the adapter stops nesting and instead validates/pass-through sections; `ORM_CONFIG_FILENAME` (`:8`) and the remediation strings in `src/orm/config-section.ts` (:25,:44,:56,:70) change spelling.
3. **createTestCli config evaluation** (`test/integration/test/utils/cli-test-helpers.ts:65-96,113-125` plus db-init/db-update helpers at `:57`): `evaluatedSections` builds `{ orm: <flat> }` via `loadOrmConfig`; follows whatever 1–2 decide. Unit tests already hand-nest `config: { orm: ... }` and are unaffected.
4. **migration-cli loading** (`src/migration-cli.ts:49,135-137,547-557`): goes through `loadConfigForSections(parsed.config, ['family','target','adapter','driver','extensions'])` directly (no `orm` nesting) — needs the same dual-name walk, and note the pre-existing discrepancy: `loadConfigForSections` starts discovery at `process.cwd()`, not the migration file's directory as its header claims.
5. **Init generator** (`init-scaffold.ts` + `code-templates.ts`): scaffold `prisma.config.ts` with the nested `orm` section; decide the `defineConfig` import (see open questions).
6. **Display-string sweep**: ~20 hard-coded `'prisma-next.config.ts'` remediation/help strings across `src/orm/db/sign.ts:37`, `src/utils/command-helpers.ts:104,143`, `src/utils/migration-command-scaffold.ts` (deleted this phase), and every `--config` option description.

### Interim (phase 2a)

No dual-name reading was needed: the local bin work changed no config-loading behaviour, examples keep `prisma-next.config.ts`, and the loader still reads the old name only.

## 4b. Config consolidation — IMPLEMENTED (phase 2b, 2026-08-13)

### Loader design (as landed)

- **`@internal/config-loader` (`load.ts`)** owns both markers (the R10 deviation reconciled in one place): a raw first-layer export carrying the enumerable `$prismaConfig: 1` key is the engine shape and the flat Prisma Next config is read from its `orm` section (`orm` missing → `{}` + the usual section diagnostics; `orm` non-object → a sectionless `CONFIG.VALIDATION_FAILED` that blocks every command); a layer carrying the non-enumerable `Symbol.for('prisma-next.config-format-version')` is the deprecated flat shape, still loaded whole. Discovery prefers `prisma.config.ts` in cwd and falls back to `prisma-next.config.ts` (c12 `name: 'prisma'` vs `'prisma-next'`, chosen by an existence check); an explicit `--config` path spelled `prisma-next.config.ts` is also flagged. Neither marker → `CONFIG.VERSION_MARKER_MISSING` (its fix text now names the engine defineConfig). `findNearestConfigPathForFile` walks both names, new name first per directory.
- **Deprecations are data, not errors**: `LoadedConfig` gains `deprecations: readonly ConfigDeprecation[]` (`CONFIG.DEPRECATED_FILENAME`, `CONFIG.DEPRECATED_SHAPE`). They cannot ride the engine's `LoadedConfig.diagnostics` — every `section: null` entry fails config-needing commands regardless of severity — so the bin's `loadOrmConfig` takes a `warn` callback (wired to stderr as an engine-style `⚠` line in `runtimeFromProcess`), and `loadConfigForSections` takes `options.onDeprecation` (the migration-file CLI wires it to its stderr; keeping that one function also keeps migration-cli.test.ts's existing module mock valid).
- **The bin adapter still nests**: `loadOrmConfig` keeps building `sections: { orm: <flat config> }` from the loader's flat result, so the engine-side section validator and every handler are untouched by the shape change.

### Sweep (commit f513b958c8)

All 226 `prisma-next.config.*` files renamed via `git mv` and 224 rewrapped to `defineConfig({ orm: ormConfig({ … }) })` with `defineConfig` from `@prisma/cli-engine` and the original target-typed helper aliased as `ormConfig` (types preserved). Per top-level dir: test/ 197 (integration 195, e2e 2), examples/ 23, packages/ 5, apps/ 1. Two files deliberately renamed-only (they export unmarked objects to test `CONFIG.VERSION_MARKER_MISSING` / validation bypass): `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/db-introspect/prisma.config.no-driver.ts`, `…/cli-integration-test-app/fixtures/emit-command/prisma.config.missing-output.ts`. The accidental `examples/prisma-8-demo/prisma-next.config.ts-contract.ts` became `prisma.config.contract-ts.ts` (script `emit:ts` updated). 267 referencing files swept (`prisma-next.config` → `prisma.config`), excluding docs/releases, CHANGELOG.md, projects/, and the deliberate deprecated-path fixtures. 21 package.json files gained `@prisma/cli-engine: 0.0.9` so the new config import resolves under pnpm's strict linking. One sweep casualty caught by tests and reverted (d633745d0b): the flat-shape marker symbol key string must stay `prisma-next.config-format-version`.

### Deprecated-path test set (the explicit fixtures that keep the old spelling)

- `packages/1-framework/3-tooling/config-loader/test/load.test.ts` — `describe('deprecated config fallback')`: flat shape in prisma.config.ts (shape deprecation), old filename with new shape (filename deprecation), old filename + flat shape (both, in order), new name preferred when both files exist, explicit `--config prisma-next.config.ts` flagged, `findNearestConfigPathForFile` old-name walk + same-dir preference.
- `packages/1-framework/3-tooling/config-loader/test/section-requirements.test.ts` — `loadConfigForSections` reports both deprecations through `onDeprecation`.
- `packages/1-framework/3-tooling/cli/test/orm/load-config.test.ts` — `describe('deprecated spellings')`: flat-shape prisma-next.config.ts loads with one `warn` message per deprecation and `path` reporting the old filename; primary spelling warns nothing.

### init generator + devDependency decision (OPERATOR REVIEW)

`init` scaffolds `prisma.config.ts` in the engine shape (engine `defineConfig` wrapping the target-typed `ormConfig`). The unpublished `prisma-next` devDependency is replaced by **`@prisma/cli@next` + `@prisma/cli-engine`**, and scaffolded scripts/docs invoke the **`prisma-cli`** bin:

- Evidence: rollout-plan.md step 2 has v8 RC-line versions of the unified CLI publishing as `@prisma/cli` under the `next` dist-tag, and npm confirms `@prisma/cli@next = 8.0.0-rc.1` with bin `prisma-cli` mounting the ORM commands top-level (`contract emit`, `db init`, …) from `@prisma/orm-toolchain/cli`. `packages/9-public/prisma-next` was removed from this workspace (f6b6343bc2).
- `@prisma/cli-engine` is needed directly because the scaffolded config imports its `defineConfig`; the publish-surface import audit now whitelists it (`EXTERNAL_DIRECT_DEPENDENCIES` in `import-roots.ts`).
- Alternative the operator may prefer: rollout step 3 also plans the `prisma-next` npm name continuing as an rc channel published from the prisma-cli repo (bin `prisma-next`); that package does not exist in the prisma-cli repo yet, so scaffolding it today would install the stale artifact this repo used to publish. Chosen the package that exists and is on the plan's happy path; pinned by tests in `test/orm/init-install.test.ts` / `init-scaffold.test.ts`.

### Straggler repairs surfaced by the full integration run (e10a1712b5)

- `test/cli.init-skill-distribution.integration.test.ts` was still importing the deleted commander `runInit` — broken since the shell deletion and present-but-miscounted in the 2a triage (its "Failed Suites 1" sat outside the 7 failed files). Ported: it now spawns the engine bin's `init` with the same fake package-manager PATH harness; both distribution assertions kept.
- The init journey's tarball install now declares `@prisma/cli-engine` (registry) so the scaffolded config evaluates under `node-linker=isolated`.

### Phase-2b verification record (2026-08-13)

| Check | Result | Log |
|---|---|---|
| root `pnpm build` | exit 0 (86 tasks) | /private/tmp/claude-502/p2b-root-build2.log |
| config-loader `pnpm test` | exit 0 — 53/53 | (inline) |
| cli `pnpm typecheck` / `pnpm lint` / `pnpm test` | exit 0 / exit 0 (264 infos) / 113 files, 1410/1410 | p2b-cli-typecheck-final.log, p2b-cli-lint-final.log, p2b-cli-test7.log |
| publish-surface / language-server / vite-plugin / config pkg tests | all pass (56, 259, 31, all) | p2b-pubsurf-test.log, p2b-ls-test2.log, p2b-vite-test.log |
| test/integration FULL `pnpm test` | first pass exit 1: 6 failed files → triage: init-journey + skill-distribution were the stragglers above (fixed, now 32/32 and 2/2 isolated); 3 sqlite/count files were 100ms-budget flakes (pass isolated with TEST_TIMEOUT_MULTIPLIER=2, p2b-integration-iso.log); issues-28192-pg-historical-dates fails 2 cases on this machine regardless (known timezone artifact). Final full rerun (p2b-integration-test-final.log): 331/333 files, 1884 passed — remaining: the historical-dates artifact (2 tests) and one init-journey `afterAll` database-close exceeding its 5s hook budget under full-suite load (file green in isolation) | p2b-integration-test.log |
| test/e2e/framework `pnpm test` | exit 0 — 113/113 | p2b-e2e-framework.log |
| telemetry-backend / pgvector pack / multi-extension example tests | 48/48, 160/160, 4/4 | p2b-backend-test.log, p2b-pgvector-test.log, p2b-multiext-test.log |
| examples/prisma-8-demo `pnpm run emit` + `emit:ts` (renamed contract-ts config) | exit 0, no artifact diff | p2b-emit-demo.log, p2b-emit-demo-ts.log |
| examples/prisma-8-demo-sqlite `pnpm run emit` | exit 0, no artifact diff | p2b-emit-sqlite.log |
| `node scripts/lint-framework-vocabulary.mjs` | exit 0 (count 308 = threshold) | p2b-vocab.log |

### Divergence notes

- migration-cli's `loadConfigForSections` still starts discovery at `process.cwd()`, not the migration file's directory as its header prose claims — pre-existing, deliberately left unchanged (operator ruling).
- The vite plugin's default `configPath` and the language server's watched glob now name only `prisma.config.ts`; a deprecated-name project keeps working through the loader fallback everywhere a path is discovered rather than assumed, but the vite plugin's default (an explicit path, so no fallback) and the LSP file watcher no longer see `prisma-next.config.ts`.
- R10 deviation recorded: the engine marker is the enumerable `$prismaConfig` key; the ORM's flat marker is a non-enumerable symbol. Both recognised only on the requested file's own layer (extends bases cannot vouch).

## 5a. Phase-2a verification record (2026-08-13)

| Check | Result | Log |
|---|---|---|
| root `pnpm build` | exit 0 (86 tasks) | /private/tmp/claude-502/p2a-root-build.log |
| cli `pnpm typecheck` | exit 0 | /private/tmp/claude-502/p2a-cli-typecheck-final.log |
| cli `pnpm lint` | exit 0 (264 infos, 0 errors) | /private/tmp/claude-502/p2a-cli-lint-final.log |
| cli `pnpm test` (full) | exit 0 — 113/113 files, 1408/1408 tests | /private/tmp/claude-502/p2a-cli-test-final2.log |
| cli-telemetry `pnpm test` (incl. engine-bin e2e vs real backend) | exit 0 — 111/111 | /private/tmp/claude-502/p2a-cli-telemetry-test.log |
| telemetry-backend `pnpm test` | exit 0 — 48/48 | /private/tmp/claude-502/p2a-backend-test.log |
| test/integration `pnpm test` (full) | exit 1 first pass: 7 failed files. Triage: init-journey was genuinely broken (commander-era flags + unpublished `prisma-next` dep; fixed in 1d31e27efb, now 32/32, log p2a-init-journey.log); 4 files were 100ms-budget flakes + 1 a 30s spawn flake — all pass isolated with TEST_TIMEOUT_MULTIPLIER=2 (p2a-integration-iso.log); issues-28192-pg-historical-dates fails 2 cases in any run on this machine (timestamptz off by an LMT +28s on pre-1900 dates — environment/timezone artifact, file untouched by this branch, unrelated to the cutover) | /private/tmp/claude-502/p2a-integration-test.log |
| `node scripts/lint-framework-vocabulary.mjs` | exit 0 (count 308 = threshold, unchanged) | /private/tmp/claude-502/p2a-vocab.log |

Fixes the full runs surfaced (committed): version.test.ts 1s spawn budget → shared `timeouts.coldTransformImport` (5a60254be1); init-journey re-point completed (1d31e27efb); control-client `vi.mock('@internal/emitter')` removed — it was order-dependent under `isolate:false` and the newly ported files exposed it; the emit tests now run the real emitter (5cc53b479d).

## 5. Phase-1 verification record

| Check | Result | Log |
|---|---|---|
| root `pnpm build` | exit 0 (86 tasks) | /private/tmp/claude-502/build.log |
| cli `pnpm typecheck` | exit 2 — only the §2 pending files | /private/tmp/claude-502/cli-typecheck.log |
| cli `pnpm lint` | exit 0 (264 infos, 0 errors/warnings) | /private/tmp/claude-502/cli-lint.log |
| cli `pnpm test` | 18 failed / 103 passed files; 4 failed / 1328 passed tests — all failures are §2 pending files | /private/tmp/claude-502/cli-test.log |
| publish-surface `pnpm test` | 55/55 pass | /private/tmp/claude-502/publish-surface-test.log |
| orm-framework shell/tarball tests (incl. `@prisma/orm-toolchain/cli` import) | 13/13 pass | /private/tmp/claude-502/tarball-test.log |
| `node scripts/lint-framework-vocabulary.mjs` | exit 0 after re-baseline 364 → 308 | /private/tmp/claude-502/vocab.log |
| examples/prisma-8-demo `pnpm run emit` (local bin) | exit 0, no artifact diff | /private/tmp/claude-502/emit-demo.log |
| examples/prisma-8-demo-sqlite `pnpm run emit` (local bin) | exit 0, no artifact diff | /private/tmp/claude-502/emit-sqlite.log |

## 6. Phase 3 — prose sweep, docs supersessions, final verification (2026-08-13)

### Bin-name prose sweep (commit 91ed489904)

The engine substitutes `{bin}` only in help examples and redirect replacements (`resolveExample` in the engine's stricli adapter); next-action `command` strings and `fix` prose render verbatim, and the unified `prisma-cli` bin mounts this repo's handlers directly (`ormCommandFamily.commands[...]` in prisma-cli's `packages/cli/src/cli.ts:266-`). So hardcoded command prose was rewritten to the unified bin: ~98 `prisma-next <cmd>` string sites across 29 src files (cli-errors, db/migration failure builders, next-actions, status findings, control-api operations, init errors/probe) plus the init templates (`Generated by \`prisma-cli init\``, `pnpm dlx @prisma/cli@next init`, catalog prose naming `@prisma/cli`) and matching test assertions (15 files + the templates snapshot). Root README installs `@prisma/cli@next`.

Deliberately kept as `prisma-next` (41 sites in cli src + 5 generated-header sites):

- `BIN_NAME`/createCli name in `orm/cli.ts` — it names the workspace-local bin, which IS still `prisma-next` (package.json bin map). The dead commander-era `utils/bin-name.ts` deleted.
- Telemetry wiring (`orm/telemetry/reporting.ts` first-run notice, `commandPath: ['prisma-next', …]`, docs URL) — bin-local; the unified CLI ships its own telemetry surface.
- Generated-artifact headers: emitter (`contract.d.ts` "To regenerate, run: prisma-next contract emit", `emit.ts:40-41`, `generate-contract-dts.ts:180-181`) and psl-printer's inferred-PSL header — the emitter cannot know the invoking bin and the strings are baked into every committed fixture.
- PSL dialect marker `// use prisma-next`, skill names `prisma-next-*`, the `prisma-next.md` scaffold filename, internal code comments, and internal dev docs' command examples (docs/ uses the workspace bin).

Leftover applied: init-journey `afterAll` database-close now carries `timeouts.spinUpDbServer` (f7f81b7c61).

### Docs supersessions (commit 5a37aff480)

- `packages/1-framework/3-tooling/cli/README.md`: header names `@prisma/cli@next`/`prisma-cli`; engine entry replaces the commander sections (entry point, contract-emit command, error handling, help formatters, dependencies, design decision 3).
- `docs/CLI Style Guide.md`: commander-era `--force` note in past tense; redirect implementation described as family `RedirectSpec` data with engine `{bin}` substitution.
- `docs/reference/error-reference.md`: the three CLI.INIT_* passages that treated the commander init as extant now speak of it as deleted.
- `docs/reference/cli-e2e-test-patterns.md`: commander parseAsync section replaced with the createTestCli/engine-harness pattern.
- ADR 242 gains a supersession note (bin distribution retired; package split stands). ADR 239's `CLI` namespace row carries the shared-ownership note assigned by R-S5-13 (the engine mints its own `CLI.*` codes; this repo keeps `CLI.INIT_*` etc.). ADR 211 already carried its note from phase 1.

### Straggler repairs surfaced by final verification (commit aa4b4078c1)

- `test/e2e/framework`'s `emit` script resolved `prisma-next` through a stale node_modules shim pointing at the deleted facade launcher (`@prisma/orm-sqlite/dist/bin__prisma-next.mjs`); the package now declares `@internal/cli` as a devDependency like every other workspace consumer.
- `scripts/regen-example-migrations.mjs` wrote a flat-shape temp config by spreading the (now engine-shaped) example config, and expected the commander's single-object `--quiet` JSON; it now wraps `realConfig.orm` in the engine shape and reads `envelope.result.storageHash` from the last NDJSON line.
- `test/integration/test/cli.db-verify.e2e.test.ts` retry-hint assertion updated for the prose sweep.

### Phase-3 verification record (2026-08-13)

| Check | Result | Log (/private/tmp/claude-502/) |
|---|---|---|
| root `pnpm build` | exit 0 | p3-root-build.log |
| cli `pnpm typecheck` / `pnpm lint` / `pnpm test` | exit 0 / exit 0 (264 infos) / exit 0 — 113 files, 1410/1410 | p3-cli-typecheck.log, p3-cli-lint.log, p3-cli-test.log |
| config-loader `pnpm test` | exit 0 | p3-config-loader-test.log |
| test/integration FULL `pnpm test` | first pass exit 1: 10 failed files → triage: cli.db-verify was real prose-sweep fallout (fixed in aa4b4078c1); issues-28192-pg-historical-dates 2 tests = known machine timezone artifact; composites-list-updateMany = mongodb-memory-server port collision; 6 journey files + init-skill-distribution = timeout flakes under full-suite load. Everything except the historical-dates artifact passes isolated with TEST_TIMEOUT_MULTIPLIER=2 (34/34 + 2/2) | p3-integration-test.log, p3-integration-iso.log, p3-skill-dist-iso.log |
| `pnpm fixtures:check` | exit 1 twice (the two straggler repairs above), then exit 0 with no fixture diffs | p3-fixtures-check{,2,3,4}.log |
| `pnpm lint:deps` | exit 0 | p3-lint-deps.log |
| `node scripts/lint-framework-vocabulary.mjs` | exit 0 | p3-vocab.log |
