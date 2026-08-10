# S2c code review — services slice

Slice: s2c-services (contract `../specs/s2c-services.md`, plan `../plans/s2c-services.md`).
Branch `s2c-services` off `s2b-resources`. Reviewer-maintained except the
sections marked orchestrator-owned.

## Subagent IDs (orchestrator-owned)

- Implementer: (not yet spawned)
- Reviewer: (not yet spawned)

## AC scoreboard

| Acceptance criterion | Status |
| --- | --- |
| All 24 in-scope commands mounted, green on R-S2b-9 matrix | D1+D2: 14 commands mounted, matrix complete per command |
| `service` rename complete; no `app` path in v8 | D1+D2 surface: met |
| Deploy/promote/rollback/remove event sequences pinned | met — deploy pins the full phase sequence as an ordered array; remove pins first/second/last; promote and rollback bracket the SDK transitions |
| Divergence file complete | D1+D2 surface: met — one shipped consent mechanism, both engine gaps recorded |
| Q2 ruled+implemented or parked with legacy intact | parked (Q2 open) |
| Legacy fixture tests for ported commands deleted | pending (later dispatch — legacy `app` shell still serves deploy/logs/etc.) |
| Root verification green; PR ≥1k LOC; review loop run | pending (LOC floor already cleared: 4,794 added) |

## Findings log

### D1-R1-F1 — R-S2b-9 matrix has per-command axis gaps (should-fix) — CLOSED in c7c10de

`packages/cli/tests/v8-service-domain.test.ts:204-293` (show, retry),
`:295-395` (remove).

R-S2b-9 requires every command × (success, errored, json envelope,
unauthenticated, consent, picker where applicable). Two axes are
missing on the domain commands:

- **Unauthenticated**: covered for `service show`, `open`,
  `list-deploys`, `show-deploy`, `domain add`, `domain wait`. Missing
  for `domain show`, `domain remove`, `domain retry` — the three
  commands whose `needs.credentials` declaration nothing pins.
- **Successful json envelope**: none of the five `domain` commands
  assert a completed envelope with its `commandId` and `result`. They
  assert errored envelopes only, so `service.domain.*` command ids and
  the success `result` payload are unpinned on the json surface.
  (`show`, `list-deploys`, `show-deploy`, `build` all have this.)

Picker coverage exists once, on `service show`, through the shared
`resolveExistingServiceSelection`; that is acceptable — do not
duplicate it per command.

### D1-R1-F2 — the rename leaks in error prose that flows through `renameAppCopy` (should-fix) — CLOSED in c7c10de

`packages/cli/src/v8/service/errors.ts:34-39`.

`renameAppCopy` is a three-entry substitution list, so ported copy that
spells the noun differently survives unrenamed. The visible case is
`ComputeConfigTargetRequiredError`
(`packages/cli/src/lib/app/compute-config.ts:254-268`): the summary
"App target required" IS renamed to "Service target required", but its
`fix` — "Pass the app target, for example `prisma-cli service build
<target>`." — still says "app target". One error message now names the
same thing two ways. This fires on every multi-target
`prisma.compute.ts` for `build`, `show`, `open`, `list-deploys`, and
every `domain` command, so it is a routine path, and R-S2c-1 puts
error copy explicitly inside the rename surface.

`ComputeConfigTargetUnknownError`'s fix ("Remove the target argument;
this config defines a single app.") has the same shape but arguably
refers to the SDK-owned `app:` config key that deliberately does not
rename. Decide it deliberately and say which way in the divergence
file; do not leave it as an accident of the substitution list.

### D1-R1-F3 — three real differences from the shipping CLI are not in the divergence file (low) — CLOSED in c7c10de

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md`.

The file is otherwise unusually complete and accurate (the json-mode
per-poll wait events, the `--yes` consent contradiction, the fixture
refusal, the list-serializer wrapper are all correctly recorded).
Missing:

1. **`service open` loses a next action.** Legacy returned
   `["prisma-cli app show", "prisma-cli app show-deploy <liveId>"]`
   (`packages/cli/src/controllers/app.ts:1291-1294`); v8 returns only
   "Inspect the service"
   (`packages/cli/src/v8/service/presentation.ts:208`). Either restore
   the deployment action or record the drop.
