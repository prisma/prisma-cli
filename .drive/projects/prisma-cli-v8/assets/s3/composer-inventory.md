# S3 Composer Inventory — the `prisma-composer` CLI as it exists today

Normative record of what Composer's CLI does now. The S3 contract and all
porting work hang off this document.

Sources read read-only at
`wip/repos/composer` (branch `main`, commit `a1cd673`). Unless a path is
prefixed otherwise, every `path:line` citation in this document is relative to
that clone's root. Citations into the prisma-cli repo are prefixed
`prisma-cli:`.

The CLI's code lives in the **private** workspace package `@internal/cli` at
`packages/0-framework/3-tooling/cli`
(`packages/0-framework/3-tooling/cli/package.json:2`). It is published only as
part of `@prisma/composer`
(`packages/9-public/composer/package.json:2`), whose `bin` entry is
`prisma-composer` → `./dist/bin.mjs`
(`packages/9-public/composer/package.json:8-10`).

Format follows `.drive/projects/prisma-cli-v8/assets/s2/command-inventory.md`.

---

## 1. Command index and per-command inventory

### 1.1 Index

The whole grammar is registered in one call:

```
Cli.from([DeployCommand, DestroyCommand, DevCommand, LogCommand], …)
```

`packages/0-framework/3-tooling/cli/src/main.ts:113`.

| path | kind today | flags | positionals | auth | spawns | proposed engine kind |
|---|---|---|---|---|---|---|
| `deploy <entry>` | long-running, child-driven | `--name`, `--stage`, (`--production` — accepted by the parser, always an error) | `entry` (required) | platform, indirectly via the extension's providers inside the child | `alchemy deploy`, `git check-ref-format` | result command |
| `destroy <entry>` | long-running, child-driven | `--name`, `--stage`, `--production` | `entry` (required) | same as deploy | `alchemy destroy`, `git check-ref-format` | result command |
| `dev <entry>` | session (runs until SIGINT/SIGTERM) | `--name`, `--fresh` | `entry` (required) | none — credential-free by design | `alchemy deploy` (once per converge, repeatedly on file change) | session command |
| `log <entry> [address]` | session (runs until SIGINT/SIGTERM) | `--name`, `--tail` | `entry` (required), `address` (optional) | none | none | session command |

**There are no other commands.** No hidden, experimental, or debug commands
exist: `Cli.from` receives exactly those four classes
(`packages/0-framework/3-tooling/cli/src/main.ts:113`), there is no dynamic
registration, and no second binary. `packages/9-public/composer/package.json:8`
declares exactly one `bin`. A grep of the workspace for other `bin` entries
returns only that package.

There are **no group nodes** — the grammar is one level deep.

There is **no `--json` flag, no `--quiet`, no `--verbose`, no `--color`, no
`-y/--yes`, and no global flag set of any kind.** The four commands' options
are the entire flag surface.

`--help` / `-h` is handled by clipanion's own fallback and intercepted at
`packages/0-framework/3-tooling/cli/src/main.ts:205-207`: the detailed usage
text is printed to **stdout** and the process exits **0**. A bare
`prisma-composer` with no arguments prints the same text to **stderr** and
exits **2**
(`packages/0-framework/3-tooling/cli/src/main.ts:208`, then
`packages/0-framework/3-tooling/cli/src/cli.ts:21-25`).

### 1.2 Process-wide behavior shared by all four commands

**Startup preflight.** `bin.ts` runs `checkEffectResolution(process.cwd())`
*before* importing anything else
(`packages/0-framework/3-tooling/cli/src/bin.ts:14-22`). It walks the app's
installed tree, and if `alchemy` resolves a different `effect` version than
`@prisma/composer` requires, it prints a rendered error envelope to stderr and
calls `process.exit(2)`. This runs for `--help` too. The check is a no-op when
`alchemy` is not installed
(`packages/0-framework/3-tooling/cli/src/check-effect-resolution.ts:114-128`).

**Top-level error mapping** (`packages/0-framework/3-tooling/cli/src/cli.ts:17-35`):

| condition | stream | exit code |
|---|---|---|
| `run()` returned a number | — | that number (`cli.ts:19`) |
| clipanion `UsageError` | stderr, raw message | 2 |
| `CliStructuredError` | stderr, rendered envelope | 2 |
| anything else | stderr, `Error: …` plus a "this is a bug, please report it" line naming `https://github.com/prisma/composer/issues` | 1 |

Exit codes are set via `process.exitCode`, never `process.exit()`, so the
process drains its streams first.

**Error envelope rendering** (`packages/0-framework/3-tooling/cli/src/render-error.ts:9-18`):

```
✖ <summary> (<CODE>)
  Why: <why>
  Fix: <fix>
  Where: <path>[:<line>]
```

No color. `conflicts`, `meta`, and `docsUrl` are deliberately not rendered.
The error model is ADR-0044 (dotted namespace codes, structured at origin,
no fallback codes)
(`docs/design/90-decisions/ADR-0044-errors-are-structural-envelopes-with-dotted-namespace-codes.md`).

**Prompts: there are none.** No command in this CLI ever reads stdin or asks a
question. The alchemy child is always invoked with `--yes`
(`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:49`), which suppresses
alchemy's own confirmation prompts. There is no confirmation before `destroy`
— the guard is the required explicit `--stage`/`--production` target, not a
prompt.

**Env vars the CLI itself reads or writes.** Only one is defined by composer:

| var | direction | site |
|---|---|---|
| `PRISMA_COMPOSER_DEPLOYMENT_RESULT_FILE` | written by the parent onto the child; read inside the child by the report hook | `packages/0-framework/3-tooling/cli/src/deployment-summary.ts:18`; set at `packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts:245`; read at `packages/0-framework/3-tooling/cli/src/deployment-summary.ts:46` |
| one var per extension, named by `containerEnvVarName` | written by the parent onto the child; read inside the generated dev stack file | `packages/0-framework/3-tooling/cli/src/run-alchemy.ts:56`; read at `packages/0-framework/3-tooling/cli/src/dev/generate-dev-stack.ts:81` |

The parent's own `process.env` is otherwise passed through wholesale to the
child (`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:55`). Credential
env vars are therefore consumed by the extension's provider code inside the
child, not by the CLI — see §3.

---

### 1.3 `deploy <entry>`

**Summary.** "Deploy the application whose root node is `<entry>`'s default
export." (`packages/0-framework/3-tooling/cli/src/main.ts:44`)

**Positionals.** `entry` — required, a path to the entry module, resolved
against the process cwd
(`packages/0-framework/3-tooling/cli/src/main.ts:19`,
`packages/0-framework/3-tooling/cli/src/pipeline.ts:87`).

**Flags.**

| flag | type | default | meaning |
|---|---|---|---|
| `--name <s>` | string | absent → the root node's own name | Overrides the root node's name, i.e. the deployed application name (`main.ts:21-23`, applied at `pipeline.ts:111`) |
| `--stage <s>` | string | absent → production | Target a named, isolated environment instead of production (`main.ts:25-27`) |
| `--production` | boolean | `false` | **Declared on deploy but never valid.** Inherited from the shared abstract class `DeployCliCommand` (`main.ts:29-32`); `run()` rejects it with `DEPLOY.FLAG_INVALID` (`main.ts:259-267`) |

**Config consumed.** `prisma-composer.config.ts` — see §2.

**Auth.** The CLI performs no authentication itself. Credentials are read by
the extension's provider code — partly in-process (the container `ensure`
call, `execute-deploy-destroy.ts:140`) and partly in the alchemy child. See §3.

**Child processes.**

1. `git check-ref-format refs/heads/<stage>` via `spawnSync` with
   `stdio: 'ignore'`, only when `--stage` was given
   (`packages/0-framework/3-tooling/cli/src/validate-stage.ts:6-8`). A spawn
   error is `DEPLOY.STAGE_UNVALIDATABLE`; a nonzero status is
   `DEPLOY.STAGE_INVALID`.
2. The workspace's installed `alchemy` bin — see §1.7 for the exact mechanics.

**Behavior, in order** (`packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts:82-323`):

1. Validate the stage name (only if `--stage`) — `execute-deploy-destroy.ts:88-97`.
2. Shared pipeline (`pipeline.ts:79-130`): discover and load
   `prisma-composer.config.ts` walking up from the entry's directory; import
   the entry module; run `Load` on its default export; check the root is a
   module; validate registry coverage; resolve the name; assemble each service
   through the config's build registries.
3. For each extension with a `container` descriptor: `container.ensure({
   appName, stage })` — this is where the platform's Project/Branch are created
   if absent (`execute-deploy-destroy.ts:137-141`).
4. Pin the Alchemy stage: the state-owning extension's container supplies
   `alchemyStage`; otherwise the user's `--stage`; if neither exists,
   `DEPLOY.SCOPE_MISSING` (`execute-deploy-destroy.ts:162-180`). Alchemy's own
   default (`dev_$USER`) must never apply — it is machine-dependent
   (recorded as incident TML-3157, `execute-deploy-destroy.ts:158-161`).
5. Preflight: each extension's `preflight({ graph, container, stage })`, before
   any stack file is written (`execute-deploy-destroy.ts:186-195`).
6. Write `.prisma-composer/alchemy.run.ts`
   (`packages/0-framework/3-tooling/cli/src/generate-stack.ts:82-88`).
7. Spawn alchemy (§1.7).
8. Read and delete the deployment-summary result file
   (`execute-deploy-destroy.ts:314`, `execute-deploy-destroy.ts:317-322`).

**Output.**

- The deploy tree is printed **from inside the alchemy child**, not from the
  CLI process. The generated stack file wires
  `report: deploymentReport` into `lower()`
  (`packages/0-framework/3-tooling/cli/src/generate-stack.ts:53`,
  `generate-stack.ts:71`), and `deploymentReport` prints a blank line then the
  rendered topology to **stdout** via `console.log`
  (`packages/0-framework/3-tooling/cli/src/render-deployment.ts:123-127`).
  The rendering is a box-drawn address tree, one line per deployed node, with
  `kind id` per entity, its `url`, and its `details` aligned into one column
  (`render-deployment.ts:77-116`).
- All of alchemy's own apply output goes straight to the terminal, because the
  child inherits stdio (`run-alchemy.ts:53`).
- The parent's `deploy` success path prints nothing at all: `run()` returns 0
  and discards `result.summary` (`main.ts:272`).
- There is **no JSON output mode.**

**Prompts.** None.

**Side effects.**

| effect | where |
|---|---|
| `<cwd>/.prisma-composer/alchemy.run.ts` written (overwritten every run) | `generate-stack.ts:82-88` |
| `<cwd>/.prisma-composer/deployment-result-<pid>-<uuid>.json` written by the child, read then deleted by the parent | `execute-deploy-destroy.ts:210-213`, `deployment-summary.ts:45-53`, `execute-deploy-destroy.ts:317-322` |
| `<cwd>/.alchemy/` — alchemy's own local state directory | referenced at `execute-deploy-destroy.ts:28`; written by alchemy itself |
| Platform Project/Branch created if absent | `execute-deploy-destroy.ts:140` |
| Everything the alchemy apply provisions | inside the child |

