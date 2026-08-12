# S5 dispatch plan — ORM adoption

Contract: [`../specs/s5-orm.md`](../specs/s5-orm.md). Sequential dispatches unless a round says otherwise. Every unpinned fact is a STOP, never an improvisation.

## Repos, branches and PRs

| Repo | Branch | Base | Content |
| --- | --- | --- | --- |
| prisma/prisma | one branch per PR, each based on the previous until merged | `main` | **A series of PRs, not one.** PR 1 proves the concept (foundations + one command + its e2e tests on the engine harness); each later PR ports a few commands, 2–4k lines, easiest first; the last one is the cutover. Table below. |
| prisma-cli | (external) | `main` | The engine amendments the contract §8 requests are built OUTSIDE this plan: `--config` is PR #138, the package-manager capability is PR #140 and redirect tables are PR #141 (both specs handed to independent implementers), and the cancellation-export and colour-mode amendments (§8 items 4–5) are small follow-ups in the same stream. This plan only **consumes** published engine versions (D0) — it owns no engine branch. |
| prisma-cli | `s5-orm-mount-proof` | `main` | The single mount proof (contract R-S5-24). Lands after prisma/prisma publishes an rc of `@prisma/orm-toolchain` carrying `./cli/family`. |

### The PR series (operator ruling, 2026-08-11)

Ruled: **PR 1 proves the concept end to end with one command; after that, a few commands per PR at 2–4k lines, low-hanging fruit first, with the hard commands (which need new engine components) last.** The commands are ordered by difficulty below, not by grammar grouping. Every PR before the cutover is **purely additive** — the ported code lands beside the commander CLI, which keeps working and keeps owning the `prisma-next` bin — so no PR in the series changes user-facing behavior until the last one. That is what makes them independently mergeable.

