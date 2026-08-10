# S2c parity divergences — service group

Every known place where the S2c ports differ from the shipping
`prisma-cli`. Same entry format as `parity-divergences.md`; S2d
consolidates the per-slice files. The S1 whoami-scoped record and the
engine-global divergences (json framing, channel discipline, `--quiet`
as a log-level alias, dropped `--trace`, shared flag family, errored
settlements exit 2) apply to every command here and are not repeated.

## Dispatch 1 — service group core (build, show, open, list-deploys, show-deploy, domain add/show/remove/retry/wait)

### The rename (R-S2c-1), one entry per command

`app` ports as `service` — paths, ids, help, presenters, error copy,
flags, positionals. No alias; the legacy `app` spellings do not exist
in the v8 tree.

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
| `prisma-cli app build [app]` | `prisma-cli service build [service]` | positional `[app]` → `[service]`; error copy "App build/app" → "Service build/service" |
| `prisma-cli app show [app]` | `prisma-cli service show [service]` | `--app <name>` → `--service <name>`; result field `app` → `service` |
| `prisma-cli app open [app]` | `prisma-cli service open [service]` | `--app` → `--service`; result field `app` → `service` |
| `prisma-cli app list-deploys [app]` | `prisma-cli service list-deploys [service]` | `--app` → `--service`; result field `app` → `service` |
| `prisma-cli app show-deploy <deployment>` | `prisma-cli service show-deploy <deployment>` | result field `app` → `service` |
| `prisma-cli app domain add <hostname> [app]` | `prisma-cli service domain add <hostname> [service]` | `--app` → `--service`; result fields `app`/`appId` → `service`/`serviceId` |
| `prisma-cli app domain show <hostname> [app]` | `prisma-cli service domain show <hostname> [service]` | same as domain add |
| `prisma-cli app domain remove <hostname> [app]` | `prisma-cli service domain remove <hostname> [service]` | same, plus consent question "Detach … from App …?" → "… from Service …?" |
| `prisma-cli app domain retry <hostname> [app]` | `prisma-cli service domain retry <hostname> [service]` | same as domain add |
| `prisma-cli app domain wait <hostname> [app]` | `prisma-cli service domain wait <hostname> [service]` | same as domain add |

- Command ids follow: `app.domain.add` → `service.domain.add`, etc.
- Env override rename: `PRISMA_APP_ID` → `PRISMA_SERVICE_ID` (domain
  target selection; `PRISMA_PROJECT_ID` unchanged). The legacy name is
  NOT read in v8.
- NOT renamed: `prisma.compute.ts` keys (`app:`/`apps:` are
  SDK-owned; rename needs @prisma/compute-sdk coordination — flagged
  for the operator), and the shared local state file's internal keys
  (`state.json`'s `app.selectedByProject` — the store is still shared
  with the legacy shell until S2d).

### Error-code mapping (flat → dotted `SERVICE.*`)

Every errored settlement exits 2 (engine rule; the legacy exit-1
errors below change as a class). `fix` prose maps to a `user-choice`
nextAction — appended after the legacy typed `nextActions` when an
error carries both (e.g. `PROJECT_SETUP_REQUIRED`), so no advice is
lost; command-shaped `nextSteps` map to `run-command` nextActions
with the renamed `service` spelling.