The result file's name is unique per run so two concurrent deploys from one
checkout cannot read or delete each other's file
(`execute-deploy-destroy.ts:205-208`). The `finally` at
`execute-deploy-destroy.ts:317` removes it on every path, success or failure.

**Error paths and exit codes.**

| condition | code | exit |
|---|---|---|
| `--production` passed | `DEPLOY.FLAG_INVALID` | 2 |
| bad `--stage` name | `DEPLOY.STAGE_INVALID` / `DEPLOY.STAGE_UNVALIDATABLE` | 2 |
| no config file found walking up | `CONFIG.FILE_MISSING` | 2 |
| config module threw while evaluating | `CONFIG.EVALUATION_FAILED` | 2 |
| config resolved to a different file than discovered | `CONFIG.PATH_MISMATCH` | 2 |
| config shape invalid | `CONFIG.EXPORT_INVALID` / `CONFIG.FIELD_INVALID` / `CONFIG.EXTENSION_DUPLICATE` | 2 |
| entry module unloadable | `COMPOSE.ENTRY_UNLOADABLE` | 2 |
| root not a module / unnamed | `COMPOSE.ROOT_NOT_MODULE` / `COMPOSE.NAME_MISSING` | 2 |
| container ensure threw | `DEPLOY.CONTAINER_FAILED` | 2 |
| no alchemy stage resolvable | `DEPLOY.SCOPE_MISSING` | 2 |
| preflight threw | `DEPLOY.PREFLIGHT_FAILED` | 2 |
| stack file could not be written | `DEPLOY.STACK_WRITE_FAILED` | 2 |
| `alchemy` bin not found | `DEPLOY.ALCHEMY_BIN_MISSING` | 2 |
| spawn itself threw | `DEPLOY.ENGINE_FAILED`, `diagnostics.exitCode === undefined` | 2 |
| **alchemy child exited nonzero** | `DEPLOY.ENGINE_FAILED`, `diagnostics.exitCode = status` | **the child's own status** (§1.7) |
| executor module failed to import | `DEPS.EFFECT_VERSION_CONFLICT` or `DEPS.EXECUTOR_UNLOADABLE` | 2 |
| effect-resolution preflight at startup | `DEPS.EFFECT_VERSION_CONFLICT` | 2 (via `process.exit`) |

**Test coverage.** `src/__tests__/run.test.ts` (1098 lines) drives the whole
pipeline over injected fakes: `--production` rejection, preflight ordering,
container-supplied `alchemyStage` (both with and without `--stage`), a nonzero
alchemy status propagating with the printed stack-file path.
`src/operations/__tests__/operations.test.ts` (1330 lines) covers the
programmatic surface. `src/__tests__/generate-stack.test.ts` asserts the
generated source text. There is no end-to-end test that actually runs alchemy.

**Engine notes.** `deploy` is a **result command**. It has one required
positional and two live flags. It has no prompts and no consent — but it is
destructive-adjacent in that it creates platform resources; the current design
has no `--confirm` equivalent, so porting it as-is means declaring no consent.
It should declare `needs.config` on the `composer` section token. Its exit-code
set is the passthrough exception, not a documented `exitCodes` map — see §7.
Long-running with progress output that is written by a *child process on
inherited stdio*, which the engine's `output`/`step` events cannot mediate;
see §7 hazard H1.

---

### 1.4 `destroy <entry>`

**Summary.** "Tear down the application whose root node is `<entry>`'s default
export — same derivation as deploy, Alchemy destroy."
(`packages/0-framework/3-tooling/cli/src/main.ts:53-54`)

**Positionals.** `entry` — required.

**Flags.** `--name`, `--stage`, `--production` — all three from the shared
abstract class (`main.ts:18-39`).

**Target selection is mandatory and exclusive** (`main.ts:276-294`):

| flags | result |
|---|---|
| `--stage x --production` | `DEPLOY.TARGET_CONFLICT`, exit 2 |
| neither | `DEPLOY.TARGET_MISSING`, exit 2 |
| `--stage x` | target `{ kind: 'stage', stage: x }` |
| `--production` | target `{ kind: 'production' }` |

This is the only protection against tearing down production: a bare `destroy`
is an error, so an omitted or mistyped stage cannot silently hit production
(`docs/design/10-domains/deploy-cli.md:133`).

**Behavior.** The same pipeline as deploy, with four differences
(`execute-deploy-destroy.ts:62-77` and `execute-deploy-destroy.ts:82-316`):

1. **Guardrail first.** If `<cwd>/.alchemy` is missing or empty, a
   `no-local-deploy-state` event fires *before* everything else
   (`execute-deploy-destroy.ts:103-105`, predicate at
   `execute-deploy-destroy.ts:31-34`). The CLI renders it as a **warning on
   stderr**, not a failure (`main.ts:301-308`): "No prior deploy state under
   `<cwd>` — if you deployed from a different directory, run destroy from
   there; otherwise this is a no-op."
2. **Containers are located, not created.** `container.locate(...)`; an
   `undefined` result is `DEPLOY.TARGET_NOT_FOUND`
   (`execute-deploy-destroy.ts:143-150`).
3. **No preflight.** `execute-deploy-destroy.ts:186`.
4. **Two suffix loops, in this order** (`execute-deploy-destroy.ts:283-306`):
   every extension's `teardown(...)` first, then every extension's
   `container.remove(...)`. The comment records why the order is structural:
   a stage's state database must be deleted before its Branch, because a
   Branch with an attached database refuses deletion (ADR-0034).

A destroy still assembles the app, so **the app must be built first**; an
assembly failure is re-coded to `DEPLOY.BUILD_REQUIRED` with a "run the build,
then retry" fix (`execute-deploy-destroy.ts:117-125`).

**Output.** No summary — `runStackPipeline` returns `ok(undefined)` for destroy
(`execute-deploy-destroy.ts:316`) and `run()` returns 0 silently. All visible
output is alchemy's own, on inherited stdio, plus the possible stderr warning.

**Prompts.** None. There is no type-to-confirm.

**Side effects.** Same generated stack file; platform resources removed;
containers removed. The result file is created and cleaned up identically even
though destroy never reads it (`execute-deploy-destroy.ts:210`, `:317`).

**Error paths.** As deploy, plus `DEPLOY.TARGET_CONFLICT`,
`DEPLOY.TARGET_MISSING`, `DEPLOY.TARGET_NOT_FOUND`, `DEPLOY.BUILD_REQUIRED`,
`DEPLOY.TEARDOWN_FAILED`, `DEPLOY.CONTAINER_REMOVE_FAILED`. All exit 2 except
the alchemy passthrough.

**Test coverage.** Extensive in `src/__tests__/run.test.ts`: target selection,
the `.alchemy` guardrail (missing / empty / present / not-checked-on-deploy),
container removal after destroy, no removal after a failed destroy, teardown
ordering, a throwing teardown aborting before removal.

**Engine notes.** A **result command**. It is the one clearly destructive
command in the family and the natural place for a `consent` prompt with the
app name as its token — it has none today, so adding one is a parity
divergence to put to the operator. Its `--stage` / `--production` exclusivity
is exactly the engine's flag-conflict territory. Same passthrough exception as
deploy.

---

### 1.5 `dev <entry>`

**Summary.** "Bring up the application whose root node is `<entry>`'s default
export, entirely on this machine, credential-free."
(`packages/0-framework/3-tooling/cli/src/main.ts:64-65`)

**Positionals.** `entry` — required.

**Flags.**

| flag | type | default | meaning |
|---|---|---|---|
| `--name <s>` | string | root node's name | Override the dev instance's application name (`main.ts:71-73`) |
| `--fresh` | boolean | `false` | Destroy the dev stack and wipe the dev state directory before starting (`main.ts:75-78`) |

**There is deliberately no `--stage` and no `--production`**: a working
directory has exactly one dev instance, no stages
(`main.ts:60`, local-dev spec §6).

**Auth.** None — this is the credential-free command. Everything runs against
local emulators through the extension's `localTarget` descriptor.

**Child processes.** `alchemy deploy .prisma-composer/dev/…` with stage `dev`,
once at startup and again on every file-change rebuild
(`packages/0-framework/3-tooling/cli/src/operations/execute-dev.ts:141-147`,
`execute-dev.ts:265-271`). Note the stage is the hardcoded literal `'dev'`.

**Behavior** (`packages/0-framework/3-tooling/cli/src/operations/execute-dev.ts:41-327`):

1. Refuse on Windows — `DEV.PLATFORM_UNSUPPORTED` (`execute-dev.ts:46-53`).
2. Shared pipeline (`execute-dev.ts:66`).
3. Resolve every non-build-only extension's lazy `localTarget` thunk once;
   an extension without one fails with `DEV.TARGET_UNSUPPORTED` raised inside
   core (`execute-dev.ts:74`).
4. Local containers ensured (`execute-dev.ts:77-83`).
5. `--fresh` → every local target's `teardown` (`execute-dev.ts:86-95`).
6. Preflight — always (`execute-dev.ts:98-105`).
7. Emulators ensured (`execute-dev.ts:108-115`).
8. Write the dev stack file and converge via alchemy (`execute-dev.ts:125-158`).
9. Attach: `startServices()` on every attachment, then merge `endpoints()`
   (`execute-dev.ts:213-237`).
10. Start the file watcher; on each change, re-run the pipeline, rewrite the dev
    stack, re-converge. A converge failure keeps the running app and keeps
    watching (`execute-dev.ts:248-283`).
11. Wait on `session.closed` (`run-dev.ts:129`).

Failures between step 9 and handover roll back: the watcher is stopped and
every started service is stopped before the failure surfaces
(`execute-dev.ts:319-326`).

**Output.** All on stdout via `console.log` except the error events, which go
to stderr (`packages/0-framework/3-tooling/cli/src/dev/run-dev.ts:54-90`).
The shipped order is: front door → logs hint → unwatchable notices
(`run-dev.ts:44-48`, `run-dev.ts:106-108`).

```
[dev] ready:
[dev] <address>  <url>          (sorted by address depth, then lexicographically)
[dev] logs: prisma-composer log <entry>
[dev] <address> has no watchable inputs
```

Error/notice lines, all prefixed `[dev]`: `converge failed — the running app is
untouched; still watching.` (plus the two reproduce-hint lines),
`rebuild failed: …`, `watch error: …`, `a service refused to stop: …`,
`stopping — …`, `stopped.` No JSON mode.

**Prompts.** None.

