# S5 ORM CLI Inventory — `prisma-next` (`@internal/cli`) commander shell (grounding for the v8 port)

Source of truth read on branch `worktree/prisma-orm-cli-port-e1963d` at repo
`/Users/will/Projects/prisma/prisma/.claude/worktrees/prisma-orm-cli-port-e1963d`.
All paths below are relative to `packages/1-framework/3-tooling/cli/` unless prefixed
(repo-relative paths are written out from the repo root, e.g. `docs/CLI Style Guide.md`).

Registration lives in `src/cli.ts` (root program) plus one `create*Command()` factory per
command under `src/commands/`. There is no central descriptor table — descriptions live on
each factory via `setCommandDescriptions` (`src/utils/command-helpers.ts`). Behavior was
cross-checked against `docs/CLI Style Guide.md`, `docs/Telemetry.md`,
`docs/commands/SUMMARY.md`, and `docs/reference/error-reference.md`; divergences are recorded
inline and numbered in §3.7.

Engine context used for the "proposed engine kind" column comes from `@prisma/cli-engine`
(`wip/repos/prisma-cli/packages/cli-engine/src/commands.ts:192` `defineCommand`, `:286`
`defineSessionCommand`, `:346` `defineServerCommand`).

---

## 1. Command index

Behavior classes: **sync** = one result envelope; **long-running** = plans/applies against a live
database with progress events; **stream/server** = raw stdio handover; **interactive** = can prompt.
The "auth" column: this CLI has **no platform authentication at all** — no login, no token store,
no Management API. What varies is whether a command needs a live database connection
(`--db` / `config.db.connection`) or is fully offline.

| path | group | behavior | auth / connection | proposed engine kind |
|---|---|---|---|---|
| `--version` / `-V` | program | sync (pre-parse fast path) | none | result-command |
| `help` | program | sync | none | engine-owned help |
| `init` | top | interactive, file-writing, spawns package managers | none (optional `--probe-db` reads `DATABASE_URL`) | **result-command with `needs.interaction` + `needs.consent`** |
| `migrate` | top | long-running (DDL) | live DB required | result-command (progress events) |
| `format` | top | sync, file-writing | none (offline) | result-command |
| `lsp` | top | long-lived stdio server | none | **server-command** |
| `contract emit` | contract | sync, file-writing | none (offline) | result-command |
| `contract infer` | contract | sync, file-writing | live DB required | result-command |
| `db verify` | db | sync + "completed with findings" | live DB required | result-command, exit 4-band + diagnostics |
| `db init` | db | long-running (additive DDL) | live DB required | result-command (progress events) |
| `db update` | db | long-running (destructive DDL), interactive | live DB required | result-command + `needs.consent` |
| `db schema` | db | sync, read-only | live DB required | result-command |
| `db sign` | db | sync, DB write (marker) | live DB required | result-command, exit 4-band on verify failure |
| `migration plan` | migration | sync, heavy file-writing | none (offline) | result-command |
| `migration new` | migration | sync, file-writing | none (offline) | result-command |
| `migration show` | migration | sync, read-only | none (offline) | result-command |
| `migration status` | migration | sync, read-only | live DB unless `--from` | result-command + diagnostics |
| `migration log` | migration | sync, read-only | live DB required | result-command |
| `migration list` | migration | sync, read-only | none (offline) | result-command |
| `migration graph` | migration | sync, read-only | none (offline) | result-command |
| `migration check` | migration | sync + "completed with findings" | none (offline) | result-command, exit 4-band + diagnostics |
| `ref set` | ref | sync, file-writing | none (offline) | result-command |
| `ref delete` | ref | sync, file-deleting | none (offline) | result-command |
| `ref list` | ref | sync, read-only | none (offline) | result-command |
| `telemetry status` | telemetry | sync | none | result-command |
| `telemetry enable` | telemetry | sync, writes user config | none | result-command |
| `telemetry disable` | telemetry | sync, writes user config | none | result-command |
| `__telemetry-crash-test` | hidden | deliberately throws | none | test-only; do not port |
| `node migration.ts` (clipanion) | separate argv surface | sync, file-writing | none (offline) | **none — out of scope for S5, stays as-is (§5)** |

Group nodes (print help when invoked bare, no action of their own): root `prisma-next`
(`src/cli.ts:71-73`), `contract` (`src/cli.ts:204`), `db` (`src/cli.ts:228`), `migration`
(`src/cli.ts:264`), `ref` (`src/commands/ref.ts:271`), `telemetry`
(`src/commands/telemetry/index.ts:85`).

## 2. Group census

| group | leaf commands |
|---|---|
| top-level verbs (`init`, `migrate`, `format`, `lsp`) | 4 |
| `help` + program `--version` | 2 |
| `contract` (emit, infer) | 2 |
| `db` (verify, init, update, schema, sign) | 5 |
| `migration` (plan, new, show, status, log, list, graph, check) | 8 |
| `ref` (set, delete, list) | 3 |
| `telemetry` (status, enable, disable) | 3 |
| hidden `__telemetry-crash-test` (env-gated) | 1 |
| **Total invocable commands in the commander program** | **28** |
| separate clipanion binary (`migration.ts`, one default command) | 1 |

Plus 6 group/help nodes and two removed-verb redirect tables (`src/cli.ts:40-56`).

## 3. Shared machinery

### 3.1 Global flags

One set, attached to every leaf command by `addGlobalOptions`
(`src/utils/command-helpers.ts:368-389`). There is **no compact/full split** as in
`@prisma/cli` — every command gets all nine.

| flag | alias | resolution |
|---|---|---|
| `--format <pretty\|json>` | — | `src/utils/command-helpers.ts:376-379`; resolved at `src/utils/global-flags.ts:49-72` |
| `--json` | — | alias for `--format json` (`command-helpers.ts:380`) |
| `--quiet` | `-q` | `command-helpers.ts:381` |
| `--verbose` | `-v` | `command-helpers.ts:382` → verbosity 1 (`global-flags.ts:153`) |
| `--trace` | — | `command-helpers.ts:383` → verbosity 2 (`global-flags.ts:151`) |
| `--color` / `--no-color` | — | `command-helpers.ts:384-385`; default `TTY && !CI` (`global-flags.ts:159-167`) |
| `--interactive` / `--no-interactive` | — | `command-helpers.ts:386-387`; default = stdout is a TTY (`global-flags.ts:169-175`) |
| `--yes` | `-y` | `command-helpers.ts:388`; `global-flags.ts:177-179` |

**The single most consequential flag behavior: when stdout is not a TTY the format silently
defaults to `json`** (`src/utils/global-flags.ts:67-69`), which then also forces
`flags.json = true` (`:143-145`) and `color = false` (`:159`). Piping any command changes the
output shape with no flag passed. Nothing in the docs says so (§3.7 item 8).

`--config <path>` and `--db <url>` are **not** global despite being documented as such
(§3.7 item 9) — each command re-declares them, and `init`, `format`, `lsp`, and `telemetry`
reject `--config` outright.

Flag-parse failures (`CLI.INVALID_OUTPUT_FORMAT`, `CLI.OUTPUT_FORMAT_CONFLICT`) are raised
before any action body and exit 2 through `emitGlobalFlagParseError`
(`src/utils/global-flags.ts:87-100`).

`--no-color` is registered as a commander negation, so commander sets `options.color = false`,
but the resolver reads the never-populated key `options['no-color']`
(`src/utils/global-flags.ts:161`); it works only via the `options.color !== undefined` fallback
at `:163`.

### 3.2 Command runner and the result funnel

There is no `runCommand` wrapper. Each command's commander `.action()` builds its own
`TerminalUI`, calls its own execute function, and ends in
`process.exit(handleResult(...))`. `handleResult` (`src/utils/result-handler.ts:16-45`) is the
only shared funnel:

- success → runs the caller's `onSuccess` callback, returns `0` (`result-handler.ts:22-26`);
- failure → `result.failure.toEnvelope()`, then **JSON mode writes the error envelope to stdout
  and stderr stays silent**; human mode writes to stderr (`result-handler.ts:32-38`);
- exit code = `3` for `CLI.INIT_USER_ABORTED`, `2` for everything else (`result-handler.ts:43`).

Output channels are owned by `TerminalUI` (`src/utils/terminal-ui.ts:13-22`): `ui.output` →
stdout unconditionally (`:299-301`); `ui.log` → stderr and **is a no-op unless the UI is
decorating**, i.e. interactive stdout or an explicit `--format pretty` (`:99-102`, `:331`);
`ui.error` → stderr, ignoring `--quiet` (`:123-125`).

Three commands escape the funnel for their own logical-failure branch: `db verify`
(`src/commands/db-verify.ts:566`, `:605`), `db sign` (`src/commands/db-sign.ts:324`), and
`migration check`, which never calls `handleResult` at all
(`src/commands/migration-check.ts:666-698`).

### 3.3 Error taxonomy and the full exit-code census

Every structured error is a `CliStructuredError` with a dotted `NAMESPACE.SUBCODE` code, a
summary, a `why`, a `fix`, and a `meta` bag; the envelope is produced by `toEnvelope()` and
rendered by `src/utils/formatters/errors.ts`.

**The dotted code a user sees is usually not the code the CLI author intended.** Every factory
in `src/utils/cli-errors.ts` builds through `errorRuntime` (`src/utils/cli-errors.ts:86`,
`:102`, `:119`, `:136`, `:169`, `:181`, `:206`, `:234`, `:263`, `:325`, `:360`, `:408`, `:424`),
and `errorRuntime` hard-codes the envelope code to `CONTRACT.VERIFY_FAILED`
(`packages/1-framework/1-core/errors/src/execution.ts:266`). The intended code
(`MIGRATION.HASH_NOT_IN_GRAPH`, `MIGRATION.SPACE_NOT_FOUND`, `MIGRATION.PATH_UNREACHABLE`, …)
survives only inside `meta.code`. About twenty distinct failures share one visible code.

#### 3.3.1 Scheme A — the shared funnel

| source | code | meaning |
|---|---|---|
| `src/utils/result-handler.ts:26` | 0 | success |
| `src/utils/result-handler.ts:43` | 2 | every structured failure |
| `src/utils/result-handler.ts:43` | 3 | `CLI.INIT_USER_ABORTED` only |
| `src/utils/global-flags.ts:99` | 2 | invalid `--format` value, or `--json` + `--format pretty` |
| `src/cli.ts:165` | 2 | commander unknown command / unknown argument |
| `src/cli.ts:178` | 0 | commander help request |
| `src/cli.ts:189` | 2 | commander missing required argument |
| `src/cli.ts:194-198` | **1** | any other commander error — prints `Unhandled error:` plus a raw stack |
| `src/cli.ts:200` | 0 | `exitOverride` called with no error |
| `src/cli.ts:405-406` | 0 | `--version` / `-V` pre-parse fast path |
| `src/cli.ts:423` | 2 | unrecognized top-level command (pre-parse scan) |
| `src/cli.ts:430` | 2 | removed-verb redirect (`migration apply`, `migration ref`) |
| `src/cli.ts:440` | 2 | removed-flag redirect (`migration status --graph/--all/--limit/--ref`) |
| `src/cli.ts:394` | 0 | no arguments at all — prints root help to stderr |
| `src/cli.ts:455` | 0 | bare group node — prints group help to stderr |
| `src/utils/shutdown.ts:43` | 130 | SIGINT/SIGTERM: abort, then force-exit after a 3s grace period |
| `src/utils/shutdown.ts:36` | 130 | second signal during the grace period, immediate |

Handlers are installed before anything else runs (`src/cli.ts:9`, `shutdown.ts:87-92`).
There is no SIGTERM-specific 143; both signals map to 130.

#### 3.3.2 Scheme B — `init`'s 0–6

`src/commands/init/exit-codes.ts`, mapped by `exitCodeForError`
(`src/commands/init/init.ts:624-651`) and rendered into `--help` at
`src/commands/init/index.ts:56-63`.

| constant | value | anchor | error codes mapped |
|---|---|---|---|
| `INIT_EXIT_OK` | 0 | `exit-codes.ts:15` | — |
| `INIT_EXIT_INTERNAL_ERROR` | 1 | `exit-codes.ts:25` | `CLI.INIT_INVALID_OUTPUT_DOCUMENT` (`init.ts:641-642`) and any unrecognized code (`init.ts:645-649`) |
| `INIT_EXIT_PRECONDITION` | 2 | `exit-codes.ts:34` | `CLI.INIT_REINIT_NEEDS_FORCE`, `CLI.INIT_MISSING_FLAGS`, `CLI.INIT_INVALID_FLAG_VALUE`, `CLI.INIT_STRICT_PROBE_WITHOUT_PROBE`, `CLI.INIT_INVALID_MANIFEST`, `CLI.INIT_INVALID_TSCONFIG`, `CLI.INIT_PROBE_FAILED`, `CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH` (`init.ts:626-633`) |
| `INIT_EXIT_USER_ABORTED` | 3 | `exit-codes.ts:41` | `CLI.INIT_USER_ABORTED` (`init.ts:635-636`) |
| `INIT_EXIT_INSTALL_FAILED` | 4 | `exit-codes.ts:53` | `CLI.INIT_INSTALL_FAILED` (`init.ts:637-638`) |
| `INIT_EXIT_EMIT_FAILED` | 5 | `exit-codes.ts:62` | `CLI.INIT_EMIT_FAILED` (`init.ts:639-640`) |
| `INIT_EXIT_SKILL_INSTALL_FAILED` | 6 | `exit-codes.ts:72` | `CLI.INIT_SKILL_INSTALL_FAILED` (`init.ts:643-644`) |

`init` deliberately bypasses `handleResult` for its error rendering
(`src/commands/init/init.ts:598-606`).

#### 3.3.3 Scheme C — `migration check`'s 0/2/4

`src/commands/migration-check/exit-codes.ts` is three lines: `OK = 0` (`:1`),
`PRECONDITION = 2` (`:2`), `INTEGRITY_FAILED = 4` (`:3`). Documented in the command's own help
(`src/commands/migration-check.ts:630-631`).

- 0 at `migration-check.ts:423` (holistic, no failures) and `:607` (single-target, no failures).
- 2 at `:388` (aggregate load failed), `:407` (bad `--space`), `:482`/`:487` (single-target
  `--space` invalid/not found), `:511` (target path outside the app dir), `:550` (ambiguous ref
  across spaces), `:562` (ref unresolvable in every space), `:573` (target not on disk),
  `:662` (any thrown error).
- 4 at `:429` (holistic) and `:613` (single-target).

Exits happen at `:673` (structured-error branch) and `:698` (result branch).

#### 3.3.4 Scheme D — the clipanion `migration.ts` CLI's 0/1/2

`src/migration-cli.ts:181-186` documents the contract; the raise sites are:

- 0 — success, `--help`, or the imported-not-entrypoint no-op (`:198`, `:206`, `:296`, `:305`, `:310`).
- **1 — expected runtime failure**: config not found, `MIGRATION.TARGET_MISMATCH` (`:566`),
  `MIGRATION.INVALID_JSON` (`:490`), anything else thrown by `runMigration`; all funnel through `:325`.