2. **The domain result's `branch.id` field is gone.** Legacy's
   `toResultBranch` emitted `{id, name, kind}`
   (`packages/cli/src/controllers/app.ts:3721-3729`);
   `ServiceDomainTarget.branch` is `{name, kind}`
   (`packages/cli/src/v8/service/results.ts:77-80`). The value was
   always `null` for domain commands, so this is a json result-shape
   change, not a behavior change — but the "Result shape changes"
   section is where it belongs.
3. **Ported `fix` prose is silently dropped when a legacy error
   carries `nextActions`.** `fromLegacyCliError`
   (`packages/cli/src/v8/service/errors.ts:47-63`) takes the
   nextActions branch OR the fix/nextSteps branch, never both. The one
   reachable error with `nextActions` here is `PROJECT_SETUP_REQUIRED`
   (`packages/cli/src/lib/project/resolution.ts:411-428`), whose fix
   ("Link the directory to an existing Project, or pass --project
   <id-or-name> for this command.") therefore disappears from the
   unlinked-directory error. Either carry the advice through alongside
   the actions or record the loss.

### D2-R1-F1 — the consent section documents the ruled end state as though it ships (should-fix) — CLOSED in a0b0ea6 + 040c750

`parity-divergences-s2c.md:210-224` (D2 consent table) with
`:103-108` (the D1 "SUPERSEDED" note).

The code is right: `service remove`
(`packages/cli/src/v8/service/remove.ts:86-91`) and `service deploy`'s
production consent (`packages/cli/src/v8/service/deploy.ts:278-283`) are
plain `prompt.consent` with no skip flag, per the ruling, and D1's
boolean `--confirm` on `service domain remove`
(`packages/cli/src/v8/service/domain-remove.ts:22-28`) stays until the
merge-down, per the orchestrator note below. **This finding asks for no
code change.**

The record is what is wrong. The D2 table's "v8 grant (ruled)" column
lists `prompt.consent` **or global `--confirm <token>`** for all three
commands, and the D1 section is headed "SUPERSEDED by the dispatch-2
consent section below". Read together, they describe a group where all
three consent points accept `--confirm <token>`. What actually ships
today is three different answers: `service remove` and `service deploy
--prod` cannot be granted non-interactively at all, and `service domain
remove` takes D1's boolean `--confirm`. An operator reading this list to
judge parity gets the end state, not the shipped state, with nothing
marking the difference.

Split the table into "ships today" and "ruled end state (arrives with
the engine consent mechanism)", and soften the D1 heading from
SUPERSEDED to "superseded on merge-down; the boolean still ships".

### D2-R1-F2 — the Next.js standalone-output hint loses the one line that tells the user what to change (should-fix) — CLOSED in 55bb185

`packages/cli/src/v8/service/errors.ts:961-976`.

Legacy paired the `edit-file` action with a concrete fix string: `Add
output: "standalone" to next.config.*, then rerun deploy.`
(`packages/cli/src/controllers/app.ts:4721-4723`). The port keeps the
action and drops the string. The engine's `NextAction` has no path or
instruction field (`packages/cli-engine/src/protocol.ts:27-33`), so all
that survives is the label "Add Next.js standalone output" and a `reason`
explaining why Compute needs it — the user is told what outcome to reach
and never told that it is `output: "standalone"` in `next.config.*`.

The command inventory calls this hint out by name for `app deploy`
("Next standalone-output hint with edit-file nextAction"), and the
detection predicate is otherwise a faithful copy. Carry the instruction
through as an `adviceAction`, or fold it into the action's `reason`.

The test only asserts that some action has `kind: "edit-file"`
(`packages/cli/tests/v8-service-deploy.test.ts:585-589`), which is why
the dropped text went unnoticed; pin the instruction text too.

### D2-R1-F3 — ported advice points at a command that does not exist in v8 (should-fix) — CLOSED in 55bb185

`packages/cli/src/v8/service/branch-database.ts:251`.