**Signal handling — a notable hazard.** After the session is handed over,
`run-dev.ts` calls `process.removeAllListeners('SIGINT')` and
`process.removeAllListeners('SIGTERM')` and installs itself as the *only*
listener (`run-dev.ts:124-127`). The recorded reason: alchemy's library code,
loaded transitively while importing the app's config and providers, registers
its own signal listeners for in-process bookkeeping that is irrelevant here
(the real converge runs in a spawned child), and whichever runs first can call
`process.exit()` synchronously and kill the process before the watch loop's
async cleanup gets a turn (`run-dev.ts:114-123`).

**Side effects.** `<cwd>/.prisma-composer/dev/` — the dev state directory
(`packages/0-framework/1-core/core/src/control/app-config.ts:162`); the
generated dev stack file; emulator daemons started and left running across
sessions; local containers. `--fresh` wipes the dev state directory.

**Error paths.** `DEV.PLATFORM_UNSUPPORTED`, `DEV.TARGET_UNSUPPORTED`,
`DEV.CONTAINER_FAILED`, `DEV.TEARDOWN_FAILED`, `DEV.PREFLIGHT_FAILED`,
`DEV.EMULATOR_FAILED`, `DEV.STACK_WRITE_FAILED`, `DEV.CONVERGE_FAILED`,
`DEV.ATTACH_FAILED`, `DEV.SERVICE_START_FAILED` — all exit 2, except that a
nonzero alchemy converge status at **startup** takes the passthrough
(`run-dev.ts:96-99`). A converge failure *after* the session is live is an
event, not an exit. A clean shutdown returns 0 (`run-dev.ts:132`) — including
after Ctrl-C, so `dev` exits **0** on SIGINT, not 130.

**Test coverage.** `src/dev/__tests__/run-dev.test.ts` (25 lines — only the
front-door rendering), `src/dev/__tests__/watch.test.ts` (130),
`src/dev/__tests__/generate-dev-stack.test.ts` (59), plus the dev cases in
`src/operations/__tests__/operations.test.ts`. Repo-level integration tests
exist at `test/integration/test/local-dev.integration.ts`,
`local-dev-store.integration.ts`, `local-dev-criteria-4-5.integration.ts`.

**Engine notes.** A **session command**: runs until the signal fires, speaks
entirely through events, returns `Result<void>`. Its event vocabulary maps
onto the engine's `EngineEvent` set almost directly — `ready` →
`endpoint` events, `stopping`/`stopped` → `status`, `converge-failed` /
`rebuild-failed` / `watch-error` / `stop-error` → `message` at `warn`/`error`.
Two things do not fit and need operator rulings: (a) the signal-listener
stripping above conflicts with the engine owning `context.signal`, and (b) the
startup-converge exit-code passthrough conflicts with a session command's
"no exit-code set". Its exit-0-on-Ctrl-C also disagrees with the shared
`130` convention.

---

### 1.6 `log <entry> [address]`

**Summary.** "Tail the merged logs of the locally-running application whose
root node is `<entry>`'s default export."
(`packages/0-framework/3-tooling/cli/src/main.ts:87-88`)

**This command is local-only.** It reads nothing from the Prisma management
API. See §4c.

**Positionals.** `entry` (required); `address` (optional) — restrict output to
one service's dotted address, e.g. `catalog.service`
(`main.ts:95-97`, filtered at
`packages/0-framework/3-tooling/cli/src/operations/execute-log.ts:81`).

**Flags.**

| flag | type | default | meaning |
|---|---|---|---|
| `--name <s>` | string | root node's name | Override the dev instance's application name (`main.ts:99-101`) |
| `--tail <n>` | string, parsed with `Number.parseInt(…, 10)` | `20` | Trailing history lines before live output (`main.ts:103-105`, `main.ts:143`, parsed at `main.ts:185-188`) |

`--tail` is the one flag with its own validation: `NaN` or negative →
`UsageError('\`--tail\` must be a non-negative integer.')`, exit 2
(`main.ts:186-188`). Note it is parsed with `parseInt`, so `--tail 5abc`
silently becomes `5`.

**Behavior** (`packages/0-framework/3-tooling/cli/src/operations/execute-log.ts:130-208`):

1. Refuse on Windows — `LOG.PLATFORM_UNSUPPORTED` (`execute-log.ts:135-142`).
2. `resolveAppIdentity` — the pipeline's *front only*: config discovery and
   load, entry import, name resolution. Deliberately no `Load`, no coverage
   check, and **no assemble**, because `log` neither builds nor provisions and
   must not require the user's built output
   (`packages/0-framework/3-tooling/cli/src/pipeline.ts:50-70`).
3. Resolve local targets; for each, `container.ensure(...)` then `attach(...)`
   (`execute-log.ts:158-169`).
4. Merge every attachment's `logs(signal, { tail })` async iterable into one
   stream (`execute-log.ts:39-127`).

**The merge is bounded.** `LOG_QUEUE_LIMIT = 10_000`
(`execute-log.ts:27`); past that the oldest line is dropped and the consumer is
told via a `lines-dropped` event (`execute-log.ts:82-86`). One pump's throw
becomes a `stream-failed` event and ends that pump only (`execute-log.ts:89-93`).

**Output.** Lines on **stdout** as `[<service>] <line>`
(`packages/0-framework/3-tooling/cli/src/log/run-log.ts:66`). Two notices on
**stderr**: `[log] stream failed: …` and `[log] falling behind — dropped the N
oldest lines.` (`run-log.ts:42-48`). No JSON mode.

**Empty case.** If no services are running, one stderr line — "no running
services for `<app>` — start it first with `prisma-composer dev <entry>`" —
and **exit 0** (`run-log.ts:58-63`).

**Prompts.** None.

**Signal handling.** SIGINT/SIGTERM → `controller.abort()`, which ends the
merged iterable; listeners are removed in a `finally`
(`run-log.ts:27-31`, `run-log.ts:68-71`). Returns 0. Unlike `dev`, it does not
strip other listeners.

**Side effects.** None on disk. It calls `container.ensure(...)`
(`execute-log.ts:164`), which for the local target is a purely local identity
resolution.

**Error paths.** `LOG.PLATFORM_UNSUPPORTED`, `LOG.ATTACH_FAILED`,
`LOG.ADDRESS_UNKNOWN` (names the running services in its message,
`execute-log.ts:192-201`), plus the config/entry codes from
`resolveAppIdentity`. All exit 2 — `run-log.ts:55` rethrows the failure and
`cli.ts` renders it.

**Test coverage.** `src/log/__tests__/run-log.test.ts` (150 lines) plus the log
cases in `src/operations/__tests__/operations.test.ts`.

**Engine notes.** A **session command** with a stream-shaped payload. `--tail`
is a number flag the engine would type properly (removing the `parseInt`
laxness). The optional `address` positional and the `LOG.ADDRESS_UNKNOWN`
"did you mean" list map to a normal validation failure. Its clean signal
handling makes it the easiest of the four to port. Because it reads only local
emulator state, it needs **no credentials and no management API** — which is
the fact §4c turns on.

---

### 1.7 The alchemy child-status passthrough, precisely

This is the exception S3 must preserve. The chain, end to end:

**Step 1 — resolve the bin.** `resolveAlchemyBin(cwd)` walks up from the cwd
looking for `node_modules/.bin/alchemy`
(`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:16-31`). Deliberately
not `npx`/`bunx`, so it behaves the same under node and bun; the resolved
launcher does its own runtime dispatch. Not found →
`DEPLOY.ALCHEMY_BIN_MISSING`.

**Step 2 — spawn.**

```ts
const args = [input.command, input.stackFileRelativePath, '--yes', '--stage', input.stage];
const result = spawnSync(bin, args, {
  cwd: input.cwd,
  stdio: 'inherit',
  env: { ...(input.env ?? process.env), ...input.containerEnv },
});
if (result.error !== undefined) throw result.error;
return result.status ?? 1;
```

`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:47-62`.

Key facts: **synchronous** `spawnSync`; **`stdio: 'inherit'`** so the child
writes directly to the CLI's own stdout/stderr with no interception; the
parent's whole environment is forwarded plus the per-extension container vars;
`--yes` is always passed; the stage is always explicit. A signal-killed child
(`result.status === null`) becomes `1`.

**Step 3 — a nonzero status becomes a structured failure carrying the status.**

```ts
if (status !== 0) {
  return notOk(new CliStructuredError('DEPLOY.ENGINE_FAILED',
    `alchemy ${action} exited with status ${status}.`,
    { meta: { exitCode: status,
              diagnostics: { exitCode: status, stackFilePath, reproduceCommand, cwd } } }));
}
```

`packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts:262-275`.
The `reproduceCommand` is built at `execute-deploy-destroy.ts:234` as
``alchemy <action> .prisma-composer/alchemy.run.ts --yes --stage <stage>``.

**Step 4 — the renderer extracts the status and returns it.**