- 2 — usage error: malformed `--config` (`:280`) or unknown flag (`:391`, `:400`).

#### 3.3.5 The non-conforming exit-1 sites

| site | condition | why it matters |
|---|---|---|
| `src/commands/db-verify.ts:605` | full-mode schema drift | drift is the command's documented outcome, not a crash |
| `src/commands/db-verify.ts:566` | `--schema-only` drift | same |
| `src/commands/db-sign.ts:324` | schema verification failed, so the signature was not written | same |
| `src/commands/init/init.ts:641-642, :645-649` | invalid output document / unknown code | the only 1 that actually means "bug" |
| `src/cli.ts:194-198` | unhandled commander error | also means "bug" |

Neither `db verify` nor `db sign` has a co-located `exit-codes.ts`, so their 1 is undeclared.

#### 3.3.6 The semantic collisions

- **1 means four different things**: internal bug (`init`, commander), expected drift
  (`db verify`), expected verify failure (`db sign`), and expected runtime failure
  (`migration-cli`). The Style Guide reserves 1 for "this should not have happened"
  (`docs/CLI Style Guide.md:160`), and the v8 engine reserves it for bugs only. Note that the
  `migration-cli` meaning **persists after the port** — that CLI is out of scope for S5 (§5), so
  the collision between it and the main CLI's 1 does not go away.
- **2 means five different things**: every structured failure (funnel), precondition only
  (`init`, `migration check`), usage error (`migration-cli`, commander), and a declined
  destructive prompt (`db update`, which should be 3).
- **3 exists in two schemes and is absent from a third**: the funnel and `init` use it for
  "user aborted"; `migration-cli` has no 3; `db update` never produces one even though
  declining its destructive prompt is exactly that case.
- **4 means two opposite things**: `init` = dependency install failed (an error), `migration
  check` = the run completed and found integrity failures (a finding). The v8 engine's 4–99
  band is for documented per-command outcomes, so `migration check`'s 4 ports cleanly and
  `init`'s 4 does not — it is an error that must move into the 2 band or be redocumented.
- **130 is produced only by the shutdown handler**; no command produces 143.

#### 3.3.7 Error-code census highlights

Codes that appear as the envelope `code`: `CLI.FILE_NOT_FOUND`, `CLI.INVALID_VERIFY_MODE`,
`CLI.INVALID_OUTPUT_FORMAT`, `CLI.OUTPUT_FORMAT_CONFLICT`, `CLI.CONFIG_ARG_MISSING_PATH`,
`CLI.UNKNOWN_FLAG`, `CLI.UNEXPECTED`, the twelve `CLI.INIT_*` codes,
`CONFIG.{FILE_NOT_FOUND,CONTRACT_MISSING,VALIDATION_FAILED,DB_CONNECTION_REQUIRED,DRIVER_REQUIRED,MISSING_EXTENSION_PACKS,FAMILY_READ_MARKER_REQUIRED,QUERY_RUNNER_FACTORY_REQUIRED}`,
`CONTRACT.{VALIDATION_FAILED,MODULE_EXPORT_MISSING,EXPORT_INVALID,SOURCE_LOAD_FAILED,SOURCE_IMPORT_DISALLOWED,UNREADABLE,MARKER_REQUIRED,MARKER_MISSING,MARKER_MISMATCH,TARGET_MISMATCH,SCHEMA_VERIFICATION_FAILED,VERIFY_FAILED}`,
`DRIVER.{ALREADY_CONNECTED,NOT_CONNECTED}`,
`MIGRATION.{TARGET_UNSUPPORTED,CONTRACT_SPACE_VIOLATION,CONTRACT_SPACE_LAYOUT_VIOLATION,DESTRUCTIVE_CHANGES,TARGET_MISMATCH,INVALID_JSON,HASH_MISMATCH,UNFILLED_PLACEHOLDER,FILE_MISSING,INVALID_DEFAULT_EXPORT,PLAN_NOT_ARRAY}`,
`PSL.PARSE_FAILED`.
`CLI.JSON_FORMAT_UNSUPPORTED` is declared
(`packages/1-framework/1-core/errors/src/control.ts:252`) and **never raised**.

Codes that live only in `meta.code` behind `CONTRACT.VERIFY_FAILED`:
`MIGRATION.HASH_NOT_IN_GRAPH` (`src/utils/cli-errors.ts:93`, `:210`),
`REF_SET_EMPTY_SENTINEL` (`:106`), `LEGEND_HUMAN_ONLY` (`:123`), `INVALID_SPACE_ID` (`:140`),
`SPACE_NOT_FOUND` (`:173`), `REF_SET_BUNDLE_NOT_FOUND` (`:185`), `SNAPSHOT_MISSING` (`:244`),
`MARKER_MISMATCH` (`:271`), `PATH_UNREACHABLE` (`:339`), `AMBIGUOUS_MIGRATION_REF` (`:413`),
`MARKER_ORIGIN_MISMATCH` (`src/commands/db-init.ts:56`, `:83`),
`LEGACY_MARKER_SHAPE` (`db-init.ts:99`, `src/commands/db-update.ts:72`),
`MARKER_NOT_IN_HISTORY` / `MISSING_INVARIANTS` (`src/commands/migration-status.ts:218`, `:226`),
`CONTRACT_SNAPSHOT_MISSING` / `REF_NOT_RESOLVABLE` / `CONTRACT_DESERIALIZATION_FAILED` /
`BUNDLE_NOT_FOUND_FOR_GRAPH_NODE` (`src/utils/contract-at-errors.ts:18-63`).
Six **undotted** codes also appear in `meta.code`: `RUNNER_FAILED`
(`src/commands/db-init.ts:106`, `src/control-api/operations/db-run.ts:432`), `PLANNING_FAILED`
(`db-run.ts:335`), `CONTRACT_SOURCE_INVALID` (`src/control-api/client.ts:643`, `:668`),
`PROVIDER_THROW` (`client.ts:675`), `CONTRACT_VALIDATION_FAILED` (`client.ts:718`),
`EMIT_FAILED` (`client.ts:758`).

`migration check`'s 19 `MIGRATION.CHECK_*` codes are **findings, not envelopes**: they render
as `✗ [CODE] where: why` (`src/commands/migration-check.ts:691`) and carry no `--json` error
shape and no `docsUrl` (`src/utils/integrity-violation-to-check-failure.ts:34-133`).

Six failure paths produce **no code at all** — bare text on stderr even under `--json`:
`src/cli.ts:152-163`, `:418-422`, `:429`, `:439`, `:194`, and `src/commands/db-sign.ts:283`.

### 3.4 Telemetry machinery

Fired from a single commander `preAction` hook on the root program (`src/cli.ts:82-88`), inside
a try/catch. The hook is synchronous by construction: `fireTelemetryFromPreAction` resolves the
gates, then `fork()`s a detached sender, so the child survives an action body that throws
synchronously (`src/cli.ts:75-81`).

- **Exemption**: the whole `telemetry` group is skipped when `commandPath[1] === 'telemetry'`
  (`src/utils/telemetry.ts:156-158`, `:161-163`), so `telemetry disable` cannot send an event
  before disabling.
- **Gate order** (`src/utils/telemetry.ts:60-70`): CI (via `ci-info`, `src/utils/is-ci.ts:16-18`)
  → env opt-out → stored opt-out. `resolveGating`
  (`packages/1-framework/3-tooling/cli-telemetry/src/gating.ts:60-72`) is opt-out by default:
  absence of a stored choice means telemetry is ON (`gating.ts:52-56`).
  `PRISMA_NEXT_DISABLE_TELEMETRY` counts only when truthy — `''`, `'0'`, `'false'` read as unset
  (`gating.ts:32-39`); `DO_NOT_TRACK` must be exactly `'1'` (`gating.ts:64`).
- **There is no consent prompt anywhere in the CLI.** The only disclosure is a one-time stderr
  notice on the first enabled run (`src/utils/telemetry.ts:134-142`, text at `:113-120`), which
  mints an installation id but deliberately leaves `enableTelemetry` undefined so no unasked-for
  consent is recorded (`:122-132`, `cli-telemetry/src/user-config.ts:127-135`).
- **Per-user config**: `<configDir>/prisma-next/config.json`
  (`cli-telemetry/src/user-config.ts:23-24`, `:62-64`); `configDir()` at `:43-56` uses
  `%APPDATA%` on Windows and `$XDG_CONFIG_HOME` (falling back to `$HOME/.config`) elsewhere,
  including macOS. Writes are atomic (temp file + rename, `:108-115`).
- **Sender**: `fork(senderPath, [], { detached: true, stdio: ['pipe','ignore','ignore','ipc'] })`,
  `child.send(payload)`, `disconnect()`, `unref()`
  (`cli-telemetry/src/spawn.ts:107-118`); the child validates the payload with arktype, POSTs
  with a hard 1500 ms `AbortController` timeout, swallows every error, and always exits 0
  (`cli-telemetry/src/sender.ts:24`, `:38-45`, `:54-63`). Endpoint compiled in at
  `cli-telemetry/src/endpoint.ts:5,10`.
- **Fields sent** (`cli-telemetry/src/payload.ts:92-106`, assembled at `enrich.ts:185-206`):
  installation id, CLI version, command path, long flag names, runtime name/version, os, arch,
  package manager, database target id, TypeScript version, coding agent, extension pack ids.
  **Never sent**: positional arguments (accepted then dropped, `sanitize.ts:23-29`, `:60-69`),
  flag values, raw argv, defaulted options, or the project path.
- Stale doc comments at `spawn.ts:22`, `:89` and `payload.ts:48` reference a
  `fireTelemetryAfterInitConsent` function that **does not exist** in the codebase.

### 3.5 Interactivity, TTY, and CI machinery

Two independent signals, and only `init` uses the correct one for prompting.

- `flags.interactive` governs **decoration** (spinners, intro/outro, notes) and is derived from
  stdout: `--no-interactive` → false, else an explicit `--interactive`, else
  `!!process.stdout.isTTY` (`src/utils/global-flags.ts:169-175`).
- `deriveCanPrompt` (`src/utils/global-flags.ts:209-217`) is the correct prompt check —
  explicit `--interactive` forces true, `flags.interactive === false` forces false, otherwise
  **stdin**'s TTY decides. **Only `init` calls it** (`src/commands/init/index.ts:102-106`).
- `db update`'s destructive prompt gates on `flags.interactive` alone
  (`src/commands/db-update.ts:321-325`), and `ui.confirm` checks only `isInteractive`
  (`src/utils/terminal-ui.ts:271`) — so stdin is never consulted for the CLI's single most
  dangerous prompt. `ui.confirm` also returns `false` both when the user declines and when the
  user presses Ctrl-C (`terminal-ui.ts:270-278`); the two are indistinguishable.
- CI (`ci-info`, `src/utils/is-ci.ts:16`) affects **only** colour (`global-flags.ts:166`) and
  telemetry (`telemetry.ts:61`). CI is never consulted for prompting.
- `-y/--yes` never substitutes for `init`'s `--force` — that separation is explicit
  (`src/commands/init/inputs.ts:114-121`) — but it **is** the destructive-consent mechanism for
  `db update` (`src/commands/db-update.ts:174`).

Total prompts in the entire CLI: **seven**. Six live in `init`
(`src/commands/init/inputs.ts:327-336`, `:402-413`, `:416-429`, `:431-457`, `:202-222`,
`:296-304`); one lives in `db update` (`src/commands/db-update.ts:338`).

### 3.6 Local files and environment variables

**Files the CLI reads**: `prisma-next.config.ts` (discovered by `c12`,
`packages/1-framework/3-tooling/config-loader/src/load.ts:74-101`), `<contract.output>/contract.json`
and `contract.d.ts`, `migrations/<space>/<dir>/{migration.json,ops.json,migration.ts}`,
`migrations/snapshots/<hash>/{contract.json,contract.d.ts}`, `migrations/app/refs/<name>.json`,
`migrations/<space>/refs/head.json`, `package.json`, `tsconfig.json`.

**Files the CLI writes**: everything `init` scaffolds (§4.1), `contract.json`/`contract.d.ts`
(`contract emit`), `contract.prisma` (`contract infer`), the PSL source in place (`format`),
migration packages and snapshots (`migration plan`, `migration new`), ref files (`ref set`,
`--advance-ref`), and the telemetry user config.

**There is no dotenv anywhere.** The CLI never reads `DATABASE_URL` except in `init --probe-db`
(`src/commands/init/init.ts:469`), and even there it reads `process.env` directly and
deliberately ignores `.env` (`src/commands/init/probe-db.ts:100-102`). Every `--db $DATABASE_URL`
in the help text is shell expansion. Any `.env` behavior users experience comes from their own
config file calling `process.env`.

**Env var census**: `PRISMA_NEXT_TRACE` (`global-flags.ts:151`), `PRISMA_NEXT_DEBUG`
(`global-flags.ts:153`, also `cli-telemetry/src/sender.ts:27`), `NO_COLOR`
(`global-flags.ts:159`), `CLI_WIDTH` (`src/utils/formatters/help.ts:36`),
`PRISMA_NEXT_ENABLE_TEST_COMMANDS` (`src/cli.ts:348`), `PRISMA_NEXT_SKILLS_BASE`
(`src/commands/init/skill-install.ts:68`), `DATABASE_URL` (`init/init.ts:469`),
`npm_config_user_agent` (`init/detect-package-manager.ts:38`, `cli-telemetry/src/enrich.ts:200`),
`DO_NOT_TRACK` and `PRISMA_NEXT_DISABLE_TELEMETRY` (`cli-telemetry/src/gating.ts:62-64`),
`PRISMA_NEXT_TELEMETRY_ENDPOINT` (`cli-telemetry/src/endpoint.ts:26`), `XDG_CONFIG_HOME` /
`APPDATA` (`cli-telemetry/src/user-config.ts:45-51`), plus the `CI` family via `ci-info`.

### 3.7 Spec discrepancies

Each item carries both a doc anchor and a code anchor. `SG` = `docs/CLI Style Guide.md`.

1. **`migration-cli`'s exit 1 means "expected failure", the Style Guide reserves 1 for bugs.**
   `SG:160` and `SG:95` ("Only an internal bug or uncaught error exits 1") vs
   `src/migration-cli.ts:181-186` documenting 1 as "runtime/orchestration error (config not
   found, target mismatch)", raised at `src/migration-cli.ts:325`. **Recorded, not actioned:**
   the clipanion migration-file CLI is out of scope for S5 (§5) and keeps its 0/1/2 scheme.