The post-provisioning advice says "Get a connection URL with
`prisma-cli database connection create <id>`", copied verbatim from
legacy (`packages/cli/src/lib/app/branch-database-deploy.ts:216`). R-S2b-1
renames that group to `postgres` with no alias, so in the v8 tree the
command is `postgres connection create` and the suggested one does not
exist. Every successful `service deploy --db` prints this.

### D2-R1-F4 — a divergence row states legacy behavior that legacy did not have, and hides a second engine gap (low) — CLOSED in a0b0ea6

`parity-divergences-s2c.md:253` and
`packages/cli/src/v8/service/deploy-target.ts:425-432`.

The row reads "`USAGE_ERROR` (2) — invalid Project name at the setup
prompt → `SERVICE.PROJECT_NAME_INVALID` (2)", which presents this as a
straight code rename. Legacy did not error: it passed `validate` to the
clack text prompt
(`packages/cli/src/lib/project/interactive-setup.ts:87-95`,
`packages/cli/src/shell/prompt.ts:44-59`), so a bad Project name was
re-asked in place and the deploy continued. The engine's `prompt.text`
takes only `placeholder` and `default`
(`packages/cli-engine/src/context.ts:110-113`), so the port validates
after the fact and fails the whole command — a user who typos a Project
name during first-deploy setup now loses the run.

This is the same class as the `--db` tri-state gap, which the file
records honestly and flags for the operator. Do the same here: state the
real legacy behavior, and name the missing engine affordance (a prompt
validator / re-ask) so the operator sees both gaps together.

### D2-R1-F5 — dead export (low) — CLOSED in 55bb185

`packages/cli/src/v8/service/errors.ts:789`.

`serviceAmbiguousError` is never referenced in `src/` or `tests/`. The
ambiguous-service path goes to the engine prompt instead
(`packages/cli/src/v8/service/deploy-target.ts:596`), which is correct and
recorded as a divergence — this builder is the abandoned first approach.
Commit fb6bc32 swept dead re-exports out of `deploy-target.ts` and missed
this one.

## Round notes

### Round 1 (dispatch D1, 2026-08-10) — reviewer

**What was checked.** All 26 changed files against the inventory
entries for `app build|show|open|list-deploys|show-deploy` and `app
domain add|show|remove|retry|wait`, read side by side with
`packages/cli/src/controllers/app.ts`.

**The port is faithful where it matters.** Line-by-line comparison of
the resolution and mapping logic against the legacy controller found
no behavioral drift: branch resolution honors an explicit `--branch`
as-is and resolves an inferred one against the project's branches
(matching `resolveProjectContext`); `resolveCurrentLiveDeploymentId`
and `applyLiveDeploymentHint` reproduce the three-step live-pointer
precedence including the a72f34a "never assume newest is live" fix;
`show-deploy`'s workspace → remembered-project → known-live chain
matches `readCurrentWorkspaceId`; hostname normalization and
validation, the timeout grammar, the poll-interval env var, the
service picker's exact-name matching, and `formatBuildTypeName` are
faithful copies. The `--build-type` "auto" sentinel still reaches
`mergeComputeLocalInputs` correctly, so a compute-config `framework`
is not shadowed by the engine flag default. The domain error mapping
reproduces every status/hint branch of the legacy `domainCommandError`.

**Engine use is idiomatic.** Thrown `CliStructuredError` with typed
`nextActions`, `ctx.present` + `ok()`, `needs.credentials` on the nine
platform commands and off on `build`, `output` events split
`data`/`diagnostic` by source, `status` events only on transition,
`endpoint` for the live URL. The one operation-layer change is the
additive `io` pass-through on `executeAppBuild` /
`resolveAppBuildStrategy`; legacy callers are untouched. Hard
boundaries (`packages/cli-engine/**`, `src/auth/**`, `v8/auth/**`,
publish files) are untouched.

**Tests are the right kind.** Semantic throughout: envelope,
`presented.data`, events, exit codes — no byte pinning. Fakes are
shaped like real API responses (paginated `{data, pagination}`,
`{data: …}` singles, status-coded errors), the auth module is stubbed
at its seam, and the domain-wait fake advances a status sequence per
poll rather than pinning timing. The `--yes cannot grant consent` case
is pinned with the divergence cited inline.