```ts
export function renderChildStatusHints(failure: CliStructuredError): number | undefined {
  const diagnostics = executionDiagnostics(failure);
  if (diagnostics === undefined || diagnostics.exitCode === undefined) return undefined;
  console.error(`\nGenerated stack file: ${diagnostics.stackFilePath}`);
  console.error(`Run \`${diagnostics.reproduceCommand}\` from ${diagnostics.cwd} to reproduce this directly.`);
  return diagnostics.exitCode;
}
```

`packages/0-framework/3-tooling/cli/src/render-error.ts:27-37`. The two hint
lines go to **stderr**. `executionDiagnostics` is the structural reader at
`packages/0-framework/3-tooling/cli/src/operations/shared.ts:56-75`; the shape
it reads is `ExecutionDiagnostics` at `shared.ts:44-50` and is explicitly
documented as *not* part of the durable contract ("branch on
`code`/`message`/`cause` for anything durable", `shared.ts:41-42`).

**Step 5 — the CLI returns it as its own exit code.**

`renderDeployDestroyFailure` (`main.ts:220-224`) returns the status if there is
one and rethrows otherwise; `run()` returns it (`main.ts:273`, `main.ts:313`);
`cli()` assigns it (`packages/0-framework/3-tooling/cli/src/cli.ts:19`).

**Which commands pass through:** `deploy` (`main.ts:273`), `destroy`
(`main.ts:313`), and `dev` for a **startup** converge failure only
(`packages/0-framework/3-tooling/cli/src/dev/run-dev.ts:96-99`). `log` never
spawns alchemy and never passes anything through.

**When it does *not* apply:** if `spawnSync` itself throws (bin missing at
exec time, permissions), `runAlchemy` rethrows
(`run-alchemy.ts:60`), the catch builds `DEPLOY.ENGINE_FAILED` with
`diagnostics.exitCode: undefined` (`execute-deploy-destroy.ts:249-260`),
`renderChildStatusHints` returns `undefined`, and the failure takes the normal
envelope path — exit **2**.

**The rule it excepts.** ADR-0044's exit-code rule is `0` OK, `1` internal
bug only, `2` expected failure, `3` user abort, `130`/`143` signals. The
documented exception says a passthrough status is the *child's* number, not a
statement in the CLI's own code space, so an expected engine failure may
surface as `1` without contradicting the rule
(`docs/design/90-decisions/ADR-0044-errors-are-structural-envelopes-with-dotted-namespace-codes.md:108-114`).
Renumbering it onto `2` was explicitly considered and rejected
(same file, `:152-154`).

---

## 2. Config machinery

### 2.1 The file

One file: **`prisma-composer.config.ts`**
(`packages/0-framework/3-tooling/cli/src/load-config.ts:18`). The literal
filename is the only one looked for — there is no `.js`/`.mjs`/`.json`
variant, no `.config/` directory convention, and no
`prisma.config.ts` involvement today.

ADR-0017 makes it the ONE file that imports control-plane code; app code never
imports it (`docs/design/90-decisions/ADR-0017-control-plane-loads-through-the-app-config.md`;
see also the example at `examples/store/prisma-composer.config.ts`).

### 2.2 Discovery

A plain walk **up** from the entry file's directory to the filesystem root,
testing `fs.existsSync` on `<dir>/prisma-composer.config.ts` at each level
(`load-config.ts:27-36`). Not found → `CONFIG.FILE_MISSING`, whose `where`
names the directory the walk started from (`load-config.ts:38-51`).

Note: discovery is anchored on the **entry**, not the cwd. The generated stack
file, the `.alchemy` state directory, and `.prisma-composer/` are all anchored
on the **cwd**. The two can differ.

### 2.3 Evaluation strategy

The file is TypeScript and is executed by **c12**
(`load-config.ts:137-144`), with an explicit `configFile` path and every other
lookup disabled:

```ts
await c12.loadConfig({
  name: 'prisma-composer',
  configFile: configPath,
  cwd: path.dirname(configPath),
  rcFile: false, globalRc: false, packageJson: false,
});
```

The recorded reason for passing an explicit path rather than letting c12
discover: the config file's own static imports then resolve from the app root
under whatever package manager is running — no specifier construction, no
anchoring (`load-config.ts:4-8`). c12 handles the TypeScript transpilation
(via jiti, internally); composer does not run `tsc` or esbuild for this file.

**A same-path check follows the load.** If c12 reports a `configFile` whose
`realpath` differs from the discovered path, the load fails with
`CONFIG.PATH_MISMATCH` — "Refusing to deploy against a different file."
(`load-config.ts:156-169`).

### 2.4 Validation behavior — "the throwing loader"

`validateConfigShape` is field-by-field, hand-written, and **deliberately uses
no schema library** — each check raises a structured error naming the offending
field (`load-config.ts:68-127`). Every failure path is a **`throw`**, not a
returned value. This is what §S3 of the plan calls "the current throwing
loader"; the engine's `ConfigSection.validate` must return
`SectionValidation<T>` and must never throw
(`prisma-cli:.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts:344-360`).

The checks, in order:

| check | failure code | message shape |
|---|---|---|
| default export is a non-null object with at least one key | `CONFIG.EXPORT_INVALID` | `"<path>" exported no config.` (`load-config.ts:75-81`) |
| `extensions` is an array | `CONFIG.FIELD_INVALID` | `prisma-composer.config.ts: \`extensions\` must be an array.` (`:84-86`) |
| each `extensions[i]` is an object | `CONFIG.FIELD_INVALID` | `…\`extensions[i]\` must be an extension descriptor object.` (`:89-91`) |
| each `extensions[i].id` is a non-empty string | `CONFIG.FIELD_INVALID` | `…must be a non-empty string (the extension package name).` (`:92-98`) |
| each `extensions[i].nodes` is an object | `CONFIG.FIELD_INVALID` | `…must be an object (the node-ID → control registry).` (`:99-104`) |
| ids are unique | `CONFIG.EXTENSION_DUPLICATE` | `…extension "<id>" is listed more than once in \`extensions\`.` (`:105-111`) |
| `state` is an object with a string `extension` and a function `create` | `CONFIG.FIELD_INVALID` | `…\`state\` must be a state descriptor (e.g. prismaState()).` (`:114-121`) |

Every `CONFIG.FIELD_INVALID` carries `fix: "See defineConfig() in '@prisma/composer/config'."` and
`meta: { field }` (`load-config.ts:53-62`). `meta` is **not rendered** by
`renderErrorEnvelope`, so the machine-readable field name never reaches the
user's screen — it is only visible through the programmatic surface.

Nothing deeper is checked: the descriptors inside each `nodes` registry cannot
be structurally validated at runtime, and the code says so
(`load-config.ts:123-126`).

**Evaluation failure is separately coded.** If the config module itself throws
while being evaluated (a missing env var, a syntax error, a throwing factory),
the c12 call is wrapped into `CONFIG.EVALUATION_FAILED` with the original as
`cause` and `where.path` naming the file (`load-config.ts:145-154`).

### 2.5 Every config key

The type is `PrismaAppConfig`
(`packages/0-framework/1-core/core/src/control/app-config.ts:197-200`):

| key | type | required | use |
|---|---|---|---|
| `extensions` | `ExtensionDescriptor[]` | yes | Every extension the app deploys through |
| `state` | `StateDescriptor` | yes | The ONE deploy state store — explicit, platform-agnostic, never defaulted by an extension |

`ExtensionDescriptor` (`app-config.ts:31-80`):

| key | type | required | use |
|---|---|---|---|
| `id` | `string` | yes | The extension's package name, e.g. `"@prisma/composer-prisma-cloud"`; matched against a node's `extension` field |
| `nodes` | `Record<string, NodeDescriptor>` | yes | One registry per extension keyed by node ID; each entry is `kind: 'resource' \| 'service' \| 'build'` (`app-config.ts:187-190`) |
| `provisions` | `ReadonlyMap<symbol, ProvisionerDescriptor>` | no | Param provisioners keyed by need brand (ADR-0031) |
| `application` | `ApplicationDescriptor` | no | Once-per-lowering hook for the app's shared infrastructure (prisma-cloud's Project) |
| `providers` | `() => Layer.Layer<never>` | no | The extension's Alchemy providers, merged across extensions in config order |
| `preflight` | `(input) => Promise<void>` | no | Deploy-time prerequisite check; runs after containers resolve, before any stack file is written (ADR-0029) |
| `teardown` | `(input) => Promise<void>` | no | Destroy-time cleanup; runs after `alchemy destroy` succeeds, before containers are removed |
| `container` | `ContainerDescriptor` | no | The extension's container lifecycle — `ensure` / `locate` / `remove`, plus the `alchemyStage` an instance supplies (ADR-0038) |
| `localTarget` | `() => Promise<LocalTargetDescriptor>` | no | Lazy async thunk to the extension's local-target entry (ADR-0041); keeps local-target code out of every deploy path's static graph |

`StateDescriptor` (`app-config.ts:86-91`): `extension` (the owning extension's
id) and `create(container) => AlchemyStateLayer`.

`LocalTargetDescriptor` (`app-config.ts:112-125`) is the `dev`/`log` surface:
`providers`, `container`, optional `preflight`, optional `emulators`,
`attach`, optional `teardown`. `attach` returns a `LocalTargetAttachment`
with `startServices()`, `endpoints()`, `logs(signal, { tail })` and
`stopServices()` (`app-config.ts:147-159`).

### 2.6 Engine notes on the config port

The engine's `ConfigSection<T>` is `{ name, validate }` where `validate` takes
the raw section value **or `undefined`** and returns findings, never throwing
(`prisma-cli:…/engine-interface-draft.ts:348-360`). The port has to answer
three questions that today's loader does not:

1. **File identity.** Today the section is a whole separate file discovered by
   walking up from the *entry*. The engine's model is a named section inside
   `prisma.config.ts`. Whether `composer` becomes a section of
   `prisma.config.ts`, or the engine's section loader is pointed at
   `prisma-composer.config.ts`, is an open decision. UNKNOWN from the composer
   repo alone — this is an S3 design ruling.
2. **Absence.** Today absence is a hard `CONFIG.FILE_MISSING` failure with a
   fix. Under the engine, the validator owns absence and returns a
   section-required diagnostic.
3. **Executable values.** The section's validated value holds **functions and
   Effect Layers** (`create`, `providers`, `preflight`, `attach`, …). The
   engine's draft says validators load with the definition tree at startup and
   should be dependency-light (`engine-interface-draft.ts:346-347`). A composer
   section validator that must import extension packages to have anything to
   validate is in direct tension with that. This is the sharpest config
   question S3 has to settle.

---

## 3. Alchemy integration

One caveat applies to this whole section: `node_modules` is **not installed**
in the clone, so nothing about Alchemy's own internals could be read. Every
claim below comes from composer's own source.

### 3.1 Process model — a spawned child, never in-process

Composer never runs Alchemy as a library. It writes a generated stack file and
shells out to the workspace's installed `alchemy` bin. The full mechanics,
including the exit-code passthrough, are in §1.7.

The one place Alchemy code *is* loaded in-process is incidental and is treated
as a problem: importing the app's config and providers transitively loads
alchemy's provider tree, which is why `bin.ts` runs the effect-version
preflight first (`packages/0-framework/3-tooling/cli/src/bin.ts:6-13`), why the
executor modules are behind lazy imports
(`packages/0-framework/3-tooling/cli/src/operations/deploy.ts:45-47`), and why
`dev` strips alchemy's signal listeners
(`packages/0-framework/3-tooling/cli/src/dev/run-dev.ts:114-127`).

**Generated stack files.**

| command | file | contents |
|---|---|---|
| `deploy` / `destroy` | `.prisma-composer/alchemy.run.ts` | `lower(app, config, { name, bundles, report })` — no `state`, no `providers`; those come from the config (`packages/0-framework/3-tooling/cli/src/generate-stack.ts:59-79`) |
| `dev` | `.prisma-composer/dev/alchemy.run.ts` | pins `providers: localTargetProviders(...)` and `state: localState()` from `alchemy/State/LocalState` (`packages/0-framework/3-tooling/cli/src/dev/generate-dev-stack.ts:28-29`, `:55-56`, `:77`) |

**Container transport.** Each extension's resolved container crosses into the
child as one env var, `PRISMA_COMPOSER_CONTAINER_<MANGLED_EXTENSION_ID>` —
e.g. `@prisma/composer-prisma-cloud` becomes
`PRISMA_COMPOSER_CONTAINER_PRISMA_COMPOSER_PRISMA_CLOUD`
(`packages/0-framework/1-core/core/src/container-transport.ts:54-61`, built at
`:78-94`). The value is serialized JSON
`{ input: { appName, stage }, projectId, branchId?, defaultBranchId? }`
(`packages/1-prisma-cloud/1-extensions/target/src/container.ts:57-64`), read
back in the child by `deserializeContainers(config.extensions, process.env)`
(`packages/0-framework/1-core/core/src/control/deploy.ts:576`, `:759`). The CLI
is content-blind: it writes these values and never reads them
(`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:40-41`).