| PR | Rounds | Content | Why here in the order |
| --- | --- | --- | --- |
| 1 | D1a + D1b | Foundations (config adapter, `orm` section, control-API parameterization, `normalizeError`, shared-layer `fix`→`nextActions`, journey helper, family, bin) + **`migration list`** ported end to end + its e2e/journey tests rewritten on `createTestCli` | The concept proof. Carries the foundations, so it is larger than the 2–4k target by necessity; every later PR is smaller because this one exists. |
| 2 | D2 | `migration show`, `migration log`, `migration graph` | Offline reads, no database, no prompts. Settles the presentation conventions on the cheapest commands. |
| 3 | D2 (cont.) | `ref set|delete|list`, `format` | Small commands that exercise the parameterized operation layer. |
| 4 | D3 | `contract emit`, `contract infer` | Offline writes; introduces fixture patterns later PRs reuse. |
| 5 | D3–D4 | `migration plan`, `migration new`, `migration status` | Writes plus the first typed diagnostics (`migration status`). |
| 6 | D4–D5 | `db schema`, `db init`, `migrate` | First database-touching commands; establishes the progress-events mapping. |
| 7 | D6 | `db verify`, `db sign`, `migration check` | Completed-with-findings and documented exit codes — the first PR that depends on the merged ADR 239 amendment, and the one that will surface any defect in it. |
| 8 | D7 | `db update` | Destructive consent, the full consent matrix, and the decline-exit-3 interim until §8 item 4 publishes. |
| 9 | D8a + D8b | `lsp` | Needs a `@internal/language-server` API change (injectable streams, exit-code lifetime, `Content-Length` adapter). D8a can be its own earlier PR if it is ready before this slot. |
| 10 | D9 | `init` | The largest command, and the one that needs the package-manager capability (#140) published. Has a documented fallback if it is not. |
| 11 | D10 | **The cutover**: rewire the bin, delete the commander shell / `TerminalUI` / `handleResult` / global-flag resolver, packaging and export-map changes, close out the test migration, write the divergence file | All the risk in one reviewable unit, after every command already works. |
| 12 | D11 | Mount proof in prisma-cli | Needs prisma/prisma to publish first. |

Rules for the series:

- **Size**: aim 2–4k lines changed per PR (PR 1 excepted). If a slot exceeds it, split it at a command boundary rather than growing the PR.
- **Basing**: each PR bases on the previous one while that one is unmerged, and rebases onto `main` once it merges. PR 1 additionally bases on the #29936 branch until that merges.
- **Independence**: because every pre-cutover PR is additive, a PR can merge without the ones after it. Nothing in the series is a half-migration a user could observe.
- **New engine components**: PRs 9 and 10 (and the redirect declaration, whenever #141 publishes) depend on components that do not exist yet. Their rounds carry documented fallbacks; if a component slips, the PR ships the fallback and a follow-up wires the component. Do not block the series on prisma-cli.
- **Verification**: each PR runs the standing list below plus the journey subset for the commands it ports. The full suites run at PR 11.

Commit discipline per the operator's standing rules: explicit staging, `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, push via the `bot` remote, verify the PR is open before pushing to an existing branch.

## Blocking dependencies, and what each one blocks

1. **prisma/prisma #29936** (config diagnostics, `defineConfig` marker, `ControlClient` test double) — blocks D1a. It is already on the working branch; if the slice branches from `main` before #29936 merges, D1a stops.
2. **S4, the ADR 239 amendment** — blocks D6 only (`db verify`, `db sign`, `migration check`, `migration status`). Every other round can proceed while S4 is in flight. If S4 slips, reorder: run D7 and D8 before D6.
3. **`@prisma/cli-engine` published** at the version the slice pins — blocks D1a. Already published at `8.0.0-rc.1`; a later version is needed for #138 (D1a's non-interim shape) and #140 (D9). D0 records which.
4. **Published engine versions carrying §8's amendments** — the `--config` amendment (#138) blocks nothing hard (the interim bin-side pre-parse in D1a works without it, and D1a's precondition checkpoint verifies which world we are in); the package-manager capability (#140) blocks D9's `init` install path (D9 has an explicit fallback checkpoint); the cancellation export and colour-mode amendments (§8 items 4–5) block nothing — both have specified interims (decline exits 2, renderers uncoloured).
5. **STOP rulings.** STOP-9 (reopened: verb redirects) and STOP-12 (per-subsection config blocking) are open with recommendations and build-to defaults; STOP-12's ruling shapes D1a's validator, so raise both in the first operator report, before D1a starts.

## Recording out-of-scope findings

A round that notices something wrong outside its scope writes it into [`../assets/s5/execution-findings.md`](../assets/s5/execution-findings.md) — what is wrong, where, and who should fix it. **Never a background-task chip** (operator ruling): a chip is not durable and nobody can review it. Either the finding lands in a tracked project document or it is not recorded.

## Standing verification (every round, before its commit)

```bash
pnpm build --filter=@internal/cli...          # refresh dist for downstream typecheck
pnpm --filter @internal/cli test              # the touched package's suite
pnpm --filter @internal/cli-telemetry test    # rounds that touch telemetry only
pnpm typecheck                                # root
pnpm lint:deps                                # layering — fix violations, never bypass
pnpm run check:error-reference                # rounds that add or move an error code
pnpm lint                                     # root, before the PR opens
```

Per the repo's running-tests rule: save the output to a file once and read the file; do not re-run a slow suite to grep different lines.

**Journeys are cross-package and run per round, not at the end.** The journey and e2e suites live in the repo-root `integration-tests` package (`test/integration/test/cli-journeys/`, 48 files; `test/integration/test/*e2e*.test.ts`, 28 files) — `pnpm --filter @internal/cli test` never runs them, so the standing list above gives no signal on the files a round just broke. Every round that touches a command used by journeys ALSO runs the journeys for those commands before its commit: `pnpm --filter integration-tests test:journeys -- <file patterns>`. The suite is self-contained (PGlite, forks pool capped at 4, 30 s per-test timeouts, CI retries for a known PGlite flake — `test/integration/vitest.journeys.config.ts`), so the full run is minutes-scale, not seconds; run it in full at D6, at any round that touches `journey-test-helpers.ts`, and at D10, and run the per-command subset everywhere else. `pnpm test:integration` in full closes D10.

## Rounds

### D0 — consume published engine amendments (checkpoint, not a build round)

Building the amendments is external (see the repos table): #138 is landed on prisma-cli `main`, #140 (package-manager capability) and #141 (redirect tables) are specs handed to independent implementers, items 4–5 ride the same stream. D0 is the **consuming** checkpoint: identify the published `@prisma/cli-engine` version the slice pins, and verify what it actually carries.

**Result (checked 2026-08-11): published `latest` is `0.0.3`, and it carries none of the amendments.** Verified by installing the published tarball and inspecting `dist/`: no `config` entry in the shared-flag set, no `runPackageManager` on `Runtime`, no redirect or `COMMAND_MOVED` surface. Consequences, all of which the contract already specifies interims for:

- **D1a pins `0.0.3` and takes the STOP-1 interim**: the prisma-next bin pre-parses and strips `--config <path>` from argv before `cli.run`, and the flag does not appear in engine help. When a version carrying #138 publishes, the pre-parse is deleted in a follow-up.
- **D9 builds `init` on its fallback** unless #140 has published by then (D9's own checkpoint decides).
- **Redirects are not declared in D1a's family**; they are added when #141 publishes (contract STOP-9 already makes the port non-blocking on it).

Re-run this check at the start of D9 and before the PR opens — a newer publish changes the answer, and pinning a version that carries an amendment is always preferred to keeping an interim.

### D1a — foundations: config seam, family skeleton, bin, boundary helpers

The round that hands its structure to every later round. **Precondition checkpoint first**: confirm the pinned engine version carries #138; if not, the STOP-1 interim applies and this bin does the argv pre-parse. Delivers:

- The **bin config adapter** — loads `prisma-next.config.ts` through the ORM's existing c12 loader (async, configDir-relative finalization) and hands the engine a `LoadedConfig` with the whole ORM config nested as the `orm` section (contract §2). This adapter is also what the journey helper reuses.
- `src/orm/config-section.ts` — the `orm` `ConfigSection`: the synchronous structural validator over the raw section value, returning section diagnostics as engine `Diagnostic`s, built to STOP-12's default (whole-section blocking). It never throws (R10); a test drives it with hostile input.
- The **control-API parameterization** (contract R-S5-21): the six operation modules gain explicit `(config, cwd)` parameters; their existing unit tests are updated in the same commit.
- **`normalizeError`** (contract R-S5-31) — the handler-boundary conversion, with tests covering a `fix`-carrying error, a bare throw, and an already-conformant envelope.
- The **`fix` → `nextActions` conversion in the shared layers** as its own commit: `src/utils/cli-errors.ts` (the factory layer every command shares) and `src/commands/json/schemas.ts` (the published `--json` shape, a listed §7 divergence). Per-command `fix:` call sites convert in each command's own round.
- The **journey helper conversion** (`test/integration/test/utils/journey-test-helpers.ts`): `runCommand` moves from commander factories + `process.chdir` + `--config` to a per-step `createTestCli`, evaluating the journey's config file through the bin adapter and re-seeding the `TestCli` when a step (like `init`) writes config. This lands here — not D2 — because every later round's journeys depend on it.
- `src/orm/family.ts` — `defineCommandFamily` with the section, an empty command map, and the docs base URL.
- `src/orm/cli.ts` + `src/bin.ts` — the prisma-next bin on `createCli`, assembling `Runtime` from `process` and wiring `onSettled` telemetry.
- `src/orm/flags.ts` — the shared `--db` flag spec constant (R-S5-5).
The `telemetry status|enable|disable` trio is NOT part of this round or this slice (R-S5-19, ruled 2026-08-11): the unified binary already has them and the prisma-next copies die with the commander shell. Telemetry reporting (the `onSettled` wiring above) stays.

The old commander program still runs in this round; both bins coexist until D10. Verification adds: the bin starts on plain Node from a packed tarball.

### D1b — first command, as the template

One command ported end to end as the pattern: **`migration list`** — offline, no prompts, and its config arrives through `ctx.config` plus the parameterized operations, so the template exercises the D1a seams without `format`'s operation-layer config load being the very first thing ported. Its file layout, presentation shape (including R-S5-9's `stdout`-presentation convention for its table), and test file ARE the template every later round copies. `format` moves to D2.

### D2 — offline read commands and the presentation conventions

`format`, `migration graph` (with R-S5-17's `--dot` handling), `migration show`, `ref set|delete|list`. All offline, no database, no prompts — the cheapest place to settle the remaining presentation conventions (blocks on stderr, `stdout` payload lines, the rich-renderer `stdout` presentation per R-S5-9). The error-code work this round once carried is gone with the dropped renames (contract R-S5-13); error-reference edits now ride whichever round deletes or adds a code, with `pnpm run check:error-reference` in that round's verification.

### D3 — offline write commands

`contract emit` (with the double config load deleted), `migration plan`, `migration new`. Introduces progress and step events for the seed phase. Heaviest write footprint in the CLI; the fixtures for these tests are the ones later rounds reuse.

### D4 — database read commands

`db schema` (discarded inference call removed), `contract infer` (staged-rename write), `migration log` (dotted-code fix), `migration status` (diagnostics at exit 0 — the one part of D4 that depends on S4's `Diagnostic` shape; if S4 has not landed, hold `migration status` for D6). Drives the `ControlClient` test double from #29936.

### D5 — `migrate` and `db init`

The two long-running additive commands. Establishes the progress-adapter-to-events mapping the whole migration surface uses. No prompts, no consent.

### D6 — the diagnostic commands (blocked on S4)

`db verify`, `db sign`, `migration check`, and `migration status` if it was held from D4. Completed-with-findings, documented exit codes 4, diagnostics carrying the codes they carry today. Deletes `migration check`'s `exitOverride` and try/catch wrapper, `db verify`'s `--quiet` override, and the three commands' escapes from `handleResult`. This round proves the ADR 239 amendment against real commands and is where a defect in the amendment surfaces — budget time to return findings to S4 rather than working around them. Named docs deliverable (contract §7, §10): rewrite `error-reference.md`'s preamble exit-code sentence and the per-code notes for every code that now appears on a completed-with-findings settlement at exit 4 (`CONTRACT.MARKER_*`, `CONTRACT.TARGET_MISMATCH`, the 19 `MIGRATION.CHECK_*` codes).

### D7 — `db update` and consent (blocked on STOP-5)

The consent path: `prompt.consent` with the ruled token, `--confirm` non-interactively, decline at exit 3, and the deletion of the re-invocation. The full consent matrix is the test: interactive grant, interactive decline, Ctrl-C, non-interactive without `--confirm`, non-interactive with the right token, non-interactive with a wrong token, `--yes` alone (which must NOT grant).

### D8 — `lsp` (two-part round; D8a can run early and in parallel)

Not a small round: it carries a cross-package API change (contract §4 `lsp`).

- **D8a — the `@internal/language-server` API PR.** `startServer` gains an injectable connection/stream parameter and returns a promise resolving to an exit code on client disconnect, plus the byte-stream adapter from the engine's `InputStream`/`OutputStream` to LSP's `Content-Length` framing. Its own PR with its own review cycle; it has no dependency on any other round and SHOULD land early, in parallel with D2–D7.
- **D8b — the server command.** `defineServerCommand` over the new API, plus the first test that ever starts the language server (initialize/shutdown over the harness's injected streams).

### D9 — `init` (blocked on the published capability, with a fallback checkpoint)

The largest single command: nine flags, six prompts, a precondition phase, package installs through the capability, and the three completed-with-findings exit codes. The prompt matrix and the install matrix are separate test suites. `--force` removal and the `--skip-install`/`--skip-skills` renames land here with their divergence entries. **Fallback checkpoint**: if the package-manager capability (#140) is not in a published engine version when D8 completes, do not block the slice — build `init` with `--skip-install`-only behavior and the install commands as next actions (contract §6's stated fallback), and wire the capability as a follow-up when it publishes.

### D10 — retirement, test migration closure, and the divergence file

- Delete everything in contract R-S5-29; enumerate the survivors in the PR body.
- Point `bin.prisma-next` at the new entry and drop the `./cli` and 18 `./cli/commands/*` subpaths — both are edits to the publish-surface generator `packages/0-shared/publish-surface/src/shells.ts` (contract R-S5-27), not hand edits to the toolchain's `package.json`. Delete `commander` and `@clack/prompts` from `@internal/cli`; confirm `clipanion` and the migration-file CLI are untouched, with a test asserting its 0/1/2 scheme is unchanged.
- Finish the test migration: every remaining file in `@internal/cli`'s `test/` and in the `integration-tests` package (`test/integration/test/cli-journeys/` — 48 files, `test/integration/test/*e2e*.test.ts` — 28 files) is migrated, replaced, or deleted with its reason recorded. Add the spawned-binary smoke suite (STOP-10).
- Docs closure: the ADR 239 `CLI`-row ownership note and the `plan.md`/`s2-overview.md` supersession edits (contract §2, §10).
- Write `../assets/s2/parity-divergences-s5.md` with a per-command conformance row and every contract §7 entry.
- Full verification: `pnpm build`, `pnpm test:all`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm run check:error-reference`, `pnpm check:publish-deps`, `pnpm fixtures:check`.
- Review loop (architect + principal engineer), findings fixed, PR opened non-draft.

### D11 — mount proof (prisma-cli, after prisma/prisma publishes)

Mount `ormCommandFamily` from the published `@prisma/orm-toolchain` in prisma-cli's shell, prove one ORM command runs end to end through it, and record the `init` collision (STOP-2) as a blocker for S7's full mount rather than resolving it here. **Includes the lockstep engine-pin bump**: prisma-cli's shell pins `@prisma/cli-engine` as `workspace:8.0.0-rc.1` (`packages/cli/package.json`), while the published toolchain pins an exact registry version — if the two differ, pnpm resolves a second engine copy and the one-module-instance goal of contract R-S5-28 silently fails. Bump the workspace pin to the identical version in this round.

## Test-rewrite strategy

The current surface is roughly 111 unit files in `packages/1-framework/3-tooling/cli/test/`, plus — in the separate repo-root `integration-tests` package, NOT under the CLI package — 48 journey files in `test/integration/test/cli-journeys/` and 28 process-level `*e2e*.test.ts` files in `test/integration/test/`, and 10 telemetry files. The rewrite is not a mechanical translation; each round carries its own commands' tests, and D10 closes out whatever is left.

**Unit tests (`test/commands/`, `test/control-api/`, `test/utils/`).** Tests of the control-API operation layer and the util modules survive largely unchanged — S5 does not rewrite `src/control-api/**`. Tests of commander command factories are deleted and replaced by `createTestCli` tests in the same round that ports the command. Tests of `global-flags`, `terminal-ui`, `result-handler`, `help` formatters and `suggest-command` are deleted with their modules.

**Output tests (`test/output*.test.ts`, the golden files).** These pin the current human and json rendering. The json shapes are contract (R-S5-8) and their assertions move onto the envelope's `result`. The human byte pins do not survive: one small golden suite per output surface replaces them, and everything else asserts semantically (R-S5-20).

**Journeys.** They already run in-process, importing command factories and calling `process.chdir` — which is why their vitest config needs `pool: 'forks'`. Under `createTestCli` they pass `cwd` instead, so the chdir goes away and with it the forks constraint. The migration is **helper-heavy, not mechanical**: `createTestCli` takes config at construction as a pre-evaluated record and `run()` has no config option, while every journey today writes a real `prisma-next.config.ts` into a temp dir and passes `--config` on every step. The converted helper in `test/integration/test/utils/journey-test-helpers.ts` therefore evaluates the journey's config file itself — through the bin's config adapter (D1a), the same code path production uses — and builds a fresh `TestCli` per step, re-loading when a step (`init`) writes or changes the config. Once the helper does that, the per-journey edits ARE mechanical: keep every fixture and database handle as-is, change assertions from captured stdout to envelope, events and exit code, and import the family from `@internal/cli`'s `.` export (contract R-S5-26) instead of deep relative paths. The helper lands in D1a so every later round's journeys convert cheaply. The journeys that spawn `tsx` for authored `migration.ts` files are untouched — that is the clipanion CLI, out of scope.

**Process-level e2e.** `cli.emit-cli-process.e2e.test.ts` and its siblings that use `execFile` become the seed of the spawned-binary smoke suite (STOP-10); the rest convert like journeys.

**Telemetry tests.** `cli-telemetry/test/cli-e2e.test.ts` spawns the real binary against a mock backend and asserts four scenarios. Three port unchanged. The fourth — "a command that crashes after the preAction hook still produces a row" — cannot port: with `onSettled`, a crashed run before settlement emits nothing by design. Replace it with its inverse: a run that errors and settles produces a row carrying the exit code. `__telemetry-crash-test` is deleted with it.

## Completeness

Every contract acceptance box maps to a round: family and exports → D1a, D10; control-API parameterization and `normalizeError` → D1a; deletions → D10; diagnostic commands and the error-reference preamble rewrite → D6; `init` (with its fallback checkpoint) → D9; `lsp` and the language-server API change → D8a/D8b; tests and divergence file → every round plus D10; telemetry → D1a, D10; docs supersessions and the ADR ownership note → D10; mount proof and the engine-pin lockstep bump → D11; migration-file CLI untouched → D10's assertion.

## The five highest-risk items

1. **`init` (D9).** Nine flags, six prompts, a precondition phase, four package-manager invocations, a pnpm-to-npm fallback keyed on pnpm error codes plus two message regexes, and three exit codes changing meaning — all depending on an engine capability that is ratified (STOP-3) but built externally and not yet published. It is the single biggest command in the CLI and the only one blocked on new engine work; the D9 fallback checkpoint is the pressure valve.
2. **The ADR 239 amendment arriving late or wrong (D6).** Four commands and the whole completed-with-findings model depend on it. A defect found in D6 has to go back to S4 rather than be worked around, and S4 is in another repo's stream.
3. **The test rewrite's sheer volume.** Roughly 187 test files, of which the 48 journeys carry the real behavioral coverage. If the `journey-test-helpers` conversion in D1a is not clean — and it is helper-heavy, not mechanical, because the helper must evaluate config files itself — every later round pays for it, and the temptation to keep byte assertions (which the engine's output deliberately changes) will show up as dozens of small failures with no single cause.
4. **One PR of this size.** The slice touches every command, deletes the shell, rewrites the tests and changes a published export map. It will be very large, the review loop is expensive, and a mid-flight rebase against `main` (which is actively moving — #29936 and #29919 both landed recently) is where silent regressions enter.
5. **Cross-repo sequencing.** The externally-built engine amendments must publish, inside S3's contention window on the same package, before D9's capability path can start (D9's fallback checkpoint caps the damage); D11 needs prisma/prisma to publish before it can run, and carries the engine-pin lockstep bump; and the `init` name collision (STOP-2) reaches back into an already-shipped S2 deliverable. Three repos' release timing has to line up, and none of it is automated until S7.