Rename inside ported error prose: command lines (`prisma-cli app …` →
`prisma-cli service …`) and the "app target" noun rename;
prose that names the SDK-owned config entries deliberately keeps
`app` — `defineComputeConfig({ app })` and
`ComputeConfigTargetUnknownError`'s "this config defines a single
app." refer to the `prisma.compute.ts` `app:`/`apps:` keys, which do
not rename until the compute-sdk coordination lands (decided, not an
accident of the substitution list).

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `BUILD_FAILED` (1) | `SERVICE.BUILD_FAILED` (2) | build |
| `FRAMEWORK_NOT_DETECTED` (2) | `SERVICE.FRAMEWORK_NOT_DETECTED` (2) | build |
| `BUILD_SETTINGS_UNSUPPORTED` (2) | `SERVICE.BUILD_SETTINGS_UNSUPPORTED` (2) | build |
| `USAGE_ERROR` (2) — ambiguous auto detection | `SERVICE.BUILD_DETECTION_AMBIGUOUS` (2) | build |
| `USAGE_ERROR` (2) — `--entry` with a non-entrypoint build type | `SERVICE.ENTRYPOINT_UNSUPPORTED` (2) | build |
| `USAGE_ERROR` (2) — named target without a config | `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | build, show, open, list-deploys, domain * |
| `COMPUTE_CONFIG_INVALID` (2) | `SERVICE.COMPUTE_CONFIG_INVALID` (2) | build, show, open, list-deploys, domain * |
| `COMPUTE_CONFIG_TARGET_REQUIRED` (2) | `SERVICE.COMPUTE_CONFIG_TARGET_REQUIRED` (2) | build |
| `COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | all with `[service]` |
| `USAGE_ERROR` (2) — unknown `--app`/saved selection | `SERVICE.SELECTION_INVALID` (2) | show, open, list-deploys, domain * |
| `USAGE_ERROR` (2) — "App selection required in non-interactive mode" | engine `CLI.PROMPT_REQUIRED` (2) | show, open, list-deploys, domain * (see picker entry) |
| `USAGE_ERROR` (2) — domain target has no app | `SERVICE.DOMAIN_TARGET_REQUIRED` (2) | domain * |
| `USAGE_ERROR` (2) — invalid `--timeout` | `SERVICE.TIMEOUT_INVALID` (2) | domain wait |
| `USAGE_ERROR` (2) — "Workspace required" | `SERVICE.WORKSPACE_REQUIRED` (2) | all platform commands |
| `PROJECT_NOT_FOUND` (1) | `SERVICE.PROJECT_NOT_FOUND` (2) | show, open, list-deploys, domain * |
| `PROJECT_AMBIGUOUS` (2) | `SERVICE.PROJECT_AMBIGUOUS` (2) | same |
| `PROJECT_SETUP_REQUIRED` (1) | `SERVICE.PROJECT_SETUP_REQUIRED` (2) | same |
| `LOCAL_STATE_STALE` (1) | `SERVICE.LOCAL_STATE_STALE` (2) | same |
| `LOCAL_PROJECT_WORKSPACE_MISMATCH` (1) | `SERVICE.LOCAL_PROJECT_WORKSPACE_MISMATCH` (2) | same |
| `NO_DEPLOYMENTS` (1) | `SERVICE.NO_DEPLOYMENTS` (2) | open, domain add |
| `FEATURE_UNAVAILABLE` (1) — no live URL | `SERVICE.FEATURE_UNAVAILABLE` (2) | open |
| `DEPLOYMENT_NOT_FOUND` (1) | `SERVICE.DEPLOYMENT_NOT_FOUND` (2) | show-deploy |
| `DEPLOY_FAILED` (1) | `SERVICE.DEPLOY_FAILED` (2) | all remote-listing failures |
| `BRANCH_NOT_DEPLOYABLE` (2) | `SERVICE.BRANCH_NOT_DEPLOYABLE` (2) | domain * |
| `DOMAIN_HOSTNAME_INVALID` (2) | `SERVICE.DOMAIN_HOSTNAME_INVALID` (2) | domain * |
| `DOMAIN_NOT_FOUND` (1) | `SERVICE.DOMAIN_NOT_FOUND` (2) | domain show/remove/retry/wait |
| `DOMAIN_ALREADY_REGISTERED` (1) | `SERVICE.DOMAIN_ALREADY_REGISTERED` (2) | domain add |
| `DOMAIN_QUOTA_EXCEEDED` (1) | `SERVICE.DOMAIN_QUOTA_EXCEEDED` (2) | domain add |
| `DOMAIN_DNS_NOT_CONFIGURED` (1) | `SERVICE.DOMAIN_DNS_NOT_CONFIGURED` (2) | domain add |
| `DOMAIN_RETRY_NOT_ELIGIBLE` (1) | `SERVICE.DOMAIN_RETRY_NOT_ELIGIBLE` (2) | domain retry |
| `DOMAIN_VERIFICATION_FAILED` (1) | `SERVICE.DOMAIN_VERIFICATION_FAILED` (2) | domain wait |
| `DOMAIN_VERIFICATION_TIMEOUT` (1) | `SERVICE.DOMAIN_VERIFICATION_TIMEOUT` (2) | domain wait |