### 3.2 Providers

Provider code lives in **two** packages, neither of which is the CLI.

**`@internal/lowering`** (`packages/1-prisma-cloud/0-lowering/lowering`) — the
eight management-API-backed providers, bundled into a
`Provider.ProviderCollection` named `'Prisma'` at
`packages/1-prisma-cloud/0-lowering/lowering/src/providers.ts:19-51`. All paths
below are relative to that package.

| resource | file | management API calls |
|---|---|---|
| `Prisma.Project` | `src/postgres/Project.ts` | `GET /v1/projects/{id}` (:37, :62); `POST /v1/projects` body `{name, workspaceId}` (:46); `DELETE /v1/projects/{id}` (:54) |
| `Prisma.Database` | `src/postgres/Database.ts` | `GET /v1/databases/{databaseId}` (:47, :94); `POST /v1/databases` body `{projectId, name, region, isDefault?, branchId?}` (:58); `PATCH /v1/databases/{databaseId}` body `{branchId}` (:75); `DELETE /v1/databases/{databaseId}` (:86) |
| `Prisma.Connection` | `src/postgres/Connection.ts` | `POST /v1/databases/{databaseId}/connections` body `{name}` (:42); `DELETE /v1/connections/{id}` (:68) |
| `Prisma.ComputeService` | `src/compute/ComputeService.ts` | `GET /v1/apps/{appId}` (:77, :120); `POST /v1/apps` (:95); `DELETE /v1/apps/{appId}` (:112) |
| `Prisma.Deployment` | `src/compute/Deployment.ts` | `POST /v1/apps/{appId}/deployments` (:88); raw `PUT` to the returned `uploadUrl` via `fetch` (:107); `POST /v1/deployments/{deploymentId}/start` (:123); `GET /v1/deployments/{deploymentId}` (:62, :150); `POST /v1/apps/{appId}/promote` body `{deploymentId}` (:134) |
| `Prisma.EnvironmentVariable` | `src/compute/EnvironmentVariable.ts` | `GET /v1/environment-variables/{envVarId}` (:60, :141); `GET /v1/environment-variables` (:68); `PATCH /v1/environment-variables/{envVarId}` body `{value}` (:110); `POST /v1/environment-variables` (:119); `DELETE /v1/environment-variables/{envVarId}` (:133) |
| `Prisma.Bucket` | `src/buckets/Bucket.ts` | `GET /v1/buckets/{bucketId}` (:37, :68); `POST /v1/buckets` body `{projectId, name, branchId?}` (:46); `DELETE /v1/buckets/{bucketId}` (:60) |
| `Prisma.BucketKey` | `src/buckets/BucketKey.ts` | `POST /v1/buckets/{bucketId}/keys` body `{name, role: 'read_write'}` (:59); `DELETE /v1/buckets/{bucketId}/keys/{keyId}` (:78) |

Also in that package, with no API calls: `PrismaCloud.ServiceKey`
(`src/compute/ServiceKey.ts`) mints a 256-bit hex key once and keeps it in
Alchemy state.

**`@internal/prisma-cloud`** (`packages/1-prisma-cloud/1-extensions/target`) —
four more resources merged into the same provider layer at
`src/control/extension.ts:329-339`: `PrismaCloud.S3Credentials`
(mints a SigV4 key pair once), `PrismaCloud.GeneratedParam` (N random bytes,
base64, once), `PrismaCloud.PnMigration` (runs a Prisma-Next migration against
the resolved database URL), `PrismaCloud.PgWarm` (connects with `pg` and runs
`select 1` to ride out cold start).

**`@internal/local-target`**
(`packages/1-prisma-cloud/0-lowering/local-target/src/providers.ts:24-51`) —
the same eight resource tags backed by local emulator providers. It has no
management-API client and no credentials layer at all (`:1-7`). Used only by
`dev`.

`@internal/s3-protocol` defines no Alchemy providers.

**Client.** `@prisma/management-api-sdk` at `^1.57.0`
(`packages/1-prisma-cloud/0-lowering/lowering/package.json:23`), an
openapi-fetch client built once at
`packages/1-prisma-cloud/0-lowering/lowering/src/client.ts:22-34`. The default
origin is `https://api.prisma.io`
(`packages/1-prisma-cloud/0-lowering/lowering/src/client.ts:11`), overridable
via an `apiOrigin` option.

### 3.3 Credentials — where they enter

**Three environment variables, and nothing else.**

| var | purpose | read at |
|---|---|---|
| `PRISMA_SERVICE_TOKEN` | Bearer token for every management API call | `packages/1-prisma-cloud/0-lowering/lowering/src/credentials.ts:19-25` (`Config.redacted('PRISMA_SERVICE_TOKEN')`, held as `Redacted`); direct presence checks at `packages/1-prisma-cloud/1-extensions/target/src/container.ts:139-150`, `:263`, and `packages/1-prisma-cloud/1-extensions/target/src/preflight.ts:185` |
| `PRISMA_WORKSPACE_ID` | Workspace the app's Project is resolved in | `packages/1-prisma-cloud/1-extensions/target/src/container.ts:139`; default for the `prismaCloud()` option at `packages/1-prisma-cloud/1-extensions/target/src/control/extension.ts:285` |
| `PRISMA_REGION` | Optional default compute region, validated against `COMPUTE_REGIONS` | `packages/1-prisma-cloud/1-extensions/target/src/control/extension.ts:291-300` |

**There is no keychain, no credentials file, no OAuth flow, and no token
refresh anywhere in this repo.** A missing token is a literal error:
"environment variable `PRISMA_SERVICE_TOKEN` is required."
(`packages/1-prisma-cloud/1-extensions/target/src/container.ts:135-136`).

**Where credentials enter, precisely.** Two places, both outside the CLI
package:

1. **In the CLI's own process**, when the extension's `container.ensure` /
   `container.locate` runs before the stack file is written
   (`packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts:140`,
   `:143`) and when `preflight` runs (`:190`). The extension reads the env var
   itself; the CLI never sees a token.
2. **In the alchemy child**, which inherits the parent's whole environment via
   the `spawnSync` env spread
   (`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:55`), so the
   providers read the same env var again.

This is the reconciliation point for the v8 credential manager. The engine's
model is per-workspace sessions obtained through
`ctx.session()` / `ctx.credentialManager`
(`prisma-cli:.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts:395`,
`:502-524`). Composer's model is a raw env var read independently by extension
code in two processes. Bridging them means either (a) the ported commands
resolve credentials from the engine's session and inject
`PRISMA_SERVICE_TOKEN` into the child's environment — which keeps the
extensions untouched but writes a secret into a child env, or (b) the
extensions gain a way to receive a token from the caller. **UNKNOWN which**;
this is an S3 design ruling, not a fact recoverable from the clone.

### 3.4 State

**Remote — the hosted deploy path.** Alchemy state lives behind the **Prisma
management API**, not S3
(`packages/1-prisma-cloud/0-lowering/lowering/src/state/layer.ts:109-115`): the
stock `makeHttpStateStore` from `alchemy/State` is pointed at

```
{apiOrigin}/v1/projects/{projectId}/branches/{stateBranchId}/alchemy-state
```

Selection is the config's `state:` field —
`opts.state ?? config.state.create(containers.get(config.state.extension))`
(`packages/0-framework/1-core/core/src/control/deploy.ts:523-529`), passed to
`Alchemy.Stack` at `:762-766`. The user-facing descriptor is `prismaState()`
(`packages/1-prisma-cloud/1-extensions/target/src/control/extension.ts:161-171`).
This is ADR-0045 ("deploy state lives behind the platform state API").

**Concurrency control.** A per-(stack, stage) deploy lease, acquired on layer
init and released in a finalizer
(`packages/1-prisma-cloud/0-lowering/lowering/src/state/layer.ts:84-88`).
Endpoints at
`packages/1-prisma-cloud/0-lowering/lowering/src/state/lease.ts:26`:
`POST …/alchemy-state/lease` body `{stack, stage, holderDescription}`
(`:69-77`, 409 on contention, fails fast with no retry); `PATCH` the same path
as a heartbeat every 20s (`:106-134`, a 404 means the lease was lost — one
warning, then stop); `DELETE` on clean exit (`:141-173`, never throws). Every
state operation carries an `Alchemy-State-Lease-Id` header (`:11`), added to
Effect's redacted-header list (`:18-24`). This is ADR-0010.

**Bootstrap guard.** Before the store exists, `scopeOccupied` calls
`GET …/alchemy-state/state/stacks/{stack}/stages/{stage}/resources`
(`packages/1-prisma-cloud/0-lowering/lowering/src/state/empty-scope.ts:19-33`).
If it is empty, it lists `GET /v1/apps`, `GET /v1/databases`,
`GET /v1/buckets` scoped to the branch (`:55-66`) and refuses the deploy if any
live resource exists (`:87-111`).

**Local.**

| path | what |
|---|---|
| `<cwd>/.alchemy/` | Referenced by composer only as the destroy guardrail (`packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts:28-34`). Dev's local state lives at `<cwd>/.alchemy/state/<app>/dev`, per the `--fresh` teardown at `packages/1-prisma-cloud/1-extensions/target/src/local-target/teardown.ts:39` |
| `<cwd>/.prisma-composer/` | Generated stack files and the per-run deployment-result JSON |
| `<cwd>/.prisma-composer/dev/` | The dev state directory (`packages/0-framework/1-core/core/src/control/app-config.ts:162`) |