**Not findings — for the orchestrator, not this dispatch.**

- *Cross-slice error-code consistency.* Project-resolution failures
  surface here as `SERVICE.PROJECT_NOT_FOUND` /
  `SERVICE.PROJECT_SETUP_REQUIRED` etc., because R-S2b-5 namespaces by
  the invoking group. S2b's `project *` commands will emit their own
  spelling for the same underlying failure. That is what the rule
  says, and D1 recorded it — but two codes for one failure is worth an
  explicit ruling before S2d consolidates the divergence files.
- *`target.ts` duplicates ~250 lines of private legacy controller
  helpers* (selection, live-pointer, hostname, branch). Justified: the
  legacy versions are private and take the shell's `CommandContext`,
  and they die with the shell in S2d. Two copies can drift until then;
  no action now.
- *`legacyResolutionContext` casts a two-field object through
  `unknown` to `LegacyCommandContext`* (`target.ts:106-110`). Correct
  today — `resolveProjectTarget` reads only `runtime.cwd`/`signal` —
  and the comment says so. It stops compiling honestly if that
  changes; flag for S2d cleanup, not now.
- The three escalated items (`--yes` consent, `ctx.interactive`,
  injectable clock) were excluded from review per the dispatch brief
  and are correctly documented in the divergence file.

### Round 2 (dispatch D1, commits c7c10de + 0dd65a8) — reviewer

**All three round-1 findings are closed, verified individually.**

- **F1.** Unauthenticated cases added for `domain show`, `domain
  retry`, `domain remove` — the three that lacked one. Successful json
  envelopes now pinned (commandId + `result`) for all five domain
  commands: `add`, `show`, `retry`, `remove`, `wait`
  (`packages/cli/tests/v8-service-domain.test.ts:76`, `:253`, `:339`,
  `:539`; `v8-service-domain-wait.test.ts:182-191`). Every axis
  R-S2b-9 names is now covered per command.
- **F2.** `renameAppCopy` (`packages/cli/src/v8/service/errors.ts:36-40`)
  replaces the lowercase "app target" noun as well, so
  `ComputeConfigTargetRequiredError`'s summary and its fix now agree.
  Dropping the old `^Unknown app target` anchored regex is a strict
  improvement — the general replacement covers that string wherever it
  appears. The `app:`/`apps:` config-key exception is now a recorded
  decision, not a leftover, in the divergence file's error-mapping
  section. Pinned by a test that fails if the serialized error
  contains "app target" or "prisma-cli app "
  (`packages/cli/tests/v8-service-build.test.ts:162-193`).
- **F3.** (1) `service open` restores the live-deployment next action,
  pinned in `v8-service-open.test.ts:48-58`. (2) The `branch.id` drop
  is recorded under "Result shape changes". (3) `fromLegacyCliError`
  now appends the fix advice after the typed legacy actions rather
  than choosing one branch (`errors.ts:52-58`), so
  `PROJECT_SETUP_REQUIRED` keeps both; recorded in the error-mapping
  preamble.

**The `--confirm` grant is the engine's consent system used as
designed.** The engine's own `CLI.CONSENT_REQUIRED` text tells the
user to "pass the command's explicit consent flag if it documents
one" (`packages/cli-engine/src/execution/prompts.ts:100-105`) — a
command-declared flag is exactly the mechanism the engine anticipates,
and there is no engine-side registration to miss. `confirm` is not in
`RESERVED_FLAG_NAMES`
(`packages/cli-engine/src/execution/shared-flags.ts:8-20`), so
declaring it is legal and its value reaches the handler (unlike
`--yes`, whose value the engine hides). The handler checks it only
after resolving the domain, so `--confirm` never skips the
does-this-hostname-exist check
(`packages/cli/src/v8/service/domain-remove.ts:36-56`).

Coverage of the new flag is real, not nominal: grant × non-interactive,
grant × interactive (run with `answers: []`, so an unexpected prompt
would fail the run — that is what proves no prompt happens), and json
envelopes for both; the pre-existing decline (exit 3), no-grant
non-interactive (exit 2), and `--yes` (exit 2) cases all survive
unchanged (`v8-service-domain.test.ts:422-518`, `:539`, `:588+`). The
divergence entry rewrites the old OPEN QUESTION into the ruled
behavior and states all four transitions, including that `--yes` still
never grants.