2. **`db verify` and `db sign` exit 1 on their documented outcomes.** `SG:160` (1 = "this should
   not have happened") and `SG:219-221` (drift is a `db verify` outcome) vs
   `src/commands/db-verify.ts:566`, `:605` and `src/commands/db-sign.ts:324`. Neither command has
   the co-located `exit-codes.ts` module `SG:170` requires.
3. **A declined destructive prompt exits 2, not 3.** `SG:162` reserves 3 for "the user explicitly
   declined an interactive prompt" vs `src/commands/db-update.ts:338` falling through to
   `src/utils/result-handler.ts:43`, which maps `MIGRATION.DESTRUCTIVE_CHANGES` to 2.
4. **No-arg and bare-group invocations exit 0.** `SG:161` classifies missing required input as 2
   vs `src/cli.ts:394` and `src/cli.ts:455`; the code's own FOLLOW-UP comments at
   `src/cli.ts:386-389` and `:450-451` agree this is wrong.
5. **`--format` is implemented but documented nowhere.** `SG:252` and `SG:288` enumerate the
   global flags and omit it, even though `src/utils/command-helpers.ts:376-379` makes it the
   primary control and `--json` merely its alias (`:380`).
6. **JSON is auto-selected off-TTY, undocumented.** `SG:209` says `--json` outputs JSON
   "regardless of TTY mode", implying opt-in, vs `src/utils/global-flags.ts:67-69` which selects
   JSON whenever stdout is not a TTY, then forces `flags.json` (`:143-145`) and disables colour
   (`:159`).
7. **`--config` and `--db` are documented as global but are per-command.** `SG:252`, `SG:288` vs
   `src/utils/command-helpers.ts:368-389` (which registers neither) and per-command
   re-declarations at e.g. `src/commands/db-verify.ts:520-521`, `src/commands/migrate.ts:892-893`.
8. **`--trace` prints no stack traces.** `SG:58` ("deep internals, stack traces"), `SG:102`
   (diffs auto at `--trace`), `SG:104-105` (full timings, scrubbed sample values) vs
   `src/utils/global-flags.ts:151-152`, which only sets verbosity 2; the only consumer that
   differs from `-v` dumps `meta` as JSON (`src/utils/formatters/errors.ts:109`).
9. **`--show-sql`, `--show-diff`, `--max-sql-lines <n>` do not exist.** `SG:101-102`, `SG:254-255`
   vs a repo-wide search of `src/**` returning zero hits.
10. **`contract emit --out <dir>` does not exist, and the Style Guide contradicts itself.**
    `SG:254` and `SG:290` say `--out <dir>`; `SG:143` says `--output-path <dir>`; the code
    registers only `--output-path` (`src/commands/contract-emit.ts:172`).
11. **`migration plan --out <dir>` does not exist.** `SG:255` vs
    `src/commands/migration-plan.ts:740-751`, which registers only `--config`, `--name`,
    `--from`, `--to`.
12. **Every documented `db sign` flag is missing, including `--force`.** `SG:228`, `SG:256` list
    `--force`, `--dry-run`, `--include-contract-json`, `--app-tag`, `--canonical-version`, and
    `SG:134` requires `--force` to overwrite a marker; `src/commands/db-sign.ts:271-278`
    registers only `[contract]`, `--db`, `--config`, `--contract`.
13. **`-y` is the destructive-consent mechanism the Style Guide forbids.** `SG:115`, `SG:125-128`
    ("`-y`/`--yes` MUST NOT be a substitute for `--force`") and `SG:133` vs
    `src/commands/db-update.ts:174` mapping `flags.yes` → `acceptDataLoss: true`, with the shared
    error text at `packages/1-framework/1-core/errors/src/execution.ts:250` telling the user
    "Re-run with `-y` to apply". `docs/commands/SUMMARY.md:124` documents the code's behavior,
    contradicting the Style Guide.
14. **The destructive prompt never checks stdin.** `SG:114` requires
    `process.stdin.isTTY && process.stdout.isTTY` vs `src/commands/db-update.ts:321-325` and
    `src/utils/terminal-ui.ts:271`. The correct helper exists
    (`src/utils/global-flags.ts:209-217`) and is used only by `init`
    (`src/commands/init/index.ts:99-103`).
15. **Half the command surface is absent from the Style Guide.** `SG:14-20` and `SG:289-296` omit
    `format` (`src/cli.ts:325`), `lsp` (`:326`), `telemetry` (`:331`), `contract infer` (`:225`),
    `db init` (`:249`), `db update` (`:253`), `db schema` (`:257`), `migration new` (`:283`),
    `migration show` (`:286`), `migration log` (`:292`), `migration list` (`:295`),
    `migration graph` (`:298`).
16. **Human-readable prose goes to stdout in two places.** `SG:45` rule 7 ("never write
    decoration to stdout") vs `src/commands/migrate.ts:922` (`--show` non-JSON branch, with a
    comment stating the bypass is intentional) and `src/commands/telemetry/index.ts:36`, `:57`,
    `:78`.
17. **Unknown-command and redirect paths emit no error code and no JSON envelope.** `SG:87`
    requires a dotted code on every error vs `src/cli.ts:152-163`, `:418-422`, `:429`, `:439`.
    The redirect exit code itself (2) does match `SG:190-194`.
18. **The documented dotted code is usually not the code emitted.** `SG:87`, `SG:186` ("scripts
    MUST match on the error code") and `docs/reference/error-reference.md:786-788`, `:842-844`,
    `:942-944` (each describing "the envelope" as carrying `MIGRATION.HASH_NOT_IN_GRAPH`,
    `LEGEND_HUMAN_ONLY`, `SPACE_NOT_FOUND`) vs `errorRuntime` hard-coding
    `CONTRACT.VERIFY_FAILED` at
    `packages/1-framework/1-core/errors/src/execution.ts:266`. `error-reference.md:346`
    documents the generic code, so the reference contradicts itself.
19. **Undotted codes are emitted.** `SG:87` mandates `NAMESPACE.SUBCODE` vs `'RUNNER_FAILED'`
    (`src/commands/db-init.ts:106-107`), `'PLANNING_FAILED'`
    (`src/control-api/operations/db-run.ts:335`), `'CONTRACT_SOURCE_INVALID'`
    (`src/control-api/client.ts:643`), `'PROVIDER_THROW'` (`:675`),
    `'CONTRACT_VALIDATION_FAILED'` (`:718`), `'EMIT_FAILED'` (`:758`).
    `docs/commands/SUMMARY.md:82`, `:89`, `:96`, `:99` document the undotted forms as
    user-visible.
20. **`MIGRATION.SCHEMA_VERIFY_FAILED` is documented but never raised by the CLI.**
    `docs/reference/error-reference.md:934` vs the CLI raising
    `CONTRACT.SCHEMA_VERIFICATION_FAILED`
    (`packages/1-framework/1-core/errors/src/execution.ts:207`); the `MIGRATION.` form exists
    only inside target runners
    (`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts:144`).
21. **The "More:" line and per-code docs link are unimplemented.** `SG:93` specifies a final line
    hinting `-v`/`--trace` plus a per-code docs URL vs
    `src/utils/formatters/errors.ts:32-113`, which emits no hint and prints `docsUrl` only when
    the envelope already carries one **and** `-v` is set (`:99-101`). No `execution.ts` or
    `migration.ts` factory populates `docsUrl`, so the codes the CLI raises most often carry no
    link.
22. **`db sign`'s positional/flag conflict is an unstructured error.** `SG:87` (dotted code on
    every failure) and `SG:96` (`meta.missingFlags` for flag problems) vs
    `src/commands/db-sign.ts:283-286`, which writes a bare English line to stderr and exits 2
    with no envelope and no JSON path.
23. **`--quiet` is overridden by `db verify`.** `SG:58` defines quiet as "errors only" vs
    `src/commands/db-verify.ts:553` and `:596` rebuilding flags as `{...flags, quiet: false}` to
    print drift. Defensible, but undocumented.
24. **The documented JSON error schema omits `ok`.** `SG:94` lists
    `{code, severity, summary, why, fix, where, meta, docsUrl}` while `SG:212` says success and
    error documents share an `ok` discriminator; the envelope does emit `ok: false`
    (`packages/1-framework/1-core/errors/src/control.ts:84`), so `SG:94` is simply incomplete.
25. **Telemetry.md is accurate about consent, but its "verbatim" notice text cannot hold.**
    `docs/Telemetry.md:5` and `:140` correctly state there is no interactive consent prompt, and
    `src/utils/telemetry.ts:134-142` matches. However `docs/Telemetry.md:146` reproduces the
    notice verbatim as one sentence, while `src/utils/telemetry.ts:113-120` builds it by joining
    four fragments — any reflow silently breaks the promise.

---

## 4. Per-command inventory

Global flags (§3.1) are attached to every command and are not repeated per entry.
"Errors:" lists give the dotted code and the exit code together.

### `prisma-next init`

- **Summary**: scaffolds a Prisma Next project — schema, config, db client, quick reference,
  hygiene files — then installs dependencies, emits the contract, and installs the agent skills.
  Factory at `src/commands/init/index.ts:45`; the run body is lazily imported (`:100`) and its
  return value is passed to `process.exit` (`:107-112`).
- **Flags**:

| name | type | default | required | description |
|---|---|---|---|---|
| `--target <db>` | `postgres\|postgresql\|mongo\|mongodb`, case-insensitive | prompted | yes when non-interactive | `index.ts:75`; aliases `inputs.ts:83-88` |
| `--authoring <style>` | `psl\|typescript\|ts` | prompted | yes when non-interactive | `index.ts:76`; aliases `inputs.ts:90-94` |
| `--schema-path <path>` | string | `src/prisma/contract.prisma` (psl) / `.ts` | no | `index.ts:77-80`; defaults `templates/code-templates.ts:63-68` |
| `--force` | boolean | false | no | overwrite an existing scaffold without prompting (`index.ts:81`) |
| `--write-env` | boolean | false | no | also write `.env` from `.env.example` (`index.ts:82-85`) |
| `--probe-db` | boolean | false | no | connect once to `DATABASE_URL` and check server version (`index.ts:86-89`) |
| `--strict-probe` | boolean | false | no | treat a failed probe as fatal; errors without `--probe-db` (`index.ts:90-93`, check `inputs.ts:125-127`) |
| `--no-install` | negated boolean | install enabled | no | skip install + emit (`index.ts:94`, read at `inputs.ts:192`) |
| `--no-skill` | negated boolean | skills enabled | no | skip the skills install (`index.ts:95-98`, read at `inputs.ts:186`) |

- **Positionals**: none — `init` always operates on `process.cwd()` (`index.ts:107`).
- **Auth**: none. `--probe-db` reads `DATABASE_URL` from `process.env` only
  (`init.ts:469`; `.env` deliberately ignored, `probe-db.ts:100-102`). Package-manager stderr is
  redacted of URL userinfo before surfacing (`init.ts:936-940`, `skill-install.ts:229-232`,
  `probe-db.ts:205-208`).
- **API calls**: one — `executeContractEmit` called **in-process**, not shelled out
  (`init.ts:958-960`).
- **Behavior**: clack intro to stderr unless `--json`/`--quiet` (`init.ts:141-143`) → resolve
  inputs (`:147`) → detect the package manager by lockfile/`packageManager` field, then
  `npm_config_user_agent`, then `npm` (`detect-package-manager.ts:33-43`) → **a precondition
  phase computes every write before touching disk** (`init.ts:163-380`) → write loop with
  `mkdirSync` recursive per parent (`:389-397`) → unlink stale artifacts tolerating ENOENT
  (`:407-420`) → install (`:774-786`) → emit (`:446-457`) → optional probe (`:464-481`) →
  skills install (`:503-527`) → arktype-validate the success document, routing a failure through
  the error path (`:557-577`).
- **Output**: `--json` writes the success document to stdout (`init.ts:579-580`, serializer
  `output.ts:50-52`); human mode writes everything to stderr (`output.ts:61-106`, outro at
  `init.ts:582-585`). JSON shape (`output.ts:19-40`): `ok`, `target`, `authoring`, `schemaPath`,
  `filesWritten[]`, `filesDeleted[]`, `packagesInstalled{skipped,deps[],devDeps[]}`,
  `contractEmitted`, `nextSteps[]`, `warnings[]`. Errors go to stdout in JSON mode, stderr
  otherwise (`init.ts:598-606`).
  Errors: `CLI.INIT_REINIT_NEEDS_FORCE` exit 2, `CLI.INIT_MISSING_FLAGS` exit 2,
  `CLI.INIT_INVALID_FLAG_VALUE` exit 2, `CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH` exit 2,
  `CLI.INIT_STRICT_PROBE_WITHOUT_PROBE` exit 2, `CLI.INIT_INVALID_MANIFEST` exit 2,
  `CLI.INIT_INVALID_TSCONFIG` exit 2, `CLI.INIT_PROBE_FAILED` exit 2,
  `CLI.INIT_USER_ABORTED` exit 3, `CLI.INIT_INSTALL_FAILED` exit 4, `CLI.INIT_EMIT_FAILED`
  exit 5, `CLI.INIT_SKILL_INSTALL_FAILED` exit 6, `CLI.INIT_INVALID_OUTPUT_DOCUMENT` exit 1
  (mapping `init.ts:624-651`, factories `errors.ts:9-284`).
- **Prompts**: six, all clack, all on stderr — re-init confirm (`inputs.ts:327-336`), target
  select (`:402-413`), authoring select (`:416-429`), schema-path text with inline validation
  (`:431-457`), write-`.env` confirm (`:202-222`), remove-previous-facade confirm (`:296-304`).
  Every cancellation throws `CLI.INIT_USER_ABORTED` (`errors.ts:115`).
- **Side effects**: writes `<schemaPath>` (`init.ts:179-182`), `prisma-next.config.ts`
  (`:183-186`), `<schemaDir>/db.ts` (`:187`), `prisma-next.md` (`:188-197`), `.env.example`
  (`:198`), `.env` when `--write-env` and absent (`:221-229`), `tsconfig.json` merged or default
  (`:251-258`), `.gitignore` when an entry is missing (`:261-268`), `.gitattributes` when a
  `linguist-generated` line is missing (`:273-283`), `package.json` when merged or synthesised
  (`:296-350`), `README.md` when `src/index.ts` exists and `README.md` does not (`:362-380`).
  Deletes on re-init `<schemaDir>/{contract.json,contract.d.ts,ops.json,migration.json}`
  (`:208`, filenames `reinit-cleanup.ts:20-25`) and on **every** run
  `.agents/skills/prisma-next/SKILL.md` (`:214-216`).
  **Spawns package managers**: `<pm> add <facade> dotenv` (`:776`), `<pm> add -D prisma-next
  [@types/node]` (`:777`), an npm retry when a recognised pnpm workspace/catalog error matches
  (`:798`, matcher `:888-897`), and three sequential `skills@latest add …` installs
  (`skill-install.ts:195-208`).
- **Tests**: `test/commands/init/*.test.ts` (10 files); `test/help.snapshot.test.ts:54`;
  repo-relative `test/integration/test/cli-journeys/init-journey.e2e.test.ts:50`,
  `test/integration/test/cli.init-templates.e2e.test.ts`,
  `cli.init-facade-imports.e2e.test.ts`, `cli.init-skill-distribution.integration.test.ts`,
  plus ~18 journeys that bootstrap with `init`.
- **Engine notes**: result-command with `needs.interaction` (six prompts) and `needs.consent`
  (the re-init overwrite). **The hard blocker is engine rule R13: the CLI never touches a
  package manager, and `init` spawns one four times** (`init.ts:776`, `:777`, `:798`,
  `skill-install.ts:198`) — flagging, not resolving. Secondary hazards: the pnpm→npm fallback
  matches English error substrings (`init.ts:888-897`); the probe resolves `pg`/`mongodb` from
  the user's `node_modules` via CJS `createRequire` (`probe-db.ts:303-315`); `init`'s exit 4 is
  an error, colliding with the engine's 4–99 documented-outcome band; the six-code scheme must
  either be re-declared as typed `exitCodes` or collapsed into 2.

### `prisma-next migrate [--db <url>] [--config <path>] [--to <contract>] [--advance-ref <name>] [--show] [--from <contract>]`

- **Summary**: replay-only application of pending on-disk migrations across every contract space
  (extensions alphabetically, then app); it graph-walks and never invents an edge
  (`src/commands/migrate.ts:873-883`, `src/control-api/operations/migrate.ts:96-115`).
- **Flags**: `--db <url>` (`migrate.ts:892`, default `config.db.connection` at `:602`),
  `--config <path>` (`:893`), `--to <contract>` (`:894-897`), `--advance-ref <name>` (`:898`),
  `--show` (`:899`), `--from <contract>` — `--show` only (`:900-903`).
- **Positionals**: none.
- **Auth**: live DB required; `options.db ?? config.db?.connection` (`:602`), a `config.driver`
  separately required (`:612-618`).
- **API calls**: `client.connect`, `client.readAllMarkers`, `client.migrate`, `client.close`
  (`:735-746`, `:808-814`, `:869`). `--show` calls connect/readAllMarkers/close only
  (`:325-355`) and reuses the same `planSpacePath` seam (`:377-383`).
- **Behavior**: load config → require DB, driver, and a migration-capable target (`:602-626`) →
  deserialize `contract.json` through the family serializer (`:639-669`) → load the
  contract-space aggregate, refusing on integrity violations (`:671-690`) → resolve `--to`
  (`:692-707`) → connect and refuse when the app marker is not a graph node (`:746-757`) →
  reject unknown ref invariants (`:759-775`) → apply → optional ref advancement (`:822-842`).
- **Output**: styled header to stderr (`:709-731`); results to stdout (`:917-935`). `MigrateResult`
  shape at `:124-144`; `MigrateShowResult` at `:99-122`.
  Errors: `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:603-610`), `CONFIG.DRIVER_REQUIRED` exit 2
  (`:612-618`), `MIGRATION.TARGET_UNSUPPORTED` exit 2 (`:620-626`), `CLI.FILE_NOT_FOUND` exit 2
  (`:645-651`), `CONTRACT.VALIDATION_FAILED` exit 2 (`:653-669`), `CONTRACT.VERIFY_FAILED` exit 2
  carrying `meta.code` `MIGRATION.MARKER_MISMATCH` (`:749-757`), `MIGRATION.PATH_UNREACHABLE`
  (`:390-409`, `:579-588`), or a migration-tools code (`:765-774`), `CLI.UNEXPECTED` exit 2
  (`:863-867`).