**UNKNOWN:** whether the hosted-state path also writes anything under
`<cwd>/.alchemy`. The remote store is purely HTTP, so on this evidence it
should not — which would make the destroy guardrail a check on a directory
only `dev` populates, and therefore misleading. Resolving this needs Alchemy's
own source (`makeHttpStateStore` and the CLI's state bootstrap), absent from
this clone. **Flagged as hazard H6.**

**Containers are outside Alchemy entirely.** Project and Branch are
found-or-created by the CLI *before* the stack runs
(`packages/1-prisma-cloud/0-lowering/lowering/src/container.ts:192-206`) and
removed *after* destroy (`:213-236`, driven from
`packages/1-prisma-cloud/1-extensions/target/src/container.ts:289-301`). They
are never Alchemy resources
(`docs/design/05-prisma-cloud/alchemy-lowering.md:80-84`).

---

## 4. The three S8 questions

### 4a. Does Alchemy hold desired state for which deployment is live?

**No — but a redeploy still overwrites an out-of-band promotion, by
superseding it rather than reverting it.**

Evidence:

- **`Deployment.reconcile` is unconditionally imperative**
  (`packages/1-prisma-cloud/0-lowering/lowering/src/compute/Deployment.ts:82-142`):
  create → upload artifact → start → poll until `running` →
  `POST /v1/apps/{appId}/promote`. The code states why there is no
  short-circuit at `:83-86` — a props change (a new `artifactHash`) is what
  brought it here, so returning the previous deployment would strand the new
  build. Whenever reconcile runs it mints a **brand-new** deployment and
  promotes it.
- **`Deployment.read` does not read promotion state**
  (`Deployment.ts:147-160`). It returns
  `{ deploymentId: v.data.id, deployedUrl: v.data.previewDomain }` — the
  *preview* domain of the deployment recorded in state, not the app's
  currently-promoted deployment. Nothing anywhere reads "which deployment is
  currently live".
- **`Deployment.delete` is a no-op** (`Deployment.ts:143-146`) — promoted
  deployments are retained as history.
- **`stables: []`** on Deployment (`Deployment.ts:80`), unlike every other
  provider, which pins `['id']`.
- The design doc says it outright: "What we deliberately do not model yet …
  **Promotion** as a standalone resource (the Deployment provider
  auto-promotes; rollback is unexpressed)."
  (`docs/design/05-prisma-cloud/alchemy-lowering.md:77-80`)

**Consequences for S8's five imperative commands.** There is no resource whose
props say "deployment X is promoted", so nothing reconciles a promotion back.
The behavior splits:

- **Build unchanged** (same `artifactHash`, `port`, `environment` record refs):
  the Deployment resource does not diff, `reconcile` does not run, and
  composer's next `deploy` leaves an out-of-band promotion or rollback in
  place. An out-of-band *stop* is likewise not restarted — nothing checks
  running state outside `reconcile`'s own poll.
- **Anything diffs** (any new build changes `artifactHash`,
  `Deployment.ts:15-20`): `reconcile` runs, creates a *new* deployment, and
  promotes it. A manual rollback is silently discarded — not reverted to a
  recorded desired state, but superseded by a fresh deployment.

So an imperative `promote`/`rollback`/`start`/`stop` in the CLI would not be
fought by a declarative controller. It would simply be undone by the next
`composer deploy` that changes the build — which is the normal expectation for
"I rolled back, then someone deployed again" and does not by itself argue
against the commands existing.

**UNKNOWN, and it matters.** Whether Alchemy's planner calls provider `read`
for drift detection on every apply and treats an attribute mismatch as a
change. If it does, `Deployment.read` returning `previewDomain`
(`Deployment.ts:157`) while `reconcile` persisted the post-promote
`appEndpointDomain` (`:140`) looks like permanent attribute drift, and could
force a reconcile — a fresh deploy-and-promote — on *every* run, even with an
unchanged build. That would flip the answer above for the unchanged-build case
and would make the five imperative commands genuinely unstable.
**What would resolve it:** reading Alchemy 2.0.0-beta.67's planner source
(`read`/`diff`/`stables` semantics), which requires an installed
`node_modules` or the upstream repo. The in-repo inspiration notes say
"`read` + `diff` build the plan; `reconcile` + `delete` apply it"
(`docs/design/04-inspirations/Alchemy/glossary.md:132`), but that documents a
general/older Alchemy, not the pinned beta, so it is not sufficient evidence.

### 4b. What do Composer-created app and deployment records contain?

**App / service — `POST /v1/apps`**
(`packages/1-prisma-cloud/0-lowering/lowering/src/compute/ComputeService.ts:94-103`):

```ts
body: {
  displayName: news.name,                                    // the node's graph address
  projectId: news.projectId,
  ...(news.region && { regionId: news.region }),
  ...(news.branchId !== undefined && { branchId: news.branchId }),
}
```

Props come from the compute descriptor
(`packages/1-prisma-cloud/1-extensions/target/src/descriptors/compute.ts:71-77`):
`name` is the node's graph address; `projectId` from the application hook;
`region` is `o().region ?? DEFAULT_REGION`; `branchId` is set **only for a
named stage**. Attributes kept in state: `{id, name, endpointDomain}`
(`ComputeService.ts:104-108`), `stables: ['id']`.

`branchId` is in the create body rather than a later PATCH because a create
without it lands on the default Branch and collides with the production app of
the same name (`ComputeService.ts:90-93`).

**Deployment — `POST /v1/apps/{appId}/deployments`**
(`Deployment.ts:87-92`):

```ts
body: news.port !== undefined ? { portMapping: { http: news.port } } : {}
```

That is the **entire** request payload. Everything else is out of band:

- The artifact is `PUT` raw to the `uploadUrl` returned in the create response
  (`Deployment.ts:95-120`).
- Environment variables are **not** in the body. The platform materializes the
  branch's ConfigVariables into the deployment at create time; the
  `environment` prop exists only as an Alchemy dependency edge so the variable
  writes are ordered before deployment-create (`Deployment.ts:26-35`; design
  note at `docs/design/05-prisma-cloud/alchemy-lowering.md:177-183`).
- `artifactHash` is a prop but is never sent — it exists so a new build diffs
  as a change (`Deployment.ts:15-20`).

Attributes persisted: `{deploymentId, deployedUrl?}`, where `deployedUrl` is
`promoted.data.appEndpointDomain` read *after* promote, because the create-time
domain is a placeholder (`Deployment.ts:130-132`, `:140-141`).

**Environment variables — `POST /v1/environment-variables`**
(`EnvironmentVariable.ts:118-128`):

```ts
body: { projectId, class: cls, key, value, ...(branchId ? { branchId } : {}) }
```

`class` is `'preview'` on a named stage (with `branchId`) and `'production'` on
the default stage
(`packages/1-prisma-cloud/1-extensions/target/src/descriptors/compute.ts:88-90`).
Rows written per deploy: every resolved param (`compute.ts:111-119`), the
serialized input document (`:129-139`), one per generated leaf (`:150-157`),
one per reserved provider param — RPC accepted keys, streams API key, self
origin (`:214-222`) — and the two poison rows `DATABASE_URL` and
`DATABASE_URL_POOLED` set to `"-"`
(`packages/1-prisma-cloud/1-extensions/target/src/control/extension.ts:355-373`).

**Comparison to the legacy `app deploy` path.** The legacy path's field set is
recorded in `prisma-cli:.drive/projects/prisma-cli-v8/assets/s2/command-inventory.md`
(the `app deploy` entry: `ComputeClient.deployApp`, `POST /v1/projects`,
branches, env vars, optional `POST /v1/databases`). A field-by-field diff of
the two payloads **cannot be completed from the composer clone alone** — it
needs the prisma-cli side's `deployApp` request body read against these. What
*is* established here is the shape of the Alchemy path, which is the half S8
said nobody had looked at.

Two gaps worth carrying into S8's design:

- **`displayName` is the node's graph address**, not a user-chosen app name.
  A `service list` presenting `displayName` will show graph addresses for
  composer-created services.
- **An env-var value change does not propagate to a new deployment.**
  `EnvironmentVariable` exposes only `{id, key}`, so a rotated value does not
  diff the consumer `Deployment` and no new version is created — a known
  deferred gap (`docs/design/05-prisma-cloud/alchemy-lowering.md:185-189`).

### 4c. Where does log reading live?

**`composer log` reads local dev-emulator logs over HTTP from a daemon on the
developer's own machine. It never calls the management API, and it has no
relationship to `/v1/deployments/{id}/logs` whatsoever.**

The chain:

1. `packages/0-framework/3-tooling/cli/src/log/run-log.ts:33-56` delegates to
   the operation and prints `[service] line`.
2. `packages/0-framework/3-tooling/cli/src/operations/execute-log.ts:151-169`
   resolves the app identity, then `resolveLocalTargets(identity.config)`,
   `target.container.ensure({appName, stage: undefined})`, and
   `target.attach({container, devDir})` where
   `devDir = <cwd>/.prisma-composer/dev`.
3. The attachment's `logs()` is the local emulator client:
   `packages/1-prisma-cloud/1-extensions/target/src/local-target/attach.ts:111`,
   backed by
   `packages/1-prisma-cloud/0-lowering/dev-emulators/src/client.ts:251` —
   `GET {baseUrl}/apps/<app>/services/<id>/logs?follow=1[&tail=N]` against the
   local compute-emulator daemon, over HTTP streaming.

A search for `/logs` across every package in the repo returns only the
dev-emulator client and its tests. There is no websocket log path and no S3
log stream.

**What this means for S8's ownership question.** The project spec's rule that a
subgroup is owned by exactly one command family is **not** in tension here.
`composer log` and a platform `service deployment logs` read two different
things from two different places:

| | `composer log` | proposed `service deployment logs` |
|---|---|---|
| source | local dev-emulator daemon | `GET /v1/deployments/{id}/logs` |
| scope | the app running on this machine under `composer dev` | a deployed remote deployment |
| credentials | none | platform session |
| exists today | yes | no |

They are not two ways to read the same thing. The naming is the only collision,
and it is a real one: a user who has run `composer dev` and then types
`prisma service deployment logs` should not be surprised, and vice versa. The
S8 design should name them so the local/remote split is visible — this is a
naming decision, not an ownership conflict.

One consequence for the port: because `log` needs no credentials and no
management API, it is the cheapest of the four commands to move onto the
engine and the best first proof of the engine's session-command kind.

## 5. Dependency and release surface

### 5.1 What is published

Exactly two packages:

| name | version | path |
|---|---|---|
| `@prisma/composer` | `0.6.0` | `packages/9-public/composer/package.json:2-3` |
| `@prisma/composer-prisma-cloud` | `0.6.0` | `packages/9-public/composer-prisma-cloud/package.json:2-3` |

Everything else is `private: true` — the 18 `@internal/*` packages (including
the CLI), `website/`, `test/integration/`, every `examples/*`, and the
workspace root (`package.json:2-3`). `publishConfig.access` is `public`
(`packages/9-public/composer/package.json:70-72`); `engines.node` is `>=24`
(`:67-69`).

**How the CLI reaches the registry.** Not `bundleDependencies` — that key
appears nowhere. tsdown inlines the `@internal` scope:
`packages/9-public/composer/tsdown.config.ts:30` sets
`skipNodeModulesBundle: false` and `:36` sets `noExternal: [/^@internal\//]`,
so the tarball is self-contained while external npm deps stay real imports
(`tsdown.config.ts:4-7`). The `@internal/*` packages are declared as
**devDependencies** in the public manifests so they never reach the registry
(`packages/9-public/composer/package.json:47-56`), a rule enforced by
`scripts/check-publish-deps.mjs:152-163` and grounded in ADR-0028
(`docs/design/90-decisions/ADR-0028-numbered-domains-and-layers-enforced-by-dependency-cruiser.md:48-53`).

**Direct consequence for S3.** Only `@internal/*` is inlined. Any dependency
that must survive as a real runtime import has to be **mirrored** into
`packages/9-public/composer/package.json` `dependencies` — which is exactly why
`c12`, `clipanion`, `esbuild`, `alchemy`, `effect`, `arktype` and
`@prisma/management-api-sdk` all appear there
(`packages/9-public/composer/package.json:36-46`) duplicating
`packages/0-framework/3-tooling/cli/package.json:18-25`. **`@prisma/cli-engine`
will have to be declared in both places, at the same exact version.**

### 5.2 Versioning: lockstep, no changesets

There is no `.changeset/` directory and no changesets dependency. Every
workspace package — publishable, private, and the root — carries the same
`version` (`docs/oss/versioning.md:24-41`); all manifests currently read
`0.6.0`, with the root `package.json:45` as the source of truth.

| script | what it does |
|---|---|
| `pnpm bump-minor` → `scripts/bump-minor.ts` | Reads the root version at git HEAD (`:30-47`), computes the next minor (`:49`), calls `set-version.ts` (`:55-59`), regenerates the lockfile (`:62-65`) |
| `scripts/set-version.ts:49-60` | Stamps every package and rewrites `workspace:` deps to `workspace:<version>` |
| `scripts/determine-version.ts:140-168` | Picks version and dist-tag per CI event |

Release procedure (`docs/oss/versioning.md:94-106`): run `pnpm bump-minor`,
open a PR titled `chore(release): v<version>`, and **merging that PR is the
publish trigger**.

### 5.3 Pinning

Mixed, with no general policy document. CONTRIBUTING.md, AGENTS.md, CLAUDE.md
and README.md contain no dependency-version guidance.

Exact pins exist where type identity or breakage demands them:
`alchemy: "2.0.0-beta.67"` (`packages/9-public/composer/package.json:39`, plus
five more, and patched via root `package.json:38-40` `patchedDependencies`);
`effect: "4.0.0-beta.103"` and the `@effect/*` family (`:37`, `:43`);
`@prisma/orm-*: "8.0.0-rc.1"`
(`packages/9-public/composer-prisma-cloud/package.json:47`, `:58`, `:77`).

**But `@prisma/management-api-sdk` is a caret — `^1.57.0`**
(`packages/9-public/composer/package.json:45`,
`packages/9-public/composer-prisma-cloud/package.json:46`,
`packages/1-prisma-cloud/0-lowering/lowering/package.json:22`). So the nearest
existing analogue to a new `@prisma/*` external dependency is a range, not an
exact pin.

Targeted pin checks that do exist:

| script | what it forces |
|---|---|
| `scripts/lint-orm-pins.mjs:24-25`, `:52-72` | One identical exact version, for `@prisma/orm-*` only |
| `scripts/check-npm-effect-resolution.mjs:58-62` | `effect` is exact in `@prisma/composer` |
| `scripts/check-publish-deps.mjs:65`, `:109-141` | Exact `X.Y.Z` for *workspace-internal* deps |

**The finding that matters for S3's exact-pin requirement:** "internal" in
`check-publish-deps.mjs` is determined by `pnpm list -r`, not by the `@prisma/`
scope (`scripts/check-publish-deps.mjs:25-28`, `:192-208`;
`docs/oss/versioning.md:83-86`). `@prisma/cli-engine` would therefore be
treated as an ordinary external dependency and **no existing check would force
it to be exact-pinned.** Making the pin mechanical means extending
`lint-orm-pins.mjs` or writing a sibling script.

### 5.4 CI

Six workflows under `.github/workflows/`: `ci.yml`, `dco.yml`,
`deploy-docs.yml`, `e2e-deploy.yml`, `preview-publish.yml`, `publish.yml`.

**`publish.yml` is the only npm publisher.** Triggers: push to `main` with tags
explicitly excluded (`:17-20`, `tags: ["!**"]`), and `workflow_dispatch` with
`dist-tag` and `dry-run` inputs (`:21-32`). **There is no tag trigger.** The
model (`:3-15`): a push to main with the root version unchanged publishes
`<base>-dev.N` on the `dev` tag; a changed root version publishes `<base>` on
`latest` plus a GitHub Release. Auth is npm **OIDC Trusted Publishing** — no
`NODE_AUTH_TOKEN` — with `NPM_CONFIG_PROVENANCE: "true"` (`:47-49`, `:97-105`).
The actual command is
`pnpm publish --access public --tag <tag> --no-git-checks`
(`scripts/publish-packages.mjs:87`), idempotent on already-published versions
(`:26-31`, `:114-116`).

**Tarball verification is manifest-only.** `check-publish-deps.mjs:165-170`,
`:313-337` packs each publishable tarball and inspects
`package/package.json` inside it. It does not check the emitted JavaScript.

**`publish.yml` runs no lint, typecheck, or test step** (verified across
`:51-142`). Those checks live only in `ci.yml`, on the PR: `lint` (biome plus
`pnpm lint:deps`, `:16-29`), `typecheck` (`:31-42`), `test` with a
`postgres:16` service (`:44-102`), `cast-ratchet` (`:104-124`),
`npm-effect-resolution` — which packs both public packages and installs them
with real npm (`:126-144`) — and `build` plus a clean-worktree check
(`:146-166`).

**One Node version, no matrix.** Every job uses `./.github/actions/setup` →
`jdx/mise-action` (`.github/actions/setup/action.yml:10-11`) reading
`.tool-versions:1-2` → `node 24.16.0`, `bun 1.3.13`.

`preview-publish.yml` does pkg.pr.new previews (`:62-77`), not npm publishes.

### 5.5 Constraints on adding an exact-pinned `@prisma/cli-engine`

- **No renovate.** Dependency automation is Dependabot
  (`.github/dependabot.yml`): npm at `/` covering the pnpm workspace
  (`:31-32`), weekly (`:33-37`), grouped runtime/dev (`:52-62`), with an
  `ignore` list (`:63-74`). A hand-coordinated dependency needs an ignore
  entry. The precedent is `@durable-streams/server-conformance-tests`, ignored
  because it is "bumped by hand together with streams-server" (`:70-73`) —
  the closest documented analogue to a tandem release anywhere in this repo.
- **dependency-cruiser does not restrict external dependencies.** Its rules
  (generated from `architecture.config.json`) constrain module-to-module import
  edges only — upward `:91-108`, cross-domain `:110-128`, plane `:130-158`,
  `public-is-a-sink` `:161-178`, examples `:179-193` — and it does not follow
  `node_modules` (`:204-215`). ADR-0028 explicitly permits external
  dependencies at every layer. A `9-public` package may freely add one.
- `scripts/lint-publishable-location.mjs:29-44` — anything outside
  `packages/9-public/` must be private; anything inside must not be.
- **No pnpm catalog.** `pnpm-workspace.yaml` has only `packages:`, and
  `check-publish-deps.mjs:76-78` actively rejects `catalog:` specifiers in
  packed manifests. Each manifest declares its own versions; there is no
  central place to pin.
- If `@prisma/cli-engine` ever has a postinstall or build step, it must be
  added to root `package.json:33-36` `onlyBuiltDependencies` (currently
  `["prisma", "@prisma/engines"]`).
- pnpm `10.27.0` is pinned via `packageManager` (root `package.json:4`);
  `.npmrc:5` sets `node-linker=hoisted`; CI always installs
  `--frozen-lockfile`.
- `.agents/rules/exports-entrypoints.mdc:48-49` requires new public entrypoints
  to be registered in `architecture.config.json` with non-overlapping globs —
  relevant if consuming the engine's `./protocol` subpath adds one.

**UNKNOWN — the tandem-release protocol.** Nothing in the composer repo
references cross-repo release coordination, `cli-engine`, or a "tandem"
release; there is no submodule and no workflow referencing another repo. A
repo-wide grep of the clone for `cli-engine` and `tandem` returns zero hits.
**What would resolve it:** the prisma-cli side's publish workflow plus a
written decision on the coordination protocol. Neither exists yet — designing
it is S3 work.

**UNKNOWN — externalization semantics under `skipNodeModulesBundle: false`.**
Whether declared `dependencies` are automatically left external is not
documented, and the evidence is mixed: `esbuild` is both a declared dependency
*and* explicitly listed in `external`
(`packages/9-public/composer/tsdown.config.ts:35`), while `chokidar` is an
`@internal/cli` dependency that is *not* mirrored into the public manifest.
**What would resolve it:** running `pnpm --filter @prisma/composer build` and
grepping the emitted `dist/*.mjs` for surviving imports. No `dist/` is checked
in. This must be settled before `@prisma/cli-engine` is added, or the engine
could silently end up inlined into the tarball — which would break the
published-consumption proof S3 exists to deliver. **Flagged as hazard H7.**

---

## 6. The paused 1c brief

**Path:** `.drive/projects/prisma-cli-v8/assets/briefs/1c-leftovers-composer.md`
(in the prisma-cli repo, not the composer clone).

**Title:** "Brief: composer config-contract compliance and control-API test
double" (`:1`). Target repo prisma/composer (main); operator Will Madden;
three deliverables (`:3`).

It has exactly one commit — `6abc20f docs(architecture): requirements for the
unified CLI engine (#128)`, 2026-08-10 — so there is no in-repo edit trail.
Nothing under `wip/repos/composer/docs` mentions it.

**Context it locks down** (`:7`): composer's error and result rules come from
its ADR-0043 and ADR-0044 — structured errors at origin with dotted codes from
a **closed** registry, one `ok` discriminator, exit 1 for bugs only; adding a
subcode means editing that list in the same change. Plus one constraint marked
as immovable: the effect constellation stays pinned at `4.0.0-beta.103` via the
consumer overrides block, because alchemy is broken on effect ≥ beta.104.

### The three deliverables

**1 — config validation returns diagnostics instead of throwing** (`:9-17`).
Today `load-config.ts` and `validate-coverage.ts` throw on the first invalid
field; both still do (see §2.4). The target: loading returns the evaluated
value **plus a diagnostics list** tagged by config section and field via
`meta`; a command fails (exit 2) only when a section it needs is invalid; an
unevaluatable config module yields one `CONFIG.EVALUATION_FAILED` diagnostic
that fails every command early; "no import-time side effects and no throwing
from `defineConfig`-equivalent factories" (`:16`); rendered and `--json` output
pinned before and after, with user-visible behavior allowed to change "only in
framing" (`:17`).

**2 — the effect-resolution preflight becomes a diagnostic** (`:19-26`).
`check-effect-resolution.ts` throws during import and takes out every command
(see §1.2). The target: run it at config-load / command-dispatch time as a
`DEPS.EFFECT_VERSION_CONFLICT` diagnostic inside deliverable 1's list, so
help and config-inspection commands keep working; the
`DEPS.EXECUTOR_UNLOADABLE` lazy path stays as the backstop; the effect CI probe
and the `npm install effect` dedupe check must still pass.

**3 — a published test double for the control API** (`:28-30`). Hosts driving
`@prisma/composer/control` (deploy/destroy/dev/log) need a double that never
spawns alchemy or containers: fixture-backed, exported from a published
entrypoint (placement judged against the existing `./control` shim, which
exists at `packages/9-public/composer/package.json:12`), the same operation
signatures and `Result<…, CliStructuredError>` shapes, per-operation fixtures
overridable per test, a working `DevSession` double, and a compile-time
conformance check that the double's surface matches the real operations.

The brief also carries a verification list (`:32-34`) and commit discipline
(`:36-38`).

### Why it is paused

Recorded at `.drive/projects/prisma-cli-v8/design-notes.md:47-56`, under
"Hand-off briefs — handed off, PAUSED by the operator": the 1b and 1c briefs
were already with other agents, but the operator paused that work until the
engine lands, because their config deliverables (diagnostics-not-throw loaders,
marker, validators) will be rewritten against the engine's config API. The
sequencing consequence recorded there is that the engine's protocol and
config-section API is upstream of resuming 1b/1c, and that when resumed the
briefs need revision first. `spec.md:121-123` restates it as a non-goal:
resuming 1b/1c is sequenced after the engine's config API lands, their revision
is the trigger to unpause, and their content is not this project's deliverable.

**UNKNOWN:** the exact pause date and which agents held the brief. Nothing
in-repo records either; the operator's own session history or the composer PR
list would resolve it.

### What S3 supersedes, and what it does not

| deliverable | status under S3 |
|---|---|
| 1 — diagnostics-not-throw config loading | **Superseded.** `plan.md:44-45` puts the throwing-loader rewrite in S3, but re-specified against the engine's `defineConfigSection` / validator-owned-absence / `Diagnostic` model rather than 1c's bespoke diagnostics list. 1c's exit-2 rule and per-section failure semantics are replaced by the engine's protocol, not carried over |
| 2 — effect preflight as a diagnostic | **Not clearly covered.** S3 says nothing about it. Moving it off import time is a prerequisite for the "no import-time side effects" property the engine wants (and for S6's import-purity check), so it is adjacent — but no S3 text claims it. Same for the effect `4.0.0-beta.103` pin constraint, which is live for S3's exact-pin work but is not restated in the plan |
| 3 — published control-API test double | **Not covered at all.** Nothing in S3, and nothing in S6 (whose three checks are import purity, validator no-throw, and tarball verification, `plan.md:74-78`), delivers it. Closing 1c against S3 **drops this deliverable** unless it is re-filed |

Recommendation for the operator: close 1c against S3 for deliverable 1, fold
deliverable 2 into S3 explicitly (the engine's no-throw-at-startup requirement
makes it S3's problem whether or not the plan says so), and take a decision on
deliverable 3 — drop it or re-file it — rather than letting it lapse silently.

---

## 7. Spec discrepancies and hazards

### 7.1 Where composer's docs or help text disagree with its code

**D1 — `deploy --help` advertises a flag that always fails.** `--production`
is declared on the shared abstract class `DeployCliCommand`
(`packages/0-framework/3-tooling/cli/src/main.ts:29-32`), so clipanion lists it
in `deploy`'s help. Its description opens with "destroy:", which is the only
hint. Passing it to `deploy` is always `DEPLOY.FLAG_INVALID`
(`main.ts:259-267`). Same for `--stage` on `destroy`, though that one is
genuinely valid.

**D2 — a stale reference to an unscoped launcher.** `cli.ts:15` says the
function is "Shared by this package's `bin` and the unscoped `prisma-composer`
launcher." No such launcher exists; ADR-0027 explicitly rejected building one
(`docs/design/90-decisions/ADR-0027-two-packages-compose-and-compose-prisma-cloud.md:19`,
`:93`). Cosmetic, but it will mislead a porter looking for a second entry
point.

**D3 — the `.alchemy` destroy guardrail may check a directory the hosted path
never writes.** `destroy` warns when `<cwd>/.alchemy` is missing or empty
(`packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts:31-34`,
`:103-105`), telling the user they may be in the wrong directory. But hosted
deploy state lives behind the management API (§3.4), and the only confirmed
writer of `<cwd>/.alchemy` is `dev`'s local state
(`packages/1-prisma-cloud/1-extensions/target/src/local-target/teardown.ts:39`).
If the hosted path writes nothing there, the warning fires on every legitimate
`destroy` from a machine that has only ever deployed, never run `dev`. See H6.

**D4 — the trusted-publisher repository name is stale.**
`docs/oss/versioning.md:132` names the repository `compose`, while the
manifests say `https://github.com/prisma/composer.git`
(`packages/9-public/composer/package.json:62-66`).

**D5 — `--tail` accepts malformed input silently.** `main.ts:185` uses
`Number.parseInt(command.tail, 10)`, so `--tail 5abc` becomes `5` rather than a
usage error. The explicit check only rejects `NaN` and negatives (`:186-188`).

**D6 — every parse failure produces the same message.** Any clipanion parse
error — unmatched command, missing `<entry>`, unknown flag, a trailing
`--name` with no value — is replaced by the **full detailed usage text**
(`main.ts:156-159`). The specific reason is discarded. A user who typos a flag
gets a wall of help with no indication of what was wrong.

**D7 — bare invocation exits 2.** `prisma-composer` with no arguments prints
the usage text to **stderr** and exits **2** (`main.ts:208`), while
`prisma-composer --help` prints the same text to **stdout** and exits **0**
(`main.ts:205-207`).

### 7.2 Hazards for the port

**H1 — the child writes to the terminal, and the engine cannot see it.**
`spawnSync(..., { stdio: 'inherit' })`
(`packages/0-framework/3-tooling/cli/src/run-alchemy.ts:51-58`) means alchemy's
entire apply output, and the deploy topology tree printed by the report hook
*inside the child* (`render-deployment.ts:123-127`), bypass the CLI process
completely. The engine's presentation model — `output` events, `--json`
envelopes, quiet mode — has no purchase on any of it. Three consequences:
composer can never have a working `--json` for `deploy` without changing the
process model; the engine's stdout/stderr discipline cannot be enforced; and
`spawnSync` **blocks the event loop**, so a session command's signal handling
cannot run during a converge. This is the single largest porting decision in
S3 and needs an operator ruling.

**H2 — the passthrough exception and the engine's exit-code model.**
ADR-0044's exception (§1.7) hands the child's arbitrary status through as the
CLI's own. The engine's `CommandDefinition` types exit codes as a documented
`Record<TCode, string>` in the range 4–99
(`prisma-cli:.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts:846-855`),
and session commands have no exit-code set at all. An arbitrary passthrough
status — which may be `1`, the engine's "internal bug" code — fits neither.
The plan says to preserve the exception, so the engine needs an explicit escape
hatch for it, and `dev` needs one too (its startup-converge failure passes
through, `run-dev.ts:96-99`).

**H3 — `dev` strips the process's signal listeners.** `run-dev.ts:124-127`
calls `process.removeAllListeners('SIGINT')` and `removeAllListeners('SIGTERM')`
and installs itself as the only listener, because alchemy's transitively-loaded
library code registers listeners that can `process.exit()` synchronously
(`run-dev.ts:114-123`). Under the engine, `context.signal` is the engine's, and
a command that wipes the host's listeners will break it. The underlying cause —
alchemy's import-time side effects — does not go away by porting.

**H4 — the config validator must import extension packages.** The engine wants
validators dependency-light because they load with the definition tree at
startup (`engine-interface-draft.ts:346-347`). Composer's validated config
value holds functions and Effect Layers supplied by extension packages (§2.5),
and merely *evaluating* the config file pulls alchemy's provider tree into the
process — which is what the effect preflight at `bin.ts:14` exists to guard.
A `composer` section validator cannot be dependency-light as written.

**H5 — everything composer depends on for deployment is experimental or
pre-release.** `alchemy@2.0.0-beta.67`, exact-pinned *and locally patched*
(root `package.json:38-40`); `effect@4.0.0-beta.103`, which cannot move because
alchemy breaks on beta.104 or later
(`.drive/projects/prisma-cli-v8/assets/briefs/1c-leftovers-composer.md:7`);
`@prisma/orm-*@8.0.0-rc.1`. On the API side, the plan already records that
every deployment endpoint is marked experimental and subject to change without
notice (`plan.md:99`) — and the providers in §3.2 call `POST /v1/apps`,
`POST /v1/apps/{id}/deployments`, `POST /v1/deployments/{id}/start` and
`POST /v1/apps/{id}/promote` directly. The `alchemy-state` and
`alchemy-state/lease` endpoints (§3.4) are a further unversioned surface that
nothing outside composer uses.

**H6 — hosted-path local state is unresolved.** Whether the hosted deploy path
writes anything under `<cwd>/.alchemy` could not be established (§3.4). It
determines whether D3's guardrail is correct or misleading. Resolving it needs
Alchemy's own source.

**H7 — bundler externalization is unresolved.** Whether a declared dependency
is automatically left external under `skipNodeModulesBundle: false` is not
documented, and the evidence is mixed (§5.5). If `@prisma/cli-engine` were
silently inlined into the published tarball, S3's cross-repo
published-consumption proof would be void while appearing to pass. Settle this
before adding the dependency. S6's tarball-verification check is the natural
place to make it permanent — note that composer's own
`check-publish-deps.mjs` inspects only the packed `package.json`, never the
emitted JavaScript (§5.4).

**H8 — the alchemy stage is a hidden, container-derived value.** The stage
passed to the child is not the user's `--stage`: it is the state-owning
extension's `container.alchemyStage` when there is one, falling back to
`--stage` (`execute-deploy-destroy.ts:162`). The reproduce hint printed on
failure deliberately includes it, because without it alchemy falls back to its
machine-dependent `dev_$USER` default and reads **different** deploy state
(`render-error.ts:31-33`; incident TML-3157). Any port that reconstructs the
alchemy invocation must preserve this exactly.

**H9 — discovery anchors differ.** The config file is discovered by walking up
from the **entry** (`load-config.ts:27-36`), while `.prisma-composer/`,
`.alchemy/` and the alchemy child's cwd all anchor on the **process cwd**
(`execute-deploy-destroy.ts:210`, `run-alchemy.ts:52`). The two can diverge,
and the destroy guardrail's "you may be in the wrong directory" warning is a
symptom of that design. The engine's config loading has its own discovery
rules, so this needs reconciling rather than porting.

**H10 — no prompts today, and one command that arguably needs one.**
`destroy` tears down production with no confirmation; its only protection is
the required explicit target (§1.4). Adding the engine's `consent` prompt with
the app name as its token would be an improvement but is a **parity
divergence** and belongs on S3's divergence list for operator review, not in
the port silently.