**No regressions.** `openPresentations` gained a required
`liveDeploymentId` parameter; its only caller passes a value that is
provably non-null at that point (the handler throws
`SERVICE.NO_DEPLOYMENTS` above it). Nothing else in the round-2 diff
touches resolution, mapping, or event logic.

**Note (superseded by the D2 consent ruling):** the concern below about
`--confirm` meaning two different things across the tree is resolved for
this group by the operator's D2 ruling — consent points carry no skip
flag in the interim, and the end state is a single engine-owned
`--confirm <token>`. It still applies to S2b's exact-id `--confirm <id>`
flags, which are not consent points in the engine's sense.

**One thing for the operator, not a finding: `--confirm` will mean two
different things across the tree.** Here it is a boolean grant. R-S2b-3
keeps the *current* confirmation flag for S2b's destructive commands,
and the inventory records those as exact-id `--confirm <id>`
(`project remove`, `postgres remove`, `bucket delete`). Once S2b
lands, `--confirm` is a boolean on one destructive command and
"retype the resource id" on others. Both are defensible in isolation;
together they are a grammar inconsistency users and agents will hit.
Worth ruling deliberately before S2d consolidates — it is a naming
decision above this dispatch, and nothing in D1 should change for it.
The cross-slice error-code note from round 1 (`SERVICE.PROJECT_*`)
still stands and belongs in the same conversation.

### Round 1 (dispatch D2 — deploy, promote, rollback, remove) — reviewer

**What was checked.** All 19 changed files against inventory §4's
`app deploy|promote|rollback|remove` entries, read side by side with
`controllers/app.ts` (`runSingleAppDeploy`, `runAppPromote`,
`runAppRollback`, `runAppRemove`), `lib/app/production-deploy-gate.ts`,
`lib/app/branch-database-deploy.ts`, and `lib/project/interactive-setup.ts`.

**The deploy port is faithful step for step.** The whole ordering —
exclusive project inputs, compute target, local pin read, branch,
port/region/entry validation, project context, pin binding, framework,
runtime, env vars, service selection, customization, production check,
entrypoint, build settings, legacy-settings inspection, branch database,
`deployApp`, state writes — matches `runSingleAppDeploy` position for
position. The production check reproduces
`enforceProductionDeployGate` exactly, including the empty-deployments
short-circuit and the `--no-promote` bypass;
`requireRemoteBranch` is a byte copy of `toBranchDatabaseDeployBranch`,
raw `Error` and all; the deploy-failure phase logic and its
`isNextStandaloneOutputFailure` predicate match (except the dropped
instruction, D2-R1-F2). `deploy-plan`, `env-vars`, `local-pin`,
`project/setup`, `bindProjectToDirectory` and `compute-config` are reused,
not rewritten. The rollback default target reads the **unsorted**
deployments list, which is what legacy does — a real trap, avoided.

I checked one apparent omission carefully: legacy's project resolution
has a `resolveDurablePlatformMapping()` step between the local pin and
the prompt that v8 does not. That function is a placeholder that always
returns `null` (`lib/project/resolution.ts:586-588`), so dropping it
changes nothing.

**The branch-database port matches the legacy decision matrix** —
`--db` false, provided DATABASE_URL/DIRECT_URL, production-after-first,
existing env for target, unsupported schema, signal-driven prompt, create
+ upsert + stale DIRECT_URL delete, and the delete-on-failure rollback
including the cleanup-failed message. The one behavioral shift (the
skip advice now also fires on an interactive "no", because handlers
cannot see interactivity) is deliberate, commented, and recorded.

**Events genuinely pin ordering.** `service deploy` asserts the full
phase sequence as one ordered array (build → archive → upload → deploy →
promote, each start/ok); `service remove` pins `events[0]`, `events[1]`
and `events.at(-1)` around the SDK teardown counts; promote and rollback
assert the bracketing step plus the transition sequence. That is the bar
the dispatch asked for, met.

