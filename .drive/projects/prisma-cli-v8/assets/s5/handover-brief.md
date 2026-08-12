# S5 ORM CLI port — handover brief

Written 2026-08-12. Everything below is current as of the last push recorded here.

## Where to work

Worktree root: `/Users/will/Projects/prisma/prisma/.claude/worktrees/prisma-orm-cli-port-e1963d`

Never read or write outside it. Each branch has its own worktree under `wip/` — use the existing one, never `git checkout` a branch that another worktree holds.

| branch | worktree |
| --- | --- |
| `s5-orm-adopt-engine-8` | the root itself |
| `errors-next-actions` | `wip/wt-errors` |
| `s5-orm-ref-format` | `wip/wt-ref-format` |
| `s5-orm-contract` | `wip/wt-contract` |
| `s5-orm-migration-write` | `wip/wt-migration-write` |
| `s5-orm-db-read` | `wip/wt-db-read` |
| `s5-orm-diagnostics` | `wip/wt-diagnostics` |
| `s5-orm-lsp` | `wip/wt-lsp` |
| `s5-orm-db-update` | `wip/wt-dbupdate` |
| `s5-orm-init` | `wip/wt-init` |

## What has landed

- **#29988** — the framework-vocabulary check is now a Biome GritQL plugin (`biome-plugins/no-family-vocabulary.grit`) plus a counting ratchet (`scripts/lint-framework-vocabulary.mjs`). Comments and JSDoc are no longer counted, deliberately. `main`'s threshold is **363**.
- **#29978** — the port's foundations and the engine 0.0.8 adoption. Squash-merged.
- **#29977** — pushed and current with `main` at `dedf72f028`, threshold 365. Open, mergeable.

## The immediate job

Eight branches have local commits that are NOT pushed, and none of them contains current `main`. Every one needs: merge `bot/main` → resolve → re-baseline the threshold → verify → commit → push.

| branch | unpushed commits | threshold | uncommitted files |
| --- | --- | --- | --- |
| `s5-orm-ref-format` | 2 | 363 | `src/orm/ref/list.ts` |
| `s5-orm-contract` | 8 | 363 | `src/orm/contract/infer.ts` |
| `s5-orm-migration-write` | 8 | 363 | `src/orm/migration/plan.ts` |
| `s5-orm-db-read` | 5 | 358 | — |
| `s5-orm-diagnostics` | 8 | 363 | — |
| `s5-orm-lsp` | 8 | 363 | — |
| `s5-orm-db-update` | 13 | 358 | `src/utils/db-update-failure.ts` |
| `s5-orm-init` | 8 | 367 | `src/orm/init-inputs.ts`, `src/orm/init.ts` |

**All eight are now pushed and clean** (verified: zero unpushed commits, zero uncommitted files). The shas and final thresholds:

| branch | pushed sha | threshold |
| --- | --- | --- |
| `s5-orm-ref-format` | `fd5cb0cc55` | 363 |
| `s5-orm-contract` | `90806b48cd` | 363 |
| `s5-orm-migration-write` | `269df06f5a` | 363 |
| `s5-orm-db-read` | `627ac2efd4` | 358 |
| `s5-orm-diagnostics` | `ba6050b5f2` | 363 |
| `s5-orm-lsp` | `60d47668c4` | 363 |
| `s5-orm-init` | `057e7054f0` | 367 |
| `s5-orm-db-update` | `fbf2528374` | 358 |

Lint and typecheck exit 0 on all eight; tests green on all eight at time of push.

