# S5 cutover divergences — retiring the prisma-next shell (prisma/prisma)

Every known place where the S5 **cutover** in prisma/prisma (branch `s5-cutover-v2`: delete the commander shell, unpublish the `prisma-next` bin, consolidate config, run every ORM command on `@prisma/cli-engine`) changes behaviour relative to what shipped before it, enumerated for operator review.

This file complements `parity-divergences-s5.md` (committed on the `s5-orm-drive-docs` branch, commit `6813124`), which records the **per-command port divergences** — flags, prompts, settlement, output, exit codes — from the S5 ORM port round. Nothing from that file is repeated here; where a cutover item lands on ground the older file already covers, this file references it.

## 1. Distribution — the bin is unpublished; the install journey moves to the unified CLI

- `packages/9-public/prisma-next` (the bin-only shim of prisma/prisma ADR 211/242) is **deleted**. `@prisma/orm-toolchain` publishes the `orm` command family at `@prisma/orm-toolchain/cli` and **no bin**; the database facades declare no launcher bins either.
- The only user-facing binary is the unified `prisma-cli` (`@prisma/cli@next`, this repository), which mounts the family. The "install the CLI via a package manager" journey is therefore owned by this repository now — prisma/prisma's own e2e journey installs `@prisma/cli-engine` from the registry and exercises the family through the engine bin.
- Inside prisma/prisma a **workspace-local `prisma-next` bin remains** on `@internal/cli` (pointing at `dist/bin.mjs`, the engine entry) for examples, dev use, and the spawn smoke tests. It never reaches a published tarball.
- **Operator-owned remainder:** deprecating/handing off the `prisma-next` npm package name (rollout-plan step 3 sketches it as an rc channel published from this repository) is not done by the cutover and stays with the operator.

## 2. Test policy — deleted stdout-formatting behaviours

The cutover's test policy: tests run on the in-process engine harness (`createTestCli`) and assert **data** (settled envelope, events, exit code); one small smoke suite spawns the real bin. Pure-formatting tests of the commander renderer were deleted rather than ported, because the behaviour they pinned died with the renderer:

| Deleted behaviour pin | Disposition |
| --- | --- |
| Styled stdout of the commander renderer (`output.test.ts`, 964 lines, plus `output.db-update`, `output.errors`, `output.json-shapes`, `output.next-actions`, `output.migration-commands`) | Data now asserted via settled envelopes in the engine tests; rendering is the engine's |
| Coloured migration-graph output snapshot | Deleted; graph model/geometry keep their own unit tests |
| Help-output snapshot | Deleted; help is engine-owned and the policy bans snapshots |
| Legend renderer tests | Legend pins re-expressed as presentation-model data in the `migration status`/`graph`/`list` engine tests |
| Commander help formatter, progress adapter, result handler, shutdown handler, global-flag resolver, "did you mean" | Behaviour died with the shell or is engine-owned (signal policy, shared flags, suggestions) |

Full deletion tables with per-file reasons: `assets/s5/cutover-ledger.md` §1–2.

## 3. Exit codes

- `db verify`, `db sign`, `migration check`: **exit 4 on findings, 2 on errors** (was 1) — landed in prisma/prisma PR #29984 during the port round and recorded in `parity-divergences-s5.md`; absorbed here by reference, not re-recorded.
- The **authored-migration-file CLI** (`MigrationCLI.run`, clipanion) keeps its **0/1/2** scheme across the cutover, pinned by a dedicated test. The migration-file runtime survives the shell deletion by operator ruling.

## 4. `--quiet` semantics

The commander shell's `-q/--quiet` was an errors-only output mode implemented per command. On the engine, `--quiet` is a shared engine flag that acts as a **log-level alias** (recorded as a global divergence in `parity-divergences-s5.md`); the cutover deletes the last per-command quiet plumbing, so quiet behaviour is now uniformly the engine's.

## 5. Config consolidation

The user config file is now **`prisma.config.ts` in the engine shape**:

```ts
import { defineConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default defineConfig({
  orm: ormConfig({ /* the old flat prisma-next config object, unchanged */ }),
});
```