**Test seams are strong where it counts.** promote, rollback and remove
drive the **real** provider through `ctx.api` routes — `releaseRoutes`
models the SDK's own start/stop/poll/delete HTTP flow, so the provider's
request and response mapping is exercised, not stubbed. Consent coverage
is complete on both new consent points (grant, decline → 3,
non-interactive → 2, `--yes` cannot grant).

**Not findings.**

- *`removeApp`'s `progress?: unknown` + `as never`
  (`lib/app/app-provider.ts:195`, `:359`).* I was ready to file this
  until I checked the file: every other SDK progress pass-through there
  already uses exactly this shape (`:222`, `:239`, `:245`, `:479`,
  `:527`, `:571`, `:584`, all from fcc0b26). The change is additive,
  matches house style, and the callback object is type-checked at its
  construction site in `release.ts` where it is declared
  `DestroyAppProgress`. Typing the whole family properly belongs to the
  S2d provider cleanup, not here.
- *`service deploy`'s tests fake `createAppProvider` wholesale* rather
  than `ctx.api`, so listApps/resolveBranch/createProject/env-var calls
  skip the provider's own mapping. Defensible — `deployApp` is a
  compute-SDK upload/build flow with callbacks that no HTTP fake
  reaches, and D1 set the precedent with `executeAppBuild`. Worth
  revisiting only if provider mapping bugs start slipping through.
- *`ServiceDeployResult`'s optional `branchDatabase` / `localPin` /
  `reason` properties* look like standing ruling 3, but that ruling
  governs engine definitions, and these mirror legacy `AppDeployResult`
  exactly (`types/app.ts:57-90`) — keeping the shipped json result shape
  is the right call over internal tidiness.
- The escalated items (`--db` tri-state, rollback unconfirmed, agent-setup
  prompt, fixture-test deletion, interactive-only consent) were excluded
  per the dispatch and are all recorded in the divergence file.

### Round 2 (dispatch D2, commits 040c750 + 55bb185 + a0b0ea6) — reviewer

**Base change.** The branch was rebased onto `bot/s2a-foundations`, so
the engine affordances (consent tokens, `ctx.openUrl`, `needs.interaction`)
and the credential-manager rework are now underneath, and all ten prior
commits have new hashes. Spot-checked rather than re-reviewed:
`git diff 0dd65a8 794c2c0` over `v8/service/**`, the testkit and
`lib/app/build.ts` is **empty**, and `git diff fb6bc32 2159ee4` over
`packages/cli/src` and `tests` shows only the new base's own files
(auth/, v8/runtime.ts, credential-manager tests) — no service file moved.
The replay is content-identical for this dispatch's work.

**All five findings closed.**

- **F1** — the divergence file now carries one consent section for the
  whole group (`parity-divergences-s2c.md:101-104` points at it,
  `:189-217` is the table). Because tokens actually ship, the
  ships-today/end-state split I asked for is moot, and the file is
  accurate as written: I checked each claim against
  `packages/cli-engine/src/execution/prompts.ts:335-351` — the token
  branch, `--confirm` consumption once per run
  (`consumeConfirmValue`, `:37-46`), `--yes` alone never granting, and
  `--yes` plus a matching token granting via the same non-interactive
  branch. The stale exit-3 claim is gone: with a token there is no "no"
  to give, so a wrong answer is a mismatch (exit 2), and the file says
  exactly that.
- **F2** — the instruction is back, in the `edit-file` action's `reason`
  and again as its own advice action (`errors.ts:948-956`), and the test
  now pins the text in both places rather than just the action kind.
- **F3** — `postgres connection create` (`branch-database.ts:251`).
- **F4** — the row now reads "*(no legacy error — the prompt re-asked)*"
  and the prompt-validator gap is recorded beside the `--db` gap
  (`parity-divergences-s2c.md:286-296`).
- **F5** — `serviceAmbiguousError` deleted.