### Auth (Q1 class)

The service group's legacy commands never auto-logged-in
(`requireComputeAuth`); v8 keeps that: `needs.credentials` settles
unauthenticated runs with the engine's `CLI.CREDENTIALS_REQUIRED`
(exit 2) instead of the legacy `AUTH_REQUIRED` (exit 1).

### `service domain remove` consent

Recorded with the group's other consent points in "Consent" under
dispatch 2 below — one table, one mechanism, for all three.

### Interactive service picker

The legacy picker errored with per-command `USAGE_ERROR` copy in
non-interactive contexts and when a saved selection went stale
non-interactively. In v8 the engine prompt settles those runs with the
structural `CLI.PROMPT_REQUIRED` error (R-S2b-6); a stale saved
selection falls through to the picker in both modes.

### `service open` browser launch

The legacy command opened the live URL whenever prompting was allowed
(TTY + not CI + not `--json`). v8 hands the URL to the engine's
`ctx.openUrl`, which announces it as an `endpoint` event and opens the
browser when the session is interactive. Differences from legacy: a
`--json` run in an interactive terminal now DOES open the browser
(legacy suppressed it because json implied non-interactive), a failed
open reports `opened: false` instead of raising, and the URL is also
printed as the stdout payload line (legacy printed nothing on stdout).

### `service build`

- Gains engine progress events: `step-started`/`step-finished` around
  the build, an `artifact` event for the output directory, and
  per-line `output` events tapped from the SDK build runner
  (`BuildCommandIo.onOutput`, wired through a new optional `io`
  parameter on `executeAppBuild`/`resolveAppBuildStrategy`; legacy
  callers unaffected). Legacy printed no live build output.
- `--build-type` values are engine-enum-validated at parse time
  (usage error exit 2, engine copy) instead of the legacy
  commander/controller split.
- Legacy `nextSteps: ["prisma-cli app deploy"]` becomes the
  `run-command` nextAction `prisma-cli service deploy`.

### `service domain wait`

- Now a result command with engine `status` events (one per status
  change, `from`/`status`/`data.domainId`/`data.elapsedMs`) instead of
  the legacy streaming stderr lines / per-poll json events; json mode
  frames each status change exactly once (legacy emitted an event per
  poll cycle in json mode, including unchanged statuses).
- Success now settles with a result envelope
  (`{…target, hostname, status: "active", liveUrl}`); legacy ended
  with only the streaming success wrapper event.
- Poll interval still honors `PRISMA_CLI_DOMAIN_WAIT_POLL_MS`
  (default 5s); `--timeout` grammar unchanged (default `15m`, `0` =
  single check).

### Result shape changes (all commands)

- `verboseContext` (the `--verbose` "Local context" block and json
  field) is dropped — `--verbose` is a log-level alias in v8 and is
  not otherwise retained (S2 ruling 7).
- `service list-deploys` json result is the plain
  `{projectId, service, deployments}` record; the legacy
  `items`/`count` list-serializer wrapper does not port.
- Domain results drop the `branch.id` field (legacy emitted
  `branch: {id, name, kind}` with `id` always `null` for domain
  commands; v8 emits `branch: {name, kind}`).
- Human output: whoami-style summary + field rows (and a table for
  list-deploys) on stderr; these commands write no stdout payload in
  human mode except `service open`, which now prints the URL as its
  stdout payload line (pipe-clean; legacy printed nothing on stdout).

### Fixture mode

Legacy app commands refused to run in fixture mode
(`FEATURE_UNAVAILABLE` via `ensurePreviewAppMode`). The v8 tree has no
fixture mode, so the refusal path does not port (fixture machinery
dies in S2d).

## Dispatch 2 — deploy, promote, rollback, remove