- **Prompts**: none. `-y` is accepted and unused.
- **Side effects**: DDL plus per-space marker rows inside each space's transaction
  (`operations/run-migration.ts:106-116`, `:159`) and ledger rows. Disk writes only with
  `--advance-ref`: `migrations/snapshots/<hash>/{contract.json,contract.d.ts}` and
  `migrations/app/refs/<name>.json` (`:829-835`, `src/utils/ref-advancement.ts:39-58`).
- **Tests**: `test/commands/{migration-apply,migrate-show,migrate-to-contract,migration-invariants,migration-tamper}.test.ts`,
  `test/control-api/{apply,apply.progress,migrate-plan-space-path}.test.ts`,
  `test/output.migration-commands.test.ts`; e2e `cli.migration-apply.e2e.test.ts`,
  `cli.migrate-drift-check.e2e.test.ts`, `cli.migrate-external-space.e2e.test.ts`,
  `cli.migrate-ref-advancement.e2e.test.ts`, plus eleven journeys.
- **Engine notes**: result-command with progress events. Hazards: `EMPTY_CONTRACT_HASH` is a
  hash-shaped sentinel for "greenfield" used as a from-state (`:308`, `:400`, `:492`) while
  `buildPathNotFoundFailure` uses the string literal `'<empty>'` for the same idea
  (`operations/migrate.ts:631`) and `errorPathUnreachable` special-cases that literal
  (`cli-errors.ts:281-283`) — two spellings of "empty" that must not be conflated. `'app'` is
  hardcoded as the app space id at `:747` and `operations/migrate.ts:637`. `--show`'s human
  formatter hardcodes the renderer's layout constants (`:566`). Also §3.7 item 16: `--show`
  writes human prose to stdout.

### `prisma-next format [--config <path>]`

- **Summary**: formats the PSL source declared in `contract.source.inputs[0]` in place; a no-op
  when the source format is not `psl` (`src/commands/format.ts:20`).
- **Flags**: `--config <path>`, default `prisma-next.config.ts` (`format.ts:36`, `:42-44`).
- **Positionals**: none. **Auth**: none — one local file read and written.
- **API calls**: `executeFormat` (`src/control-api/operations/format.ts:29`), called at
  `format.ts:55`; internally `loadConfig` (`:36`) and `format()` from `@internal/psl-parser`
  (`:73`).
- **Behavior**: non-`psl` source returns `{formatted:false}` (`operations/format.ts:44-47`), as
  does a missing `inputs[0]` (`:49-52`). Indent defaults to 2, newline from
  `config.formatter.newline` or `os.EOL` (`:66-69`, resolver `:19-27`).
- **Output**: `--json` prints `{formatted, path?}` to stdout (`format.ts:59-61`); `--quiet`
  prints nothing (`:62-64`); otherwise a success line or "Nothing to format" on stderr
  (`:65-69`).
  Errors: `CONFIG.FILE_NOT_FOUND` / `CONFIG.VALIDATION_FAILED` exit 2
  (`operations/format.ts:36-42`), `CONTRACT.VERIFY_FAILED` exit 2 for unreadable source, PSL
  parse errors, and unwritable output (`:59`, `:77`, `:91`), `CLI.UNEXPECTED` exit 2 (`:41`,
  `:84`).
- **Prompts**: none. **Side effects**: one in-place file overwrite
  (`operations/format.ts:88`).
- **Tests**: `test/control-api/format.test.ts`; repo-relative
  `test/integration/test/cli-journeys/format.e2e.test.ts`. Note
  `test/commands/format-status-summary.test.ts` covers `migration status`, not this command
  (`format-status-summary.test.ts:6`).
- **Engine notes**: the cleanest port candidate — a pure function over PSL text
  (`operations/format.ts:73`). Hazards: newline resolution depends on host `os.EOL` (`:32`);
  only `inputs[0]` is formatted, silently ignoring the rest (`:49`).

### `prisma-next lsp [--stdio]`

- **Summary**: starts an LSP server over stdio publishing PSL diagnostics and whole-document
  formatting for `contract.source.inputs` (`src/commands/lsp.ts:8`).
- **Flags**: `--stdio` (`lsp.ts:23`) — **the value is never read**; the action ignores its options
  entirely (`:24`). There is deliberately no `--config`, pinned by a test
  (`test/commands/lsp.test.ts:15`).
- **Positionals**: none. **Auth**: none. **API calls**: none — a lazy import of
  `@internal/language-server` then `startServer()` (`lsp.ts:27-28`), lazy specifically to keep
  `vscode-languageserver` off other commands' startup path (`:25-26`).
- **Behavior**: never resolves; the process lives until the editor client disconnects (`:24-28`).
  **Alone among the commands it does not parse global flags, build a `TerminalUI`, or call
  `process.exit`** — `--json`/`--quiet`/`--format` are accepted and inert.
- **Output**: LSP JSON-RPC frames on stdin/stdout, owned by the language server.
  Errors: none surfaced by this file; the exit code is whatever `startServer()`/Node produces.
- **Prompts / side effects**: none, beyond taking over the process's stdio.
- **Tests**: `test/commands/lsp.test.ts` — three surface assertions only (`:6-9`, `:11-17`,
  `:19-24`); no e2e run of the server.
- **Engine notes**: **the canonical server-command** (`defineServerCommand`,
  `cli-engine/src/commands.ts:346`): raw stdio handover, no shared flags, handler returns an exit
  code. The port must keep tolerating and ignoring `--stdio`. All real porting risk lives in
  `@internal/language-server`, which has no exit-code or error contract to preserve.

### `prisma-next contract emit [--config <path>] [--output-path <dir>]`

- **Summary**: loads the config, resolves the contract source provider, and emits
  `contract.json` + `contract.d.ts` as an atomic pair
  (`src/commands/contract-emit.ts:156-197`, `src/control-api/operations/contract-emit.ts:154-304`).
- **Flags**: `--config <path>` (`contract-emit.ts:171`, display default `:122`),
  `--output-path <dir>` (`:172`), joined as `<dir>/contract.json`
  (`operations/contract-emit.ts:170-171`).
- **Positionals**: none. **Auth**: none — never connects to a database.
- **API calls**: `executeContractEmit` (`operations/contract-emit.ts:154`), invoked at
  `contract-emit.ts:126-130`.
- **Behavior**: **loads the config a second time solely to compute header display paths**
  (`contract-emit.ts:45-89`, redundancy documented at `:39-44`). Work is serialized per output
  JSON path by `queueEmitByOutput` (`operations/contract-emit.ts:195`), an in-process mutex only.
  Publication stages temp files and renames `.d.ts` before `.json` (`:280-286`).
- **Output**: JSON to stdout (`contract-emit.ts:182`), shape
  `{ok, storageHash, executionHash?, profileHash?, outDir, files:{json,dts}, timings}`
  (`src/utils/formatters/emit.ts:55-67`); human output to stderr (`:184-190`), empty under
  `--quiet` (`formatters/emit.ts:26-28`).
  Errors: `CONFIG.FILE_NOT_FOUND` exit 2, `CONFIG.VALIDATION_FAILED` exit 2,
  `CONFIG.CONTRACT_MISSING` exit 2 (`contract-emit.ts:72`,
  `operations/contract-emit.ts:163,175,181,189`), `CONTRACT.VERIFY_FAILED` exit 2
  (`operations/contract-emit.ts:43`), `CLI.UNEXPECTED` exit 2 (`contract-emit.ts:61`, `:136`).
- **Prompts**: none. **Side effects**: writes `contract.json` and `contract.d.ts`, creating parent
  dirs (`operations/contract-emit.ts:279-286`).
- **Tests**: `test/commands/contract-emit.command.test.ts:25`,
  `test/control-api/contract-emit.test.ts:117`, `test/utils/emit-queue.test.ts`,
  `test/utils/publish-contract-artifact-pair.test.ts`,
  `test/utils/validate-contract-deps.test.ts`; seven `cli.emit*` integration files.
- **Engine notes**: result-command. Hazards: the double config load is a wasted `c12` round-trip;
  `queueEmitByOutput` gives no cross-process safety, so the port must decide whether concurrent
  emits are the CLI's problem; source-resolution failures carry a verify-flavoured code
  (§3.7 item 18).

### `prisma-next contract infer [--db <url>] [--config <path>] [--output <path>]`

- **Summary**: introspects the live database, asks the family to infer a PSL contract, prints it,
  and writes `contract.prisma`. Stops there — no emit, no sign
  (`src/commands/contract-infer.ts:96-130`, long description `:101-104`).
- **Flags**: `--db <url>` (`:111`), `--config <path>` (`:112`), `--output <path>` (`:113`).
- **Positionals**: none.
- **Auth**: live DB required. `options.db ?? config.db?.connection`
  (`src/commands/inspect-live-schema.ts:111`); missing → `CONFIG.DB_CONNECTION_REQUIRED`
  (`:112-119`); `config.driver` required (`:121-127`).
- **API calls**: `client.introspect`, `client.toSchemaView`, `client.inferPslContract`,
  `client.getPslBlockDescriptors` (`inspect-live-schema.ts:139-145`).
- **Behavior**: output path priority is `--output` → `contract.prisma` beside
  `config.contract.output` → `contract.prisma` in the config directory
  (`contract-infer-paths.ts:16-32`). A family that does not implement `PslContractInferCapable`
  fails (`contract-infer.ts:58-65`). **An existing file is overwritten with only a stderr
  warning, never a prompt** (`:70-75`).
- **Output**: two stderr lines in human mode (`:71`, `:79`); `--json` stringifies
  `{ok, summary, target, psl:{path}, meta, timings}` to stdout (`:82-93`, `:121-123`).
  Errors: `CONFIG.FILE_NOT_FOUND` / `CONFIG.VALIDATION_FAILED` exit 2
  (`inspect-live-schema.ts:71-83`), `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:114`),
  `CONFIG.DRIVER_REQUIRED` exit 2 (`:123`), `CONTRACT.VERIFY_FAILED` exit 2 for an unsupported
  family (`contract-infer.ts:60`), `CLI.UNEXPECTED` exit 2 (`inspect-live-schema.ts:79`, `:178`).
- **Prompts**: none. **Side effects**: `mkdirSync` + `writeFileSync` of the PSL file
  (`contract-infer.ts:74-75`); a read-only DB connection closed in `finally`
  (`inspect-live-schema.ts:182-184`).
- **Tests**: `test/commands/contract-infer.command.test.ts:150`,
  `test/commands/inspect-live-schema.test.ts:69`, `test/commands/db-introspect-paths.test.ts`;
  e2e `cli-journeys/contract-infer-workflow.e2e.test.ts`,
  `cli-journeys/infer-roundtrip-fidelity.e2e.test.ts`,
  `infer-roundtrip-runtime.integration.test.ts`.
- **Engine notes**: result-command. Hazards: uses `writeFileSync` rather than the staged-rename
  publication `contract emit` uses, so an interrupted run leaves a truncated `contract.prisma`;
  path resolution mixes `process.cwd()` and the config directory across three branches
  (`contract-infer-paths.ts:20-31`); the silent overwrite is a consent decision the engine should
  route through `needs.consent` + `--confirm`.

### `prisma-next db verify [--db <url>] [--config <path>] [--marker-only] [--schema-only] [--strict]`

- **Summary**: three modes over one command — `full` (marker + schema), `marker-only`,
  `schema-only` (`src/commands/db-verify.ts:501-609`).
- **Flags**: `--db <url>` (`:520`), `--config <path>` (`:521`), `--marker-only` (`:522`),
  `--schema-only` (`:523-526`), `--strict` (`:527-531`).
- **Positionals**: none.
- **Auth**: live DB required; connection resolved at `:293-302` with a mode-aware error message
  (`:176-186`); `config.driver` required (`:304-310`).
- **API calls**: `client.verify` (legacy single-contract marker check, `:376-380`) then
  `client.dbVerify` → `executeDbVerify` (`src/control-api/operations/db-verify.ts:103`), called
  at `:389-396`. Schema-only calls `client.connect` then `client.dbVerify` with
  `skipMarker: true` (`:475-483`).
- **Behavior**: `--marker-only --schema-only` and `--marker-only --strict` are both rejected
  (`:116-144`). **Full mode deliberately runs both verification pipelines** — the comment at
  `:369-375` explains they cover different failure lanes. Per-space schema results are collapsed
  by `combineVerifyResults` (`src/utils/combine-verify-results.ts:38-95`), which fails the
  combined verdict in strict mode when `unclaimed` is non-empty (`:64-65`).
