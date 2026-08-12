# S5 — ORM adoption (slice contract)

S5 ports the ORM CLI (`prisma-next`, `@internal/cli` in prisma/prisma) onto `@prisma/cli-engine`, exports it as the `orm` `CommandFamily`, and rewrites the `prisma-next` binary as a thin `createCli()` composition of those same command definitions. The commander shell in prisma/prisma is deleted in the same slice.

Normative sources, in precedence order: (1) this contract's mapping rules and per-command decisions; (2) the ORM inventory [`../assets/s5/orm-cli-inventory.md`](../assets/s5/orm-cli-inventory.md) for every current-behavior fact — port behavior is the inventory's record EXCEPT where a rule below changes it, and every such change is a divergence-list entry; (3) the shipped engine source in `packages/cli-engine/src/` (which supersedes the v8 draft wherever the two disagree — the draft is a design record, the code is the surface); (4) the v8 draft [`../assets/engine/engine-interface-draft.ts`](../assets/engine/engine-interface-draft.ts) for intent. An unpinned fact is a **STOP** (§9), never an improvisation.

**Inventory corrections carried into this contract.** The inventory was written across a branch switch and two of its claims no longer hold. Both are corrected here and must not be carried forward:

- **The error-code collapse is fixed.** `errorRuntime` no longer hard-codes `CONTRACT.VERIFY_FAILED`; it takes an explicit dotted code (`packages/1-framework/1-core/errors/src/execution.ts:270`, landed with TML-3180 / prisma/prisma#29919). All ten codes the inventory reported as living only in `meta.code` are real envelope codes today, all under `MIGRATION.*` (`cli/src/utils/cli-errors.ts:86,105,125,144,176,188,249,279,343,402`), plus four more the inventory did not list (`MIGRATION.REF_NOT_FOUND`, `MIGRATION.REF_AMBIGUOUS`, `MIGRATION.REF_WRONG_GRAMMAR`, `MIGRATION.REF_INVALID_FORMAT`). Inventory §3.3, §3.3.7 and §3.7 item 18 are stale in this respect; the port preserves the codes as they are today rather than promoting anything.
- **The undotted codes are not user-visible.** `RUNNER_FAILED`, `PLANNING_FAILED`, `CONTRACT_SOURCE_INVALID`, `PROVIDER_THROW`, `CONTRACT_VALIDATION_FAILED` and `EMIT_FAILED` are control-API failure discriminants (`cli/src/control-api/types.ts:402,404,478,521-523`), translated by commands before they reach a user. Inventory §3.7 item 19 overstates the problem; the port keeps them as internal discriminants and does not rename them.

One further correction: `db update` does not re-execute the whole command after an accepted prompt. It re-invokes `executeDbUpdateCommand` with `{...flags, yes: true}` (`cli/src/commands/db-update.ts:286-289`). The re-invocation still does not port (R-S5-14).

## 1. Scope

**In scope (22 ported commands).** `init`, `migrate`, `format`, `lsp`; `contract emit|infer`; `db verify|init|update|schema|sign`; `migration plan|new|show|status|log|list|graph|check`; `ref set|delete|list`.

**In scope (repo work).** The `orm` config section and its validator; the `orm` `CommandFamily`; the `prisma-next` bin rewritten on `createCli()`; deletion of the commander shell, the global-flag resolver, `TerminalUI`, and the `handleResult` funnel; the enumerated control-API parameterization (R-S5-21); the `normalizeError` boundary helper (R-S5-31); the `@internal/language-server` `startServer` API change and stream adapter (§4 `lsp`); the rewrite of the CLI test suites onto `createTestCli`; the package and export-map changes in `@internal/cli` and `@prisma/orm-toolchain`, including the generated publish surface in `packages/0-shared/publish-surface/src/shells.ts`; the exact-pin dependency on the published `@prisma/cli-engine`.

**Out of scope.**

- **The clipanion migration-file CLI** (`cli/src/migration-cli.ts`) — not retired, not ported, not touched. Its 0/1/2 exit scheme survives, including exit 1 meaning "expected runtime failure". It keeps its clipanion dependency and its `./cli/migration-cli` published subpath. Nothing in this contract applies to it.
- **`telemetry status|enable|disable` as ORM commands.** These already ported into prisma-cli as shell-owned commands in S2a. They do not enter the `orm` family. What S5 does with them is R-S5-19.
- **`__telemetry-crash-test`** — deleted, no successor (the engine's `onSettled` firing after settlement makes the scenario it guarded structurally impossible to lose).
- **Mounting the `orm` family in the unified `prisma` shell beyond the single integration proof** — the full tree with its build-time completeness check is S7. S5 delivers the family and one mount proof (R-S5-24).
- **The npm publisher handoff for `prisma-next`**, the `prisma-next.config.ts` → `prisma.config.ts` codemod, docs-site updates, and deprecation of the `prisma-next` binary. Ecosystem cutover is post-rc work per the project spec.
- **Grammar regularization** — every naming irregularity the inventory §7 lists (`db schema` vs `schema show`, `migrate` vs `migration`, `ref delete` vs `remove`, `migration list` vs `migration graph`) is recorded and NOT acted on. Renaming is a separate ruling; S5 ports the names as they are, with one exception under STOP-2.

## 2. Dependencies and preconditions

| Dependency | What S5 needs from it | Blocking |
| --- | --- | --- |
| prisma/prisma #29936 (config per-section diagnostics, `defineConfig` version marker, `ControlClient` test double) | The `orm` section validator is built ON the diagnostics-returning loader; the test double is what the rewritten command tests drive | All command work |
| S4 — ADR 239 amendment (completed-with-diagnostics, documented exit codes, `fix` → typed `nextActions`) | The semantics `db verify`, `db sign`, `migration check` and `migration status` settle under | The four diagnostic commands only (R-S5-11) |
| `@prisma/cli-engine` published at an exact version | The runtime dependency of `@internal/cli` and `@prisma/orm-toolchain` | All command work |
| Engine amendments requested by this contract (§8) | Shell-level `--config`; the package-manager capability; the cancellation-error export; the rendering surface | `init` (capability); `--config` and the rendering surface are both published and adopted at 0.0.8; the cancellation export blocks nothing — it has a specified interim (R-S5-14) |

S5 builds ON #29936 as follows. `Runtime.config` is **bin-supplied** (`cli-engine/src/runtime.ts:96-99`); the engine's own loader is a convenience hard-coded to `prisma.config.ts` and the `$prismaConfig` marker, which is not the file this bin reads. So the **prisma-next bin owns the load**: it calls the ORM's existing c12 loader (`config-loader/src/load.ts`, name `prisma-next`) — asynchronous, and finalizing paths against the config file's directory (`finalize-config.ts`) — and adapts the result into the `LoadedConfig` it hands the engine, with the **whole ORM config nested as the single `orm` section** (the engine models one section per family; the ORM's `contract`/`db`/`migrations`/… become subsections of `orm`). The split of responsibilities is deliberate: **async load + configDir-relative finalization live in the bin adapter; the `orm` section validator is the synchronous structural check** the engine's `ConfigSection.validate` contract requires (raw value in, section-tagged diagnostics out, never throws — R10), re-homing the ORM's validation logic minus anything that needs the filesystem or the config directory. #29936's per-section blocking (`requireConfigSections`) lets a command ignore diagnostics on sections it does not read; that granularity does not survive single-section nesting, and the whole `orm` section blocks every `orm` command (STOP-12, ruled). The `defineConfig` version marker #29936 added governs the `prisma-next.config.ts` file the prisma-next bin reads; the engine's own `$prismaConfig` marker governs `prisma.config.ts` under the unified shell — this split is an R10 deviation and is recorded as a written exception the same way §6 amends R13's text, not silently tolerated. **The 1b promise S5 does NOT deliver**: nothing in S5 makes a classic Prisma 7 config file fail with a named migration path in prisma/prisma — that check belongs to the unified shell's loader in prisma-cli, which already has it. S5 also does not deliver 1b deliverable 3 beyond consuming it: the `ControlClient` test double is #29936's, and S5 only extends its fixtures where a rewritten test needs a seam the double lacks.

**Supersessions.** Three earlier normative statements contradict this contract and are superseded by the operator rulings recorded here: `plan.md`'s S5 outline includes "retiring the clipanion migration-cli" (superseded — §1 keeps it untouched) and porting `telemetry` inside the family (superseded — R-S5-19 keeps those commands shell-owned); `specs/s2-overview.md` standing ruling 7 retires `@internal/cli-telemetry` at S5 (superseded — R-S5-30 defers it to cutover). This contract is the operative text; amending those two documents rides the port PR's checklist (§10) rather than being edited out-of-band.

## 3. Global mapping rules

These apply to every command in scope. Each is a rule the implementer applies, not a judgment call.

**R-S5-1 — Command kinds.** Every ported command is a **result command** (`defineCommand`) except `lsp`, which is a **server command** (`defineServerCommand`). No ORM command is a session command: `migrate`, `db init` and `db update` are long-running with progress, but they settle with a result, and progress is `report()` events, which result commands have.

**R-S5-2 — Shared flags are engine-owned and are not redeclared.** `--format`, `--json`, `--log-level`, `-v/--verbose`, `-q/--quiet`, `-y/--yes`, `--confirm`, `--interactive/--no-interactive`, `--color/--no-color` come from the engine on every non-server command (`cli-engine/src/execution/shared-flags.ts:30`). The ORM's `addGlobalOptions` and `src/utils/global-flags.ts` are deleted. `--format pretty` becomes `--format human` (the engine's value). `--trace` and `PRISMA_NEXT_TRACE` are dropped; its only distinct behavior — dumping `meta` as JSON — folds into `--log-level verbose`.

**R-S5-3 — Format auto-selection is unchanged in effect but engine-owned.** The engine selects `json` when stdout is not a TTY (`shared-flags.ts:154-159`), which is what the ORM does today (`global-flags.ts:67-69`). This is the one place where the ORM's undocumented behavior and the engine's rule agree; it is documented in the divergence list as now-specified rather than accidental.

**R-S5-4 — Per-command `--config` does not port.** Config discovery belongs to the shell, and the engine loads the file when a command needs it. No ported command declares `--config`: it is an engine shared flag from 0.0.5, and the bin wires `Runtime.loadConfig` so the engine hands the named path straight to the ORM's own loader. The bin-side argv pre-parse interim STOP-1 allowed is gone, deleted when the pin moved to 0.0.8. Every `--config` removal is still one divergence entry per command.

**R-S5-5 — `--db <url>` stays command-owned.** It is declared from one shared spec constant (`orm/flags.ts`, `dbFlag`) on exactly the commands that have it today, so its brief and placeholder cannot drift. Resolution order is unchanged: the flag, then `config.db.connection`, then `CONFIG.DB_CONNECTION_REQUIRED`.

**R-S5-6 — Command booleans have no negated form.** The engine's `flag.boolean` produces a single `--name` defaulting to false (`cli-engine/src/execution/stricli-adapter.ts:61`). `init --no-install` becomes `--skip-install` and `init --no-skill` becomes `--skip-skills`. Divergence entries.

**R-S5-7 — Channels.** Human mode: blocks, next-action lines and diagnostics go to stderr; the `stdout` presentation is the only stdout write. Every place the ORM writes human prose to stdout — `migrate --show`'s non-JSON branch (`migrate.ts:922`), the three `telemetry` commands, `ref set|delete|list`, `migration check`'s result lines — loses that behavior; the payload lines move to the `stdout` presentation and the prose to blocks. Divergence entries.

**R-S5-8 — Presentation.** Each command supplies `human` (blocks), `stdout` (the payload lines a pipe receives), `json` (the current `--json` document, unchanged in shape unless a rule below changes it) and `next` (typed next actions, replacing the ORM's `fix` prose). The current `--json` document shapes in `src/commands/json/schemas.ts` and `src/utils/formatters/*` are the contract for `json`; a shape change is a divergence entry and must be listed.

**R-S5-9 — Rich renderers ship as `human` blocks whose spans carry tone (rewritten 2026-08-11, superseding the `stdout` rule).** The original rule sent six renderers — the migration graph tree, the `migration status` matrix, the `db verify` tree, the `db schema` tree, the migration list table and the log table — to `Presentations.stdout` as pre-rendered, uncoloured strings, because engine 0.0.3 offered no block that could hold box-drawing (`list` glues `"- "` onto every item) and exposed no colour resolution to a handler. Engine 0.0.8 removes both reasons, and the `stdout` rule was wrong on its own terms: `stdout` is the machine channel, and a drawing's consumer is a human.

Each renderer now ships as `human` blocks:

- A tree, matrix or other box-drawn rendering becomes a **`drawing`** block, whose `lines` are `Span[]` — text plus the tone it means. `drawing` exists for exactly this: two-dimensional structure the engine cannot derive, printed verbatim.
- Tabular output becomes a **`table`** block. The engine sizes every column to its widest cell, so the renderer stops hand-padding.
- A key/value header becomes a **`fields`** block, with `rail: true` where it is the command's header card.
- A glyph/label key (`--legend`) is a drawing, not a list: it is glyph/label pairs laid out in columns, and a `list` block would put a bullet on every line of it.

**No handler emits an escape sequence.** A span carries a tone and the engine paints it, so the same output re-themes or strips to plain text without re-rendering, and colour cannot disturb a column width (the engine measures `span.text`). A renderer that needs to know its room reads `ui.width` — stderr's terminal width, or `Number.POSITIVE_INFINITY` when stderr is not a terminal. The engine prints an overrun unmodified, so no renderer truncates defensively.

The ORM's colour vocabulary maps onto `Tone` as: cyan identifiers → `identifier`; dim gutters and connectors → `structure`; dim secondary text → `muted`; green refs and markers → `ref`; yellow warnings → `warn`; bold emphasis → `emphasis`; the six-hue branch-lane rotation → `color-1`..`color-6`; the on-path highlight → `highlight`. Two shade distinctions do not survive, because a span carries exactly one tone: the source and destination contract hashes are both `identifier` (the ANSI styler dims one and brightens the other), and a bold-green name — the `contract` marker, the active ref — is `emphasis` rather than both. Both are divergence entries.

**`Presentations.stdout` keeps its real job: machine-consumable data lines.** A command supplies it only where it has such lines. Among the ported commands only `migration graph --dot` does: Graphviz DOT is a document another program reads. `migration list`, `migration graph` without `--dot`, `migration log` and `migration show` supply no `stdout` presentation at all, so human mode writes nothing to stdout and a pipe sees an empty stream where it used to see a tree.

**R-S5-10 — `needs`.** `needs.config` is the `orm` section on every command that reads config today (all except `lsp`, per R-S5-22). `needs.credentials` is never used — this CLI has no platform authentication. `needs.interaction` is declared by no command: `init` prompts but must still run non-interactively with flags, and `db update` must run non-interactively with `--confirm`. `needs.dependencies` is not used; the driver and target packages are reached through the config's descriptors, not resolved by specifier.

**R-S5-11 — Completed-with-findings.** `db verify`, `db sign` and `migration check` settle as COMPLETED envelopes carrying `diagnostics` and a documented exit code; they never throw for their own documented outcome. `migration status` already carries findings inside a successful result and keeps exit 0. The documented codes are:

| Command | Code | Meaning |
| --- | --- | --- |
| `db verify` | 4 | verification completed and found drift or marker findings |
| `db sign` | 4 | schema verification failed, so no signature was written |
| `migration check` | 4 | integrity check completed and found failures |
| `init` | 4 | scaffold written; dependency install failed |
| `init` | 5 | scaffold written and installed; contract emit failed |
| `init` | 6 | scaffold complete; agent-skill install failed |

No other command documents an exit code. This depends on S4 landing (§2).

**R-S5-12 — Exit codes elsewhere.** 0 completed; 1 bug only; 2 errored; 3 user cancel; 130/143 signals, all engine-owned. Concretely: `db verify`'s exits converge on 4 from two directions — the schema-drift branches exit 1 today (`db-verify.ts:592,631`) while marker/target findings are structured errors funnelled through `handleResult` to exit 2, and both become exit 4 with diagnostics; `db sign`'s exit 1 becomes exit 4; deleting `migration check`'s catch-all wrapper (`migration-check.ts:158-166`, which maps any unexpected throw to exit 2) moves unexpected-throw to the engine's exit 1, which is what exit 1 means; `db update`'s declined destructive prompt moves from 2 toward 3 (interim per R-S5-14); `init`'s cancel stays 3 via `CLI.PROMPT_CANCELLED`; `init`'s precondition codes stay 2; `init`'s invalid-output-document 1 stays 1 as an engine-settled internal error; no-argument and bare-group invocations become engine-owned help behavior (STOP-9); the ORM's 130-only signal handling becomes 130 for SIGINT and 143 for SIGTERM. The clipanion CLI's scheme is untouched (§1).

**R-S5-13 — Error codes.** Dotted codes port verbatim in **every** namespace, `CLI.*` included. ADR 239's namespace table defines `CLI` as "Invocation: flag parsing, output format, `init`, command usage" — exactly what these codes are — and registers no other CLI-tooling namespace (`ORM` is taken by the runtime query surface, `INIT` does not exist), so nothing moves: the thirteen `CLI.INIT_*` codes, `CLI.FILE_NOT_FOUND`, `CLI.INVALID_VERIFY_MODE`, `CLI.UNEXPECTED`, `CLI.FILE_WRITE_FAILED`, `CLI.PROJECT_MANIFEST_INVALID` and `CLI.PROJECT_MANIFEST_UNREADABLE` all keep their spellings. The engine mints its own `CLI.*` codes (`CLI.UNKNOWN_COMMAND`, `CLI.INVALID_ARGUMENTS`, `CLI.PROMPT_CANCELLED`, `CLI.INTERNAL_ERROR`, …); that two producers now share the namespace is recorded as fact, and ADR 239's `CLI` table row gains an ownership note saying so — a docs-only change that rides the port PR. What does change:

| Today | Ports as |
| --- | --- |
| `CLI.INVALID_OUTPUT_FORMAT`, `CLI.OUTPUT_FORMAT_CONFLICT`, `CLI.UNKNOWN_FLAG`, `CLI.CONFIG_ARG_MISSING_PATH` | no successor — the engine raises `CLI.INVALID_ARGUMENTS` for all four |
| `CLI.JSON_FORMAT_UNSUPPORTED` | deleted (declared, never raised) |
| — | new: `CLI.CONTRACT_ARG_CONFLICT` (`db sign`, §4) |
| `CLI.UNEXPECTED` at `migration-log.ts:64` | `MIGRATION.TARGET_UNSUPPORTED` (a fix, §4 `migration log`) |

`CLI.INIT_REINIT_NEEDS_FORCE` keeps its spelling even though `--force` is gone; its error-reference prose is rewritten to describe the consent requirement (§10). `docs/reference/error-reference.md` is updated in the same change as each code change and `pnpm run check:error-reference` passes. `CLI.UNEXPECTED` survives only as the wrapper for expected-but-uncategorized runtime failures (driver connect errors, with `sanitizeErrorMessage` applied so connection strings never leak); a genuine programming error is no longer wrapped — it propagates and the engine settles it as `CLI.INTERNAL_ERROR`, exit 1.

**R-S5-14 — Consent.** `-y/--yes` accepts declared prompt defaults and never grants consent. It stops meaning "accept data loss" in `db update`. Destructive consent is `prompt.consent` with a token; the non-interactive form is `--confirm <token>`, engine-owned. No command invents a consent-skipping flag, so `init --force` does not port. The tokens are: `db update` → the database name (STOP-5); `init` re-scaffold → the basename of the working directory. The `db update` prompt-rejection re-invocation is deleted — one invocation asks, receives the answer, and continues or cancels. Declining targets exit 3, but the engine reserves the only route there: `settleErrored` maps exactly the code `CLI.PROMPT_CANCELLED` to 3 (`execution/settlement.ts:97`), the constructor lives in `execution/prompts.ts` and is not exported, and R-S5-13 forbids the ORM minting an engine code. §8 item 4 requests the export; **until it is published, a declined consent settles as the handler's own errored code at exit 2** (`CLI.INIT_USER_ABORTED` for `init`, a `db update` decline code for `db update`), moving to 3 when the amendment ships. Both states are divergence entries.

**R-S5-15 — Prompts consult stdin.** Interactivity is the engine's, derived from TTY stdin outside CI and overridden by `--interactive/--no-interactive` (`shared-flags.ts:138,150`). Today interactivity is derived from **stdout** for every command, not just `db update`: the shared `parseGlobalFlags` reads `process.stdout.isTTY` (`global-flags.ts:174`), and `db update` consumes that flag at `db-update.ts:267-273`. The engine's stdin-derived default therefore changes behavior globally (stdout piped + stdin TTY becomes interactive; stdin piped + stdout TTY stops being interactive) — one **global** divergence entry (§7), not a per-command note. The decline-versus-Ctrl-C ambiguity in `ui.confirm` disappears: cancel is `CLI.PROMPT_CANCELLED`, exit 3; decline is `false`.

**R-S5-16 — Behavior that is preserved as-is, deliberately.** `contract infer` overwriting an existing `contract.prisma` with only a warning, and `ref delete` removing a ref with no confirmation, both stay as they are. Both are consent candidates; adding a prompt is a behavior change nobody asked for. Ruled acceptable as designed (STOP-8); recorded as plain parity, no follow-up.

**R-S5-17 — `migration graph --dot`.** `--dot` stays a command-owned boolean; the engine reserves `--format`, so DOT cannot become a format value. The precedence quirk is removed instead: with `--dot`, the DOT text is the command's `stdout` payload in human mode, and in json mode the envelope's `result` gains a `dot: string` field alongside the existing graph document. `--dot` with `--legend` stays an error; `--dot` continues to ignore `--space`. Divergence entry.

**R-S5-18 — Telemetry.** Reporting stays byte-identical on the wire, with the same per-user config file and installation id, **including the two config-derived fields** (`databaseTarget`, `extensions`) the ORM sender computes from the loaded config — the prisma-cli copy dropped those fields (S2 Q7), and this bin does not follow it; where the two senders disagree, the ORM sender's shape wins here (see the STOP-4 correction). The event fires from the bin's `onSettled` hook, after settlement, so it now carries the exit code — the ORM's `preAction` timing (`cli.ts:82-88`) does not port. The consequences, recorded in the divergence list: a run killed before settlement emits nothing, and a run that never reaches a mounted command (unknown command, usage error, `--help`, `--version`) also emits nothing — `onSettled` never fires for either (`cli-engine/src/run-summary.ts`) — where the ORM emitted before the command ran. The `telemetry` group exemption (`utils/telemetry.ts:156-158`) becomes unnecessary and is deleted — with `onSettled`, `telemetry disable` disables before any event for that run is sent. Tests never contact the production endpoint: the mock endpoint fixture plus `PRISMA_NEXT_DISABLE_TELEMETRY=1` in the package's vitest config.

**R-S5-19 — The `telemetry` commands do not port (operator ruling, 2026-08-11).** `telemetry status|enable|disable` are not rebuilt in prisma/prisma. They already exist on the prisma-cli side (ported in S2a as shell-owned commands) and the unified binary serves them; the prisma-next bin's commander copies die with the shell at cutover, and the `prisma-next` package name is handed to prisma-cli at that point (rollout plan step 3), so its users get the unified binary's commands. Consequence to record as a divergence: between the cutover and the name handoff, the prisma-next binary has no telemetry subcommands — the documented environment-variable opt-outs (`PRISMA_NEXT_DISABLE_TELEMETRY`, `DO_NOT_TRACK`) still work throughout. Telemetry **reporting** is unaffected (R-S5-18): the bin wires the engine's `onSettled` hook to `@internal/cli-telemetry`. See STOP-4 for that implementation.

**R-S5-20 — Tests are semantic-first.** Every command is tested through `createTestCli` from `@prisma/cli-engine/testing`, asserting the envelope, the presented data, the events, and the exit code — not output bytes. One small golden suite per output surface pins human rendering and channel discipline globally (the prisma-cli precedent is `packages/cli/tests/v8-golden-rendering.test.ts`). Database-touching commands drive the `ControlClient` test double from #29936; the journeys that need a real database keep their PGlite/mongodb-memory-server harness and drive it through `createTestCli`'s `cwd` option instead of `process.chdir`.

**R-S5-21 — Files.** Command modules live at `packages/1-framework/3-tooling/cli/src/orm/<group>/<command>.ts`, one command per file, definition and handler colocated, following the prisma-cli precedent (`packages/cli/src/v8/<group>/<command>.ts`). Shared per-group presentation helpers are named sibling modules. The family is built in `src/orm/family.ts`; the bin composition in `src/orm/cli.ts` plus `src/bin.ts`. Handlers call the existing control-API operation layer, with **one mechanical, enumerated change**: the six operation modules that load config internally today gain explicit `(config, cwd)`-style parameters and stop calling `loadConfigForSections` and falling back to process-cwd discovery — `operations/format.ts:34`, `operations/ref.ts:78,157,174`, `operations/contract-emit.ts:167`, `operations/migration-plan.ts:253`, `operations/migrate-show.ts:84`, `operations/migration-new.ts:56`. Without this, those operations would read config from the *process* cwd rather than `ctx.cwd` — silently wrong under `createTestCli`, which supplies `cwd` per run. Beyond that parameterization, S5 re-homes invocation and does not rewrite `src/control-api/**`.

**R-S5-22 — `lsp` keeps loading its own config.** The language server resolves config per document and per workspace folder, and re-resolves when the user edits it (`language-server/src/config-resolution.ts:32`); a single snapshot injected at startup would be wrong. `lsp` therefore declares no `needs.config`, and the `io.config` a server command receives goes unused. `--stdio` continues to be accepted and ignored.

**R-S5-23 — Removed-verb and removed-flag redirects (rewritten 2026-08-11).** The compatibility table at `cli.ts:40-56` (`migration apply`, `migration ref`, and the four removed `migration status` flags) now has an engine surface: `defineCommandFamily({ redirects })`, published in 0.0.6. The `orm` family declares the two verb redirects — `migration apply` → `{bin} migrate --to <contract>` and `migration ref` → `{bin} ref set|list|delete` — with `{bin}` in every replacement, and the engine answers a retired invocation with `CLI.COMMAND_MOVED` naming the replacement instead of a spelling suggestion.

The four retired `migration status` flags are **not** declared yet, and cannot be: the shipped `RedirectSpec` accepts a flag redirect only when `from` names a **mounted command** (`redirect for flag '<flag>' names '<path>', which is not a mounted command` is a construction error), and `migration status` is not ported. They land with that command. Two further construction rules the declaration respects: a redirect may not sit on a mounted command **or** on a group path — `migration` itself is a group, so only its retired leaves are declarable.

One divergence entry records the message-text change from the legacy table; a second records that the four flag redirects are absent until `migration status` mounts.

**R-S5-24 — One mount proof.** S5 ships a single integration proof in prisma-cli that the published family mounts and one command runs end to end through the unified shell. The full tree, the grammar completeness check and the `init` collision are S7's (STOP-2).

**R-S5-31 — One error shape at the handler boundary.** The engine and prisma/prisma each define a `CliStructuredError`, and the two are duck-type compatible but structurally divergent: the engine's `.is()` accepts any `Error` named `CliStructuredError` with a `toEnvelope()` (`cli-engine/src/protocol.ts:120-134`) and its settlement reads `error.nextActions`, while prisma/prisma's class (`packages/1-framework/1-core/errors/src/control.ts`) emits `fix` prose and has no `nextActions` — so an unconverted error settles as an envelope with `nextActions: undefined` (the protocol says always present) plus a non-protocol `fix` field. The seam is a single **`normalizeError` helper in `@internal/cli`**, applied at the handler boundary and nowhere else: handlers returning `notOk()` pass every prisma/prisma-raised error through it, and a top-of-handler catch passes thrown errors from unrewritten layers through the same helper. It produces the engine's protocol shape with `nextActions` always present, derived from the `fix` prose during the transition (a `fix` string becomes one next action; no `fix` means an empty list). The engine stays untouched; `src/control-api/**` and the framework error factories keep raising what they raise today.

## 4. Per-command contracts

Global flags (R-S5-2) and the `orm` config section (R-S5-10) are not repeated. "Errors" lists only changes; every code not listed ports verbatim from the inventory entry. Every command's inventory entry is its behavior contract for everything this section does not state.

### `init`

- **Kind**: result command. **Config**: none — `init` creates the config file, so it declares no `needs.config` and must run with no config present.
- **Flags**: `--target <db>`, `--authoring <style>`, `--schema-path <path>` unchanged in surface. The first two are `flag.string` with validation in the handler, NOT `flag.enum`: enum values are matched exactly by stricli at parse time (`cli-engine/src/args.ts`, `execution/stricli-adapter.ts:63-70`), so an enum flag would reject the aliases and capitalizations `init` accepts today (`postgresql`, `mongodb`, `ts`, any case — `init/inputs.ts:83-94,339-360`). Handler validation preserves them all, raising `CLI.INIT_INVALID_FLAG_VALUE` exactly as today. `--write-env`, `--probe-db`, `--strict-probe` unchanged booleans; `--no-install` → `--skip-install`, `--no-skill` → `--skip-skills` (R-S5-6); `--force` **removed** (R-S5-14).
- **Prompts**: the six clack prompts port to `ctx.prompt` — re-scaffold overwrite becomes `prompt.consent` with the working directory's basename as its token, the two selects become `prompt.select`, the schema-path question `prompt.text` with its inline validation re-checked in the handler after the answer, and the write-`.env` and remove-previous-facade questions `prompt.confirm` with their current defaults. Cancellation (Ctrl-C mid-prompt) is engine-owned: `CLI.PROMPT_CANCELLED`, exit 3, replacing `CLI.INIT_USER_ABORTED` on the cancel path. `CLI.INIT_USER_ABORTED` survives only for a declined consent — exit 2 until §8 item 4's cancellation export is published, exit 3 after (R-S5-14).
- **Package installs**: through the engine's package-manager capability (§8), never a direct child process. The four invocation sites — `<pm> add <facade> dotenv`, `<pm> add -D prisma-next [@types/node]`, the npm retry after a recognized pnpm workspace error, and the three sequential `skills@latest add` runs — become capability calls. The pnpm→npm fallback predicate (`isRecognisedPnpmResolutionError`, `init/init.ts:894-901`) matches pnpm error **codes** (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`, `ERR_PNPM_NO_MATCHING_VERSION`) plus two message regexes; it stays in `init`'s handler as a documented, tested predicate over the capability's returned stderr and does not become the engine's business.
- **Exit codes**: `exitCodes: { 4: …, 5: …, 6: … }` per R-S5-11. The three are re-derived as completed-with-findings: the scaffold exists on disk, so the run completed; the failure is a diagnostic with a next action, and the numbers are preserved for scripts. Preconditions (`CLI.INIT_REINIT_NEEDS_FORCE` — spelling kept per R-S5-13, prose rewritten since the flag is gone, `CLI.INIT_MISSING_FLAGS`, `CLI.INIT_INVALID_FLAG_VALUE`, `CLI.INIT_STRICT_PROBE_WITHOUT_PROBE`, `CLI.INIT_INVALID_MANIFEST`, `CLI.INIT_INVALID_TSCONFIG`, `CLI.INIT_PROBE_FAILED`, `CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH`) are errored, exit 2. `CLI.INIT_INVALID_OUTPUT_DOCUMENT` throws and settles as an engine bug, exit 1.
- **Presentation**: the current success document (`output.ts:19-40`) is the `json` presentation unchanged. Human output moves entirely to blocks on stderr; the clack intro/outro disappear (the engine owns decoration).
- **Divergences**: `--force` removed; `--no-install`/`--no-skill` renamed; cancel code changed; declined consent exits 2 interim, 3 after §8 item 4; installs run through the capability; exit codes 4/5/6 keep their numbers with completed-with-findings semantics.

### `migrate`

- **Kind**: result command with progress events. **Config**: `orm`.
- **Flags**: `--db`, `--to <contract>`, `--advance-ref <name>`, `--show`, `--from <contract>` unchanged; `--config` removed (R-S5-4).
- **Events**: the existing progress adapter's callbacks map to `step-started`/`step-finished`/`progress` per space and per migration; the styled header becomes `message` events at `info`.
- **Presentation**: `MigrateResult` and `MigrateShowResult` are the `json` presentation unchanged. `--show`'s human prose moves off stdout to blocks (R-S5-7).
- **Notes**: keep `EMPTY_CONTRACT_HASH` and the `'<empty>'` literal distinct as they are today — this port does not unify them. `-y` is no longer accepted silently: it is engine-owned and has no effect here, which is unchanged in observable behavior.

### `format`

- **Kind**: result command. **Config**: `orm`. **Flags**: none after `--config` is removed.
- **Presentation**: `{formatted, path?}` as `json`; one summary block in human mode. `--quiet` becomes a log-level alias, and the engine renders a completed result's blocks unconditionally (`execution/rendering.ts`, `renderCompletedHuman` — only events and section warnings are level-filtered), so the success line now renders even under `--quiet`. That matches §7's global divergence entry; the ORM's command-level quiet branch is deleted, not replicated.

### `lsp`

- **Kind**: server command (`defineServerCommand`). **Config**: none (R-S5-22). **Flags**: `--stdio`, accepted and ignored.
- **Behavior**: `@internal/language-server`'s `startServer` cannot be called as-is — today it is `startServer(): LanguageServer`, no parameters, building its own transport via `createConnection(ProposedFeatures.all)` (which binds `process.stdin`/`process.stdout` directly) and returning a server object with no lifetime (`language-server/src/start-server.ts:4-7`). S5 therefore includes an **API change to `@internal/language-server`**: `startServer` gains an injectable connection (or stream pair) parameter and returns a promise that resolves to an exit code when the client disconnects — which is what a `defineServerCommand` handler must return (`cli-engine/src/commands.ts`, `Promise<number>`). Between the engine and the server sits a **byte-stream adapter**: the engine hands the handler `io.stdin` as `AsyncIterable<Uint8Array>` and `io.stdout` as `{ write(text: string) }` (`cli-engine/src/runtime.ts`), while LSP framing is byte-counted `Content-Length` over Node `Readable`/`Writable` (or a MessageReader/MessageWriter pair); the adapter bridges the two without buffering whole messages as strings. The handler lazily imports the package — the lazy import stays, keeping `vscode-languageserver` off every other command's startup path. Shared flags are not injected; the engine forces human format and hands over the streams. The language-server API change is its own PR and can land early, in parallel with every other round (plan D8a).
- **Tests**: the existing three surface assertions port, plus one new test that starts the server through `createTestCli` and exchanges a single LSP initialize/shutdown pair over the injected streams. This is the first test that has ever started the server (inventory §6) and is required by this contract, not optional.

### `contract emit`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--output-path <dir>` only.
- **Behavior**: the double config load ends, from both directions. The command-side load that computes header display paths (`commands/contract-emit.ts:45-79`) is the **first** load and is deleted — the bin loads config once and the handler has it via `ctx.config`. The **second** load lives in the operation layer (`control-api/operations/contract-emit.ts:167`) and is removed by R-S5-21's parameterization: the operation receives the already-loaded config and `ctx.cwd` explicitly. `queueEmitByOutput` stays as the in-process mutex it is; cross-process safety remains out of scope and is recorded as a known limitation.
- **Presentation**: the current emit document is `json` unchanged; the file paths are the `stdout` payload lines.

### `contract infer`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--db`, `--output <path>`.
- **Behavior**: unchanged, including the silent overwrite with a stderr warning (R-S5-16). The warning becomes a `message` event at `warn`. Path resolution priority is unchanged.
- **Fix carried in the port**: the PSL file is written through the same staged-rename publication `contract emit` uses, replacing the bare `writeFileSync` that can leave a truncated file. This is a defect fix, listed as a divergence.

### `db verify`

- **Kind**: result command with `exitCodes: { 4: "verification found drift or marker findings" }`. **Config**: `orm`. **Flags**: `--db`, `--marker-only`, `--schema-only`, `--strict`.
- **Behavior**: unchanged, including running both verification pipelines in full mode. The mutually exclusive flag combinations (`--marker-only --schema-only`, `--marker-only --strict`) stay handler-checked and errored at exit 2 with `CLI.INVALID_VERIFY_MODE`.
- **Settlement**: drift and marker findings become `diagnostics` on a COMPLETED result with `exitCode: 4`, carrying the codes they carry today (`CONTRACT.MARKER_MISSING`, `CONTRACT.MARKER_MISMATCH`, `CONTRACT.TARGET_MISMATCH`, the per-space schema findings, and `combineVerifyResults`' synthesized `CONTRACT.MARKER_REQUIRED`). Preconditions and unreadable inputs stay errored at exit 2.
- **`--quiet`**: the deliberate override (`{...flags, quiet: false}`) is deleted. Diagnostics ride in the envelope and are rendered regardless of log level, which is what the override was working around.
- **Divergences**: schema-drift exit 1 → 4 AND marker/target-finding exit 2 → 4 (the two finding families exit differently today — R-S5-12); findings move from stderr prose into envelope diagnostics; the `--quiet` override disappears.

### `db init`

- **Kind**: result command with progress events. **Config**: `orm`. **Flags**: `--db`, `--dry-run`, `--advance-ref <name>`.
- **Behavior**: unchanged. The shared `migration-command-scaffold` is re-homed: config loading and connection resolution come from `ctx`, and what remains of the scaffold is contract reading, client construction and the progress adapter.
- **Note**: the `assertNever` exhaustiveness check on failure codes (`db-init.ts:112-113`) is kept — a new control-API code must be handled, not silently degraded.

### `db update`

- **Kind**: result command with progress events and consent. **Config**: `orm`. **Flags**: `--db`, `--dry-run`, `--to <contract>`, `--advance-ref <name>`.
- **Consent**: the destructive-changes failure is returned by `client.dbUpdate` after `client.connect` (`db-update.ts:129-141`) — there is no pre-plan seam, and R-S5-21's parameterization does not add one. The ported handler owns the client, so the flow is: connect once; `dbUpdate` returns `DESTRUCTIVE_CHANGES`; the handler calls `prompt.consent` with the destructive operation list in the question and the database name as the token (R-S5-14, STOP-5); granted → a **second `dbUpdate({acceptDataLoss: true})` call on the same open connection**; declined → the handler's own decline error, exit 2 interim / exit 3 after §8 item 4 (R-S5-14). Non-interactive without `--confirm <token>` → the engine's `CLI.CONSENT_REQUIRED`, exit 2.
- **Divergences**: `-y` no longer accepts data loss; `--confirm <database>` is the non-interactive form; declining moves from exit 2 prose to a structured decline (exit 3 once §8 item 4 ships); the re-invocation is gone — today an accepted destructive apply runs two full connect-and-plan cycles (`db-update.ts:262,288`), and the port runs one connection with two plan calls.

### `db schema`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--db`.
- **Behavior**: the discarded `inferPslContract` call (`db-schema.ts:18-29`) is removed — it is wasted work whose result is thrown away. Divergence entry (a run against a family that fails inference now succeeds where it previously failed).
- **Presentation**: the tree renderer ships as a `drawing` block (R-S5-9); the full result document is `json` unchanged. The connection-URL masking in the header stays as a `fields` block on stderr.

### `db sign`

- **Kind**: result command with `exitCodes: { 4: "schema verification failed; no signature was written" }`. **Config**: `orm`. **Positional**: `[contract]`. **Flags**: `--db`, `--contract <contract>`.
- **Arg conflict**: supplying both the positional and `--contract` becomes an errored settlement with a dotted code (`CLI.CONTRACT_ARG_CONFLICT`, new per R-S5-13), exit 2, replacing the bare stderr line with no envelope.
- **Settlement**: verification failure becomes a COMPLETED result with the schema-verify report as data, the failures as diagnostics, and `exitCode: 4`.
- **Fix carried in the port**: the contract is read through the family's `deserializeContract` seam, matching `db verify`, instead of a bare `JSON.parse` (`db-sign.ts:168`). Divergence entry.

### `migration plan`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--name <slug>` (default `migration`), `--from <contract>`, `--to <contract>`.
- **Behavior**: unchanged, including the seed phase running before the no-op check, the auto-baseline two-package write with its 60 000 ms directory-name offset, and the placeholder handling. These are recorded as known hazards, not changed here.
- **Presentation**: the seed `ui.step` lines become `step-started`/`step-finished` events; `MigrationPlanResult` is `json` unchanged; the timings line is emitted at `--log-level verbose`.

### `migration new`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--name <slug>`, `--from <hash>`.
- **Behavior**: unchanged, including prefix matching against `metadata.to` with first-match-wins and the app-space-only scope. Both are recorded, not fixed.
- **Tests**: this command has no unit test today. The rewritten suite adds one covering the from-resolution branches, per R-S5-20's matrix.

### `migration show`

- **Kind**: result command. **Config**: `orm`. **Positional**: `<target>` (required).
- **Behavior**: unchanged, including the app-space-only resolution and the naive path detection. Recorded, not fixed.

### `migration status`

- **Kind**: result command, no documented exit codes. **Config**: `orm`. **Flags**: `--db`, `--space <id>`, `--to`, `--from`, `--legend`, `--ascii`.
- **Settlement**: the three conditions that already ride inside a successful result — `CONTRACT.UNREADABLE`, `MIGRATION.MARKER_NOT_IN_HISTORY`, `MIGRATION.MISSING_INVARIANTS` — become engine `Diagnostic`s on a COMPLETED result with `exitCode: 0`. They are `warn` on their own merits: each describes a condition the user should look at while the command still delivered its full answer, which is exactly what today's exit-0-with-findings behavior says. That severity choice also satisfies the engine's enforcement — `ctx.present` throws if a severity-`error` diagnostic accompanies `exitCode: 0` (`execution/command-context.ts`, the check lives in `present()`, not in settlement).
- **`--legend` in json mode** stays an error (`MIGRATION.LEGEND_HUMAN_ONLY`), exit 2.

### `migration log`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--db`, `--utc`, `--ascii`.
- **Fix carried in the port**: the unsupported-target failure raises `MIGRATION.TARGET_UNSUPPORTED` like every sibling, replacing the `CLI.UNEXPECTED` at `migration-log.ts:64`. Divergence entry.
- **Tests**: no e2e journey exercises this command today; the rewritten suite adds one against a live ledger.

### `migration list`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--space <id>`, `--ascii`, `--legend`. Behavior, sort order and the extension-space head-ref fold are unchanged.

### `migration graph`

- **Kind**: result command. **Config**: `orm`. **Flags**: `--space <id>`, `--dot`, `--ascii`, `--legend`. `--dot` per R-S5-17.
- **Behavior**: node id truncation to 12 characters is unchanged and recorded as a collision hazard.

### `migration check`

- **Kind**: result command with `exitCodes: { 4: "integrity check found failures" }`. **Config**: `orm`. **Positional**: `[target]`. **Flags**: `--space <id>`.
- **Settlement**: the 19 `MIGRATION.CHECK_*` findings become `Diagnostic`s on a COMPLETED result with `exitCode: 4`, gaining the envelope shape and the family docs URL they lack today. Exit 0 with no findings; preconditions and resolution failures errored at exit 2. The command's own `exitOverride` and try/catch wrapper are deleted — the engine owns both.
- **Behavior preserved exactly**: the reserved-name convention in `checkManifestFilesPresent` (entries starting with `.` or `_`, and the literal `refs`), the most-informative parse-failure ranking, and the cross-space single-target search.
- **Fix carried in the port**: an unresolved target settles as errored with its dotted code rather than as a result with `ok:false, failures: []` and exit 2. Divergence entry.

### `ref set` / `ref delete` / `ref list`

- **Kind**: three result commands. **Config**: `orm`. **Positionals** as today: `set <name> <contract>`, `delete <name>`, none for `list`.
- **Presentation**: all three gain the standard envelope. The single-argument `JSON.stringify` output is replaced by the engine's serialization, so `--json` output for these three is now pretty-printed like every other command. Divergence entry.
- **Behavior preserved**: ref names still permit forward slashes; `head` and `db` are still not rejected; `set` still writes `invariants: []`. All three are recorded hazards, unchanged here. `ref delete` gains no confirmation (R-S5-16).

### Not ported

`telemetry status|enable|disable` — R-S5-19. `__telemetry-crash-test` — deleted. `help`, `--help`, `--version`, and the did-you-mean suggestion — engine-owned; the ORM's help formatters (`src/utils/formatters/help.ts`) and the `CLI_WIDTH` env override are deleted.

## 5. Package and layout decisions (prisma/prisma)

**R-S5-25 — The family lives in `@internal/cli`, rewritten in place.** `packages/1-framework/3-tooling/cli` keeps its name, its layer (framework / tooling) and its position; its commander program is replaced by engine command definitions. No new package: the architecture's layer map already puts CLI tooling here, and `scripts/lint-publishability.mjs` requires everything outside `packages/9-public/**` to stay private, so a new package would change nothing about how the family reaches consumers.

**R-S5-26 — `@internal/cli`'s exports.** After the port: `.` exports `ormCommandFamily` and `ormConfigSection`; `./bin` is the prisma-next bin entry; `./control-api` and `./control-api/testing` survive unchanged (the operations layer and #29936's test double); `./config-types`, `./init-output` and `./migration-cli` survive. The eighteen `./commands/*` subpaths are **deleted** — they exist so tests can import commander factories; the rewritten in-package tests import command definitions by relative path, and the cross-package suites (the `integration-tests` journeys and e2e files, which today already resort to a deep relative import in `journey-test-helpers.ts`) import the family from the `.` export instead of growing ~20 more deep imports. Deleting them changes the published `@prisma/orm-toolchain` surface (R-S5-27).

**R-S5-27 — `@prisma/orm-toolchain`'s exports.** Gains `./cli/family` (the `orm` `CommandFamily` and the config section token, the only subpath the unified shell imports). Keeps `./bin/prisma-next`, `./cli/migration-cli`, `./cli/control-api`, `./cli/control-api/testing`, `./cli/config-types`, `./cli/init-output`, and every non-CLI subpath. Drops the eighteen `./cli/commands/*` subpaths **and `./cli` itself** — that subpath is the commander program R-S5-29 deletes. The export map and the `prisma-next` bin entry are **generated** from `packages/0-shared/publish-surface/src/shells.ts` (`bins`, and the subpath list), so both drops and the bin re-point are edits to that generator, owned by the retirement round (plan D10). This is a breaking change to a published package on the 8.0.0-rc line; it is listed in the divergence file and in the release notes.

**R-S5-28 — Dependency direction and pinning.** `@prisma/cli-engine` is a **runtime dependency at an exact version** of both `@internal/cli` and `@prisma/orm-toolchain`, and is **not bundled** by tsdown — it stays external in the published tarball so the shell and the family share one module instance rather than two copies with distinct brands and classes. The build check already exists — `packages/0-config/tsdown/shell-build.ts` externalizes everything that is not `@internal/*` and validates the derived `dependencies`; `pnpm check:publish-deps` verifies the declared dependency set, and both run in the retirement round's verification (plan D10). The version is bumped deliberately in a PR (committed versions, R11); prisma-cli's shell pins the identical version (today `workspace:8.0.0-rc.1` in `packages/cli/package.json`, bumped in lockstep at D11), and a mismatch is what the S6 conformance checker's tarball verification catches once S6 exists (STOP-10).

**R-S5-29 — What dies.** `src/cli.ts` (the commander program, the pre-parse scans, the redirect tables, the `exitOverride` maze), `src/utils/global-flags.ts`, `src/utils/terminal-ui.ts`, `src/utils/result-handler.ts` (the `handleResult` funnel — the engine's settlement replaces it entirely, including the three commands that escape it today), `src/utils/formatters/help.ts`, `src/utils/suggest-command.ts`, `src/utils/shutdown.ts` (the engine owns signal policy), and the `commander` and `@clack/prompts` dependencies. `clipanion` stays for the migration-file CLI. `src/control-api/**`, `src/utils/formatters/*` (minus help), and the command bodies' logic survive.

**R-S5-30 — `@internal/cli-telemetry` stays** in prisma/prisma for the prisma-next bin (R-S5-19, STOP-4). It is not deleted in S5; its deletion rides the bin's retirement at cutover.

## 6. The package-manager capability (proposal — operator ratification required)

`init` installs dependencies, and R13 says the CLI never touches a package manager. The operator has permitted a new engine affordance rather than dropping the behavior. This section proposes its shape; **it is a proposal, not a settled rule**, and it must be ratified before implementation (STOP-3). It is engine work, so it lands in prisma-cli and must be coordinated with the S3 stream, which is editing the same package.

**The shape.** A capability, not a need — declaring it never fails a run, in the same way `managesCredentials` works:

- `defineCommand({ installsPackages: true, … })` adds `ctx.packages` to the context. Exactly one command declares it: `init`.
- `ctx.packages.install(request)` where `request` is `{ packages: readonly string[]; dev?: boolean; cwd?: string }`. It resolves to `Result<{ command: string }, CliStructuredError>`.
- `ctx.packages.run(request)` where `request` is `{ package: string; args: readonly string[]; cwd?: string }` — the one-off runner form (`npx`/`pnpm dlx`/`bunx`), which is what the agent-skill installs need.
- The **engine** owns: choosing the manager from `Runtime.packageManager`, spelling the argv for that manager, emitting `step-started`/`step-finished` events around the run, redacting URL userinfo from captured child stderr, and producing the structured failure (`CLI.INSTALL_FAILED`, with the attempted command in `meta` and a `run-command` next action). Handlers never spell a package-manager command, never spawn, and never phrase install prose — which is R13's actual requirement.
- The **bin** owns execution: `Runtime.runPackageManager?: (spec: { file: string; args: readonly string[]; cwd: string; signal: AbortSignal }) => Promise<{ exitCode: number; stderr: string }>`. The engine calls it; it is absent in tests unless seeded, and `createTestCli` gains a `packageManagerRunner` seam so `init`'s whole matrix is testable without a network or a real install.
- The retry policy `init` needs (a recognized pnpm workspace or catalog resolution error falls back to npm) stays in `init`'s handler as a documented predicate over the returned stderr, calling `install` a second time with an explicit manager override. The engine does not learn about pnpm's error messages.

**Why this is inside R13's intent.** R13 forbids the CLI installing command submodules into a hidden `node_modules` — the CLI becoming a second, worse package manager. Running the user's own package manager, in the user's own project, at the user's explicit request (`prisma init`), with the command visible and the failure structured, is the opposite of that. If the operator disagrees, the fallback is: `init` stops installing, prints the two commands as next actions, and `--skip-install` becomes the only behavior. R13's text should be amended either way, so the exception is written down rather than tacitly allowed.

## 7. Divergences to enumerate

The implementation writes `../assets/s2/parity-divergences-s5.md` in the format of [`../assets/s2/parity-divergences.md`](../assets/s2/parity-divergences.md), with a per-command conformance row (command → inventory entry → applied rules → divergences). It must contain at least the following, all of which are user-visible:

**Global.** `--format pretty` → `--format human`. `--trace` and `PRISMA_NEXT_TRACE` removed. Per-command `--config` removed (one row per command); the flag itself is the engine's. Off-TTY json auto-selection now specified rather than accidental. `--quiet` becomes a log-level alias and no longer changes what a completed result renders. **Interactivity is now derived from stdin, not stdout** (R-S5-15): every command's prompting and TTY-dependent behavior flips in the two mixed-pipe cases. Human prose moves off stdout everywhere, and so do the drawings (R-S5-9): a command with no machine-consumable lines writes nothing to stdout in human mode. Colour and width details change where a renderer ships as blocks — the engine paints from tones and sizes tables itself, so the two shade distinctions named in R-S5-9 are lost and column widths come from the engine. Signals: SIGTERM now exits 143, not 130. Errored settlements all exit 2, including the paths that exited 1. Help, version, unknown-command messages and did-you-mean text are the engine's. Error envelopes gain typed `nextActions` and lose `fix` prose. Diagnostics gain docs URLs derived from the family's docs base. The `orm` config section is validated as one section: a malformed subsection now fails commands that do not read it, where today it does not (STOP-12).

**Codes.** Every existing dotted code keeps its spelling, `CLI.*` included (R-S5-13). The changes: four flag-parse codes with no successor (the engine raises `CLI.INVALID_ARGUMENTS`); `CLI.JSON_FORMAT_UNSUPPORTED` deleted; new `CLI.CONTRACT_ARG_CONFLICT`; `MIGRATION.TARGET_UNSUPPORTED` replacing `CLI.UNEXPECTED` in `migration log`. Recorded as fact, not a divergence: the engine and the ORM both mint `CLI.*` codes; ADR 239's `CLI` namespace row gains an ownership note (docs-only, rides the port PR).

**Exit codes.** `db verify` schema-drift 1 → 4 and marker/target findings 2 → 4; `db sign` 1 → 4; `migration check` unexpected-throw 2 → 1 (the catch-all wrapper dies); `db update` declined 2 → 2-with-structured-error interim, → 3 after §8 item 4; `init` declined consent likewise; `init` 4/5/6 keep their numbers but become completed-with-findings; no-argument and bare-group invocations (pending STOP-9); removed-verb redirects (R-S5-23). Completed-with-findings at exit 4 also contradicts `error-reference.md`'s preamble ("errors with codes on this page exit 2 unless noted") — the preamble's exit-code sentence and the per-code notes for every completed-with-findings code are rewritten as a named deliverable (§10, plan D6).

**Per command.** `init`: `--force` removed, `--no-install`/`--no-skill` renamed, installs through the capability, cancel code changed, declined-consent exit interim. `db update`: `-y` no longer accepts data loss, `--confirm <database>` is the non-interactive form, one connection with two plan calls instead of two full connect-and-plan cycles. `db schema`: the discarded inference call removed. `db sign`: contract read through the family seam; arg conflict structured. `contract infer`: staged-rename write. `contract emit`: single config load. `migration graph`: `--dot` semantics per R-S5-17. `migration check`: unresolved target now errored; findings gain envelope shape; **the `--json` document's `checkFailureSchema` loses its `fix: string` field for typed `nextActions`** (`json/schemas.ts:179-184`, rendered at `migration-check.ts:171,189`) — a breaking `--json` shape change under R-S5-8, landed with D1a's `cli-errors.ts`/`schemas.ts` conversion commit. `migration status`: findings become typed diagnostics. `ref *`: json output now pretty-printed; the three commands gain envelopes. `lsp`: unchanged surface, first real test.

**Telemetry.** Event timing moves from pre-run to settlement; a killed run emits nothing; **runs that never reach a mounted command (unknown command, usage errors, `--help`, `--version`) also emit nothing** — `onSettled` never fires for them (`cli-engine/src/run-summary.ts`), where the ORM's `preAction` reported some of these; the event now carries an exit code; the `telemetry` group exemption is gone.

**Packaging.** Eighteen `@prisma/orm-toolchain` `./cli/commands/*` subpaths deleted, plus `./cli` (the commander program).

**Flagged follow-ups (not changed, operator decision invited).** `migration new`'s first-match-wins prefix resolution; `migration show`'s app-space-only scope; `migration plan`'s seed-before-no-op writes; `migration graph`'s 12-character node ids. (`contract infer`'s overwrite and `ref delete`'s missing confirmation were ruled acceptable as designed — STOP-8.)

## 8. Engine amendments this contract requests (prisma-cli)

Each lands in prisma-cli, is published, and only then is consumable here. Each must be coordinated with S3, which is editing the same package — the `s3-composer` branch is already rewriting `context.ts`, `runtime.ts`, `testing.ts`, `exports/index.ts` and `execution/*` against `main`, which is precisely the file set items 2, 4 and 5 touch; the capability spec's coordination section covers the mechanics, and every amendment here lands inside that contention window.

1. **Shell-level `--config <path>`** — RESOLVED: landed as prisma-cli PR #138 (lazy per-need config loading; `--config` an ordinary flag). S5 consumes the published version. The engine checkout this contract was verified against does not carry it, so D1a starts with a hard precondition check: verify the *published* engine version carries #138 before pinning; if it does not, STOP-1's interim (bin-side argv pre-parse) is the live path.
2. **The package-manager capability** — §6; spec extracted to [`engine-package-manager-capability.md`](engine-package-manager-capability.md), prisma-cli PR #140, implemented by a third party per the STOP-3 ruling. Same publish check applies before D9.
3. **Redirect tables on `CommandFamily`** — RESOLVED: STOP-9's spec ([`engine-redirect-table.md`](engine-redirect-table.md), prisma-cli PR #141) landed in 0.0.6 and the `orm` family declares its verb redirects at 0.0.8 (R-S5-23).
4. **Export the cancellation-error constructor** (or an engine-blessed `cancel()` helper). `settleErrored` maps only the exact code `CLI.PROMPT_CANCELLED` to exit 3; the constructor lives in `execution/prompts.ts` and `exports/index.ts` exports only the credential-error constructors. Without the export, a declined consent cannot reach exit 3 without the ORM minting an engine code. Until published, declines settle at exit 2 with the handler's own code (R-S5-14).
5. **A rendering surface the drawings can use** — RESOLVED, and resolved more broadly than asked. The request was a colour-mode boolean on `ctx` so `stdout` lines could honour `--no-color`/`NO_COLOR`. Engine 0.0.8 instead gave handlers `Tone`, `Span`, `Text`, a `drawing` block, a self-sizing `table`, `fields` with a rail, `tree` nodes carrying `status`/`tone`, and `Ui.width` — so a handler describes meaning and the engine owns the painting entirely. R-S5-9 is rewritten onto that surface; no handler needs to know the colour mode.

**R-S5-32 — `nextActions` is produced in the command layer, never in the error types (ruled 2026-08-11, from D1a's STOP).** No error class outside the CLI package gains a `nextActions` field, and no framework or foundation package learns the `NextAction` type. Library-layer structured errors — raised by `1-core/errors`, the migration tools, the config loader, and everything else the language server and the Vite plugin also consume — keep carrying `code`, `why` and `fix` prose. A `run-command` action names an executable CLI invocation, which is knowledge only the CLI has; a library that raised the error has no business spelling one.

The translation happens at the command layer, in `@internal/cli`:

- `normalizeError` (R-S5-31) derives a conforming `nextActions` array from `fix` prose for any error that arrives without one. Every raised error therefore settles as a valid engine envelope with no change to the raise site.
- A command that wants better than derived prose attaches typed actions itself when it converts a failure into its settlement — in the handler or in a command-layer mapping keyed by dotted code. That mapping lives in the CLI package and nowhere else.
- `src/utils/cli-errors.ts` is a CLI-package module, so its factories may attach typed actions directly. `src/commands/json/schemas.ts`'s `checkFailureSchema` moves from `fix` to `nextActions` because it describes the CLI's own published output — a §7 divergence entry.

Consequence for D1a's STOP: deliverable 5 as originally worded (convert the shared layers to raise `nextActions`) is void. What replaces it is the command-layer conversion above, landing at the head of the second PR.

**Note for the ADR.** The merged ADR 239 amendment lists `NextAction` among the foundation module's exports and declares `nextActions` required on `StructuredError`. Under this ruling that is wrong about prisma/prisma's layering: the typed remediation belongs to the user-facing envelope produced at the CLI boundary, while library-layer errors keep prose. The ADR needs a correction saying so, carried by the port PR's docs checklist (§10).

## 9. STOP questions

Nothing below is decided. Where a default is stated, build to it; the ruling can overrule before the affected round runs.

**STOP-1 — RULED (2026-08-11), CLOSED.** The engine gained `--config <path>` as an ordinary flag with lazy per-need config loading — prisma-cli PR #138, published in 0.0.5. The port pinned 0.0.3 and ran the bin-side argv pre-parse interim; adopting 0.0.8 deleted it. R-S5-4 stands: no ported command declares its own `--config`.

**STOP-2 — RULED (2026-08-11).** The ORM scaffold mounts as `orm init` for now; the orchestrating binary constructs its own command tree, so moving it later is a shell-side remount, not a family change. S5 builds the command name-agnostically inside the family.

**STOP-3 — RULED (2026-08-11).** Build as proposed in §6. The implementation spec is extracted to [`engine-package-manager-capability.md`](engine-package-manager-capability.md) (prisma-cli PR #140) and the operator hands it to an independent implementer; S5 consumes the capability from the published engine and sequences `init`'s port behind that publish (plan D9).

**STOP-4 — RULED (2026-08-11; wording corrected in review folding).** The rebuilt prisma-next bin relies on the engine's reporting mechanism: the engine produces the run summary through the bin-level settlement hook, and the bin wires that hook to prisma/prisma's existing `@internal/cli-telemetry` sender — same installation id and endpoint as the prisma-cli copy, but NOT the same wire shape: the prisma-cli copy dropped the two config-derived fields (`databaseTarget`, `extensions`; S2 Q7), and this bin retains them per R-S5-18, which wins wherever the two senders disagree. The sender retires with the bin at cutover.

**STOP-5 — RULED (2026-08-11, built to default).** The consent token is the database name parsed from the resolved connection URL, falling back to the target id when the URL carries none.

**STOP-6 — RULED (2026-08-11).** Mount as-is; any renaming is later grammar work.

**STOP-7 — RULED (2026-08-11).** S5 (this stream) does the mechanical `fix` → `nextActions` rename inside the CLI as part of rewriting each command; non-CLI factories convert under the existing ratchet.

**STOP-8 — RULED (2026-08-11).** Parity, and no follow-up flag: the operator rules the behaviors acceptable as designed (`contract infer` writes an artifact that should be version-controlled; refs are cheap pointers whose targets survive deletion). R-S5-16's divergence-list follow-up entries are dropped.

**STOP-9 — RULED (2026-08-11).** The engine gains a declarative redirect table on `CommandFamily` rather than the ORM registering dead verbs as commands. Implementation spec: [`engine-redirect-table.md`](engine-redirect-table.md) (prisma-cli PR #141), built by an independent implementer. The `orm` family declares all six retired invocations (`migration apply`, `migration ref`, and the four retired `migration status` flags) as `redirects` entries with `{bin}`-substituted replacements; nothing dead enters the grammar tree or help. S5 consumes the capability from the published engine and sequences the declaration behind that publish — **Adopted at 0.0.8**, with one correction to the ruling's wording: only the two verb redirects are declarable today, because the shipped spec requires a flag redirect's command to be mounted and `migration status` is not ported (R-S5-23). One divergence entry records the message-text change from the legacy table.

**STOP-10 — RULED (2026-08-11, built to recommendation; record narrowed in review folding).** The spawned-binary smoke suite (~4 cases) is S5's deliverable. The conformance checker's tarball verification is **S6's**, and S6 does not exist yet (prisma-cli holds no conformance-checker package); it lands when S6 does, wired into publish CI per `plan.md`. S6's absence is a noted non-dependency: nothing in S5 blocks on it, and §2's dependency table correctly omits it.

**STOP-11 — RULED (2026-08-11).** `PRISMA_NEXT_DISABLE_TELEMETRY`, `PRISMA_NEXT_DEBUG` (the detached sender's only diagnostics channel; its `--verbose`-alias role drops), and `PRISMA_NEXT_SKILLS_BASE` survive with current spellings; `PRISMA_NEXT_TRACE` and `PRISMA_NEXT_ENABLE_TEST_COMMANDS` die with their features. Aliases wait for cutover.

**STOP-12 — RULED (2026-08-11).** Whole-section blocking. Any structural failure anywhere in the `orm` section blocks every `orm` command; the per-subsection blocking `requireConfigSections` provides today does not survive the port. This is a user-visible change ("a malformed subsection now fails commands that do not read it") and is recorded as one divergence entry. No engine work; no per-handler re-check.

## 10. Acceptance

- [ ] All 22 commands defined on the engine, mounted in the prisma-next bin through `createCli`, with the `orm` config section token on every command that reads config.
- [ ] `ormCommandFamily` exported from `@internal/cli` and republished through `@prisma/orm-toolchain`'s `./cli/family`; `@prisma/cli-engine` an exact-pinned, unbundled runtime dependency, asserted by a build check.
- [ ] The commander shell, `TerminalUI`, `handleResult`, the global-flag resolver, the help formatters and the shutdown handler are deleted; the survivor list is enumerated in the PR.
- [ ] `db verify`, `db sign` and `migration check` settle as completed-with-findings with documented exit codes 4; `migration status`'s three findings are typed diagnostics at exit 0.
- [ ] `init` runs its full prompt matrix (interactive, `--yes`, non-interactive with flags, consent granted, consent declined, `--confirm`) and installs through the ratified capability — or, if the capability is unpublished at the D9 checkpoint, ships with `--skip-install`-only behavior and install commands as next actions (plan D9).
- [ ] The six control-API operation modules take explicit `(config, cwd)` parameters (R-S5-21); no operation calls `loadConfigForSections` or reads the process cwd.
- [ ] `normalizeError` (R-S5-31) is the only place prisma/prisma errors are converted; every settled envelope carries `nextActions` and no `fix` field.
- [ ] `lsp` starts and completes an LSP initialize/shutdown exchange through the harness — the first test that ever started the server; `@internal/language-server`'s `startServer` takes an injected connection and resolves to an exit code (§4).
- [ ] Every command's tests are on `createTestCli` with envelope, presented-data, event and exit-code assertions; one golden suite per output surface; the 48 journey files and 28 process-level e2e files are migrated or deleted with their reason recorded; a small spawned-binary smoke suite exists (STOP-10).
- [ ] Telemetry reports through `onSettled` with the ORM sender's wire shape (config-derived fields included), config file and installation id; no test contacts the production endpoint.
- [ ] `docs/reference/error-reference.md` updated: the preamble's exit-code sentence and the per-code notes for every completed-with-findings code rewritten (§7 Exit codes; plan D6), `CLI.INIT_REINIT_NEEDS_FORCE`'s prose rewritten for consent, and the deleted codes removed; `pnpm run check:error-reference`, `pnpm check:publish-deps`, `pnpm lint:deps`, `pnpm typecheck`, and the full test suite pass.
- [ ] ADR 239's `CLI` namespace row carries the shared-ownership note; `plan.md`'s S5 outline and `specs/s2-overview.md` ruling 7 are amended per §2's supersessions note (docs-only, same PR).
- [ ] `../assets/s2/parity-divergences-s5.md` written with a per-command conformance row and every §7 entry, reviewed by the operator.
- [ ] One integration proof in prisma-cli that the published family mounts and runs (R-S5-24).
- [ ] The clipanion migration-file CLI is untouched, and a test asserts its exit-code scheme is unchanged.