### The rename (R-S2c-1), one entry per command

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
| `prisma-cli app deploy [app]` | `prisma-cli service deploy [service]` | `--app <name>` → `--service <name>`; `PRISMA_APP_ID` → `PRISMA_SERVICE_ID`; result field `app` → `service`; deploy-all rejection message names `--service` |
| `prisma-cli app promote <deployment> [app]` | `prisma-cli service promote <deployment> [service]` | `--app` → `--service`; result field `app` → `service`; error copy "App promote requires an existing app" → "Service promote requires an existing service" |
| `prisma-cli app rollback [app]` | `prisma-cli service rollback [service]` | same, plus "…requires an existing service" |
| `prisma-cli app remove [app]` | `prisma-cli service remove [service]` | same, plus the confirmation question "…app removal" → `Remove Service "<name>" and every deployment it owns?` |

Command ids follow: `app.deploy` → `service.deploy`, etc.

### Consent (Q5 class; operator-ruled 2026-08-10, shipped)

Consent is engine-owned and this is what ships: each consent point
declares a token — the natural noun of the action — so an interactive
session type-to-confirms it, and the engine's global repeatable
`--confirm <value>` grants it non-interactively when a supplied value
matches the token exactly (each value consumed once per run). No command
declares a consent flag of its own. `--yes` alone never grants consent;
`--yes` together with a matching `--confirm <token>` does, because it
takes the same non-interactive branch.

| Command | Legacy grant | v8 grant | Token |
| --- | --- | --- | --- |
| `service remove` | typed app name on a TTY; `-y/--yes` skipped it; non-interactive without `--yes` → `CONFIRMATION_REQUIRED` (exit 1) | type the service name interactively, or `--confirm <service>` | the service name |
| `service deploy` (production replace) | `--prod` plus `--yes` or an interactive yes/no confirm; cancel exited **0** | type the service name interactively, or `--confirm <service>`; `--prod` is still required first | the target service name |
| `service domain remove` | `-y/--yes` skipped the yes/no confirm | type the hostname interactively, or `--confirm <hostname>` | the hostname |

Transitions, identical on all three:

- **Granted** interactively by typing the token, non-interactively by
  `--confirm <token>`.
- **Wrong token typed interactively**: the engine's structural consent
  mismatch, exit 2. Legacy re-asked a bad yes/no answer and treated an
  explicit "no" as a cancellation, so what used to be a decline is now a
  mismatch — there is no longer a "no" to give.
- **Wrong or missing `--confirm` value non-interactively** (including
  under `--yes`): `CLI.CONSENT_REQUIRED`, exit 2, naming the expected
  value and carrying it as `meta.consentToken`. Legacy's
  `CONFIRMATION_REQUIRED` exited 1, and the production-deploy cancel
  exited **0** (ledger Q5).