- **Output**: success JSON to stdout via `formatVerifyJson` (`:576`), shape at
  `src/utils/formatters/verify.ts:140-158`; human output to stderr.
  Errors: `CLI.INVALID_VERIFY_MODE` exit 2 (`:109`), `CLI.FILE_NOT_FOUND` exit 2 (`:253-258`),
  `CONTRACT.VALIDATION_FAILED` exit 2 (`:280`, `:286`, `:335`),
  `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:296`), `CONFIG.DRIVER_REQUIRED` exit 2 (`:305`),
  `CONTRACT.MARKER_MISSING` exit 2 (`:68`), `CONTRACT.MARKER_MISMATCH` exit 2 (`:77`, `:84`),
  `CONTRACT.TARGET_MISMATCH` exit 2 (`:93`), `MIGRATION.CONTRACT_SPACE_VIOLATION` exit 2
  (`operations/db-verify.ts:258`, `:361`), `CONTRACT.VERIFY_FAILED` exit 2 (`:100`),
  `CLI.UNEXPECTED` exit 2 (`:261`, `:341`), and **schema drift exit 1 with no error envelope at
  all** (`:566` schema-only, `:605` full mode).
- **Prompts**: none. **Side effects**: none — read-only against disk and DB; `client.close()` in
  `finally` (`:453-455`, `:496-498`).
- **Quiet/JSON behavior**: `--json` suppresses the header (`:195`) and routes envelopes to stdout;
  **`--quiet` is deliberately overridden on drift**, both paths rebuilding flags as
  `{...flags, quiet: false}` with an explicit comment that exiting 1 silently is unhelpful
  (`:550-553`, `:594-599`).
- **Tests**: `test/control-api/db-verify.per-space-verifier.test.ts:12`,
  `test/utils/combine-verify-results.test.ts:33`, `test/output.test.ts:334,582`; e2e
  `cli.db-verify.e2e.test.ts`, `cli.db-verify.aggregate-schema.test.ts`,
  `cli.mongo-db-verify.e2e.test.ts`, `cli-journeys/drift-schema.e2e.test.ts` (exit-1 assertions
  at `:61`, `:69`, `:139`), `drift-marker.e2e.test.ts`, `brownfield-adoption.e2e.test.ts`,
  `greenfield-setup.e2e.test.ts`. `formatVerifyOutput`/`formatVerifyJson` have no direct unit
  test.
- **Engine notes**: **the canonical "completed with findings" case** — under the pending ADR-239
  amendment, drift becomes a COMPLETED envelope carrying diagnostics with a documented 4-band
  exit code, not a thrown error and not exit 1. The `--quiet` override disappears because
  diagnostics ride inside the envelope. Porting hazard: two independent verification pipelines
  run in full mode; collapsing them loses either the hash-mismatch surface or the
  orphan-marker/drift surface. `combineVerifyResults` synthesises a fallback code
  `CONTRACT.MARKER_REQUIRED` when the app space has none
  (`src/utils/combine-verify-results.ts:82`).

### `prisma-next db init [--db <url>] [--config <path>] [--dry-run] [--advance-ref <name>]`

- **Summary**: additive-only bootstrap of a database to match the emitted contract, then signs it
  (`src/commands/db-init.ts:263-306`).
- **Flags**: `--db <url>` (`src/utils/migration-command-scaffold.ts:181`), `--config <path>`
  (`:182`), `--dry-run` (`:183`), `--advance-ref <name>` (`db-init.ts:279`).
- **Positionals**: none.
- **Auth**: live DB required via the shared scaffold (`migration-command-scaffold.ts:126-149`).
- **API calls**: `client.connect` then `client.dbInit` (`db-init.ts:145-152`) → `executeDbInit`
  (`src/control-api/operations/db-init.ts:70`), which delegates to `executeRun` with
  `policy: { allowedOperationClasses: ['additive'] }` (`:84`).
- **Behavior**: the shared scaffold loads config, reads and parses `contract.json`, resolves the
  connection, builds the client and progress adapter, and prints the header
  (`migration-command-scaffold.ts:56-172`). Because the policy is additive-only, the destructive
  branch is unreachable here.
- **Output**: JSON to stdout via `formatMigrationJson` (`db-init.ts:290`); human output to stderr
  using the plan or apply formatter by mode (`:291-296`), empty under `--quiet`
  (`src/utils/formatters/migrations.ts:163`, `:421`).
  Errors: `MIGRATION.PLANNING_FAILED` exit 2 (`:53`), `MIGRATION.RUNNER_FAILED` exit 2 (`:102`),
  `CONTRACT.VERIFY_FAILED` exit 2 carrying `meta.code MIGRATION.MARKER_ORIGIN_MISMATCH`
  (`:77-90`), `MIGRATION.TARGET_UNSUPPORTED` exit 2
  (`migration-command-scaffold.ts:145`), `CLI.FILE_NOT_FOUND` exit 2 (`:99`),
  `CONTRACT.VALIDATION_FAILED` exit 2 (`:118`, `db-init.ts:242`),
  `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:129`), `CONFIG.DRIVER_REQUIRED` exit 2 (`:139`),
  `CLI.UNEXPECTED` exit 2 (`db-init.ts:254`).
- **Prompts**: none. **Side effects**: DDL in one outer transaction unless `--dry-run`
  (`operations/db-init.ts:22-29`), the marker row, and a ref file under `migrations/app/refs/`
  when `--advance-ref` is active (`db-init.ts:176-184`).
- **Tests**: `test/control-api/db-init.test.ts:34`, `test/control-api/apply.test.ts`,
  `apply.progress.test.ts`; e2e `cli.db-init.e2e.test.ts`, `cli.db-init.e2e.errors.test.ts`,
  `cli.db-init.contract-space-verifier.test.ts`, `cli.db-ref-advancement.e2e.test.ts`, journeys
  `greenfield-setup.e2e.test.ts`, `composite-pk-greenfield.e2e.test.ts`.
- **Engine notes**: result-command with progress events. Hazards: the `assertNever` exhaustiveness
  check on failure codes (`db-init.ts:112-113`) throws rather than degrading when the engine adds
  a code; `MIGRATION.MARKER_ORIGIN_MISMATCH` is smuggled into `CONTRACT.VERIFY_FAILED` via
  `meta.code` (`:83`), so promoting it to a first-class code changes the wire shape.

### `prisma-next db update [--db <url>] [--config <path>] [--dry-run] [--to <contract>] [--advance-ref <name>]`

- **Summary**: plans and applies additive, widening, and destructive changes, prompting before
  data loss (`src/commands/db-update.ts:289-362`).
- **Flags**: `--db <url>`, `--config <path>`, `--dry-run`
  (`src/utils/migration-command-scaffold.ts:181-183`), `--to <contract>` (`db-update.ts:304-307`),
  `--advance-ref <name>` (`:308`). `-y/--yes` is materially load-bearing here — it maps directly
  to `acceptDataLoss: true` (`:174`).
- **Positionals**: none. **Auth**: live DB required, same shared scaffold as `db init`.
- **API calls**: `client.connect` then `client.dbUpdate` (`:168-176`) → `executeDbUpdate`
  (`src/control-api/operations/db-update.ts:56`); with `--to`, also `buildReadAggregate` (`:124`)
  and `readContractSnapshotJson` (`:148`).
- **Behavior**: with `--to`, the ref is resolved against the migration graph and the contract is
  swapped for the matching bundle's snapshot (`:122-165`). The destructive check lives in the
  operation: on `mode: 'apply'` without `acceptDataLoss` it pre-plans, collects
  `operationClass === 'destructive'` ops, and returns a `DESTRUCTIVE_CHANGES` failure carrying
  `meta.destructiveOperations` (`operations/db-update.ts:73-76`, `:90-109`).
- **The prompt-rejection re-run**: confirmed. The first call returns
  `MIGRATION.DESTRUCTIVE_CHANGES` (`db-update.ts:315`); the handler checks four conditions —
  failure code, `flags.interactive`, not `--json`, not `--yes` (`:320-326`) — warns with the
  operation list (`:332-336`) and calls `ui.confirm` (`:338`). **On acceptance the entire command
  re-executes from scratch with `{...flags, yes: true}` and a fresh start time** (`:341`), so an
  accepted apply runs the pipeline three times: pre-plan check, first `executeDbUpdate`, then
  plan+apply on the re-run, each with its own connect/introspect cycle. On rejection nothing
  happens — the original failure stands and `handleResult` exits 2 (`:345`, `:358`).
- **Output**: JSON to stdout via `formatMigrationJson` (`:347`); human plan/apply formatter to
  stderr (`:349-355`).
  Errors: `MIGRATION.PLANNING_FAILED` exit 2 (`:63`), `MIGRATION.RUNNER_FAILED` exit 2 (`:75`),
  `MIGRATION.DESTRUCTIVE_CHANGES` exit 2 when unconfirmed (`:88`; asserted at
  `cli-journeys/drift-schema.e2e.test.ts:154`), the shared-scaffold family exit 2,
  ref-resolution failures exit 2 (`:133`, `:158`, `:211`), `CLI.UNEXPECTED` exit 2 (`:140`,
  `:280`) with the message passed through `sanitizeErrorMessage` so the connection string does
  not leak (`:274-278`).
- **Side effects**: destructive DDL, marker update, optional ref file write (`:199-208`).
- **Tests**: `test/control-api/db-update.test.ts:118` (destructive check at `:460`, progress at
  `:626`), `test/output.db-update.test.ts:72,231,413,498`,
  `test/commands/db-update-read-aggregate-json-golden.test.ts`,
  `test/commands/migrate-to-contract.test.ts`; e2e `cli.db-update.e2e.test.ts`,
  `.e2e.errors.test.ts`, `.contract-space-verifier.test.ts`, `.preflight-gaps.e2e.test.ts`,
  journeys `db-update-workflows`, `interleaved-db-update`, `drift-schema`.
- **Engine notes**: result-command plus `needs.consent`. **The re-run pattern must not be ported
  — the engine's prompt surface returns a consent token that the same invocation carries
  forward, and `--confirm` is the global non-interactive form; `-y` must stop meaning
  "accept data loss"** (§3.7 item 13). Declining must map to exit 3 (cancel), not 2. The prompt
  must move to `needs.interaction` so stdin is actually consulted (§3.7 item 14), and the
  Ctrl-C/decline ambiguity in `ui.confirm` (`terminal-ui.ts:270-278`) disappears with it.
  `sanitizeErrorMessage` is applied only on the generic catch, so a port that routes driver
  errors elsewhere could leak the connection string.

### `prisma-next db schema [--db <url>] [--config <path>]`

- **Summary**: read-only introspection of the live database, printed as a tree or JSON; never
  writes files (`src/commands/db-schema.ts:31-77`, description `:36-38`).
- **Flags**: `--db <url>` (`:46`), `--config <path>` (`:47`).
- **Positionals**: none. **Auth**: live DB required, same resolution as `contract infer`
  (`inspect-live-schema.ts:111-127`); the header masks credentials via `maskConnectionUrl`
  (`:95`, `:97`; `src/utils/command-helpers.ts:308-330`).
- **API calls**: `client.introspect`, `client.toSchemaView`, `client.inferPslContract`,
  `client.getPslBlockDescriptors` (`inspect-live-schema.ts:139-145`) — **`inferPslContract` runs
  on every invocation and its result is discarded** (`db-schema.ts:18-29`).
- **Behavior**: wraps the shared result into an `IntrospectSchemaResult` with a fixed summary
  (`:18-29`), then renders.
- **Output**: `--json` stringifies the whole result to stdout (`:64`,
  `src/utils/formatters/verify.ts:163-165`); human output is an ASCII/Unicode tree on stderr
  (`verify.ts:312-353`) with a one-line fallback when the family provides no schema view
  (`:336-345`), empty under `--quiet` (`:317-319`).
  Errors: `CONFIG.FILE_NOT_FOUND`, `CONFIG.VALIDATION_FAILED`, `CONFIG.DB_CONNECTION_REQUIRED`
  (`inspect-live-schema.ts:114`), `CONFIG.DRIVER_REQUIRED` (`:123`), `CLI.UNEXPECTED` (`:79`,
  `:178`) — all exit 2.
- **Prompts / side effects**: none.
- **Tests**: `test/commands/db-schema.command.test.ts:112`,
  `test/commands/inspect-live-schema.test.ts:69`, `test/output.test.ts:21,254`; e2e
  `cli.db-introspect.e2e.test.ts`, `cli.mongo-db-schema.e2e.test.ts`,
  `cli-journeys/db-schema-discovery.e2e.test.ts`.
- **Engine notes**: result-command. Hazards: the wasted `inferPslContract` call; the tree renderer
  reconstructs semantics by regex-matching family-produced label strings
  (`verify.ts:194-272`), so a label wording change silently degrades colouring.

### `prisma-next db sign [contract] [--db <url>] [--config <path>] [--contract <contract>]`

- **Summary**: verifies the live schema satisfies the contract (non-strict) and, if so, writes or
  updates the database signature. Idempotent (`src/commands/db-sign.ts:255-328`).
- **Flags**: `--db <url>` (`:272`), `--config <path>` (`:273`), `--contract <contract>` (`:274-277`).
- **Positionals**: `[contract]` — the same accepted ref forms as `--contract` (`:271`).
  Supplying both is rejected (`:281-287`); with only one, precedence is
  `contractArg ?? options.contract` (`:78`).
- **Auth**: live DB required (`:180-188`); `config.driver` required (`:191-193`).
- **API calls**: `client.schemaVerify` with `strict: false` (`:209-214`), then `client.sign`
  (`:222-227`). With a ref, also `buildReadAggregate` (`:103`) and `readContractSnapshotJson`
  (`:117`). There is no `operations/db-sign.ts` — the command drives the client directly.
- **Behavior**: with a ref, prefer the matching bundle's snapshot, else fall back to the emitted
  `contract.json` **only if its `storage.storageHash` equals the resolved hash**, else fail
  (`:110-137`). Without a ref, read and `JSON.parse` the emitted contract (`:148-176`).
- **Output**: success JSON to stdout via `formatSignJson` (`:296`,
  `src/utils/formatters/verify.ts:481-483`); human output to stderr via `formatSignOutput`
  (`verify.ts:451-460`), empty under `--quiet` (`:441-443`).
  Errors: positional + `--contract` both given → **exit 2 with raw stderr text and no envelope**
  (`:282-286`), `CLI.FILE_NOT_FOUND` exit 2 (`:154`), `CONTRACT.VALIDATION_FAILED` exit 2
  (`:171`, `:238`), `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:183`), `CONFIG.DRIVER_REQUIRED`
  exit 2 (`:192`), `CONTRACT.VERIFY_FAILED` exit 2 (`:131`), `CLI.UNEXPECTED` exit 2 (`:142`,
  `:161`, `:246`), ref-resolution failures exit 2 (`:112`, `:139`), and **schema verification
  failure → exit 1, rendered as a schema-verify report rather than an error envelope**
  (`:315-324`).