**Consent migration is correct against the engine, including the
semantics my brief had backwards.** `--confirm` grants only on the
non-interactive branch; an interactive session type-to-confirms
regardless. The tests pin exactly that, including the case that
distinguishes the two readings: interactive **with** `--confirm` present
still requires the typed token
(`v8-service-domain.test.ts:499-524`). Also pinned per command:
non-interactive grant, `--yes` + token grants, `--yes` alone does not,
wrong `--confirm` value → `CLI.CONSENT_REQUIRED` with
`meta.consentToken`, mistyped interactive token → exit 2. Deploy adds
the ordering case — `--confirm` without `--prod` still fails
`SERVICE.PROD_DEPLOY_REQUIRES_FLAG`
(`v8-service-deploy.test.ts:466-485`). Tokens are the natural nouns
(service name, hostname), so the typed string is guessable from the
question.

The three handlers keep an `if (!granted)` guard that a token consent
can never reach (`confirmByTyping` returns true or throws,
`prompts.ts:294-312`); each is commented as a contract guard rather than
a live branch. Defensive but honest — a destructive call must not
proceed on a falsy consent if that contract ever loosens.

**`ctx.openUrl` adoption is complete and real.** The handler no longer
emits its own endpoint event — the engine emits it inside `announceUrl`
with `name` taken from `message`, so `name: "live-url"` and the json
shape are unchanged. `isInteractive` and the `open` import are gone.
Tests cover the opener spy in all three states: interactive opens
(`opened: true`), non-interactive does not, and a throwing opener still
settles 0 with `opened: false`. I checked the shipping runtime actually
wires an opener (`packages/cli/src/v8/runtime.ts:106-108`), so this is
not test-only behavior. The interactive-`--json`-now-opens divergence is
recorded (`parity-divergences-s2c.md:114-123`); legacy's `canPrompt`
returned false under `--json` (`shell/runtime.ts:93-96`) and the engine
rules format out of interactivity, so the record is right.

**The credential seeding change does exercise the shipping path.**
Seeding `credential` (not the legacy `credentials`) makes `createTestCli`
build a real `TestCredentialManager` (`testing.ts:125-143`), and
`checkCredentials` takes the manager branch — `currentSession()` — rather
than the `getCredentials` staged-swap fallback
(`packages/cli-engine/src/execution/needs.ts:117-133`). The
unauthenticated axis seeds nothing, so the manager holds no session and
the same `credentialsRequiredError()` fires. The two paths are mutually
exclusive by construction, so this is now the shipping path in every
service test.

**Observations, not findings.**

- `ctx.openUrl`'s `message` is documented as a human announcement label
  ("Open your dashboard" in the engine's own test); the handler passes
  the slug `"live-url"`, which human mode prints verbatim as
  `live-url: https://…` (`rendering.ts:49-51`). Keeping the slug
  preserves the json `endpoint.name` D1 shipped, so this is a real
  trade, not an oversight — worth settling once, group-wide, rather than
  per command.
- The standalone-output instruction now appears twice in one error (in
  the action's `reason` and as a separate advice action). Harmless
  belt-and-braces; a consumer that renders both shows the sentence twice.
- The divergence table conveys "interactive OR `--confirm`" by column
  rather than stating that `--confirm` does not skip an interactive
  prompt. The tests pin it; one clause in the file would make the record
  self-contained.

## Orchestrator notes (orchestrator-owned)

- 2026-08-10: slice started. Branch cut from bot/s2b-resources @ 01c8183
  (S2b has pushed no command work yet — S2a auth family is the layout
  precedent until the first merge-down).
- 2026-08-10: D1 SATISFIED after two rounds. Operator consent ruling
  (post-D1): consent becomes engine-owned — token per consent point,
  type-to-confirm rendering, global `--confirm <value>` grant. D2 ports
  consent points as plain prompt.consent (no skip flags); D1's boolean
  `--confirm` on domain remove migrates off on the merge-down that
  brings the engine mechanism.
- 2026-08-10: implementer swapped Fable → Opus at D2 start
  (operator-requested, rate-limit headroom). Fresh subagent; same
  conventions via D1's code + this file.
- 2026-08-10: operator ruled Q2: `app run` is DROPPED, superseded by
  Composer's commands. No v8 port, no exit-code passthrough mechanism,
  no legacy carve-out needed in S2d (the shell deletion takes it).
  D4 records the drop as a divergence entry. The slice's "parked"
  scoreboard row resolves to "ruled: dropped".