### Error-code mapping (dispatch 2 additions)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `DEPLOY_FAILED` (1) | `SERVICE.DEPLOY_FAILED` (2) | deploy, promote, rollback |
| `BUILD_FAILED` (1) | `SERVICE.BUILD_FAILED` (2) | deploy (build phase) |
| `REMOVE_FAILED` (1) | `SERVICE.REMOVE_FAILED` (2) | remove |
| `NO_PREVIOUS_DEPLOYMENT` (1) | `SERVICE.NO_PREVIOUS_DEPLOYMENT` (2) | rollback |
| `DEPLOYMENT_NOT_FOUND` (1) | `SERVICE.DEPLOYMENT_NOT_FOUND` (2) | promote, rollback |
| `PROD_DEPLOY_REQUIRES_FLAG` (2) | `SERVICE.PROD_DEPLOY_REQUIRES_FLAG` (2) | deploy |
| `PROJECT_SETUP_REQUIRED` (1) | `SERVICE.PROJECT_SETUP_REQUIRED` (2) | deploy |
| `LOCAL_STATE_STALE` (1) | `SERVICE.LOCAL_STATE_STALE` (2) | deploy |
| `BRANCH_DATABASE_SETUP_FAILED` (1) | `SERVICE.BRANCH_DATABASE_SETUP_FAILED` (2) | deploy `--db` |
| `BUILD_SETTINGS_MIGRATION_REQUIRED` (2) | `SERVICE.BUILD_SETTINGS_MIGRATION_REQUIRED` (2) | deploy |
| `FRAMEWORK_NOT_DETECTED` (2) | `SERVICE.FRAMEWORK_NOT_DETECTED` (2) | deploy |
| `USAGE_ERROR` (2) — `--entry` with a non-entrypoint framework | `SERVICE.ENTRYPOINT_UNSUPPORTED` (2) | deploy |
| `USAGE_ERROR` (2) — invalid `--http-port` | `SERVICE.HTTP_PORT_INVALID` (2) | deploy |
| `USAGE_ERROR` (2) — invalid/unknown `--region` | `SERVICE.REGION_INVALID` (2) | deploy |
| `USAGE_ERROR` (2) — `--region` differs from the existing app's region | `SERVICE.REGION_MISMATCH` (2) | deploy |
| `USAGE_ERROR` (2) — `--project`/`--create-project`/`PRISMA_PROJECT_ID` together | `SERVICE.PROJECT_INPUTS_AMBIGUOUS` (2) | deploy |
| `USAGE_ERROR` (2) — per-app inputs in deploy-all | `SERVICE.DEPLOY_ALL_INPUTS_REJECTED` (2) | deploy |
| `USAGE_ERROR` (2) — "App promote/rollback/remove requires an existing app" | `SERVICE.TARGET_REQUIRED` (2) | promote, rollback, remove |
| `USAGE_ERROR` (2) — empty `--branch` | `SERVICE.BRANCH_INVALID` (2) | remove |
| *(no legacy error — the prompt re-asked)* | `SERVICE.PROJECT_NAME_INVALID` (2) | deploy — see the prompt-validator gap below |
| `APP_AMBIGUOUS` (2) | engine `CLI.PROMPT_REQUIRED` (2) | deploy — see the picker entry below |
| `PROJECT_CREATE_FAILED` (1) | `SERVICE.PROJECT_CREATE_FAILED` (2) | deploy `--create-project` |

`SERVICE.PROJECT_SETUP_REQUIRED` still carries the candidate list and the
suggested project name in `meta`, and `SERVICE.DEPLOY_FAILED` after the
build carries `meta.phase` / `meta.deploymentId` / `meta.deploymentUrl` with
a `service logs --deployment <id>` action, exactly as legacy did.

### `service deploy`

- **Progressive stderr rendering becomes events.** Legacy wrote a setup
  block, a build-settings block, a project-linked line, per-phase progress
  lines and a database progress line to stderr. v8 emits `step-started` /
  `step-finished` per phase (`build`, `archive`, `upload`, `deploy`,
  `promote`, and `branch-database` for `--db`), `status` events for the
  deployment's own transitions, `endpoint` events for the deployment and
  live URLs, and `message` events for the setup/link/first-production lines.
  The resolved build settings are no longer printed mid-run; they are rows
  of the result presentation and fields of the json result
  (`deploySettings`, unchanged in shape).
