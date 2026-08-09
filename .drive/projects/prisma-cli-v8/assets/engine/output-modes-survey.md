# Execution modes and event dialects across the three CLI families

Snapshot: 2026-08-09. Evidence survey feeding the unified CLI engine's event
vocabulary (cli-engine-requirements.md R5, R6, R14) and its command-execution
modes. Style follows `docs/architecture docs/research/commander-friction-points.md`:
no claim without a citation. Path prefixes:

- **ORM** = `packages/1-framework/3-tooling/cli/src` in prisma/prisma (this repo)
- **Composer** = `wip/repos/composer/packages/0-framework/3-tooling/cli/src`
- **Platform** = `wip/repos/prisma-cli/packages/cli/src` (plus `packages/compute`)
- **Emulators** = `wip/repos/composer/packages/1-prisma-cloud/0-lowering/dev-emulators/src`

Sub-survey evidence was gathered per family and the central claims were
re-verified against the code (the span-event union, the `migrate` progress
gap, JSON auto-selection, the detached daemon spawn, the domain-wait loop).

## A. Command inventory with execution mode

Mode key (refined from the four-mode starting taxonomy; the final proposal is
in §F):

- **S** — synchronous request/response: one operation call, one rendered result.
- **S+prog** — synchronous with in-flight progress reporting (spans, step
  lines, or events) that ends when the operation ends.
- **P** — poll-until-terminal: a wait loop against a remote state machine,
  with timeout semantics.
- **W** — long-lived session/watch: runs until signal/abort, re-emits over
  its lifetime.
- **D** — daemon-coupled: the command manages or implicitly ensures a
  machine-scoped process that outlives the CLI invocation.
- **X** — interactive wizard: prompts drive the flow.
- **V** — stdio protocol server: the process becomes a protocol endpoint.
- **B** — browser hand-off and/or local callback web server (a capability
  layered on another mode, not a mode of its own — see §F).

### A1. Prisma ORM (`prisma-next`) — commander main CLI + clipanion migration-file CLI

Framework: commander for the main binary (cli.ts:71-73; commands registered
cli.ts:323-331), clipanion for the separate migration-file CLI, chosen for
in-process testability (migration-cli.ts:39-42). Global flags via
`addGlobalOptions`: `--format <pretty|json>`, `--json`, `-q/--quiet`,
`-v/--verbose`, `--trace`, `--color/--no-color`,
`--interactive/--no-interactive`, `-y/--yes` (utils/command-helpers.ts:368-388).
Output discipline: stdout = data, stderr = decoration
(utils/terminal-ui.ts:9-23, 284-301). Uniform result funnel `handleResult`
with exit 2 for structured failure, 3 for user abort
(utils/result-handler.ts:16-44). Every command forks a detached telemetry
child at `preAction` (cli.ts:82-88; utils/telemetry.ts:160-177).

