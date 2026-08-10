# S2c parity divergences — service group

Every known place where the S2c ports differ from the shipping
`prisma-cli`. Same entry format as `parity-divergences.md`; S2d
consolidates the per-slice files. The S1 whoami-scoped record and the
engine-global divergences (json framing, channel discipline, `--quiet`
as a log-level alias, dropped `--trace`, shared flag family, errored
settlements exit 2) apply to every command here and are not repeated.

## Dispatch 1 — service group core (show, open, list-deploys, show-deploy, domain add/show/remove/retry/wait)

### The rename (R-S2c-1), one entry per command

`app` ports as `service` — paths, ids, help, presenters, error copy,
flags, positionals. No alias; the legacy `app` spellings do not exist
in the v8 tree.

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
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
| `USAGE_ERROR` (2) — named target without a config | `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | show, open, list-deploys, domain * |
| `COMPUTE_CONFIG_INVALID` (2) | `SERVICE.COMPUTE_CONFIG_INVALID` (2) | show, open, list-deploys, domain * |
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

The workspace those commands then act in comes from the engine's
session (`ctx.session()`), which is the only sanctioned identity
surface a handler has; no v8 command reads the credential file itself.
The `service logs` entry under dispatch 3 records what moving to it
fixed and what is left.

### `service domain remove` consent

Recorded with the group's other consent point in "Consent" under
dispatch 2 below — one table, one mechanism, for both.

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
  not otherwise retained. S2 ruling 8 drops `--trace` because log
  levels cover it; the same reasoning covers `--verbose`, which that
  ruling does not name.
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
  Legacy opened every block with a present-progressive title ("Removing
  the selected app."). In v8 that summary line is the only success
  signal the engine prints, so a command that changed something ends on
  a past-tense `ok` line instead ("Removed hello-world and every
  deployment it owned."), and only the commands that merely report keep
  the informational heading.

### Fixture mode

Legacy app commands refused to run in fixture mode
(`FEATURE_UNAVAILABLE` via `ensurePreviewAppMode`). The v8 tree has no
fixture mode, so the refusal path does not port (fixture machinery
dies in S2d).

## Dispatch 2 — promote, rollback, remove

### The rename (R-S2c-1), one entry per command

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
| `prisma-cli app promote <deployment> [app]` | `prisma-cli service promote <deployment> [service]` | `--app` → `--service`; result field `app` → `service`; error copy "App promote requires an existing app" → "Service promote requires an existing service" |
| `prisma-cli app rollback [app]` | `prisma-cli service rollback [service]` | same, plus "…requires an existing service" |
| `prisma-cli app remove [app]` | `prisma-cli service remove [service]` | same, plus the confirmation question "…app removal" → `Remove Service "<name>" and every deployment it owns?` |

Command ids follow: `app.promote` → `service.promote`, etc.

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
| `service domain remove` | `-y/--yes` skipped the yes/no confirm | type the hostname interactively, or `--confirm <hostname>` | the hostname |

The slice had a third consent point, `service deploy`'s production replace, until deploy was dropped (see "`app deploy` and `app build` are dropped" under dispatch 4). The mechanism below is unchanged by its removal.

Transitions, identical on both:

- **Granted** interactively by typing the token, non-interactively by
  `--confirm <token>`. `--confirm` never SKIPS an interactive prompt: an
  interactive session always type-to-confirms, whether or not the flag
  was passed. It is a non-interactive affordance only.
- **Wrong token typed interactively**: the engine's structural consent
  mismatch, exit 2. Legacy re-asked a bad yes/no answer and treated an
  explicit "no" as a cancellation, so what used to be a decline is now a
  mismatch — there is no longer a "no" to give.
- **Wrong or missing `--confirm` value non-interactively** (including
  under `--yes`): `CLI.CONSENT_REQUIRED`, exit 2, naming the expected
  value and carrying it as `meta.consentToken`. Legacy's
  `CONFIRMATION_REQUIRED` exited 1 (ledger Q5).

### Error-code mapping (dispatch 2 additions)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `DEPLOY_FAILED` (1) | `SERVICE.DEPLOY_FAILED` (2) | promote, rollback |
| `REMOVE_FAILED` (1) | `SERVICE.REMOVE_FAILED` (2) | remove |
| `NO_PREVIOUS_DEPLOYMENT` (1) | `SERVICE.NO_PREVIOUS_DEPLOYMENT` (2) | rollback |
| `DEPLOYMENT_NOT_FOUND` (1) | `SERVICE.DEPLOYMENT_NOT_FOUND` (2) | promote, rollback |
| `USAGE_ERROR` (2) — "App promote/rollback/remove requires an existing app" | `SERVICE.TARGET_REQUIRED` (2) | promote, rollback, remove |
| `USAGE_ERROR` (2) — empty `--branch` | `SERVICE.BRANCH_INVALID` (2) | remove |

The deploy-only rows this table used to carry went with the command; see "`app deploy` and `app build` are dropped" under dispatch 4. Two of those codes survive because a read command still raises them, and they keep their dispatch 1 rows: `SERVICE.PROJECT_SETUP_REQUIRED`, which still carries the candidate list and the suggested project name in `meta` exactly as legacy did, and `SERVICE.LOCAL_STATE_STALE`.

### `--no-db` cannot be told apart from "not passed" (RETIRED — was an escalated engine gap)

Retired: this was escalated to the operator as an engine gap and became moot when `service deploy` was dropped, because `--db` was a deploy flag and no shipped command declares it. Kept here so the escalation list reads honestly — six engine gaps went to the operator during this slice, two are retired here, and four are still open.

The engine's boolean flag is two-state with an automatic `--no-<name>`
negation and a `false` default, so the legacy tri-state (`--db` request /
`--no-db` opt out / absent = prompt when a database signal is found) was
not expressible. v8 deploy shipped `--db` as the explicit request; both
absent and `--no-db` took the signal-driven prompt path, whose default
answer is No (so a non-interactive `--no-db` still skipped setup). The
legacy "passing both → USAGE_ERROR" check disappeared with the flag pair,
and so did "Database setup requires --yes in non-interactive mode" —
`--db` was itself the explicit request. The ask was smaller than a new
flag type: the engine already computes the missing fact at parse time and
sends it somewhere else. `explicitFlagKeys`
(`packages/cli-engine/src/execution/command-snapshot.ts`) scans argv for
which flag names appear and deliberately marks the base flag when it sees
a `--no-<flag>` token; `buildCommandSnapshot` then labels every declared
flag `source: "cli"` or `source: "default"`. Together with the parsed
boolean the handler already receives, that settles all three states:
`default` means absent, `cli` with `true` means `--db`, `cli` with
`false` means `--no-db`. The snapshot goes only to `RunHooks.onSettled`,
after the run, for telemetry; it never reaches `CommandContext`. So what
parity needed was an accessor that hands the handler a fact the engine
already holds — not a declarable tri-state boolean with its own negation
rules. Any future command that wants a three-way boolean will hit this
again.

### `prompt.text` has no validator and no re-ask (RETIRED — was an escalated engine gap)

Retired: this was escalated to the operator as an engine gap and became moot when `service deploy` was dropped, because the first-deploy Project setup prompt was the only place in the slice that needed a validated text answer. No shipped command calls `prompt.text` with a value it must validate.

Legacy passed a `validate` function to the clack text prompt
(`lib/project/interactive-setup.ts`), so an invalid Project name was
re-asked in place and the deploy continued. The engine's `prompt.text`
takes only `placeholder` and `default` — no validator, no re-ask — so v8
deploy validated the answer afterwards and settled the whole command with
`SERVICE.PROJECT_NAME_INVALID` (exit 2). A user who typo'd during
first-deploy setup lost the run and reran deploy. The ask was a prompt
validator, or a re-ask affordance, on `prompt.text`; the next command that
takes a constrained text answer will need it.

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

- `verboseContext` is dropped on all three commands (S2 ruling 8, as recorded
  for D1).
- Result field `app` → `service` on every result.
- Legacy `warnings` (promote's already-live note, remove's cleanup failures)
  become engine diagnostics on the completed envelope.


## Dispatch 3 — the log streams (`service logs`, `build logs`)

### The rename (R-S2c-1)

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
| `prisma-cli app logs [app]` | `prisma-cli service logs [service]` | `--app <name>` → `--service <name>`; command id `app.logs` → `service.logs`; header row "app" → "service" |

`build logs <buildId>` keeps its spelling; its command id is `build.logs`
and its errors move into the `BUILD.*` namespace.

### Records become engine events (R-S2c-2)

Both commands are session commands. Every record becomes an `output`
event, and the channel decides where human mode writes it:

- `service logs`: log text is `data` (stdout, as legacy). The header —
  legacy's `renderCommandHeader` block — is three `diagnostic` lines
  (`project:`, `service:`, `deployment:`) rather than a rendered block,
  and terminal records other than the normal `end` are `diagnostic`
  (legacy dropped them in human mode entirely).
- `build logs`: a record is `diagnostic` when its source is `stderr` or
  its level is `error`, `data` otherwise — the legacy routing exactly.
  A terminal record whose code is not `end` (e.g. `no_logs`) is a
  `diagnostic` line, as legacy did.

Json mode: the engine frames one event per record and terminates with
exactly one result frame. Legacy `build logs` set
`emitJsonSuccessEvent: false` so its json stream had NO wrapper event;
that opt-out does not port — the engine's framing is uniform, so a
completed `build logs` now ends with a result frame. Legacy
`service logs` emitted a per-record json event plus the wrapper; the
per-record events survive as `output` frames with the engine's own
envelope shape (`{kind, source, channel, line, commandId, timestamp}`)
instead of the legacy `{type, command, timestamp, data}` shape.

The record's own fields ride in the event's free-form `data`, so a json
consumer keeps everything legacy published per record: `build logs`
carries `cursor`, `level`, `source` and `step`; `service logs` carries
`byteStart` and `byteEnd`; and a reported terminal record (a `no_logs`
end, any error terminal) carries `kind`, `cursor`, `code` and
`retryable`, plus `details` on `service logs`, which is the only stream
whose terminal records have that field. `kind` matters most on
`service logs`: a terminal error there is one diagnostic frame and the
run still settles 0, so `kind: "error"` is the only thing telling a
consumer the stream ended in failure rather than normally.

Two json-surface losses remain, both because the engine owns rendering
and a handler cannot see the format:

- **The normal terminal record is no longer framed.** Legacy framed
  every record in json mode, including the terminal `end` that human
  mode printed nothing for; v8 emits no event for it. What a consumer
  loses: on a `build logs` run whose build produced no log records at
  all, `--json` now reports no cursor anywhere, so there is nothing to
  pass to `--cursor` on the next run. On a run that produced log records
  the last record's own cursor is the resume point, so nothing is lost
  there. Carrying it needs an engine event kind that is framed in json
  and silent in human mode; the only such kind is `remediation`, which
  carries a `NextAction` and means something else.
- **The headers are framed too.** Legacy wrote its headers only when
  neither `--json` nor `--quiet` was set. `--quiet` still hides them in
  v8 — they are `diagnostic` output, whose display severity is `info`,
  and `--quiet` is a log-level alias — but `--json` does not, because a
  handler cannot read the format and must not branch on it. A json
  consumer therefore reads one extra `output` frame before the
  `build logs` records ("Streaming logs for build <id>") and three
  before the `service logs` records (`project:`, `service:`,
  `deployment:`).

Both commands default to json when stdout is not a TTY (engine
auto-format), where legacy defaulted to human text unless `--json` was
passed.

### `build logs`: a failed build cannot exit 1 (ESCALATED — engine gap)

Legacy set `process.exitCode = 1` on a terminal `error` record and let
the stream close normally: the logs printed, and the CLI reported the
build's failure through the exit code. The engine has no equivalent —
a session command returns `Result<void>` and carries no exit-code set,
and documented exit codes are constrained to 4–99
(`packages/cli-engine/src/execution/command-tree.ts` validateExitCodes),
so exit 1 is reachable only through the engine's own internal-error
path. v8 therefore streams every record and then settles the run as an
errored envelope, `BUILD.FAILED` (exit 2), carrying the terminal
record's message, code, retryable flag and cursor, plus a
`build logs <id> --cursor <cursor>` resume action.

The failure is still reported and still non-zero, but the code changes
1 → 2 and the settlement is an error rather than a clean close. Ruling
needed: either the engine grows a stream termination status (or allows
a documented exit 1), or `build logs` becomes a result command with a
documented code in 4–99. One line in `src/v8/build/logs.ts` changes
either way.

### `service logs`: the log stream has no sanctioned token (ESCALATED — engine gap)

The log stream does not go through the Management API client: it opens
its own connection and needs the raw access token (legacy built one
from `PRISMA_SERVICE_TOKEN` or the token file in
`createPreviewLogAuthOptions`). On the current base the only accessor
that reaches a session command at all is `ctx.getCredentials()`, which
the engine documents as staged for deletion:

- `ctx.session()` deliberately omits the token ("The token is
  INTERNAL", `credential-manager.ts`).
- `ctx.credentialManager` (whose `tokenStorage()` is marked
  engine-facing) is exposed only to result commands that declare
  `managesCredentials`.
- `ctx.getCredentials()` forwards straight to `runtime.getCredentials()`
  and never consults the credential manager. The shipping bin wires
  `makeGetCredentials(proc.env)`, which returns `PRISMA_SERVICE_TOKEN`
  when it is set and otherwise whatever `FileTokenStorage` reads out of
  the credential file — the same two sources, in the same order, that
  legacy used.

v8 asks `ctx.getCredentials()` and, when it resolves nothing, settles
with `SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE` instead of reading the
token file or the env var itself.

**Whether that error ever fires is decided by the shape of the
credential file, and that shape is about to change.** Both credential
surfaces resolve to the same file by default. Today `auth login` writes
the legacy `{tokens: […]}` shape through `storeLegacyCredential`,
`FileTokenStorage` reads it, and `service logs` streams — so the error
is unreachable and this entry describes a path nobody hits. Once the
auth rework merges down from `bot/s2a-foundations`, `auth login` calls
`credentialManager.createSession` instead, which writes
`{version, sessions, currentWorkspaceId}`; `@prisma/credentials-store`
reads `data.tokens || []`, finds nothing, and `ctx.getCredentials()`
resolves `undefined` while `credentialManager.currentSession()` still
returns a valid session. Anyone who sets `PRISMA_SERVICE_TOKEN` is
unaffected either way, because that path short-circuits ahead of the
file read.

**This entry used to say the merge-down broke 13 of this slice's 20
commands and that the fix belonged to the auth stream. The count was
right; the blame was not, and the misplaced part was ours.** That count
describes the slice as it stood before `service deploy` and
`service build` were dropped, when it had 20 commands; it is history, and
the list below is the historical one.
`requireWorkspace` (`src/v8/service/target.ts`) called `readAuthState`,
which builds a `FileTokenStorage` and asks it for tokens
(`src/auth/operations.ts`) — the same call `ctx.getCredentials()`
makes. With no tokens it returned `{authenticated: false}` and the
command settled `SERVICE.WORKSPACE_REQUIRED`, so a credential file the
legacy reader cannot parse made `deploy`, `show`, `open`,
`list-deploys`, `logs`, `promote`, `rollback`, `remove` and all five
`domain` commands unusable. But no v8 command should have been reading
auth state that way at all. The engine hands a handler its identity
through `ctx.session()`, answered by the credential manager, whose
reader understands both the new `{version, sessions,
currentWorkspaceId}` shape and the legacy `{tokens: […]}` one
(`src/auth/state-file.ts` adopts the legacy store on read).

**`requireWorkspace` now reads `ctx.session()`. Of the 13 that broke, 12
still ship, and the fix repairs 11 of those.** `show`, `open`,
`list-deploys`, `promote`, `rollback`, `remove` and all five `domain`
commands resolve their workspace after the merge-down exactly as they do
before it. The thirteenth, `deploy`, is no longer a v8 command at all.
`show-deploy` was never affected: it is the one caller that swallows a
workspace failure and degrades to a missing live-deployment hint.
`build logs`, the three `agent` commands and `feedback` read no auth
state at all.

**What is left is `service logs`, and only its token.** It resolves its
workspace correctly now, then still asks `ctx.getCredentials()` for the
raw token the stream needs, and that accessor still reads the credential
file through `FileTokenStorage`. After the merge-down it becomes the one
command in this slice that fails for a signed-in user whose other
commands all work, and it fails at
`SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE` rather than at
`WORKSPACE_REQUIRED`. Anyone who sets `PRISMA_SERVICE_TOKEN` is
unaffected, because that path short-circuits ahead of the file read.

**A workspace with no name now shows its id.** `Session.workspaceName`
is optional where the old `AuthWorkspace.name` was required, so a
session the manager could not name — a workspace-bound service token,
or a login whose best-effort name fetch failed — presents as its
workspace id (`workspace: ws_…`) instead of failing. Legacy asked the
API for the name on every read and settled `WORKSPACE_REQUIRED` when it
could not build a workspace at all; v8 prefers the identifier the user
can still act on. `SERVICE.WORKSPACE_REQUIRED` itself is unchanged and
still raised when there is no session.

**The tests now seed one credential source.** Every service test used to
mock `readAuthState` at the module seam while the engine's credential
check was seeded through the credential manager, so the harness had two
credential seams where production has one file — which is why nothing in
the suite could see any of this. Those mocks are gone: the harness seeds
a session on the credential manager and both the credentials check and
the workspace come from it. `tests/v8-service-session.test.ts` pins the
direction, seeding a session that names a workspace the Management API
fake never reports for the project, so a run taking its identity from
anywhere else resolves a different project or prints a different name.

Ruling still needed, on the token only. The engine should expose a token
accessor for self-authenticating streams (or hand the log stream a
client the way `ctx.api` is handed over) — one line in
`src/v8/service/logs.ts` changes when it does.

**Second, smaller engine ask, and it is why the `service logs` tests are
currently red.** Those tests seed `rawTokenSeed`, which selects
`createTestCli`'s manager-less runtime — the only way the harness makes
`ctx.getCredentials()` resolve a token. A manager-less runtime has no
session at all, so with the workspace now coming from `ctx.session()`
every one of those runs settles `SERVICE.WORKSPACE_REQUIRED`. The
shipping bin wires a credential manager and `getCredentials` together
(`src/v8/runtime.ts`), but `createTestCli` rejects that combination
(`packages/cli-engine/src/testing.ts`) and defines `getCredentials` as
the seeded value, so no harness can model the runtime the product
actually assembles. The smallest fix is to let the harness's
`getCredentials` honour a seeded `environmentToken`, mirroring the
shipping `makeGetCredentials`, which returns `PRISMA_SERVICE_TOKEN`
first; the log-stream tests would then seed one token and get both
halves. Held pending that ruling rather than worked around.

### `service logs` behavior

- **`--deployment <id>` needs no service when nothing names one.** Legacy
  folded the compute-config service name in first
  (`appName = appName ?? compute.configAppName`) and only then chose
  between the service-scoped lookup and the global one, so a directory
  holding a `prisma.compute.ts` always took the scoped path. v8
  reproduces that: `--service`, the positional config target, and the
  config's own target all count as naming a service, and only a run that
  names none resolves the id globally. The global path still skips the
  service picker entirely, so `service logs --deployment <id>` in a
  directory with no compute config works non-interactively. (The naive
  port would have prompted, because the shared read flow selects a
  service.)
- The three `DEPLOYMENT_NOT_FOUND` variants port unchanged in meaning:
  unknown id, a deployment with no service, and a deployment outside the
  resolved project — all `SERVICE.DEPLOYMENT_NOT_FOUND` (exit 2; legacy
  exit 1), distinguished by their summaries.
- A cancelled stream (Ctrl-C) is a clean shutdown, exit 0, as legacy.

### Error-code mapping (dispatch 3 additions)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `DEPLOYMENT_NOT_FOUND` (1) — three variants | `SERVICE.DEPLOYMENT_NOT_FOUND` (2) | service logs |
| `NO_DEPLOYMENTS` (1) | `SERVICE.NO_DEPLOYMENTS` (2) | service logs |
| `DEPLOY_FAILED` (1) | `SERVICE.DEPLOY_FAILED` (2) | service logs (stream failure) |
| *(none — legacy read the token itself)* | `SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE` (2) | service logs (see the gap above) |
| `BUILD_NOT_FOUND` (1) | `BUILD.NOT_FOUND` (2) | build logs |
| `BUILD_LOGS_FAILED` (1) | `BUILD.LOGS_FAILED` (2) | build logs |
| *(exit code 1, no error)* | `BUILD.FAILED` (2) | build logs (see the gap above) |

### `service open`'s announced URL

`ctx.openUrl` carries one string that is both the human label and the
endpoint event's `name`, so the slug `live-url` became the human phrase
`Live URL`. The json `endpoint.name` changes with it; endpoint events
are a v8-only surface (legacy emitted none), so nothing that shipped
depends on the old spelling.


## Dispatch 4 — agent, feedback, closure

No rename applies here: R-S2c-1 covers the `app` group only, so
`agent install|update|status` and `feedback` keep their legacy
spellings, flags, positionals and result records. Command ids are
`agent.install`, `agent.update`, `agent.status` and `feedback`.
Neither group touches the Management API or declares
`needs.credentials`, so the Q1 auth class does not apply to them.

### Error-code mapping (flat → dotted)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `AGENT_SKILLS_INSTALL_FAILED` (1) | `AGENT.SKILLS_INSTALL_FAILED` (2) | agent install, agent update |
| `USAGE_ERROR` (2) — empty message | `FEEDBACK.MESSAGE_REQUIRED` (2) | feedback |
| `USAGE_ERROR` (2) — message over 4000 characters | `FEEDBACK.MESSAGE_TOO_LONG` (2) | feedback |
| `USAGE_ERROR` (2) — malformed or over-long `--email` | `FEEDBACK.EMAIL_INVALID` (2) | feedback |
| `FEEDBACK_SEND_FAILED` (1) | `FEEDBACK.SEND_FAILED` (2) | feedback |

The engine validates neither string length nor pattern, so the three
`FEEDBACK.*` argument checks stay hand-rolled in the handler, with the
legacy limits, the legacy order, and the same refusal before any
network call. The one argument failure the engine owns is a missing
`<message>`, which settles as its own usage error
(`CLI.INVALID_ARGUMENTS`, exit 2).

`agent status` has no error path at all, in legacy or in v8: a skills
CLI that cannot be read degrades to a warning (below), never to a
failed run.

### `feedback`'s json output: the envelope reshape, and nothing command-specific

An earlier draft of this entry claimed `feedback` gained a json envelope
it never had, because it registered no `renderJson` serializer. That was
wrong, and the correction matters for anyone reading this file to judge
parity. Legacy's `runCommand` writes a full envelope for every command
and consults the serializer only for the `result` field —
`result: presenter.renderJson ? presenter.renderJson(success.result) :
success.result` (`packages/cli/src/shell/command-runner.ts:110-116`).
With no serializer, `result` simply carried the raw result object, which
for this command is what a serializer would have produced anyway.

So `feedback` has no command-specific json divergence. Its `--json`
output changes exactly as every other ported command's does, through the
engine-global envelope reshape this file's preamble already covers
(`{ok, command, result, warnings, nextSteps, nextActions}` becomes
`{ok, commandId, result, exitCode, diagnostics, nextActions}`). The
`result` payload itself is unchanged: `{id, email, context: {cliVersion,
nodeVersion, platform, arch}}`. The submitted payload, the 3-second
timeout, the `PRISMA_CLI_FEEDBACK_URL` override (read from `ctx.env`)
and the default endpoint are all unchanged.

### `agent install` / `agent update`

- Legacy's single `nextSteps` line ("Run … to verify the installed
  Prisma skills.") becomes the `run-command` nextAction "Verify the
  installed Prisma skills", carrying the same package-manager-aware
  command string. A `--dry-run` still offers nothing, as legacy did.
- The install failure keeps the installer's own command line, now as a
  typed `run-command` nextAction ("Retry the installer directly")
  instead of a free-text `nextSteps` entry plus the separate fix "Run
  the command below to retry the installer directly." The legacy
  `debug` field (the installer's stack) disappears with `--trace`
  (engine-global divergence).
- Flags, defaults and the built installer command line are unchanged,
  including `--copy` forced on Windows, `--all-agents` sending
  `--agent *`, and the package manager detected from the project.
- Human output is the engine's summary line plus field rows instead of
  the legacy rail-drawn block. Neither writes a stdout payload.
- **Help examples lose the package runner, and the command now spells
  itself two ways.** Legacy rendered the `agent` group's examples
  through the project's own runner
  (`resolvePrismaCliPackageCommandFormatterSync`), so help read `pnpm
  dlx @prisma/cli@latest agent install`. The operator ruling of
  2026-08-09 on the engine interface says examples are written without
  the binary name — the engine substitutes `{bin}`, or prepends the CLI
  name to an example that carries none
  (`assets/engine/engine-interface-draft.ts`, `HelpSpec.examples`) — so
  the ported examples are bare (`agent
  install`). The engine has no way to express the old form: examples are
  static strings resolved at definition time, and the runner is
  discovered from the filesystem at run time. The visible consequence is
  that one command now names itself two ways — help says `agent
  install`, while the same command's own next action still carries the
  package-runner form `npx -y @prisma/cli@latest agent status`, because
  next actions are built at run time and keep legacy's string. Worth
  settling once, group-wide, alongside the same question for every other
  ported group; nothing here should diverge on its own.

### `agent status`

- Legacy's `warnings` array becomes an engine warn diagnostic,
  `AGENT.SKILLS_LIST_UNAVAILABLE`, with the same sentence (including
  the project-scope "Falling back to skills-lock.json"). The run still
  completes with exit 0 and still reports `statusSource` as
  `skills-lock` or `unavailable`.
- Legacy's `nextSteps` line ("Run … to install or refresh Prisma
  skills.") becomes the `run-command` nextAction "Install or refresh
  Prisma skills" with the same command string, offered on the same
  condition (no skills installed).
- The result record is unchanged field for field. Human output is a
  summary line, field rows and a skills table instead of the legacy
  rail-drawn block.

### `app run` is dropped (operator ruling, 2026-08-10)

`prisma-cli app run` has no v8 counterpart and is not coming back:
Composer's commands supersede it. This is a ruled drop, not a
deferral. There is no `service run` port, no engine mechanism for
passing a child process's exit code through (which is what ledger Q2
asked about — the question closes with the drop), and S2d needs no
legacy carve-out, because deleting the commander shell deletes the
command with it. Anyone running a local dev server through
`prisma-cli app run` moves to Composer.

### `app deploy` and `app build` are dropped (operator ruling, 2026-08-10)

`prisma-cli app deploy` and `prisma-cli app build` have no v8 counterpart. Composer supersedes both. Like `app run`, this is a ruled drop and not a deferral: neither command will be ported as it stands, so there is no `service deploy` and no `service build`, and the slice ships 18 commands rather than 20.

The reasoning is about the shape of the command, not about how the port went. `app deploy` conflates two different jobs — compiling the service on the developer's machine, and uploading the resulting tarball to the platform — and that shape is wrong. Future commands are to work directly with platform Compute resources instead of shipping a locally built archive. `app build` is the local-compiling half of the same job, so it goes with it.

Nobody loses a command today. The legacy commander shell still serves `app deploy` and `app build`, and keeps serving them until S2d deletes the shell. What that deletion replaces them with is a Composer question, not a port question, so unlike `app run` this drop does leave something for S2d to answer.

Two engine gaps escalated during this slice existed only for `app deploy` and are retired with it: the `--db` / `--no-db` three-way flag problem, and the missing validator on `prompt.text`. Both are recorded as retired entries under dispatch 2, so the escalation list goes from six to four. The consent table under dispatch 2 loses `service deploy`'s production replace and is down to two consent points. The dispatch 1 and dispatch 2 divergence entries that described only these two commands are gone, and the entries that covered several commands now name only the ones that ship.

The tap this slice added to legacy code for `service build` is reverted. `executeAppBuild` and `resolveAppBuildStrategy` (`packages/cli/src/lib/app/build.ts`) had gained an optional `io` parameter so the v8 command could stream the bundler's per-line output as engine events; nothing in the legacy shell ever passed it, so the parameter is removed and the file is back to what it was.

### The crash-recovery feedback action does not port (ESCALATED — engine gap)

Legacy pre-filled a bug report on every unexpected error. The shell
caught the crash, built `prisma-cli feedback "<command> crashed:
<first line of the error>"` (`src/shell/output.ts:104`), and shipped
it twice: as a human next-step line and, under `--json`, as a typed
`recover` nextAction inside the `UNEXPECTED_ERROR` envelope
(`src/shell/output.ts:120`, wired at `src/cli.ts:72,86`). The
inventory records this under `feedback`, and the S2c contract asks the
v8 shell to keep an equivalent.