- **Ambiguous service name.** Legacy prompted on a TTY and errored with
  `APP_AMBIGUOUS` (candidates in `meta`) otherwise. v8 prompts through the
  engine, so a non-interactive run settles with the structural
  `CLI.PROMPT_REQUIRED` and the candidate list is no longer carried
  (same rule as D1's service picker, R-S2b-6).
- **Unlinked directory.** Legacy prompted only when `canPrompt && !--yes`
  and otherwise raised `PROJECT_SETUP_REQUIRED`. v8 always offers the engine
  prompt; when the prompt cannot be operated the run settles with
  `SERVICE.PROJECT_SETUP_REQUIRED` (candidates + suggested name preserved),
  so the agent-facing error is unchanged even though the interactive gate
  moved into the engine.
- **`--no-db` cannot be told apart from "not passed" (engine gap).** The
  engine's boolean flag is two-state with an automatic `--no-<name>`
  negation and a `false` default, so the legacy tri-state (`--db` request /
  `--no-db` opt out / absent = prompt when a database signal is found) is
  not expressible. v8 ships `--db` as the explicit request; both absent and
  `--no-db` take the signal-driven prompt path, whose default answer is No
  (so a non-interactive `--no-db` still skips setup). The legacy
  "passing both → USAGE_ERROR" check disappears with the flag pair, and so
  does "Database setup requires --yes in non-interactive mode" — `--db`
  is itself the explicit request. Flagged for the operator: the engine needs
  a declarable tri-state (or non-negatable) boolean before this is parity.
- **A mistyped Project name at the first-deploy setup prompt now fails
  the run (engine gap).** Legacy passed a `validate` function to the
  clack text prompt (`lib/project/interactive-setup.ts`), so an invalid
  Project name was re-asked in place and the deploy continued. The
  engine's `prompt.text` takes only `placeholder` and `default` — there
  is no validator and no re-ask — so v8 validates the answer afterwards
  and settles the whole command with `SERVICE.PROJECT_NAME_INVALID`
  (exit 2). A user who typos during first-deploy setup loses the run and
  reruns deploy. Flagged for the operator alongside the `--db` gap: the
  engine needs a prompt validator (or a re-ask affordance) before this
  is parity.
- **The `--db` prompt's suppression advice is now emitted whenever the
  answer is No**, not only when the run could not ask: handlers do not see
  interactivity (the ruled `ctx.interactive` fact has not landed), so
  "declined" and "could not ask" are indistinguishable.
- **The agent-setup prompt does not port.** Legacy `app deploy` called
  `maybePromptForAgentSetup` before resolving the Project (an agent-file
  setup tip, with its own dismissal state). The `agent *` group is a later
  dispatch; v8 deploy asks nothing about agent setup and emits no warning
  for it.
- **Deploy-all**: unchanged in behavior (sequential targets, `--create-project`
  binds the first target only, per-service inputs rejected, failures carry
  `meta.deployAll.{failedTarget,completed,notAttempted}`). The legacy
  `── target (1/2) ──` stderr header becomes a `step-started`/`step-finished`
  pair whose `id` is the target key and whose `data` carries index/total.
- **Fixture-mode refusal** does not port (as recorded for D1).

### `service promote` / `service rollback`

- The already-live short-circuit is unchanged, but the legacy `warnings`
  array becomes an engine warn diagnostic
  (`SERVICE.DEPLOYMENT_ALREADY_LIVE`), and no promote call or step events
  are emitted in that case.
- The SDK's promote progress lines become `status` events for the target
  deployment (`starting` → `start-requested` → the SDK's own status values →
  `running` → `promoting` → `promoted`) plus an `endpoint` event for the
  promoted URL, bracketed by a `promote` / `rollback` step.
- **`service rollback` still has no confirmation** — production-affecting
  and unconfirmed, ported as-is for parity. Flagged for the operator: with
  consent becoming engine-owned, rollback is the obvious next consent point
  (token = the target deployment id), but adding one is a product decision,
  not a port decision.

### `service remove`

- The SDK's internal teardown polling becomes `progress` events
  (`stop-deployments`, `delete-deployments`, each with completed/total) and
  a `status` event (`removing` → `deleted`), bracketed by a `remove` step.
  This required an additive `progress` pass-through on the operation layer's
  `removeApp` (`packages/cli/src/lib/app/app-provider.ts`); legacy callers
  are unaffected.
- Local state cleanup failures become warn diagnostics
  (`SERVICE.LOCAL_STATE_CLEANUP_FAILED`) instead of the legacy `warnings`
  array; the removal still succeeds.

### Result shape changes (dispatch 2)

- `verboseContext` is dropped on all four commands (S2 ruling 7, as recorded
  for D1).
- Result field `app` → `service` on every result; the deploy result's
  `deploySettings`, `branchDatabase`, `localPin`, `promoted` and `durationMs`
  fields keep their legacy shapes.
- Legacy `warnings` (deploy's agent-setup/legacy-build-settings/database
  advice, promote's already-live note, remove's cleanup failures) become
  engine diagnostics on the completed envelope.