- **Prompts**: none. **Side effects**: writes the marker/signature row (`:222`); no file writes.
- **Tests**: `test/output.test.ts:756,884`, `test/commands/read-commands-json-golden.test.ts`;
  e2e `cli.db-sign.e2e.test.ts` (exit-1 assertions at `:367`, `:414`),
  `cli.mongo-db-sign.e2e.test.ts`, `family.sign-database.test.ts`,
  `cli-journeys/sign-the-database.e2e.test.ts`,
  `cli-journeys/db-sign-contract-arg.e2e.test.ts`.
- **Engine notes**: result-command; the verify-failure branch becomes a documented 4-band exit
  with diagnostics. **`db sign` is the only command here that parses the contract with a bare
  `JSON.parse` instead of crossing the family `deserializeContract` seam** (`:168`), where
  `db verify` explicitly does the opposite (`db-verify.ts:271-291`, comment `:267-270`) — resolve
  that asymmetry during the port. The dual positional/flag surface with a hand-rolled exclusion
  check that bypasses the structured-error machinery (`:282-286`) should become an engine arg
  conflict.

### `prisma-next migration plan [--config <path>] [--name <slug>] [--from <contract>] [--to <contract>]`

- **Summary**: fully offline. Compares the emitted contract against on-disk migration state and
  writes a new migration package (`src/commands/migration-plan.ts:728-733`).
- **Flags**: `--config <path>` (`:741`), `--name <slug>` default `'migration'` (`:742`),
  `--from <contract>` (`:743-746`), `--to <contract>` (`:747-750`). The `'migration'` default is
  duplicated in the code path at `:638` and `:493`.
- **Positionals**: none. **Auth**: none — the command never reads `config.db`, never creates a
  control client, and says so in its help (`:731-733`).
- **API calls**: none. Local only: `resolveFromForPlan`/`resolveToForPlan` (`:321-324`, `:363-365`),
  `runContractSpaceSeedPhase` (`:388-391`), `buildContractSpaceAggregate` (`:441-447`),
  `planner.plan(...)` (`:86-100`).
- **Behavior**: read and deserialize the emitted contract (`:246-291`) → resolve the from-state to
  one of `greenfield` / `graph-node` / `ref` / `auto-baseline`
  (`src/utils/plan-resolution.ts:28-44`) → **phase 1 seed, which unconditionally re-emits
  per-space pinned artifacts and materializes descriptor-shipped extension packages before the
  no-op check** (`:382-405`) → no-op check, exempt for auto-baseline (`:410-422`) → phase 2
  aggregate load (`:441-451`) → run the planner and write packages. Auto-baseline writes **two**
  packages with timestamps a literal 60 000 ms apart so the directory names sort correctly
  (`:490-495`, `:512-522`, `:582-593`). Unfilled `placeholder(...)` calls make the run write
  `ops: []` and report `pendingPlaceholders: true` (`:127-133`, `:149`, `:672-687`).
- **Output**: styled header and `ui.step` seed lines to stderr (`:220-243`, `:392-402`); result to
  stdout (`:758-764`). `MigrationPlanResult` shape at `:164-205`; human formatter at `:805-933`,
  with a timings line only under `--verbose` (`:927-930`).
  Errors: `CLI.FILE_NOT_FOUND` exit 2 (`:250-257`), `CONTRACT.VALIDATION_FAILED` exit 2
  (`:275-291`), `MIGRATION.TARGET_UNSUPPORTED` exit 2 (`:426-432`),
  `MIGRATION.PLANNING_FAILED` exit 2 (`:101-107`, `:114-126`), `CONTRACT.VERIFY_FAILED` exit 2
  carrying `meta.code` `MIGRATION.HASH_NOT_IN_GRAPH` (`plan-resolution.ts:66-80`, `:213`) or
  `MIGRATION.SNAPSHOT_MISSING` (`:207-212`), ref-resolution failures exit 2 (`:215`, `:242`),
  `CLI.UNEXPECTED` exit 2 (`:717-722`).
- **Prompts**: none. **Side effects**: the largest write footprint in the CLI — see §4 summary in
  `migration-plan.ts:388-391`, `:157-162`, `:462-479`, `:492-522`, `:590-593`, `:665-670`.
- **Tests**: `test/commands/migration-plan.test.ts`, `migration-plan-command.test.ts`,
  `migration-plan-renderer.test.ts`, `migration-e2e.test.ts`, `test/utils/plan-resolution.test.ts`,
  `test/control-api/migrate-plan-space-path.test.ts`; e2e
  `cli.migration-plan-ref-aware.e2e.test.ts`, `cli-journeys/migration-plan-details.e2e.test.ts`,
  `cli-journeys/plan-to-rollback.e2e.test.ts`.
- **Engine notes**: result-command. Hazards: the seed phase writes before the no-op
  short-circuit, so a "no changes" run still mutates the repo; `'baseline'` is a hardcoded slug
  (`:492`) and the 60 000 ms offset is a naming-collision workaround, not a semantic one (`:491`);
  the sentinel string `'empty'` is accepted alongside 64-hex by `FULL_HASH_PATTERN`
  (`plan-resolution.ts:22`); `formatMigrationDirName` lowercases and collapses non-`[a-z0-9]`
  characters, so slug collisions are possible
  (`packages/1-framework/3-tooling/migration/src/io.ts:456-470`).

### `prisma-next migration new [--name <slug>] [--from <hash>] [--config <path>]`

- **Summary**: scaffolds a migration package with a hand-authored `migration.ts` stub; the user
  then runs `node migration.ts` to self-emit `ops.json` and attest
  (`src/commands/migration-new.ts:257-263`).
- **Flags**: `--name <slug>` default `'migration'` (`:269`, `:172`), `--from <hash>` (`:270`),
  `--config <path>` (`:271`).
- **Positionals**: none. **Auth**: none — no DB connection, no client. **API calls**: none;
  local `loadContractSpaceAggregate` (`:127-131`) and
  `migrations.createPlanner(controlAdapter).emptyMigration(...)` (`:223-233`).
- **Behavior**: read and deserialize `contract.json`, requiring a `storageHash` (`:87-125`) →
  load the aggregate (`:127-135`) → resolve `fromHash`: `--from` matched by **prefix** against
  `metadata.to`, else the graph's latest migration, else `null` (`:140-160`) → refuse when
  `from === to` unless `--from` was explicit (`:162-169`) → attest over `ops: []` (`:171-189`) →
  validate the target and manifest before any write (`:191-210`) → write (`:212-234`).
- **Output**: header to stderr (`:276-284`), result to stdout (`:288-299`); `--json` prints
  `{ok, dir, from, to, summary}` (`:63-69`).
  Errors: `CONTRACT.VERIFY_FAILED` exit 2 for contract not found (`:94-99`), invalid JSON
  (`:109-114`), missing `storageHash` (`:119-124`), unmatched `--from` (`:145-152`), or no
  changes (`:163-168`); `MIGRATION.TARGET_UNSUPPORTED` exit 2 (`:193-197`); `CLI.UNEXPECTED`
  exit 2 (`:247-251`). Non-ENOENT read errors are re-thrown, not mapped (`:101`).
- **Prompts**: none. **Side effects**: `migrations/app/<dirName>/{migration.json,ops.json,migration.ts}`
  (`:212`, `:234`; `migration.ts` gets mode `0o755` when it starts with a shebang,
  `migration/src/migration-ts.ts:38-43`) and
  `migrations/snapshots/<toStorageHash>/{contract.json,contract.d.ts}` (`:218-221`).
  `writeMigrationPackage` refuses to clobber (`migration/src/io.ts:52-63`).
- **Tests**: `test/migration-cli.test.ts`, `test/commands/migration-tamper.test.ts`; e2e
  `cli-journeys/migration-new-import-root.e2e.test.ts`, `migration-round-trip.e2e.test.ts`,
  `invariant-routing.e2e.test.ts`, `invariant-routing.mongo.e2e.test.ts`,
  `mongo-migration.e2e.test.ts`. **No unit test under `test/commands/`.**
- **Engine notes**: result-command. Hazards: the package is attested over an empty ops list on
  purpose (`:176-189`); `--from` prefix matching has **no ambiguity check — the first match
  wins** (`:144`), unlike `resolveBundleByPrefix` in `migration-plan.ts:951-963`; `APP_SPACE_ID`
  is passed explicitly to `emptyMigration` (`:232`), so extension spaces are unreachable.

### `prisma-next migration show <target> [--config <path>]`

- **Summary**: offline. Prints operations, statement preview, and metadata for one **app-space**
  migration (`src/commands/migration-show.ts:222-227`).
- **Flags**: `--config <path>` (`:242`).
- **Positionals**: `<target>` required — a migration directory name, hash or prefix, ref, or path
  (`:241`).
- **Auth**: none. A control client is created but only for `toOperationPreview`; `driver` is
  optional via `ifDefined` and `connect()` is never called (`:117-123`, `:71-72`).