It cannot, on the current engine. The engine settles unexpected
failures itself: `settleBug`
(`packages/cli-engine/src/execution/settlement.ts`) emits
`CLI.INTERNAL_ERROR` with `nextActions: []` written into the envelope
literally, and `settleUnhandled` does the same for framework-level
failures. The only seam a bin may attach is `CliRunHooks.onSettled`,
which receives a `RunSummary` of `{commandId, exitCode, durationMs,
snapshot}` — no error object, no message — and which fires after the
envelope has already been written. Nothing reachable from the shell
ever sees the crash.

So a v8 crash is the engine's own `CLI.INTERNAL_ERROR` envelope (exit
1) with no recovery action: the user is not offered the pre-filled
report, and an agent gets no `recover` action to run. The command it
would have pointed at (`feedback`) is ported and works; only the
automatic pre-fill is gone.

Ruling needed, and the affordance is small. The engine would need an
internal-error contribution point — for example
`createCli({onInternalError: (context: {commandId, error}) => readonly
NextAction[]})`, or the same as a `CliRunHooks` member — called from
`settleBug` and `settleUnhandled` before the envelope is emitted, with
the returned actions merged into `nextActions`. The shell would then
supply exactly the legacy action, in both human and json mode.

No partial version is worth shipping in the meantime. The bin can see
only the run's exit code, so anything it printed afterwards would be a
generic hint with no failing-command text, it would arrive after the
run's terminal output, and it could not reach the json envelope at all
— which is the surface the legacy action existed for. Wrapping every
handler body in a catch that rethrows unknown errors as a structured
one is reachable without an engine change, but it is not the same
thing: it would have to be repeated in every command, it would change
the crash's code and exit code (`CLI.INTERNAL_ERROR` exit 1 becomes a
group error exit 2), and it would still miss every crash outside a
handler — parsing, the needs checks, prompting, presentation — which
is where an unexpected failure is most likely.