| Command | Mode | Output pattern | `--json` | Citation |
|---|---|---|---|---|
| `init` | **X** + child processes | clack intro/outro, per-file logs, spinners for install/skills/emit, manual-steps note box | yes — arktype-validated `{ok, target, authoring, schemaPath, filesWritten[], filesDeleted[], packagesInstalled, contractEmitted, nextSteps[], warnings[]}` | commands/init/index.ts:45-113; init/output.ts:19-52; init/init.ts:113-143, 585-594 |
| `migrate` | S (DB session; **no progress adapter** — see B3 gap) | styled header; one `ui.step('Loading contract spaces…')`; final rendered block | yes — `{ok, migrationsApplied, migrationsTotal, markerHash, applied[], summary, perSpace[], pathDecision?, timings{total}, advancedRef}` | commands/migrate.ts:709-731, 777-779, 844-855, 928-938 |
| `migrate --show` | S (read-only preview) | full ASCII graph visualization with cross-space column alignment; skipped entirely under JSON | yes | commands/migrate.ts:159, 435-470, 910-925 |
| `format` | S | header; `ui.success`/`ui.info` line | yes — `{formatted, path?}` (compact) | commands/format.ts:20-74 |
| `lsp` | **V** — long-lived stdio LSP server | none (protocol on stdio); lazy-imports `@internal/language-server` | n/a (`--stdio` accepted, documented as the only transport) | commands/lsp.ts:8-31; language-server/src/start-server.ts:1-7; server.ts:628-629 |
| `contract emit` | **S+prog** (spans `resolveSource`, `emit`) | header; spinner per span; `ui.warn` | yes — `{ok, storageHash, executionHash?, profileHash?, outDir, files{json,dts}, timings{total}}` | commands/contract-emit.ts:105-130, 180-192; utils/formatters/emit.ts:55-66 |
| `contract infer` | **S+prog** + writes file | header; spans; `✔ Contract written to <path>` | yes — `{ok, summary, target, psl{path}, meta, timings}` | commands/contract-infer.ts:27-38, 70-93, 114-127 |
| `db verify` (full / `--marker-only` / `--schema-only`) | **S+prog** (spans `connect`, `verify`, `introspect`) | header; spinner spans; result block; drift rendered even under `--quiet`, exit **1** on drift | yes — mode-discriminated verify shape | commands/db-verify.ts:214-215, 366, 389-450, 458-499, 544-583; utils/formatters/verify.ts:38-74, 140-158 |
| `db init` | **S+prog** (spans `connect`, `introspect`, `plan`, `apply` + nested per-operation spans) | header incl. `mode: dry run`; spinner per top-level span; plan tree or apply summary | yes — `MigrationCommandResult` (see B3) | commands/db-init.ts:147-152, 194-231; utils/migration-command-scaffold.ts:79-89, 161; utils/formatters/migrations.ts:51-95 |
| `db update` | **S+prog** + interactive re-run loop: on destructive-op rejection, prompts and **re-executes the whole command** with `yes:true` | as `db init` | yes — same shape | commands/db-update.ts:170-176, 320-343, 345-357 |
| `db schema` | **S+prog** (read-only) | header; introspection tree | yes — `IntrospectSchemaResult` | commands/db-schema.ts:18-29, 48-74 |
| `db sign` | **S+prog** (spans `schemaVerify`, `sign`) | header; from→to hashes; exit **1** on verify failure | yes | commands/db-sign.ts:205-229, 293-325 |
| `migration plan` | S, offline, writes migration packages + snapshots (with cross-space seed side effects) | header; `ui.step` per seeded space; final tree/summary | yes | commands/migration-plan.ts:235-242, 382-400, 726-767 |
| `migration new` | S, offline, scaffolds files | header; success block naming dir/from/to | yes — `{ok, dir, from, to, summary}` | commands/migration-new.ts:236-302 |
| `migration show` | S, offline | header; operations + SQL preview | yes | commands/migration-show.ts:102-115, 213-258; commands/json/schemas.ts:156-177 |
| `migration status` | S; DB-connected by default, offline with `--from` | header; tree sections | yes — includes per-migration `status: 'applied'\|'pending'\|null` and `diagnostics[]` with `hints[]` | commands/migration-status.ts:383-384, 639-712; json/schemas.ts:70-121 |
| `migration log` | S, DB required | header; table render | yes | commands/migration-log.ts:67-161; json/schemas.ts:123-141 |
| `migration list` | S, offline | header + optional legend; tree | yes | commands/migration-list.ts:209-253, 304-328 |
| `migration graph` | S, offline; three output modes — `--dot` (Graphviz to stdout) **takes precedence over `--json`** | header; tree; DOT | yes | commands/migration-graph.ts:95-96, 240-270 |
| `migration check` | S, offline; own exit-code scheme (0/2/**4** = integrity failed, via `exitOverride`) | `✔ summary` or per-failure `✗ [CODE] where: why` + `fix:` | yes — `{ok, failures[{space,code,where,why,fix}], summary}` | commands/migration-check.ts:377-378, 604-698; migration-check/exit-codes.ts:1-3 |
| `ref set` / `delete` / `list` | S, offline | one line each | yes (compact) | commands/ref.ts:178-269 |
| `telemetry status` / `enable` / `disable` | S | 1–3 lines | yes (compact) | commands/telemetry/index.ts:18-83 |
| migration-file CLI (`node migration.ts`) | S; separate clipanion CLI | `--dry-run` prints framed `--- migration.json ---` / `--- ops.json ---` blobs; else writes files + one line | **no `--json`** (flags: `--help`, `--dry-run`, `--config`) | migration-cli.ts:104, 113-149, 508-529; exit codes 0/1/2 :181-186 |

### A2. Composer (`prisma-composer`) — clipanion, 4 commands

| Command | Mode | Output pattern | `--json` | Citation |
|---|---|---|---|---|
| `deploy <entry>` | S + child passthrough | alchemy child inherits stdio; topology tree rendered by the report hook inside the child; failure → envelope or child-status hints | no | main.ts:258-274; run-alchemy.ts:46-53 (`stdio: 'inherit'`); render-deployment.ts:77-127 |
| `destroy <entry>` | S with one pre-event + child passthrough | `DestroyEvent` 'no-local-deploy-state' → console.warn | no | main.ts:296-313; operations/destroy.ts:18-20 |
| `dev <entry>` | **W** (event session) + **D** (implicitly ensures machine-scoped emulator daemons) | `DevEvent` union rendered line-by-line; session object `stop()`/`closed`; CLI owns SIGINT/SIGTERM | no | operations/dev.ts:14-52; dev/run-dev.ts:43-133; emulators below |
| `log <entry> [address]` | **W** (stream) | `AsyncIterable<LogLine>` printed `[service] line`; side-channel `LogEvent` union; AbortSignal ends it | no | operations/log.ts:15-58; log/run-log.ts:26-74 |

Composer has **no** `--json` anywhere (main.ts:18-110 declares only
`--name/--stage/--production/--fresh/--tail`); the machine surface is the
programmatic operations API (`@prisma/composer/control`,
exports/control.ts:16-32) instead.

### A3. Platform (`prisma-cli`) — commander v14, ~60 commands

Framework: Commander v14 (`cli/package.json:47`; cli.ts:3), wrapped so all
Commander output goes to stderr with `exitOverride()`
(shell/runtime.ts:34-55). Twelve top-level `addCommand` calls
(cli.ts:107-118); a descriptor table of 72 command ids
(shell/command-meta.ts:34-700). Global flags: `--json`, `-q/--quiet`,
`-v/--verbose`, `--trace`, `-y/--yes`, `--interactive`/`--no-interactive`,
`--color`/`--no-color` (shell/global-flags.ts:23-45).

The overwhelming default is **S** through one choke point
(shell/command-runner.ts:70-147) with a uniform `--json` envelope.
"presenter" below means that default.

| Command | Mode | Output pattern | `--json` | Citation |
|---|---|---|---|---|
| `version` / `--version` | S (local) | presenter | yes | commands/version/index.ts:11-32; cli.ts:123-160 |
| `feedback <message>` | S | presenter | yes | commands/feedback/index.ts:11-43 |
| `init` | **X** | prompts + presenter | yes (prompts suppressed) | commands/init/index.ts:11-93; controllers/init.ts prompt sites :331, :762, :914, :925, :950, :1020 |
| `agent install/update/status` | S (local, shells out) | presenter | yes | commands/agent/index.ts:39-123 |
| `auth login` | S + **B** (local OAuth callback server + browser + paste race) | login progress direct to stderr; presenter at end | yes | commands/auth/index.ts:52-79; lib/auth/login.ts:39-155 (ephemeral-port server :45-53; `Promise.race` callback-vs-paste :136-146; HTML success page :373-462) |
| `auth logout` / `whoami` | S | presenter | yes | commands/auth/index.ts:81-150 |
| `auth workspace list/use/logout` | S (`use` prompts when arg omitted) | presenter | yes | commands/auth/index.ts:167-250; prompt controllers/auth.ts:585 |
| `project list/show/create/rename` | S | presenter | yes | commands/project/index.ts:64-92, 184-211, 243-291 |
| `project link` | S + prompt | presenter | yes | commands/project/index.ts:213-241; lib/project/interactive-setup.ts:44, 87 |
| `project remove/transfer` | S, typed `--confirm <id>` | presenter | yes | commands/project/index.ts:94-182 |
| `project env add/update/list/remove` | S | presenter | yes | commands/env.ts:45-240 |
| `git connect` | **P** + **B** (GitHub App install wait) | presenter | yes | commands/git/index.ts:31-59; poll controllers/project.ts:1780-1829; `open()` :2075 |
| `git disconnect` | S | presenter | yes | commands/git/index.ts:61-88 |
| `branch list` (the only branch cmd) | S | presenter | yes | commands/branch/index.ts:27-50 |
| `build logs <id>` | **W** with `--follow`, else bounded stream | NDJSON records split stdout/stderr by `source`/`level` | yes — per-record events, no envelope | commands/build/index.ts:24-58; controllers/build.ts:34-150 |
| `database list/show/create/usage/restore/remove` | S (`create` and `restore` are **single POSTs** — §A4) | presenter | yes | commands/database/index.ts:92-375; lib/database/provider.ts:309-333, 472-489 |
| `database backup list`, `connection list/create/rotate/remove` | S | presenter | yes | commands/database/index.ts:297-539 |
| `bucket list/create/delete`, `bucket key list/create/delete` | S | presenter; `bucket key create` is the one 3-way presenter (secret → stdout) | yes | commands/bucket/index.ts:64-269 |
| `app build` | S (local build) | presenter | yes | commands/app/index.ts:108-148 |
| `app run` | **W** — hosts framework dev server for the session | passthrough | **no — hard error** | commands/app/index.ts:150-197; rejection controllers/app.ts:273-281 |
| `app deploy` | **S+prog** with SDK-internal **P** | discrete step lines to stderr, off when `--json`/`--quiet` | yes; two result shapes (single vs all) | commands/app/index.ts:199-320; progress controllers/app.ts:801-812; SDK poll lib/app/app-provider.ts:507-527 |
| `app show` / `list-deploys` / `show-deploy` | S | presenter | yes | commands/app/index.ts:326-359, 675-735 |
| `app open` | S + **B** | presenter | yes | commands/app/index.ts:361-394; controllers/app.ts:1268-1272 |
| `app domain add/show/remove/retry` | S | presenter | yes | commands/app/index.ts:420-590 |
| `app domain wait <hostname>` | **P** — the one user-facing wait verb | status-transition lines with elapsed `mm:ss`; `--timeout` default 15m | yes — one NDJSON `{type:"status",...}` event per transition | commands/app/index.ts:592-633; loop controllers/app.ts:1506-1563, 2651-2687 |
| `app logs` | **W** (stream) | header + per-record write | yes | commands/app/index.ts:635-666; controllers/app.ts:1566-1633 |
| `app promote/rollback/remove` | **S+prog** with SDK **P** (120s budget) | progress lines | yes | commands/app/index.ts:737-862; lib/app/app-provider.ts:344-360, 471-479 |

The sibling `compute` package has **zero commands** — it is a runtime
library (`KeepAwakeGuard`, `waitUntil`; `compute/src/index.ts:1-6`, no `bin`
in `compute/package.json:8-13`).

### A4. The management-API async answer

**The management API is overwhelmingly synchronous CRUD; asynchronous
poll-until-terminal behavior exists in exactly three places, all deliberate.**

Async, loop in the CLI:

1. `app domain wait` — `while (true)` at controllers/app.ts:1506, terminal on
   `active`/`failed`, deadline throws `DOMAIN_VERIFICATION_TIMEOUT`
   (:1516-1552), abort-aware sleep clamped to remaining budget (:1554-1557),
   `--timeout 0` = check once (:1542). Real provisioning state machine:
   `pending_dns | verifying | provisioning_tls | verified_routing_blocked |
   active | failed` (types/app.ts:175).
2. `git connect` — `waitForInstalledRepository`
   (controllers/project.ts:1780-1829) polls SCM installations until the human
   finishes the GitHub App install; interval/timeout env-overridable
   (:1789-1796); polls only when `canPrompt(context)` (:1708-1717) —
   non-interactive callers error immediately instead.

Async, loop delegated to `@prisma/compute-sdk` but configured by the CLI
(`timeoutSeconds: 120, pollIntervalMs: 2000`): `deploy`
(lib/app/app-provider.ts:507-527), `promote` (:471-479), `destroyApp`
(:353-358), `updateEnv`-then-promote (:563-584). Deploy progress callbacks
expose the state machine (`onStatusChange`, lib/app/deploy-progress.ts:116-118;
steps build → archive → upload → start → running → promoted, :57-89).

Explicitly **not** async (negative findings):

- `database create` is a single POST, no wait-for-ready
  (lib/database/provider.ts:309-333); same for `database restore` (:472-489)
  and branch creation (lib/app/app-provider.ts:869-895).
- No `"provisioning"`/`"ready"` state on database/branch paths; the one "wait
  for the database to become ready" string is advice text inside an error
  message (lib/database/provider.ts:788), not a loop.
- Most `while (true)` occurrences are cursor pagination
  (lib/app/app-provider.ts:909-930; lib/database/provider.ts:244-270;
  lib/bucket/provider.ts:92, 170). No `setInterval` in the package.

### A5. Emulators and daemons (mode D evidence)

**`@prisma/dev` (PPG-local postgres) is npm-published only** — no source in
any local clone (`wip/repos/` holds composer, create-prisma, ignite,
pdp-control-plane, prisma-cli, project-compute; no dev repo). Surveyed from
the published tarballs (0.13.0 / 0.24.14 / 0.25.1; pinned 0.25.1 in
`pnpm-workspace.yaml`). Its surface:

- **No `bin`** in any surveyed version — a library, not a CLI. (The line
  `pnpm dlx @prisma/dev start` in `examples/react-router-demo/.env.example:2`
  cannot work; stale doc.)
- Programmatic API: `startPrismaDevServer(options?): Promise<ProgrammaticServer>`
  (`dist/index.d.ts:79`) returning `{database, shadowDatabase, ppg.url,
  http.url, name, close()}` (:46-55). Default ports 51213–51216 (:57-60).
- **Machine-scoped management primitives** (`dist/state-CNKFAMiX.d.ts`):
  `ServerState.scan()` (:206 — the "ps"), `getServerStatus` (:239),
  `isServerRunning` (:240), `killServer` (:241 — SIGTERM, poll, SIGKILL),
  `deleteServer` (:238), status enum `"running" | "starting_up" |
  "not_running" | "no_such_server" | "unknown" | "error"` (:236),
  `persistenceMode: "stateless" | "stateful"` (:178).
- On-disk state under `env-paths("prisma-dev")`: per-server dir with
  `server.json` dump (pid, ports, exports), `.pglite/`, and a
  `proper-lockfile` `.lock` whose held/free state plus an HTTP
  `GET /health` name-match probe *is* the liveness check (decompiled
  `dist/chunk-HFONW2ZS.js`). TCP loopback only, no unix socket.
- `dist/daemon.js` is a script the **consumer** `fork()`s: name in
  `process.argv[2]`, reports `{type:"started"|"error"}` over Node IPC
  (`dist/daemon.d.ts:14-22`), SIGTERM/SIGINT handlers close and exit.
  `@prisma/dev` never detaches itself — machine- vs session-scope is the
  caller's choice.
- The 0.25.1 README documents both scopes: the Vite plugin is in-process
  ("There is no background daemon", README:184), while `prisma dev` servers
  are machine-scoped with an ORM-CLI management surface — "invisible to
  `prisma dev ls`, `stop`, and `rm`" (README:126) and "leaves it running
  when Vite exits" (README:131).
- Consumers today: prisma-next test utils wrap start/close session-scoped
  (`test/utils/src/exports/index.ts:30-58`); the legacy bundled prisma 6 CLI
  (`packages/cli/build/index.js:4090`) uses `@prisma/dev` +
  `internal/state` for `prisma init`/`prisma dev` (foreground; it never
  imports `internal/daemon`); the platform CLI references it **zero** times.

**Composer's dev emulators are the most rigorous machine-scoped daemon design
in the survey** (`@internal/dev-emulators`):

- Every daemon is "a detached, `unref()`'d child process that outlives
  whatever called `ensureDaemon`" (daemon.ts:2-6); spawn at
  daemon.ts:273-291 (`detached: true`, stdio to a log file, `child.unref()`).
- Machine registry at `~/.prisma-composer/emulators/`: `<name>.json` entry
  {pid, port, version, logPath} (daemon.ts:26-31, 105-120), state dir, log
  file, `proper-lockfile` lock (:327-363).
- Readiness = HTTP health poll (200 ms up to 10 s) that **requires the
  health payload's version to match the caller's** so a foreign process on
  the port is never adopted (daemon.ts:159-218).
- `ensureDaemon` is an idempotent adopt-or-start-or-replace lifecycle:
  classify `healthy | stale-version | dead-or-unhealthy | absent` under the
  lock; stale version ⇒ kill and replace; persisted port never moves
  (daemon.ts:305-317, 381-478).
- Three daemons — `compute` (supervises `bun bootstrap.js` children with
  crash backoff, compute-main.ts:22-28, 422, 772-832), `buckets`
  (fs-backed S3, buckets-main.ts:336-415), `postgres` (hosts
  `@prisma/dev` `startPrismaDevServer()` in-process, one stateful named
  server per Database resource, postgres-main.ts:650-662). Admin surface is
  loopback JSON APIs (client.ts:178-199, 285-293, 376-384).
- `prisma-composer dev` **implicitly ensures** them (local-target/
  emulators.ts:42-54) and its `stop()` deliberately leaves them running —
  "emulators and data stay up" (operations/dev.ts:47-49; run-dev.ts:83).
  `--fresh` deletes per-app records only (local-target/teardown.ts:22-37).
- **There is no user-facing stop/status/ls command**: `stopDaemon` is
  documented as "Not called by any v1 command — an operator escape hatch,
  exported for tests" (daemon.ts:480-489). The strongest daemon
  implementation has the weakest management surface.

Other daemon-adjacent findings: project-compute has nothing daemon-shaped
(grep for daemon/emulator/detached/unref across cli+sdk: zero hits; its only
local server is the ephemeral OAuth callback,
project-compute/cli/src/lib/auth/login.ts:34-35). The platform CLI's one
detached process is the seconds-long update-check worker that re-execs the
CLI with `detached: true` + `unref()` and an env-var worker branch in
bin.ts (shell/update-check.ts:225-237; bin.ts:7-9). The ORM CLI's telemetry
child is the same fire-and-forget shape (utils/telemetry.ts:160-177).

## B. Event and progress dialects

Every distinct mechanism by which command code reports progress or
intermediate state.

### B1. Composer: per-operation typed event unions + `onEvent` callback

Each operation input carries `onEvent?: (event: XEvent) => void`, one
discriminated union per operation, on `kind`:

- `DevEvent` — `ready {endpoints}`, `unwatchable {address}`,
  `rebuild-failed {message}`, `watch-error {message}`,
  `converge-failed {stackFilePath, reproduceCommand, cwd}`, `stopping`,
  `stop-error {message}`, `stopped` (operations/dev.ts:14-31).
- `DestroyEvent` — `no-local-deploy-state {cwd}` (operations/destroy.ts:18-20).
- `LogEvent` — `stream-failed {message}`, `lines-dropped {count}`
  (operations/log.ts:20-25).
- `deploy` — no events; resolves to `DeploySuccess {summary?}`
  (operations/deploy.ts:25-35).

Properties: rendering lives entirely in the CLI adapter (a `switch` over
`event.kind`, run-dev.ts:54-90; run-log.ts:40-48); a throwing host `onEvent`
must not kill the session (execute-dev.ts:190-196); lifetime is a session
object (`DevSession.stop()` / `closed`, operations/dev.ts:44-52) or an
`AsyncIterable` ended by the caller's `AbortSignal` (operations/log.ts:36-58).
Failures ride the shared `Result`/`CliStructuredError` shape
(operations/shared.ts:81-126); cli.ts:17-35 maps structured → exit 2,
escape → exit 1 + report hint.

### B2. Composer: child-process passthrough + cross-process result file

`deploy`/`destroy` spawn an `alchemy` child with `stdio: 'inherit'`
(run-alchemy.ts:46-53) — the child's own output *is* the progress display.
The structured result crosses back via a JSON file named in
`PRISMA_COMPOSER_DEPLOYMENT_RESULT_FILE` (deployment-summary.ts:18), written
best-effort by a report hook inside the child (:45-53) and re-validated
field-by-field by the parent (:63-101). On failure the error carries
`meta.diagnostics` (`ExecutionDiagnostics {exitCode, stackFilePath,
reproduceCommand, cwd}`, operations/shared.ts:44-75); the CLI prints two
reproduce-hint lines and passes the child's exit status through
(render-error.ts:27-37).

### B3. ORM: progress spans (`ControlProgressEvent`)

The exact shape (ORM control-api/types.ts:91-111, verified):

```ts
export type ControlProgressEvent =
  | { readonly action: ControlActionName; readonly kind: 'spanStart';
      readonly spanId: string; readonly parentSpanId?: string; readonly label: string }
  | { readonly action: ControlActionName; readonly kind: 'spanEnd';
      readonly spanId: string; readonly outcome: 'ok' | 'skipped' | 'error' };
```

`ControlActionName` = `'dbInit' | 'dbUpdate' | 'dbVerify' | 'migrate' |
'verify' | 'schemaVerify' | 'sign' | 'introspect' | 'emit'` (types.ts:67-76).
Design notes in-source (types.ts:78-90): only two event kinds; all
operation-specific progress is modeled as **nested spans** via `parentSpanId`
(per-migration-operation spans are `operation:<op.id>` children,
control-api/operations/migration-helpers.ts:22-48); zero overhead when the
callback is absent.

Renderer: `createProgressAdapter` (utils/progress-adapter.ts:32-74) — no-op
under `--quiet`, `--json`, or non-interactive (:36-38); top-level span →
clack spinner (delay-gated 100 ms, terminal-ui.ts:172-224), nested span →
`ui.step` line; `spanEnd` closes with elapsed-ms suffix, `(skipped)`, or
`(failed)` (:60-72).

Wired by: `contract emit` (contract-emit.ts:121), `db schema` +
`contract infer` (inspect-live-schema.ts:136), `db sign` (db-sign.ts:205),
`db verify` both paths (db-verify.ts:366, 472), `db init` + `db update`
(migration-command-scaffold.ts:161). Span ids in use: `connect`, `verify`,
`schemaVerify`, `sign`, `introspect`, `resolveSource`, `emit`, `plan`,
`apply` (control-api/client.ts:215-222, 245-273, 298-327, 352-377, 548-567,
618-753; operations/db-run.ts:59-62; run-migration.ts:137-173).

**Gap:** `migrate` — the longest-running, most destructive command — never
creates a progress adapter. `client.migrate()` threads `onProgress`
(client.ts:499-532) and `runMigration` emits `apply` + nested spans, but
commands/migrate.ts calls `client.migrate({...})` with no `onProgress`
(migrate.ts:808-814, verified); its only in-flight feedback is one `ui.step`
(migrate.ts:777-779).

### B4. Platform: presenter objects + one success choke point

End-state presentation, not streaming: controllers return a result;
`writeCommandSuccess` (shell/command-runner.ts:105-147) picks the channel.
Presenter interface (command-runner.ts:25-37): `renderStdout?`
(machine-usable payload → stdout), `renderHuman` (prose → stderr),
`renderJson?` (envelope override). Stream discipline is strict — human to
stderr, data to stdout (shell/output.ts:185-191; command-runner.ts:164-171)
— which is what makes `--quiet` pipe-clean (command-runner.ts:124-127).
Warnings render in human mode too so degraded steps are never silent
(command-runner.ts:130-135). Reusable card patterns (list/show/mutate) pair
a human renderer with a serializer side by side (output/patterns.ts:44-107),
with secret masking built into the UI layer (ui.ts:10; patterns.ts:14, 41).

### B5. Platform: discrete step lines for long operations — no spinners

Repo-wide grep for spinner/ora: zero hits outside `@clack/prompts`. Long
operations print append-only step lines: `createDeployProgress`
(lib/app/deploy-progress.ts:36-91; "Building locally...", "Uploading...",
"Deploying..." + status rows via `onStatusChange` :116-118),
`createPromoteProgress` (:97-137), disabled wholesale by
`enabled = !json && !quiet` (controllers/app.ts:801-811). `app domain wait`
prints only on status transitions with elapsed `mm:ss`
(controllers/app.ts:2670-2687). Everything is line-oriented, identical piped
or interactive apart from color and headers. (Contrast: the ORM uses clack
spinners for top-level spans, B3 — the two families made opposite calls.)

### B6. Platform: NDJSON event streams

Where the platform CLI streams, it emits single-line JSON events via
`writeJsonEvent` (shell/output.ts:31-36), distinct from the pretty-printed
success envelope: build-log records (controllers/build.ts:88-93), domain-wait
status transitions (`{type:"status", command, timestamp, data}`,
controllers/app.ts:2651-2662), wrapper success/error events
(command-runner.ts:213-235). `build logs` sets `emitJsonSuccessEvent: false`
because the stream carries its own `terminal` record
(commands/build/index.ts:52-55; command-runner.ts:208-222).

### B7. Direct console writes at the adapter layer

In all three families the final human rendering is direct
`console.log`/stderr writes concentrated at one adapter layer per command:
Composer's run-dev.ts:54-90 and run-log.ts:40-48; the platform's login
progress (lib/auth/login.ts) before the presenter runs; the ORM's `ui.*`
methods over stderr (terminal-ui.ts:284-301). The structure lives one layer
down (events, results, presenters); the writes are the rendering.

### B8. Daemon readiness: HTTP health polling, not events

The emulator daemons report readiness by health endpoint, not by event or
IPC: `awaitHealthy` polls `GET /health` and requires a version match
(daemon.ts:159-218). `@prisma/dev`'s forkable daemon script is the one IPC
user (`process.send({type:"started"|"error"})`, `dist/daemon.d.ts:14-22`).
Transient loopback failures after heavy converges are absorbed by a retry
helper (5 × 500 ms, Composer operations/emulator-retry.ts:9-24).

## C. Recurring structures — R14 promotion candidates

Ranked by breadth of occurrence (families out of 3, then by site count).

1. **Structured error with code / summary / why / fix / where / docsUrl —
   3/3 families, uniform.** ORM: `ok:false, code, severity, summary, why?,
   fix?, where?{path,line}, meta?, docsUrl?`
   (packages/1-framework/1-core/errors/src/control.ts:9-19; rendered
   utils/formatters/errors.ts:32-122). Composer: `CliErrorEnvelope` with
   summary/code/why/fix/where rendered `✖ summary (CODE)` + indented lines
   (render-error.ts:9-18). Platform: `{code, domain, severity, summary, why,
   fix, where, meta, docsUrl}` (shell/output.ts:38-50). Already settled by
   ADR 239/245 + Composer ADR-0043/0044 per R6; the survey confirms it is
   the single most uniform structure in the corpus.

2. **Remediation / next-step, in five competing encodings — 3/3 families.**
   (a) the error `fix` field everywhere (above); (b) platform envelope-level
   `nextSteps` + `nextActions` on **every** success (shell/output.ts:22-29),
   including a pre-filled `feedback` recover action on crashes
   (shell/output.ts:104-114); (c) ORM structured `hints[]` only on
   `migration status` diagnostics (migration-status.ts:316-321, 525-534;
   json/schemas.ts:78-103) and a first-class `nextSteps[]` only in `init`
   JSON (init/output.ts:38, 117-150); (d) ORM free-text "Next:" prose lines
   (formatters/migrations.ts:326-327, 458-464; migration-plan.ts:827,
   908-910; migration-new.ts:295-297); (e) Composer's **reproduce command**:
   `reproduceCommand` + `stackFilePath` + `cwd` in both the
   `converge-failed` event (operations/dev.ts:22-27) and failure
   `meta.diagnostics` (operations/shared.ts:44-75; render-error.ts:27-37).
   This is the clearest case of one engine concept currently spelled five
   ways.

3. **Per-item outcome lists — 3/3 families.** ORM: per-space blocks
   `{spaceId, kind, operations[], marker?}` (control-api/types.ts:330-352;
   renderer formatters/migrations.ts:119-154), `applied[]`
   (migrations.ts:276-283), per-migration `status:'applied'|'pending'|null`
   (json/schemas.ts:70-76), `failures[{space,code,where,why,fix}]`
   (json/schemas.ts:179-187), truncated-to-3 conflict lists with a
   "re-run with -v" footer (formatters/errors.ts:54-98). Platform: the
   shared list/show card patterns with paired serializers
   (output/patterns.ts:57-107). Composer: `DeploymentSummary.nodes[]` each
   `{address, entities[{kind, id, url?, details?}]}`
   (deployment-summary.ts:22-30) rendered as a topology tree
   (render-deployment.ts:77-116).

4. **Warnings list — 3/3.** ORM `warnings[]` in results
   (formatters/migrations.ts:97-107; init/output.ts:66-68;
   formatters/verify.ts:104-118); platform envelope `warnings` rendered even
   in human mode (shell/output.ts:22-29; command-runner.ts:130-135);
   Composer's warning-severity events (`watch-error`, `stop-error`,
   `stream-failed`, `lines-dropped`; operations/dev.ts:19-30,
   operations/log.ts:20-25).

5. **Endpoints / URLs — 3/3, three senses.** Service endpoints: Composer
   `ServiceEndpoint {address, url}` (operations/shared.ts:19-22) in `ready`
   events and `log` attachments; entity `url` in deploy summaries
   (render-deployment.ts:104-106); platform `liveUrl` (`app open`,
   controllers/app.ts:1268-1272) and emulator base URLs
   (`http://127.0.0.1:<port>`, dev-emulators client.ts:58). Docs URLs: ORM
   headers carry `https://pris.ly/...` "Read more" links (styled.ts:55-66;
   e.g. db-init.ts:129) and envelope `docsUrl` under `-v` (errors.ts:99-101);
   platform envelope `docsUrl` (output.ts:38-50). Masked connection URLs:
   ORM `maskConnectionUrl`/`sanitizeErrorMessage`
   (command-helpers.ts:308-359); platform `URL_CREDENTIALS_PATTERN` +
   `maskValue` (ui.ts:10; patterns.ts:14, 41).

6. **Counts + one-line summary — 3/3.** ORM "Planned/Applied N operation(s)
   across M contract space(s)" (migrations.ts:174-182, 433-446), "N
   migration(s) applied" (migration-log.ts:142), `operationCount` fields
   (json/schemas.ts:8, 130); platform `summary` strings throughout the
   presenters and `renderSummaryLine` glyphs ✔/✘/⚠/ℹ (ui.ts:129-143);
   Composer `lines-dropped {count}` (operations/log.ts:24-25).

7. **File paths / artifacts written — 3/3.** ORM `files{json,dts}` + `outDir`
   (emit.ts:12-19), `filesWritten[]`/`filesDeleted[]` (init/output.ts:23-31),
   `dir`/`baselineDir` (migration-new.ts:238; migration-plan.ts:884-897),
   relativized to cwd nearly everywhere (emit.ts:33-34;
   command-helpers.ts:138-140). Composer `stackFilePath`
   (operations/shared.ts:48) and the generated-stack reproduce hint.
   Platform: log paths in the daemon registry (dev-emulators
   daemon.ts:26-31) — thinner here.

8. **Child-process output — 3/3, three strategies.** Passthrough: Composer
   `stdio: 'inherit'` (run-alchemy.ts:46-53). Captured + redacted + carried
   in the error: ORM init reads child stderr, strips credentials, surfaces
   an excerpt or `meta.stderrLines` (init/init.ts:809, 834-845, 925-945;
   skill-install.ts:207-241). As typed events: platform build-log NDJSON
   records with `source`/`level` routing to stdout/stderr
   (controllers/build.ts:34-150). An engine vocabulary needs a
   child-output-line concept that all three can target.

9. **Durations — 2/3 consistently.** ORM `timings: {total}` ms rendered only
   under `-v` (emit.ts:17-19; migrations.ts:92-94, 261-263, 329-332,
   477-479; verify.ts:71-73) plus span elapsed-ms suffixes
   (progress-adapter.ts:62-69); platform `--verbose` timing diagnostics
   appended best-effort (command-runner.ts:136-139, 173-191) and domain-wait
   elapsed `mm:ss` (controllers/app.ts:2682-2687). Composer surfaces no
   durations.

10. **Status/state-machine enums — 2/3 (+ the daemon layer).** Platform
    domain statuses (types/app.ts:175) and deploy display statuses
    (presenters/app.ts:790-802); ORM per-migration
    `'applied'|'pending'|null`; `@prisma/dev` `ServerStatusV1.status`
    six-value enum (state d.ts:236). Any engine "wait" concept needs a
    from→to status-transition event (the platform already emits exactly
    that, controllers/app.ts:2651-2662).

11. **Typed confirmation for destructive operations — 2/3.** Platform
    `--confirm <project-id>` (commands/project/index.ts:101-106, 136-153;
    database/bucket variants); ORM `db update`'s prompt-then-re-execute with
    `yes:true` (db-update.ts:320-343); Composer's flag-encoded target
    (`destroy` requires `--stage` or `--production`, main.ts:276-294).

## D. `--json` reality

- **ORM: near-universal, per-command shapes, plus surprises.** Every main-CLI
  command has `--json` via the shared flag set (command-helpers.ts:368-388);
  shapes are per-command result objects (the tables in §A1), several
  arktype/schema-validated (commands/json/schemas.ts; init/output.ts:19-52).
  **JSON auto-selects when stdout is not a TTY even without `--json`**
  (utils/global-flags.ts:67-69, verified; `--format pretty` is the escape
  hatch, terminal-ui.ts:334). No streaming JSON exists — spans never reach
  `--json` consumers (the progress adapter no-ops under JSON,
  progress-adapter.ts:36-38). Indentation is inconsistent: most commands
  pretty-print, `ref`/`format`/`telemetry` emit compact single lines
  (ref.ts:203, 230, 252; format.ts:67; telemetry/index.ts:33, 56, 77).
  `migration graph --dot --json` silently emits DOT
  (migration-graph.ts:249-258). The migration-file CLI has no `--json`.
- **Composer: none.** No JSON flag exists (main.ts:18-110). The machine
  surface is the typed programmatic API (`@prisma/composer/control`) —
  events as callbacks, results as values — rather than serialized output.
- **Platform: near-total, one envelope, streaming where needed.** Success:
  `{ok: true, command, result, warnings, nextSteps, nextActions}`
  pretty-printed (shell/output.ts:9-29); error: `{ok: false, command, error,
  warnings, nextSteps, nextActions}` (:38-50, 164-183); crashes still emit
  the envelope (`UNEXPECTED_ERROR` + recover action, :120-162; cli.ts:69-71).
  Streaming commands switch to single-line NDJSON events (§B6). Deviations:
  `app run` rejects `--json` outright (controllers/app.ts:273-281);
  `app deploy` has two result shapes (commands/app/index.ts:311-314).

Cross-family delta worth naming: the ORM buries remediation in per-command
shapes and prose while the platform reserved envelope-level `nextSteps` /
`nextActions` on every command; and only the platform has a
crash-still-emits-JSON guarantee.

## E. Framework support for execution modes (stricli, clipanion)

Both are parse-and-dispatch frameworks; **neither models execution modes at
all** — no concept of long-running commands, streaming, progress, daemons,
or watch modes.

- **stricli** (bloomberg.github.io/stricli): documented features are routing,
  typed argument parsing, isolated context, lazy command loading,
  autocomplete. Its "Out of Scope" page explicitly declares out of scope:
  cross-argument validation, local system access (use context injection),
  **logging** ("no first-party logging solution"), **enhanced formatting**
  (recommends chalk etc.), and **prompting/stdin** ("interactive user input
  beyond command-line arguments is not supported"; recommends
  enquirer/clack). Execution model: the command function runs to completion;
  `run()` writes help/errors to the injected `context.process.stdout/stderr`
  and sets `context.process.exitCode`. Nothing constrains what the function
  does while running — a long-lived session is just a promise that hasn't
  resolved. (Full internals evaluation:
  wip/designs/engine/stricli-vs-clipanion.md.)
- **clipanion** (mael.dev/clipanion): documents command paths, option types,
  execution contexts (`stdin`/`stdout`/`stderr`/`env`/`colorDepth`),
  validation, error handling, help. Its one stream-relevant claim is
  compositional: streams live in the context "so commands can easily
  intercept the output of other commands". No modeling of long-running
  commands, progress, or daemons. Composer's usage confirms the division of
  labor: clipanion parses (main.ts:112-160); session lifetime, signals, and
  events are hand-built above it (run-dev.ts:110-132). Same in the ORM
  migration-file CLI (migration-cli.ts).

Consequence: execution modes are the engine's to define. Nothing in either
framework will be contradicted by an engine-level mode taxonomy, and nothing
can be reused for it — the frameworks end where the handler begins.

## F. The mode taxonomy the evidence supports

The four starting modes hold, with refinements: "event-streaming
asynchronous" splits into in-flight progress (ends on its own) versus
poll-until-terminal (a remote state machine with timeout semantics), and two
modes must be added (wizard, stdio server). Browser hand-off and detached
worker spawns are capabilities that ride on other modes, not modes.

1. **Synchronous request/response** — the dominant mode everywhere:
   ~55 platform commands, ~14 ORM commands, 2 Composer commands (§A tables).
   The engine's baseline: result value in, one rendering out, uniform
   envelope.

2. **Synchronous with in-flight progress** — same lifetime as (1), plus
   intermediate reporting that both human and `--json` surfaces may consume.
   Three dialects to unify: ORM nested spans with outcome + elapsed (B3, 7
   wiring sites), platform discrete step lines + `onStatusChange` callbacks
   (B5), Composer's single pre-event on `destroy` (B1). Today none of the
   ORM's span data reaches `--json`; the platform's step lines are
   human-only. R14's vocabulary should make progress events representable in
   both channels, which no family does today.

3. **Poll-until-terminal (wait)** — distinct from (2) because it carries
   timeout/deadline semantics, an explicit remote status enum, and
   transition events: `app domain wait` (with `--timeout`, `--timeout 0` =
   probe once, NDJSON transition events), `git connect`'s
   interactivity-conditional poll, and the SDK-delegated deploy/promote/
   destroy polls (§A4). Small today (one dedicated verb) but structurally
   different enough — and precedented enough — to be its own engine concept:
   the platform team invented a `wait` verb rather than bolting waiting onto
   `add`.

4. **Long-lived session / watch** — runs until signal or abort, re-emits
   over its lifetime: Composer `dev` (session object with `stop()`/`closed`
   + typed events) and `log` (AsyncIterable + AbortSignal), platform
   `app run` (dev-server passthrough), `app logs`, `build logs --follow`
   (§A2, §A3). Two lifetime idioms exist — session object versus
   abort-signal-terminated iterable — and the engine must pick or support
   both; Composer deliberately keeps signal ownership in the host
   (operations/dev.ts:41-43; run-dev.ts:124-131), which matches R4/R5.

5. **Daemon-coupled (machine-scoped)** — the controlled process outlives the
   CLI invocation: Composer's three emulator daemons (implicitly ensured by
   `dev`, never stoppable from the CLI) and `@prisma/dev` stateful servers
   (library primitives for scan/status/kill; the legacy `prisma dev`
   `ls`/`stop`/`rm` surface per its README) (§A5). Consistent mechanics
   across both implementations — registry file + lockfile liveness + HTTP
   health with identity check + SIGTERM-then-SIGKILL — which is effectively
   a specification for the engine's daemon concept. The evidence also shows
   the gap the unified CLI must not reproduce: composer daemons have **no**
   user-facing ps/stop/status.

6. **Interactive wizard** — prompts drive the flow: ORM `init` (clack,
   spinners, child installs), platform `init` (1065-line controller, six
   prompt sites), plus scattered single-prompt commands (`project link`,
   `auth workspace use`, `db update`'s confirm-and-re-run) (§A1, §A3). Both
   families gate every prompt on an interactivity check that `--json`,
   CI, and non-TTY force off (platform `canPrompt`, shell/runtime.ts:105-119;
   ORM progress/prompt gating, progress-adapter.ts:36-38,
   global-flags interactivity flags) — an engine-level capability check, not
   per-command logic.

7. **Stdio protocol server** — ORM `lsp`: lazy-imports the language server,
   hands the process to `connection.listen()`, no exit path of its own
   (§A1). One instance, but structurally unlike everything else: the CLI's
   own rendering machinery must get out of the way entirely.

Cross-cutting capabilities (not modes): **browser hand-off / local callback
server** (auth login's ephemeral-port server + callback-vs-paste race,
git connect, app open — always layered on S or P); **child-process
passthrough** (Composer deploy/destroy); **detached fire-and-forget self
processes** (platform update-check worker, ORM telemetry child) — invisible
to users, but the engine should know the pattern exists because both
families independently built it.

Straddlers, noted rather than force-fit: `composer dev` is (4)+(5) — a
session that implicitly manages daemons; `app deploy` is (2) with (3) inside
the SDK; `db update` is (2) wrapped in a (6)-style confirm loop that
re-executes the command; `migration graph` is (1) with three output
renderers (tree/DOT/JSON).