- **API calls**: `client.toOperationPreview(ops)` only (`:72`, `src/control-api/client.ts:595-598`).
- **Behavior**: read and deserialize `contract.json` (`:125-159`) → load the aggregate
  (`:161-165`) → resolve the target: a path-looking target (contains `/` or `\`) goes through
  `resolveAppTargetPath` and must land under `migrations/app/`
  (`:172-184`, `src/utils/migration-path-target.ts:6-31`), otherwise `parseMigrationRef` against
  the app graph and refs (`:194-209`).
- **Output**: header to stderr (`:102-115`), result to stdout (`:250-256`); JSON shape at
  `src/commands/json/schemas.ts:156-177`.
  Errors: `CLI.FILE_NOT_FOUND` exit 2 (`:130-135`), `CLI.UNEXPECTED` exit 2 (`:137-141`),
  `CONTRACT.VALIDATION_FAILED` exit 2 (`:152-158`), `CONTRACT.VERIFY_FAILED` exit 2 for a target
  outside `migrations/app/` (`migration-path-target.ts:22-29`), a package not found at the path
  (`:177-182`), no migrations at all (`:187-192`), or a ref that resolved without a loadable
  package (`:201-207`), plus ref-resolution failures exit 2 (`:195-197`).
- **Prompts / side effects**: none.
- **Tests**: `test/commands/migration-show.test.ts`, `migration-read-commands-parity.test.ts`,
  `migration-read-help-text.test.ts`, `migration-tamper.test.ts`, `test/cli-errors.test.ts`; e2e
  `cli-journeys/migration-show-reachability.e2e.test.ts`.
- **Engine notes**: result-command. Hazards: `APP_SPACE_ID` is hardcoded as the reported space
  (`:212`) and the resolver only searches `aggregate.app`, so extension-space migrations are
  unreachable from this command — unlike `migration check`, which searches every space.
  `looksLikePath` is a naive substring test for `/` or `\` (`migration-path-target.ts:6-8`).

### `prisma-next migration status [--db <url>] [--config <path>] [--space <id>] [--to <contract>] [--from <contract>] [--legend] [--ascii]`

- **Summary**: shows which migrations are pending between the database marker and the target
  contract; `--from` switches to an offline path preview
  (`src/commands/migration-status.ts:650-657`).
- **Flags**: `--db <url>` (`:674`), `--config <path>` (`:675`), `--space <id>` (`:676`),
  `--to <contract>` (`:677-680`), `--from <contract>` (`:681-684`), `--legend` (`:685`),
  `--ascii` (`:686`).
- **Positionals**: none.
- **Auth**: live DB required **only when `--from` is absent** (`:284`, `:288-298`); the connection
  is attempted only when a URL, a driver, and no `--from` are all present (`:417`).
- **API calls**: `client.connect`, then `readMarkersAndLedgers` calling `client.readAllMarkers()`
  once and `client.readLedger(spaceId)` per scoped space, then `client.close()`
  (`:418-445`, `:254-271`).
- **Behavior**: read refs (`:300-308`) → read the contract envelope, **downgrading a failure to a
  `CONTRACT.UNREADABLE` diagnostic rather than an error** (`:310-322`) → load the aggregate
  (`:324-336`) → resolve `--to`/`--from` (`:344-362`) → enumerate and scope spaces via
  `runMigrationList` (`:401-408`) → optionally connect and read markers plus ledgers (`:417-446`)
  → per space compute target, marker, and graph membership, flagging
  `MIGRATION.MARKER_NOT_IN_HISTORY` when absent (`:494-535`) → derive edge annotations from the
  ledger (`:540-546`) → build the summary (`:614-637`).
- **Output**: header and optional legend to stderr (`:366-399`); result to stdout (`:698-709`);
  JSON shape `MigrationStatusResult` at `src/commands/json/schemas.ts:105-121`.
  Errors: `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:289-298`), `CONTRACT.VERIFY_FAILED` exit 2
  carrying `meta.code` `MIGRATION.LEGEND_HUMAN_ONLY` (`:691-694`, `src/utils/legend.ts:21-37`),
  `MIGRATION.INVALID_SPACE_ID` / `MIGRATION.SPACE_NOT_FOUND`
  (`src/commands/migration-list.ts:195-201`), `MIGRATION.UNKNOWN_INVARIANT` (`:454-464`) or
  `MIGRATION.NO_INVARIANT_PATH` (`:598-608`), ref-resolution failures exit 2 (`:346-348`,
  `:358-360`), `CLI.UNEXPECTED` exit 2 (`:438-442`).
  **`CONTRACT.UNREADABLE`, `MIGRATION.MARKER_NOT_IN_HISTORY`, and `MIGRATION.MISSING_INVARIANTS`
  are diagnostics inside a successful result — the command still exits 0** (`:316-321`, `:525-534`,
  `:585-590`).
- **Prompts / side effects**: none; read-only against disk and DB.
- **Tests**: `test/commands/migration-status.test.ts`, `migration-status-missing-db.test.ts`,
  `migration-status-overlay.test.ts`, `format-status-summary.test.ts`,
  `migration-invariants.test.ts`, `migration-legend-commands.test.ts`,
  `test/utils/legend.test.ts`, `test/output.migration-commands.test.ts`; e2e
  `cli-journeys/migration-status-diagnostics.e2e.test.ts`,
  `marker-read-errors-status-empty-migrations.e2e.test.ts`, `ref-routing.e2e.test.ts`,
  `divergence-and-refs.e2e.test.ts`.
- **Engine notes**: result-command — and **the existing model for the ADR-239 diagnostics-inside-
  COMPLETED pattern**, since three failure conditions already ride inside a successful envelope.
  Hazards: `EMPTY_CONTRACT_HASH` doubles as the unreadable-contract placeholder (`:311`) and the
  no-marker origin sentinel (`:510`, `:593`); `shortDisplayHash` truncates to 12 characters here
  (`:113-115`) but `migrate --show` truncates to 14 (`migrate.ts:404`); the marker counts as
  "in graph" when it equals `spaceContractHash` even if it is not a graph node (`:512`).

### `prisma-next migration log [--db <url>] [--config <path>] [--utc] [--ascii]`

- **Summary**: reads the database ledger and prints every applied migration edge in chronological
  order, merged across contract spaces (`src/commands/migration-log.ts:110-114`).
- **Flags**: `--db <url>` (`:128`), `--config <path>` (`:129`), `--utc` (`:130`), `--ascii` (`:131`).
- **Positionals**: none. **Auth**: live DB unconditionally required (`:53`, `:54-62`).
- **API calls**: `client.connect`, `client.readLedger()` with no space argument (so all spaces),
  `client.close()` (`:91-104`, `src/control-api/client.ts:494-496`).
- **Behavior**: require DB, driver, and a migration-capable target (`:54-65`), then connect, read,
  close (`:90-104`). No on-disk aggregate is loaded at all.
- **Output**: header to stderr (`:67-80`), result to stdout (`:136-158`); `MigrationLogResult`
  shape at `src/commands/json/schemas.ts:123-141`.
  Errors: `CONFIG.DB_CONNECTION_REQUIRED` exit 2 (`:54-62`), `CLI.UNEXPECTED` exit 2 (`:97-101`
  and — inconsistently — `:64` for an unsupported target, where every sibling uses
  `MIGRATION.TARGET_UNSUPPORTED`), `CONTRACT.VERIFY_FAILED` from `mapMigrationToolsError` exit 2
  (`:96`).
- **Prompts / side effects**: none.
- **Tests**: `test/commands/migration-log.test.ts`,
  `test/utils/formatters/migration-log-table.test.ts`,
  `test/commands/read-commands-json-golden.test.ts`,
  `test/commands/migration-read-commands-parity.test.ts`. **No e2e journey.**
- **Engine notes**: result-command. Fix, don't preserve, the wrong dotted code at `:64`.

### `prisma-next migration list [--config <path>] [--space <id>] [--ascii] [--legend]`

- **Summary**: offline. Enumerates every on-disk migration under `migrations/<space>/` for every
  contract space found on disk (`src/commands/migration-list.ts:276-284`).
- **Flags**: `--config <path>` (`:300`), `--space <id>` (`:301`), `--ascii` (`:302`),
  `--legend` (`:303`).
- **Positionals**: none. **Auth**: none. **API calls**: none.
- **Behavior**: `buildReadAggregate` (`:255-258`) → project into per-space rows, taking space
  membership from the on-disk directories rather than the aggregate's synthesized app space
  (`:94-124`) → `runMigrationList` validates `--space` and narrows (`:190-214`). Spaces sort
  app-first then alphabetically (`:45-51`); migrations sort by directory name **descending**
  (`:53-57`, `:118`). An empty scope synthesizes one empty app-space entry (`:206-207`).
- **Output**: header and optional legend to stderr (`:232-253`), result to stdout (`:312-326`);
  `MigrationListResult` shape at `src/commands/json/schemas.ts:36-43`.
  Errors: `CONTRACT.VERIFY_FAILED` exit 2 carrying `meta.code` `MIGRATION.LEGEND_HUMAN_ONLY`
  (`:307-310`), `MIGRATION.INVALID_SPACE_ID` (`:195-197`), or `MIGRATION.SPACE_NOT_FOUND`
  (`:199-201`); aggregate load failures exit 2 (`:255-258`).
- **Prompts / side effects**: none.
- **Tests**: `test/commands/migration-list.test.ts`, `migration-list-json-golden.test.ts`,
  `migration-legend-commands.test.ts`, `test/utils/formatters/migration-list-render.test.ts`,
  `migration-list-styler.test.ts`, `migration-list-graph-topology.test.ts`,
  `migration-read-commands-parity.test.ts`.
- **Engine notes**: result-command. Hazard: `listRefsByContractHash` folds the structural `head`
  ref back in for **extension spaces only**, because the app space synthesizes its head and has
  no on-disk `head.json` (`:67-79`).

### `prisma-next migration graph [--config <path>] [--space <id>] [--dot] [--ascii] [--legend]`

- **Summary**: offline. Renders the migration graph as a tree, JSON, or Graphviz DOT
  (`src/commands/migration-graph.ts:211-218`).
- **Flags**: `--config <path>` (`:235`), `--space <id>` (`:236`), `--dot` (`:237`),
  `--ascii` (`:238`), `--legend` (`:239`).
- **Positionals**: none. **Auth**: none. **API calls**: none.
- **Behavior**: `buildReadAggregate` (`:117-120`) → reuse `migrationSpaceListEntriesFromAggregate`
  plus `runMigrationList` for enumeration and `--space` validation (`:125-132`) → compute global
  column widths so multi-space sections align (`:139-152`) → render per-space sections
  (`:156-198`).
- **Flag precedence**: **`--dot` wins over `--json`** — the success callback tests `options.dot`
  first (`:249`), the JSON branch is only reachable when `--dot` is absent (`:258`), and the human
  branch last (`:265`). So `migration graph --dot --json` prints DOT and no JSON. Two
  qualifications: `--json` still suppresses the stderr header, because that block tests
  `flags.json` independently (`:94`); and `--dot` with `--legend` is a hard error, not a silent
  override (`src/utils/legend.ts:34-36`, checked at `:243-246`). `--dot` also ignores `--space`,
  since it iterates the app graph only (`:53`, `:122`, `:202`).
- **Output**: header and optional legend to stderr (`:94-115`), result to stdout (`:248-267`);
  DOT at `:249-257`, `MigrationGraphJsonResult` shape at `src/commands/json/schemas.ts:54-68`.
  Errors: `CONTRACT.VERIFY_FAILED` exit 2 carrying `meta.code` `MIGRATION.LEGEND_HUMAN_ONLY`
  (`:243-246`), `MIGRATION.INVALID_SPACE_ID` / `MIGRATION.SPACE_NOT_FOUND` (`:126-132`);
  aggregate load failures exit 2 (`:117-120`).
- **Prompts / side effects**: none.
- **Tests**: `test/commands/migration-graph.test.ts`, `migration-graph-coloured-output.test.ts`,
  `read-commands-json-golden.test.ts`, `test/utils/formatters/migration-graph-*.test.ts` (4
  files), `golden-pipeline.test.ts`; e2e `cli-journeys/migration-graph-dot.e2e.test.ts`.
- **Engine notes**: result-command. **`--dot` is a third output format smuggled in as a boolean
  flag; in v8 it belongs in the engine's `--format` enum, which removes the precedence problem
  entirely.** Hazards: `EMPTY_CONTRACT_HASH` normalizes to `null` in JSON `fromContract` (`:194`)
  but stays a truncated sentinel node in DOT (`:252`); DOT node ids are 12-character
  truncations, so two hashes sharing a prefix collapse into one node.

### `prisma-next migration check [target] [--config <path>] [--space <id>]`

- **Summary**: offline artifact and graph integrity check. With no argument it checks every
  contract space; with a target it checks one package, resolved across all spaces
  (`src/commands/migration-check.ts:620-631`).
- **Flags**: `--config <path>` (`:649`), `--space <id>` (`:650`).
- **Positionals**: `[target]` optional — directory name, hash or prefix, ref, or path (`:648`).
- **Auth**: none; explicitly offline (`:629`). **API calls**: none.
- **Behavior**: `buildReadAggregate` (`:386-389`) → `enumerateCheckSpaces` projects one
  `CheckSpace` per on-disk space directory (`:182-205`, `:391`). Holistic mode runs four per-space
  checks — manifest files present for skipped directories (`:207-233`), contract-snapshot
  consistency (`:108-154`), reachability (`:235-254`), dangling refs (`:256-270`) — then folds in
  aggregate integrity violations, scoping out `disjointness` when `--space` is given
  (`:410-418`). Single-target mode (`:475-616`) resolves across every in-scope space and collects
  hits: 0 → not found, 1 → check it, >1 → ambiguity error (`:521-563`); when no space yields a
  hit the **most informative** parse failure wins, ranked `wrong-grammar` 3 > `ambiguous` 2 >
  `invalid-format` 1 > `not-found` 0 (`:447-458`, `:530-534`). Single-target also runs
  `verifyMigrationHash` (`:584-593`). Unlike its siblings it sets `command.exitOverride()`
  (`:646`) and wraps execution in a try/catch converting a throw into a `PRECONDITION` result
  (`:656-664`).
- **Output**: header to stderr (`:369-384`); everything else to stdout via `ui.output`, except
  human-mode structured errors, which go to stderr (`:666-696`). JSON shape
  `MigrationCheckResult` at `src/commands/json/schemas.ts:179-195`. Human output prints
  `✔ <summary>` or one `✗ [code] where: why` plus `  fix:` pair per failure (`:685-695`).
  Errors: `CONTRACT.VERIFY_FAILED` exit 2 carrying `meta.code` `MIGRATION.INVALID_SPACE_ID`
  (`:314-316`, `:481-483`), `MIGRATION.SPACE_NOT_FOUND` (`:317-319`, `:484-489`), or
  `MIGRATION.AMBIGUOUS_MIGRATION_REF` (`:546-552`); ref-resolution failures exit 2 (`:562`);
  aggregate load failure exit 2 (`:386-389`); target path outside the app dir exit 2 (`:510-512`);
  an unresolved target exit 2 but reported as a **result** with `ok:false, failures: []`
  (`:566-575`); any thrown error exit 2 (`:658-664`); **integrity failures found → exit 4**
  (`:427-430`, `:611-615`).
- **Prompts / side effects**: none.
- **Tests**: `test/commands/migration-check-*.test.ts` (6 files),
  `cross-consumer-integrity.test.ts`; e2e `cli-journeys/migration-check.e2e.test.ts`.
- **Engine notes**: **the second canonical "completed with findings" case, and the one whose exit
  4 ports across unchanged** — the 19 `MIGRATION.CHECK_*` codes become diagnostics inside a
  COMPLETED envelope with a documented, typed exit code. Hazards: `'app'` is hardcoded twice
  (`:514`, `:602`); `checkManifestFilesPresent` skips entries beginning with `.` or `_` and the
  literal `'refs'` (`:218`), a reserved-name convention that must port exactly;
  `loadAggregateIntegrityViolations` swallows every error and returns `[]` (`:347-349`), so an
  unreadable contract silently yields zero violations.

### `prisma-next ref set <name> <contract>` / `ref delete <name>` / `ref list`

- **Summary**: manages named refs in `migrations/app/refs/`, mapping logical environment names
  to contract hashes (`src/commands/ref.ts:271-282`).
- **Flags**: `--config <path>` on each subcommand (`:191`, `:219`, `:245`).
- **Positionals**: `set` takes `<name>` and `<contract>`, both required (`:186-190`); `delete`
  takes `<name>` (`:218`); `list` takes none.
- **Auth**: none in any of the three. **API calls**: none.
- **Behavior**: `set` validates the ref name (`:80-82`) → `buildReadAggregate` (`:87-90`) →
  treats the input as a literal hash if `validateRefValue` accepts it, otherwise resolves it as a
  ref (`:96-104`) → refuses the empty sentinel (`:106-108`), a hash not in the graph (`:109-112`),
  a hash with no bundle whose `metadata.to` matches (`:114-117`), and a bundle whose snapshot is
  missing (`:119-138`) → writes with an empty invariants list (`:140-141`). `delete` unlinks
  (`:154-157`); `list` reads (`:169-171`).
- **Output**: **none of the three prints a styled header**; all output goes to stdout via
  `ui.output`. `set --json` → `{ok, ref, hash, invariants}` (`:43-48`, `:202-204`), human
  `Set ref "<name>" → <hash>` (`:205`). `delete --json` → `{ok, ref, deleted}` (`:50-54`, `:230`).
  `list --json` → `{ok, refs}` (`:56-59`, `:252`). All three use single-argument
  `JSON.stringify` — no pretty-printing, unlike every other command.
  Errors: `CONTRACT.VERIFY_FAILED` exit 2 for an invalid ref name (`:68-73`, `:81`) and carrying
  `meta.code` `MIGRATION.REF_SET_EMPTY_SENTINEL` (`:106-108`), `MIGRATION.HASH_NOT_IN_GRAPH`
  (`:109-112`), or `MIGRATION.REF_SET_BUNDLE_NOT_FOUND` (`:114-117`); `CLI.FILE_NOT_FOUND` exit 2
  for a missing snapshot (`:123-138`); ref-resolution and migration-tools failures exit 2
  (`:100-102`, `:61-66`, `:159-160`); `CLI.UNEXPECTED` exit 2 (`:65`).
- **Prompts**: none. **Side effects**: `set` writes exactly one file,
  `migrations/app/refs/<name>.json`, atomically via a `.tmp` file and rename (`:141`,
  `migration/src/refs.ts:233-251`); it **never writes a snapshot, only verifies one exists**
  (`:124`). `delete` unlinks the same path (`:156`). `list` writes nothing.
- **Tests**: `test/commands/ref.test.ts` (set `:206-393`, delete `:395-453`, list `:455`),
  `migration-ref.test.ts`, `migration-ref-error-mapping.test.ts`,
  `test/utils/ref-advancement.test.ts`; e2e `cli.ref-pointer-integration.e2e.test.ts`,
  `cli-journeys/ref-routing.e2e.test.ts`, `divergence-and-refs.e2e.test.ts`.
- **Engine notes**: three result-commands. Hazards: ref names permit forward slashes (`:71`), so
  `ref set env/prod` writes a **nested** file and the atomic temp file uses only the last segment
  (`refs.ts:245`); `'head'` and `'db'` are reserved by convention elsewhere (`refs.ts:23`,
  `plan-resolution.ts:194`) but `ref set` does not reject them; `set` writes `invariants: []`
  unconditionally with no flag to attach invariants, even though `migrate` and
  `migration status` both read `refEntry.invariants` (`:140`, `migrate.ts:759`,
  `migration-status.ts:364`). `ref delete` is destructive with no confirmation — a `needs.consent`
  candidate.

### `prisma-next telemetry status` / `telemetry enable` / `telemetry disable`

- **Summary**: `status` reports whether telemetry is on and why
  (`src/commands/telemetry/index.ts:18-41`, logic `status.ts:28-51`); `enable` stores
  `enableTelemetry: true` and mints an installation id if absent (`index.ts:43-62`); `disable`
  stores `false` and mints nothing (`index.ts:64-83`).
- **Flags**: the global set only; none of the three declares a command-specific flag
  (`index.ts:28`, `:51`, `:72`). **Positionals**: none. **Auth**: none. **API calls**: none.
- **Behavior**: `status` resolves CI first → `reason: 'ci'` (`status.ts:37-39`), then
  `resolveGating` mapping `env-override` → `env-opt-out`, else `stored-opt-out` (`:41-45`), else
  enabled with `stored-opt-in` or `default-on` (`:48-50`). It never mints and never writes
  (`:22-27`), and reports only the **presence** of an installation id, never its value
  (`:34-35`). `enable`/`disable` call `writeUserConfig`, which merges, mints a `randomUUID()`
  only when enabling and no id exists, and writes atomically
  (`cli-telemetry/src/user-config.ts:101-115`); an existing id is never rotated (`:104-106`).
- **Output**: all three write to stdout via `ui.output` — including human prose (§3.7 item 16).
  `status` pretty output is three lines from `formatTelemetryStatusLines` (`status.ts:61-66`);
  `--json` prints `{enabled, reason, configPath, installationIdStored}` (`index.ts:32-33`, shape
  `status.ts:15-20`). `enable`/`disable` print
  `Telemetry enabled|disabled. Preference stored in <configPath>.` (`index.ts:58`, `:79`) or
  `{enableTelemetry, configPath}` (`:56`, `:77`).
  Errors: only global-flag parse errors, exit 2 (`src/utils/global-flags.ts:87-100`). All three
  exit 0 on success (`index.ts:39`, `:60`, `:81`).
- **Prompts**: none anywhere. **Side effects**: `enable`/`disable` create or update
  `<configDir>/prisma-next/config.json`, creating the directory recursively
  (`user-config.ts:108-111`); `status` is a pure read.
- **Tests**: `test/commands/telemetry/telemetry-command.test.ts:66-111` (status), `:114-124`
  (enable), `:126-136` (disable); `test/utils/telemetry.test.ts:241,250` (the group exemption);
  `cli-telemetry/test/user-config.test.ts`.
- **Engine notes**: three result-commands. **The whole group may not survive the port: v8 moves
  telemetry to the engine's bin-side `onSettled` hook, which owns its own config and opt-out
  surface.** Note the timing divergence to resolve — today the event fires from a commander
  `preAction` hook *before* the command runs (`src/cli.ts:82-88`), so the outcome is never
  reported; `onSettled` fires *after*, so the ported event can carry the exit code. The group
  exemption (`src/utils/telemetry.ts:156-158`) exists because of the pre-hook timing and becomes
  unnecessary. Move human prose off stdout while porting.

### `prisma-next __telemetry-crash-test` (hidden, env-gated)

- **Summary**: deliberately throws after a 200 ms sleep so the telemetry e2e suite can verify an
  event still lands when a command crashes mid-execution (`src/cli.ts:347-357`).
- **Registration**: only when `PRISMA_NEXT_ENABLE_TEST_COMMANDS === '1'` (`src/cli.ts:348`), so
  it is not merely hidden from help — it is not registered at all in shipped binaries
  (rationale `src/cli.ts:342-346`).
- **Behavior**: sleeps `TELEMETRY_CRASH_TEST_SLEEP_MS = 200` (`:347`, `:352`) to let the IPC
  `child.send()` flush, then throws (`:353`); commander's `exitOverride` turns that into exit 1
  (`src/cli.ts:194-198`).
- **Tests**: `cli-telemetry/test/cli-e2e.test.ts:131,197`.
- **Engine notes**: do not port. The engine's `onSettled` hook makes the scenario structurally
  impossible to lose, so the test-only command has no successor.

### `prisma-next help`, `prisma-next --help`, `prisma-next --version`

- `help` is a real registered command (`src/cli.ts:360-378`): it renders root help to **stdout**
  and exits 0, on the stated ground that explicitly requested help is the data the caller asked
  for (`:371-375`).
- `--help` goes through commander's `writeOut`, which is allowed through to stdout for the same
  reason; error-path help goes through `writeErr`, which is suppressed entirely because the CLI
  renders it itself (`src/cli.ts:96-113`).
- Root and per-command help are rendered by the CLI's own formatters
  (`src/utils/formatters/help.ts`), wired via `program.configureHelp`
  (`src/cli.ts:116-124`) and per-group `configureHelp` blocks; `CLI_WIDTH` overrides wrap width
  (`help.ts:36`).
- `--version` / `-V` is short-circuited in the pre-parse argv scan, printing the version to
  stdout and exiting 0 (`src/cli.ts:403-407`); the commander option's description is rewritten
  for capitalization only (`:90-94`).
- Unknown commands get a Levenshtein "Did you mean …?" hint (`src/cli.ts:61-69`,
  `src/utils/suggest-command.ts`) plus the relevant help block on stderr, exit 2
  (`:152-165`, `:418-423`).
- **Engine notes**: help, version, and did-you-mean all become engine-owned. The two removed-verb
  and four removed-flag redirect entries (`src/cli.ts:40-56`) are a compatibility table the
  engine must carry forward as data, and they should gain error codes (§3.7 item 17).

---

## 5. The separate clipanion migration-file CLI (`src/migration-cli.ts`)

**This is not a bin.** `package.json` declares exactly one binary, `prisma-next → ./dist/cli.js`.
The migration CLI ships as the library export `"./migration-cli"`, re-exported by the target
facades (`packages/3-targets/3-targets/postgres/src/exports/migration.ts:6`,
`packages/3-targets/3-targets/sqlite/src/exports/migration.ts:6`) and published as
`./cli/migration-cli` from `packages/9-public/@prisma/orm-toolchain/package.json:91`. Users reach
it through a scaffolded `migration.ts` whose last line is `MigrationCLI.run(import.meta.url, M);`
(emitted by `packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts:85`
and the sqlite twin at `:75`). The real invocation is therefore `node migration.ts [flags]`
(`src/migration-cli.ts:1-15`).

- **Parser**: clipanion `4.0.0-rc.4` (`:59`), chosen over commander for in-process testability
  (rationale `:39-42`). `Cli.from([MigrationFileCommand], { binaryName: 'migration.ts',
  binaryLabel: 'Migration file CLI' })` (`:263-266`). It uses `cli.process`, **not** `cli.run`,
  because clipanion's `run` writes errors to stdout and this repo requires structured errors on
  stderr (`:138-145`, `:285-288`).
- **Commands**: exactly one — `MigrationFileCommand` with `static paths = [Command.Default]`
  (`:113-114`). No subcommands.
- **Flags** (`KNOWN_FLAGS` at `:104`, declarations `:130-136`): `--help`/`-h` renders detailed
  usage to stdout and exits 0 (`:289-297`, `:303-306`); `--dry-run` prints artifacts and writes
  nothing (`:518-523`); `--config <path>` is forwarded to `loadConfig` (`:551`).
- **Behavior**: empty `importMetaUrl` returns 0 (`:197-199`) → `isDirectEntrypoint` realpath
  comparison against `argv[1]`; when imported rather than run it is a silent no-op returning 0
  (`:205-207`, `:237-247`) → a **pre-scan for malformed `--config` runs before clipanion** so the
  error contract does not depend on clipanion's classification (`:270-281`, detector `:350-368`):
  bare trailing `--config`, `--config ""`, `--config=`, and `--config -someflag` all produce
  `CLI.CONFIG_ARG_MISSING_PATH` → parse errors go through `renderParseError` (`:383-403`), which
  duck-types clipanion's `UnknownSyntaxError` because the class is not re-exported (`:413-423`) →
  `loadConfig` (`:551`) → **probe-instantiate `new MigrationClass()` with no stack and compare
  `probe.targetId` to `config.target.targetId`, failing before any adapter is constructed**
  (`:563-570`) → `createControlStack`, real instantiation (`:572-573`) → read any existing
  `migration.json`, deliberately without hash verification since a hash mismatch is the expected
  outcome of a re-author (`:468-492`) → build artifacts and persist (`:508-529`).
- **Output**: success writes `ops.json` + `migration.json` beside `migration.ts` then
  `Wrote ops.json + migration.json to <dir>` on stdout (`:525-528`); `--dry-run` prints
  `--- migration.json ---` then `--- ops.json ---` to stdout with no writes (`:518-523`);
  errors go to stderr as `${code}: ${summary}\n${why}[\n${fix}]` (`writeStructuredError`,
  `:452-457`), with `MigrationToolsError` rendered in the same shape (`:314-321`) and
  non-structured errors printing `err.message` alone (`:322-323`).
  Errors: `CLI.CONFIG_ARG_MISSING_PATH` exit 2 (`:280`, `:400`), `CLI.UNKNOWN_FLAG` exit 2
  (`:391`), `MIGRATION.TARGET_MISMATCH` exit 1 (`:566` → `:325`), `MIGRATION.INVALID_JSON` exit 1
  (`:490` → `:325`), config-not-found and everything else thrown by `runMigration` exit 1
  (`:325`).
- **Exit codes**: 0/1/2 as documented at `:181-186`. `process.exitCode` is set from the return
  value, but **a pre-existing non-zero `process.exitCode` is never cleared by a success**
  (`:214-224`).
- **Streams are injectable** — `options.argv/stdout/stderr` default to the `process` globals,
  which is how the tests drive it in-process (`:188-203`, `:93`).
- **Tests**: `test/migration-cli.test.ts` (22 cases, `:151-540`).
- **Engine notes — out of scope for S5.** This CLI is **not being retired and is not being
  ported**. It is not a command the engine can own: it is a function the user's own generated
  `migration.ts` calls, and its argv surface is what every authored migration file presents when
  executed directly. Porting it onto the engine may be worth doing someday, but S5 does not touch
  it. **Its 0/1/2 exit scheme therefore survives unchanged**, including exit 1 meaning "expected
  runtime failure" — the exit-code reconciliation in §7 applies to the main `prisma-next` CLI
  only. It is documented here in full for the record, not as porting input.

---

## 6. Current tests census

Counts are files, not cases.

- **`packages/1-framework/3-tooling/cli/test/` — 111 files.** Root (13):
  `cli-errors`, `config-types`, `errors.mapping`, `help.snapshot` (+ snapshot),
  `load-ts-contract`, `migration-cli`, `output.db-update`, `output.errors`,
  `output.json-shapes`, `output.migration-commands`, `output`, `removed-verb-redirects`,
  `version`.
  `test/commands/` (44 including the 10-file `init/` subtree and
  `telemetry/telemetry-command.test.ts`).
  `test/control-api/` (12): `apply`, `apply.progress`, `client`, `client.errors`,
  `contract-emit`, `contract-enrichment`, `db-init`, `db-update`,
  `db-verify.per-space-verifier`, `format`, `migrate-plan-space-path`, `progress`.
  `test/utils/` (25 + 9 under `formatters/`).
- **`test/integration/test/cli-journeys/` — 48 e2e files** plus `README.md`, `package.json`, and a
  shared `init-journey/` helper directory (`harness.ts`, `database-handles.ts`). Heaviest
  coverage: `db update` (10 journeys), `contract emit` (~15), `db verify` (~12),
  `migration plan` (~12).
- **`test/integration/test/cli.*.e2e.test.ts` and siblings — 34 files**, dominated by
  `cli.emit-*` (7), `cli.db-update.*` (4), `cli.db-init.*` (3), `cli.mongo-*` (3),
  `cli.migrate-*` (4).
- **`packages/1-framework/3-tooling/cli-telemetry/test/` — 10 files** plus `backend-harness.ts`.
  `cli-e2e.test.ts` spawns the real binary against a real backend: a fresh `XDG_CONFIG_HOME`
  `--help` writes no config and emits no event (`:158`), seeded consent emits one row (`:172`), a
  second run reuses the id (`:184`), and a command that crashes after the preAction hook still
  produces a row (`:197`).

**Commands with no direct coverage: none** — every registered command has at least one test file
that exercises it. The thin spots, in descending order of risk:

- **`lsp`** — `test/commands/lsp.test.ts` asserts only the command name, its flag surface, and its
  description string (`:6-24`). **No test ever starts the language server.**
- **`migration new`** — no unit test under `test/commands/`; covered only through five e2e
  journeys.
- **`migration log`** — unit and golden tests only; **no e2e journey exercises it against a live
  ledger.**
- **`ref delete` / `ref list`** — one unit block each (`test/commands/ref.test.ts:395`, `:455`)
  plus a single e2e file.
- **`db verify`'s full-mode success formatters** — `formatVerifyOutput` and `formatVerifyJson`
  have no direct unit test; only the schema-only variants do (`test/output.test.ts:334,582`).
- **`db sign`** — no unit test of the command itself, only of its formatters
  (`test/output.test.ts:756,884`) plus e2e.

---

## 7. Renames and grammar notes for v8

- **`prisma-next` → `prisma`.** The binary name is set at `src/cli.ts:73` and appears in every
  help string, every error `fix` line, and the removed-verb redirect messages
  (`src/cli.ts:41-55`). The ORM CLI and the platform CLI must merge under one root, so every
  ORM verb becomes a subcommand of an already-populated tree — check for collisions with the
  platform surface before assigning namespaces.
- **`--format pretty` → `--format human`** (ruled). The value is compared as the literal
  `'pretty'` in `src/utils/global-flags.ts:49-72` and again in `TerminalUI`'s `forcePretty`
  computation (`src/utils/terminal-ui.ts:331`); both must change together.
- **`--trace` is dropped** (ruled). It exists at `src/utils/command-helpers.ts:383` and is read at
  `src/utils/global-flags.ts:151`; its only distinct behavior is dumping `meta` as JSON
  (`src/utils/formatters/errors.ts:109`), which folds into `--log-level debug`. The
  `PRISMA_NEXT_TRACE` env var (`global-flags.ts:151`) goes with it.
- **`-y/--yes` must stop meaning "accept data loss".** Today `db update` maps it directly to
  `acceptDataLoss` (`src/commands/db-update.ts:174`) and the shared error text instructs the user
  to "Re-run with `-y`" (`packages/1-framework/1-core/errors/src/execution.ts:250`). In v8, `-y`
  accepts non-destructive prompts and `--confirm` carries the consent token. **Never introduce a
  hand-rolled consent-skip flag to replace it.**
- **`--dot` should become a `--format` value**, not a boolean (`src/commands/migration-graph.ts:237`).
  That removes the `--dot`-beats-`--json` precedence quirk and the `--dot` + `--legend` error
  (`src/utils/legend.ts:34-36`) in one move.
- **Grammar irregularities in the current tree:**
  - `db init` / `db update` / `db verify` / `db sign` / `db schema` mix bootstrap verbs, a
    read verb, and a signature verb under one noun. `db schema` is the odd one — it introspects
    and prints, so `schema show` or `db inspect` would be regular.
  - `contract emit` and `contract infer` are opposite directions of the same axis (write the
    artifact from source; write the source from the database) but do not read as opposites.
  - `migrate` (top-level verb) and the `migration` group are a single word apart, and
    `migration apply` was already removed in favour of `migrate`
    (`src/cli.ts:41`) — the split is deliberate but is the most common source of user error the
    redirect table exists to catch.
  - `migration list` and `migration graph` render the same data at different fidelities; a single
    `migration list --format graph` would be regular.
  - `migration status` needs a database, `migration list` and `migration graph` do not, and
    nothing in the naming signals which. The engine's `needs` declaration makes that explicit.
  - `ref set` / `ref delete` / `ref list` uses `delete`, while every other removal in the wider
    v8 surface uses `remove`. Pick one across both CLIs.
  - `telemetry status|enable|disable` is a settings surface, not a resource; it likely folds into
    the engine's own config surface rather than surviving as a command group.
- **Exit codes are the largest single rename job.** Four schemes must collapse into the engine's
  one: 0 completed, 1 bug only, 2 errored, 3 cancel, 4–99 documented per command, 130/143
  signals. Concretely: `init`'s 4/5/6 must be re-declared as typed `exitCodes` at their return
  sites or folded into 2; `init`'s 1 stays; `migration check`'s 4 stays; `db verify`'s and
  `db sign`'s 1 move into the 4-band with diagnostics; **the clipanion migration-file CLI (§5) is
  excluded — it is out of scope for S5 and keeps its 0/1/2 scheme unchanged**; `db
  update`'s declined-prompt 2 becomes 3; and the no-arg / bare-group 0 becomes 2.