**What is still outstanding on every one of them:** they carry the *pre-squash* base branch merged as history (base `51c1ea15f1`). None has the new `bot/main` (`941195d032`, the #29978 squash) merged. That merge and its re-baseline is the job.

### Real sites deliberately left counted, not suppressed

Three judgment calls, each matching how `main` already treats the same class. Do not suppress these without a ruling:

- **`s5-orm-init`, 4 sites** — target ternaries at `src/orm/init.ts:159,171` and `src/orm/init-inputs.ts:129,162` (`target === 'mongo' ? 'mongodb' : 'postgres'`). Genuine target branching in framework code, and what `no-target-branches` forbids — but a straight port of the same ternaries in `commands/init/`, which `main` counts. They disappear at cutover when the legacy tree is deleted.
- **`s5-orm-db-read`, 1 site** — `src/orm/db/schema.ts:93`, a `case 'collection':`. The term comes from `SchemaViewNodeKind` in `packages/1-framework/1-core/framework-components/src/control/control-schema-view.ts:14`, a framework enum that already carries it on `main`. Pre-existing leak, not introduced here.
- **`errors-next-actions`, 2 sites** — `packages/1-framework/1-core/errors/src/execution.ts:148,150`, next-action prose saying "marker table" and "column". The four identical-class lines above them are counted on `main`.

### Why they all conflict

#29978 was squash-merged, so its commits were replaced by one new commit sharing no history with what the stacked branches contain. Merging `main` therefore conflicts on every file a branch shares with the base. This recurs on **every** merge in the stack — after each PR lands, the remaining branches need another `main`-merge pass.

### How to resolve

- `scripts/lint-framework-vocabulary.mjs`, its `.test.mjs`, `scripts/lint-framework-vocabulary.config.json` and `.agents/rules/no-family-vocabulary-in-framework.mdc` — **main always wins**. `git show bot/main:<path> > <path>` then `git add`. Then re-baseline the threshold to whatever the ratchet reports.
- The old `// framework-vocabulary-ignore: <reason>` comment is dead. Convert each to `// biome-ignore lint/plugin/no-family-vocabulary: <same reason>` on the line above the offending line. Find them with `grep -rn "framework-vocabulary-ignore" packages/`.
- If a branch's count is above 363, judge each new site with `node scripts/lint-framework-vocabulary.mjs --list`:
  - terminal rendering (a rendered table, its column headings, `process.stderr.columns`, the engine's `{ kind: 'table', columns, rows }` block) → false positive, add a `biome-ignore` with a specific reason
  - user-facing help or error prose naming a family on purpose so the user knows what to switch to → legitimate suppression
  - a family name in a framework type, field or identifier → **real leak, do not suppress**, raise it with the operator

Reference suppressions already on `main` via #29978: `src/orm/cli.ts` (`proc.stderr.columns`) and `src/orm/migration/log.ts` (the engine's table block).

## Merge order

**#29977 whenever** (independent) → **#29983** → **#29986** (the only second-level stack). #29980, #29981, #29982, #29984, #29985, #29987 slot in anywhere. Merging in quick succession costs less than spacing them out, because each pass reconciles one squash.

## Patterns the operator settled — apply across every PR in one pass

1. **`NextAction`** — `@prisma/cli-engine/protocol` exports it. Import the named type; never index into another type (`Diagnostic['nextActions'][number]`). 2 sites, both #29984.
2. **Payload types carry no `ok`** — the envelope owns the discriminator. Never `Omit<SomeResult, 'ok'>`; that drops the failure arm. A genuine domain verdict gets its own named field. 1 site, #29984.
3. **Exit codes** — `4` for "ran fine, found something", on `db verify`, `db sign` and `migration check`. `migration check` already shipped `INTEGRITY_FAILED = 4`; the other two used `1`, which the engine now reserves for CLI bugs, so they had to move regardless. Moving them to `0` would silently turn failing CI green. Also split the two overloaded codes so findings return 4 and errors return 2: `CONTRACT.MARKER_REQUIRED` and `MIGRATION.CONTRACT_SPACE_VIOLATION`. **This changes `db verify`/`db sign` from 1 to 4 for existing users — record it in `assets/s2/parity-divergences-s5.md`.**
4. **File access moves to `src/control-api/operations/`** — commands reach it through that seam, never `node:fs` inline. Affected: `contract/infer.ts`, `db/prepare.ts`, `db/verification.ts`, `migration/show.ts`, `init-inputs.ts`, `init-scaffold.ts`. `init-scaffold.ts` does real *write* access, so ask the operator before reshaping it.

## The big outstanding piece: dependency injection

The operator has banned `vi.mock`/`vi.doMock` on any PR. The stack adds **37**; `main` carries **121** more (not yet authorised to sweep). Three categories:

1. **`@internal/config-loader` (10)** — no seam needed. `createTestCli` already takes `config` (seeds the sections) and `loadConfig` (replaces the loader).
2. **The control-API client (11)** — no seam needed. `createControlClient` takes only `{ family, target, adapter, driver, extensions }`, all off `ctx.config`, so seed fake descriptors through `createTestCli({ config })` and the real client builds over test doubles. Precedent: `test/control-api/client.test.ts`.
3. **The rest (~8)** — `operations/*`, `@internal/psl-printer`, `init-emit`. These have no seam. The fix: **make the ORM's command tree a factory that takes its dependencies**; `createTestCli` already accepts a `commands` tree, so tests mount one built with doubles. No engine change needed.

Item 4 of the settled patterns (file access into the operations layer) collapses into this same refactor.

## Traps that have already cost time

- **Test project directories must live inside the repo**, in `packages/1-framework/3-tooling/cli/test/fixture-app/`, via `createTestProjectDir()` in `test/utils/test-project-dir.ts`. Never `mkdtempSync(tmpdir())`. pnpm links per package, and the CLI package does not declare `@prisma/orm-postgres`/`@prisma/orm-mongo`/`dotenv`, so a project anywhere else cannot resolve a scaffolded config. This passes locally (resolution succeeds from `process.cwd()`) and fails in CI. `main` has ~75 more such sites in that test tree — not yet authorised to sweep.
- **Do not pin a package manager in tests.** A test project inside the repo correctly resolves pnpm, and pnpm runs a skill install as `dlx` rather than `npx`, which shifts argument positions too. Which manager installs is the CLI engine's responsibility. Assert the packages requested, never the manager.
- **The CLI suite is order-dependent at the base commit.** `isolate: false`, `fileParallelism: false`, and module-level state in `src/utils/emit-queue.ts`. Four tests in `test/control-api/client.test.ts` alternate pass/fail across identical runs, and the package's 500ms default timeout makes `test/removed-verb-redirects.test.ts` and `test/commands/migrate-show.test.ts` trip under machine load. Re-run once and take the clean result; do not chase these.
- **`gh pr merge --squash` fails** — the repo uses a merge queue that owns the strategy. Use bare `gh pr merge`.
- Shell hooks block `biome` and `vitest` invoked directly, and reject any command containing the other package manager's name **even inside quoted prose**. Use the package's `pnpm test` / `pnpm lint`; spawn the biome binary from a node script the way `scripts/lint-casts.mjs` does.

## Decisions still waiting on the operator

- Sweep `main`'s pre-existing 121 module mocks and ~75 temp-dir sites? (Some of the latter must NOT be converted: `test/setup.ts` and the telemetry suites use a temp dir as `XDG_CONFIG_HOME`, and `test/commands/init/detect-package-manager.test.ts` depends on being outside any workspace.)
- Fix #29978's 12 module mocks — it has now merged, so this is a follow-up PR rather than a pre-merge fix.
- `init` is structurally unable to be family-blind (it picks a target and installs its package, before any adapter exists). Its threshold carries the port's duplicated lines until cutover deletes the legacy `src/commands/init` tree, which itself carries 101 counted lines.
- Whether `--confirm` should imply non-interactivity (engine-side).
- The consent-to-plan binding gap in `db update` (needs a control-API change).
- `prompt.text` never echoes typed characters under a real pty on engine 0.0.9.

## Still to do beyond the merges

- The cutover PR: rewire the bin, delete the commander command tree, packaging, and the divergence file.
- Findings live in `assets/s5/execution-findings.md` (90 entries). Never create background-task chips — the operator has banned them.

## Standing constraints

- `pnpm` only, never `npm`/`npx`.
- Commit with both sign-offs: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.
- Push only to the `bot` remote. Never force-push, never close PRs, never publish.
- Stage explicitly by path. Never `git add -A`. Never stage anything under `wip/`.
- Never use the AskUserQuestion UI.
- Per `.agents/rules/running-tests.mdc`: run a slow command once, redirect to a file, read the file. Do not re-run to grep different lines.