Divergences and decisions:

- **Deprecated fallback with warnings, where the engine spec has none.** The engine loader reads exactly `prisma.config.ts`, cwd-only, no fallback (`specs/s5-orm.md` rules the codemod post-rc). prisma/prisma's own loader (`@internal/config-loader`) additionally reads the old `prisma-next.config.ts` filename and the old flat shape as **deprecated**, each emitting a `⚠` stderr warning (`CONFIG.DEPRECATED_FILENAME`, `CONFIG.DEPRECATED_SHAPE`). Deprecations are data on `LoadedConfig`, not diagnostics — an engine diagnostic with `section: null` would fail every config-needing command regardless of severity.
- **R10 marker deviation, reconciled in one place.** The engine's config marker is the enumerable `$prismaConfig: 1` key stamped by its `defineConfig`; the ORM's flat-shape marker is the non-enumerable `Symbol.for('prisma-next.config-format-version')`. Both are recognised only on the requested file's own layer (extends bases cannot vouch). The loader owns both; the two mechanisms remain different (recorded R10 deviation).
- **The bin adapter still nests.** prisma/prisma's `loadOrmConfig` reads the flat ORM config out of the `orm` section and re-presents it to the engine as `sections: { orm: … }`, so the engine-side section validator and every handler are untouched by the shape change.
- **`migration-cli` cwd discovery — pre-existing discrepancy, kept.** `loadConfigForSections` starts config discovery at `process.cwd()`, not the migration file's directory as its header prose claims. Predates the cutover; deliberately left unchanged (operator ruling).
- **The Vite plugin's default `configPath` and the language server's file watcher name only `prisma.config.ts`.** A deprecated-name project keeps working wherever a path is *discovered* (loader fallback), but the plugin's default is an explicit path and the LSP watcher glob no longer matches `prisma-next.config.ts`.

## 6. `init` — scaffold and devDependency set (OPERATOR REVIEW)

`init` scaffolds `prisma.config.ts` in the engine shape and replaces the unpublished `prisma-next` devDependency with **`@prisma/cli@next` + `@prisma/cli-engine`**; scaffolded scripts and docs invoke the **`prisma-cli`** bin.

- `@prisma/cli-engine` is a direct devDependency because the scaffolded config imports its `defineConfig` (pnpm strict linking).
- **Alternative the operator may prefer:** rollout step 3 plans the `prisma-next` npm name continuing as an rc channel published from this repository (bin `prisma-next`); that package does not exist here yet, so scaffolding it today would install the stale prisma/prisma-published artifact. The cutover chose the package that exists and is on the plan's happy path; pinned by `init-install`/`init-scaffold` tests.

## 7. Remediation prose names the unified bin

The engine substitutes `{bin}` only in help examples and redirect replacements; next-action `command` strings and `fix` prose render verbatim. The cutover rewrites the hardcoded `prisma-next <cmd>` spellings in error remediation, next-actions, and init templates to `prisma-cli <cmd>` / `@prisma/cli`, since those strings reach real users through the unified bin. Deliberately kept as `prisma-next`:

- the workspace bin's own name (`BIN_NAME` in `orm/cli.ts`, matching the package's `bin` map) and its telemetry wiring (first-run notice, `commandPath` prefix) — the unified CLI ships its own telemetry surface;
- generated-artifact headers (`contract.d.ts` "To regenerate, run: prisma-next contract emit", inferred-PSL header) — the emitter cannot know the invoking bin, and changing the strings would churn every committed fixture;
- PSL dialect markers (`// use prisma-next`), skill names (`prisma-next-*`), and the `prisma-next.md` scaffold filename (product doc name, not a bin).

## 8. Telemetry

- The settled **exit code** is threaded through the telemetry pipeline (`ParentToSenderPayload.exitCode`, `TelemetryEvent.exitCode`, backend column) from the engine's `onSettled` summary.
- The engine's `telemetry status|enable|disable` command group is mounted on the workspace-local bin; the prisma-next commander telemetry command trio died with the shell.
