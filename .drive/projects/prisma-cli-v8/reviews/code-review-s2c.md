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
| All 24 in-scope commands mounted, green on R-S2b-9 matrix | met — D4 adds `agent install\|update\|status` and `feedback`, matrix complete per command, for 20 mounted in total. That is every in-scope command: the contract's "24" counts the four `service env` commands its own scope note then excludes, and `service run` is ruled dropped |
| `service` rename complete; no `app` path in v8 | D1–D3 surface: met |
| Deploy/promote/rollback/remove event sequences pinned | met — deploy pins the full phase sequence as an ordered array; remove pins first/second/last; promote and rollback bracket the SDK transitions |
| Divergence file complete | D1+D2 surface: met — one shipped consent mechanism, both engine gaps recorded. D3 surface: NOT met — the log-stream credential entry describes a shipping runtime the bin does not assemble (D3-R1-F1), and two real deltas are unrecorded (D3-R1-F2, D3-R1-F3). D4 surface: NOT met — the `feedback` json entry describes a change legacy did not make (D4-R1-F1) and the agent help-example drop is unrecorded (D4-R1-F2); the crash-recovery escalation and the `app run` drop are both recorded and accurate |
| Q2 ruled+implemented or parked with legacy intact | met — ruled dropped (orchestrator note, 2026-08-10) and recorded as a D4 divergence entry, including that no exit-code passthrough mechanism and no S2d carve-out are needed |
| Legacy fixture tests for ported commands deleted | pending (later dispatch — legacy `app` shell still serves deploy/logs/etc.) |
| Root verification green; PR ≥1k LOC; review loop run | pending (LOC floor already cleared: 4,794 added in D1+D2, 1,565 more in D3, 1,710 more in D4) |

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

### D3-R1-F1 — the log-stream credential gap is recorded backwards: the shipping runtime does resolve a token (should-fix)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:416-439`,
`packages/cli/src/v8/service/errors.ts:231-233`,
`packages/cli/tests/v8-service-logs.test.ts:427-450`.

The divergence entry says `ctx.getCredentials()` "is the manager-less
fallback and resolves `undefined` whenever a credential manager is wired
— which is the shipping runtime", and concludes that `service logs`
"reports a clear error under the credential manager". The code does
something else. `ctx.getCredentials()` forwards straight to
`runtime.getCredentials()` and never looks at the manager
(`packages/cli-engine/src/execution/command-context.ts:96-97`). The
shipping runtime wires `getCredentials: makeGetCredentials(proc.env)`
(`packages/cli/src/v8/runtime.ts:95`), which returns
`PRISMA_SERVICE_TOKEN` when it is set and otherwise the access token
`FileTokenStorage` holds (`packages/cli/src/auth/credentials.ts:11-22`)
— the same two sources, in the same order, that legacy's
`createPreviewLogAuthOptions` used
(`packages/cli/src/controllers/app.ts:3284-3306`). `auth login` writes
the token to exactly that place (`packages/cli/src/v8/auth/login.ts:75`
→ `storeLegacyCredential` → `FileTokenStorage.setTokens`,
`packages/cli/src/auth/operations.ts:114-131`), and nothing in the CLI
calls `credentialManager.createSession`, so a signed-in user's token is
where `getCredentials` looks for it.

So the shipped command streams under the real runtime, and
`SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE` is not reachable in
production today. What makes it fire in the tests is a harness
constraint rather than the product: `createTestCli` rejects the
`credentials` seed combined with any credential-manager seed
(`packages/cli-engine/src/testing.ts:130-134`) and defines
`getCredentials: async () => spec.credentials` (`:214`), so seeding a
manager forces `getCredentials` to resolve `undefined` — a runtime
shape the bin never assembles, because it wires both. The test at
`:427-450` therefore pins the harness, and its comment ("Under the
credential manager — the shipping path — ctx.getCredentials() resolves
nothing") repeats the same wrong fact. The comment on the error builder
(`errors.ts:231-233`) states the opposite wrong fact: "needs.credentials
makes this unreachable in practice".

The escalation is still worth putting to the operator — `getCredentials`
is documented as staged for deletion
(`packages/cli-engine/src/context.ts:44-48`), the surviving accessors
expose no token, and a session that lives only in the credential
manager's own state file would not be found by `FileTokenStorage`. This
finding asks for none of that to be built. It asks that the three places
describing today's behavior describe today's behavior, so the operator
rules on the real situation: the command ships working, on an accessor
that is scheduled to disappear.

**Orchestrator adjudication (2026-08-10): the finding is half right, and
the correction it asks for would itself be wrong within one merge-down.
Measured, not reasoned — both credential surfaces resolve to the same
file path by default, and the file's shape decides the answer:**

- **On this branch today the reviewer is right.** `auth login` still
  writes through `storeLegacyCredential`
  (`packages/cli/src/v8/auth/login.ts:75`), which produces the legacy
  `{tokens: […]}` shape. `ctx.getCredentials()` reads that shape and
  returns a token, so `service logs` streams and
  `SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE` is indeed unreachable.
- **On `bot/s2a-foundations`, which is our own base and which we merge
  down next, it is already false.** There `auth login` calls
  `ctx.credentialManager.createSession`
  (`bot/s2a-foundations:packages/cli/src/v8/auth/login.ts:132`), which
  writes `{version, sessions, currentWorkspaceId}`.
  `@prisma/credentials-store` reads `data.tokens || []`, so that file
  yields no credential: driving the manager's own API end to end,
  `ctx.getCredentials()` flips from a token to `undefined` after a
  single `createSession`, while `credentialManager.currentSession()`
  still returns a valid session.

**So the breakage is not hypothetical and not avoided — it is scheduled,
and it arrives with the next merge-down. `service logs` becomes the one
command that fails for a signed-in user whose other commands all work.
`PRISMA_SERVICE_TOKEN` users are unaffected either way, because that
path short-circuits ahead of the file read.**

**Consequences for the fix round: the error builder and its test STAY —
they are about to become the live path, not dead code. What must change
is the wording in all three places the finding names, which today claims
the command is already broken and would tomorrow claim it already works.
Both are wrong. Each should state the trigger: the shape of the
credential file, flipped by the first `auth login` run after the auth
rework lands.**

### D3-R1-F2 — `service logs --deployment <id>` stops honoring the compute-config service (should-fix)

`packages/cli/src/v8/service/logs.ts:191-199` with
`parity-divergences-s2c.md:443-448`.

`serviceNamed` counts only `--service` and the positional config target.
Legacy folded the config-selected app name in first — `appName = appName
?? compute.configAppName` (`packages/cli/src/controllers/app.ts:1583`) —
and only then chose between the scoped and the global lookup (`:1646`).
That name is still computed in v8
(`packages/cli/src/v8/service/target.ts:178-190`), and
`selectComputeDeployTarget` returns the single target whenever the
config declares one, so in any directory holding a `prisma.compute.ts`
the name is present without the user typing anything.

In a normal service directory, `prisma-cli service logs --deployment
<id>` therefore behaves differently now. Legacy looked the id up inside
the configured service and refused a deployment belonging to a sibling
service (`Deployment "…" not found for app "…"`,
`controllers/app.ts:1669-1673`); v8 resolves the id globally, streams
the sibling's logs, and rewrites the remembered service selection to
that sibling (`logs.ts:90`). A config naming a service that no longer
exists used to fail with "Selected app does not exist in the resolved
project" (`controllers/app.ts:2961-2972`) and is now ignored.

The divergence entry records the opposite — "Legacy resolved an explicit
deployment id globally when no app was named, and v8 keeps that."
Legacy's "named" included the config; v8's does not. Either feed the
config name into the decision (it cannot reintroduce the picker: an
explicit name never prompts) or record that the meaning of "named"
narrowed.

### D3-R1-F3 — the json stream drops record fields legacy published, and `--cursor` loses its only source (should-fix)

`packages/cli/src/v8/build/logs.ts:142-171` and `:202-207`,
`packages/cli/src/v8/service/logs.ts:210-221`, with
`parity-divergences-s2c.md:381-389`.

1. **Per-record fields.** Legacy `build logs --json` published each
   record whole (`data: record`,
   `packages/cli/src/controllers/build.ts:87-95`), so every framed line
   carried `cursor`, `level`, `source` and `step`. The port keeps the
   text, the channel and `step`, and emits nothing at all for a terminal
   record whose code is `end` (`build/logs.ts:163`), which legacy framed
   too. `--cursor <cursor>` is documented as "Resume from a cursor a
   previous run reported" (`build/logs.ts:187-190`) — after this change
   no successful or partial run reports one, in either format. The only
   cursor a user can obtain is the one `BUILD.FAILED` carries, so the
   flag now works only after a failed build. The `output` event has a
   free-form `data` field, already used here for `step`
   (`packages/cli-engine/src/events.ts:52-58`), so carrying the cursor
   is a one-line change.
2. **The headers are now json frames.** Legacy suppressed both headers
   under `--json` (`controllers/build.ts:47`,
   `controllers/app.ts:1609`). v8 reports them as `output` diagnostics,
   so a json consumer of `build logs` reads one extra frame before the
   records, and a json consumer of `service logs` reads three.

The divergence file presents the json change as the wrapper-event drop
plus an envelope-shape change, with "the per-record events survive".
Neither the dropped fields nor the added header frames are in it. Carry
the fields through, or record both.

### D3-R1-F4 — `build logs` belongs to no command family (low)

`packages/cli/src/v8/cli.ts:45-63` (the platform family) and `:103`
(the mount), as committed in 55efe06.

Every other Management-API command is listed in a family. `build logs`
is mounted straight into the tree, directly above the comment that
reserves familyless mounting for shell-owned surfaces (`:104`), so a
reader cannot tell whether the omission is a decision or an oversight.
Standing ruling 1 makes `CommandFamily` the ownership entity and gives
each subgroup exactly one owner, and `build logs` is a platform command
— it calls `/v1/builds/{buildId}/logs` through `ctx.api` — not a local
utility like `agent` or `telemetry`. Nothing breaks today because the
platform family declares neither a config section nor a docs base URL,
and the engine derives each diagnostic's docs link from that base
(`packages/cli-engine/src/command-family.ts:11-19`); the day a base URL
is set, this one command silently misses it.

### D3-R1-F5 — the ndjson test helper does not exercise the buffering it claims to (low)

`packages/cli/tests/v8-build-logs.test.ts:34-46`.

The helper's comment says "One chunk per record, plus a split line, so
the reader's buffering is exercised rather than assumed", but it
enqueues exactly one complete, newline-terminated chunk per record.
Nothing splits a record across chunks, so `forEachNdjsonRecord`'s
partial-line buffer is never used, and nothing omits the final newline,
so the branch that parses the last record when the stream is `done`
(`packages/cli/src/v8/build/logs.ts:132-138`) never runs. Those two
paths are the only reason the reader is hand-written, and this dispatch
is the first test coverage `build logs` has ever had. Splitting one
record across two chunks and dropping the last newline covers both.

### D4-R1-F1 — the `feedback` json divergence describes a change legacy did not make (should-fix)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md`, the section "`feedback` gains the standard json envelope" (added in da04dee).

The entry says legacy registered no `renderJson` serializer for `feedback`, "so a `--json` run emitted the raw result record", and that the same record "now travels inside" the standard envelope. Legacy already emitted an envelope. `writeCommandSuccess` (`packages/cli/src/shell/command-runner.ts:110-117`) calls `writeJsonSuccess` for every `--json` run and consults `presenter.renderJson` only to decide what goes in the `result` field; with no serializer, the raw result goes there. `writeJsonSuccess` (`packages/cli/src/shell/output.ts:22-29`) prints `{ok: true, nextActions: [], command, result, warnings, nextSteps}`. The shipped behavior is pinned by the legacy test, which parses `prisma-cli feedback --json` and asserts `{ok: true, command: "feedback", result: {id, email, context}}` (`packages/cli/tests/feedback.test.ts:56-87`).

An operator reading this entry concludes that a json consumer of `feedback` used to read `{id, email, context}` at the top level and must now reach into `.result`. It always had to reach into `.result`. The missing serializer changed nothing on the wire, and the two `agent` commands prove it from the other side: they do have serializers, but both are identity functions (`packages/cli/src/presenters/agent.ts:50-56`), so they shipped the same raw record inside the same envelope. What actually changes for `feedback` is the engine-global envelope reshape — `command` becomes `commandId`, `warnings` becomes `diagnostics`, `nextSteps` becomes typed `nextActions`, plus json framing — which the file's preamble already covers for every command in this slice.

Say what changed instead: the `result` payload is unchanged (the entry already says this, and it is correct), and `feedback`'s json surface differs only in the engine-global ways. Or delete the section and let the preamble carry it.

### D4-R1-F2 — the `agent` group's package-manager-aware help examples do not port, and the drop is unrecorded (low)

`packages/cli/src/v8/agent/install.ts:87-93`, `packages/cli/src/v8/agent/update.ts:6-11`, `packages/cli/src/v8/agent/status.ts:47-50`, against `packages/cli/src/shell/command-meta.ts:22-29` and `:70-113`.

Legacy renders the `agent` group's help examples through `agentCommandExamples`, which formats each one with the project's own package runner (`resolvePrismaCliPackageCommandFormatterSync`). So `agent install --help` shows `pnpm dlx @prisma/cli@latest agent install` in a pnpm project, `bunx @prisma/cli@latest …` in a bun project, and `npx -y @prisma/cli@latest …` otherwise. A legacy test pins it: `packages/cli/tests/agent.test.ts:414-421` asserts the help output contains `$ pnpm dlx @prisma/cli@latest agent install`. The v8 definitions declare bare examples (`"agent install"`, `"agent status --global"`, and so on) and the engine prepends the binary name (`packages/cli-engine/src/execution/stricli-adapter.ts:166-172`), so the same help now reads `prisma-cli agent install`.

`agent` and `init` are the only commands legacy spelled this way, and the reason is specific to them: they are what a user runs before the CLI is on PATH. The port keeps the package-runner spelling everywhere else in the group — `agent install`'s next action is `npx -y @prisma/cli@latest agent status` and `agent status`'s is `npx -y @prisma/cli@latest agent install` (`packages/cli/src/v8/agent/install.ts:78-84`, `status.ts:89-97`, both pinned in `packages/cli/tests/v8-agent.test.ts`). One command is therefore spelled two ways in one product: help says `prisma-cli agent status`, the next action says `npx -y @prisma/cli@latest agent status`.

The engine cannot express the legacy form. `help.examples` is a static `readonly string[]` on the definition (`packages/cli-engine/src/commands.ts:41`), and `resolveExample` either substitutes `{bin}` with the CLI name or prepends it, so no example can carry a package runner and none can vary with the project. The fix is therefore the record, not the code: add the drop to the dispatch-4 divergence section and name the engine constraint, the way the file already does for its other engine gaps. Restoring the behavior would be an engine ask, not a D4 change.

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

### Round 1 (dispatch D3 — the log streams) — reviewer

**What was checked.** All 12 files of `a0b0ea6..55efe06` against
inventory §4's `prisma app logs` and `prisma build logs` entries, read
beside `controllers/app.ts` (`runAppLogs`,
`resolveExplicitLogDeployment`, `resolveLiveLogDeployment`,
`writeLogRecord`, `createPreviewLogAuthOptions`) and
`controllers/build.ts` (`runBuildLogs`, `writeBuildLogRecord`,
`forEachNdjsonRecord`); plus the engine's `reporting.ts`,
`rendering.ts`, `needs.ts`, `command-context.ts` and `testing.ts` for
the channel, log-level, json and credential semantics, and the shipping
`v8/runtime.ts` for what the bin actually wires.

**Channel routing is the legacy routing, branch for branch.** `build
logs` sends a record to `diagnostic` when `record.source === "stderr" ||
record.level === "error"` and to `data` otherwise — the same predicate
as `writeBuildLogRecord` (`controllers/build.ts:98-101`) — and the
engine writes `data` to stdout and everything else to stderr
(`rendering.ts:33-35`). A terminal record whose code is not `end` goes
to `diagnostic`, matching legacy's `stderr.write(record.message)`.
`service logs` sends every log record to `data`, which is what legacy
did (`writeLogRecord` wrote log text to stdout and dropped terminal
records in human mode entirely); showing the terminal message is the
one difference and it is recorded. Newline handling is equivalent:
legacy wrote the text and appended a newline when one was missing, the
port strips a single trailing newline and the engine appends one, so
the bytes match — including a record that ends in a blank line.
`--quiet` still hides both headers, because diagnostics carry display
severity `info` while `data` lines carry none, so no log level can ever
swallow the logs themselves (`reporting.ts:14-22`).

**`skipSelection` does not reach the other read commands.** It is
optional and absent by default, so `show`, `open`, `list-deploys` and
`release.ts` (promote / rollback / remove) run the same
`resolveExistingServiceSelection` call as before
(`target.ts:602-610`), and the domain commands go through
`resolveServiceDomainTarget`, which this diff does not touch. The
`--service` / positional / `--deployment` combinations are right except
for the config-named case (D3-R1-F2): `--service` with `--deployment`
scopes the lookup and reproduces `requireDeploymentForApp`;
`--deployment` alone resolves globally, then checks that the deployment
has a service and that the service is in the resolved project,
producing the three `DEPLOYMENT_NOT_FOUND` variants with legacy's three
summaries; and a named service with no selection settles
`SERVICE.NO_DEPLOYMENTS`, which is the branch legacy could only reach
through a usage error.

**The escalated exit-1 interim ships exactly as described.** A terminal
`error` record is remembered rather than thrown on, every remaining
record still streams, and only after the stream closes does the handler
throw `BUILD.FAILED` carrying `record.message` as `why`, `code` and
`retryable` in `meta`, the cursor in `meta` when there is one, and a
`build logs <id> --cursor <cursor>` resume action
(`build/logs.ts:81-104`, `:228-238`). The test asserts the ordering (the
earlier log line is present in the events), the code, the `why`, the
meta and the resume action. Nothing in the port reaches for
`process.exitCode`.

**The token interim is contained; the record around it is not
(D3-R1-F1).** The command asks `ctx.getCredentials()` and settles a
structured error when it resolves nothing. It never reads
`PRISMA_SERVICE_TOKEN`, never constructs `FileTokenStorage`, never
touches the auth state file. Its only env read is
`getApiBaseUrl(ctx.env)` for the stream's base URL, which is the value
legacy passed too and which no context accessor exposes. `rawTokenSeed`
is confined to one file: 14 uses, all in `v8-service-logs.test.ts`.
`build logs`, deploy, domain, show, open and the rest still seed
`credential` and exercise the credential-manager path, and both
unauthenticated cases deliberately omit the seed, so they still fail
through the manager. What the seed cannot model is the shipping runtime,
which wires a manager and a working `getCredentials` at the same time —
hence the finding, which is about the record, not the code.

**Tests are the right kind, with one hole.** Semantic throughout:
events compared as an ordered array with their channels, envelopes and
`commandId`, exit codes, the state file for the selection cache, and the
captured request query for `--follow` / `--cursor`. R-S2b-9's axes are
complete for both commands (success, errored, json envelope,
unauthenticated; no consent point and no picker on either — the picker
stays proven once, on `service show`). The hole is the ndjson reader
(D3-R1-F5). The three service-logs error variants are driven through
route fakes that distinguish the branch-scoped listing from the
provider's branch-less global scan, which is a faithful model of
`findAppForDeployment`.

**Observations, not findings.**

- The doc comment "promote / rollback / remove need a service that
  already exists" now sits above `deploymentDetachedError` rather than
  `releaseTargetRequiredError` (`errors.ts:194-195`): the two new
  builders were inserted between the comment and the function it
  describes.
- `build logs`'s `BUILD.NOT_FOUND` advice points at `auth workspace use
  <id-or-name>` where legacy said `auth login`. That is better advice
  for "switch to the workspace that owns it" and worth keeping.
- The `service logs` header loses legacy's description line ("Streaming
  logs for the selected deployment.") along with the block rendering,
  while `build logs` keeps its single header line. The header change is
  recorded; that the two commands now differ in shape is not.

**Not findings — for the orchestrator.**

- **The review worktree is not clean.** While this review ran, the
  worktree gained uncommitted dispatch-4 work:
  `packages/cli/src/v8/agent/`, `packages/cli/src/v8/feedback.ts`,
  `tests/v8-agent.test.ts`, `tests/v8-feedback.test.ts`, a modified
  `packages/cli/src/v8/cli.ts` that mounts them, and a modified
  `parity-divergences-s2c.md` (a rewritten D2 agent-setup entry plus a
  new dispatch-4 section). Every line reference in the D3 findings is to
  the reviewed commit 55efe06; the D2 rewrite inserts four lines above
  the dispatch-3 section, so those divergence-file numbers now read four
  lines lower on disk. Nothing in D3's committed diff depends on any of
  it.
- The engine knows the Management API base URL
  (`runtime.managementApi.baseUrl`) and does not expose it on
  `CommandContext`, so a self-authenticating stream has to rebuild it
  from `ctx.env`. That belongs in the same conversation as the token
  accessor, not in a D3 finding.

### Round 1 (dispatch D4 — agent, feedback) — reviewer

**What was checked.** All 11 files of `1943501..9f29e58`, and the divergence entries in `9f29e58..da04dee`, against inventory §4's entries for `prisma feedback <message>`, `prisma agent install` / `prisma agent update` and `prisma agent status`. Read beside `controllers/agent.ts`, `controllers/feedback.ts`, `presenters/agent.ts`, `presenters/feedback.ts`, `commands/agent/index.ts`, `commands/feedback/index.ts`, `types/agent.ts`, `types/feedback.ts`, the whole of `lib/agent/**`, and the legacy tests `agent.test.ts` and `feedback.test.ts`. Also read the engine's `args.ts`, `commands.ts`, `command-family.ts`, `command-tree.ts`, `stricli-adapter.ts`, `settlement.ts`, `protocol.ts` and `run-summary.ts` for the parse, help, mounting and crash semantics the entries depend on.

**The child-process seam is a faithful move.** Compared line by line, `v8/agent/skills-cli.ts` reproduces the legacy controller's private code: the same runner resolution through `resolveSkillsPackageRunner`, the same argument order (`<runner> skills@latest add prisma/skills --skill … --agent … [--global] [--copy] --yes`), `--copy` forced on `win32`, `stdin: "ignore"` with no `stdout`/`stderr` option so the installer's output is captured rather than streamed, and the same failure mapping including `exitCode ?? "unknown"`. The abort handling keeps legacy's asymmetry exactly: the install path rethrows only on `isAbortError`, while the list path also rethrows when `ctx.signal.aborted`. `parseSkillsListOutput`, `parseInstalledSkill` and `isPrismaSkillName` are copies down to the JSON-array guard and the string filter on `agents`.

**The shared helpers are reused, not reimplemented, and no legacy file moved.** `constants.ts`, `package-manager.ts`, `cli-command.ts` and `setup-status.ts` are imported from `lib/agent/`; `git log` shows none of them has changed since e9666a6. The diff adds eleven files and modifies only `v8/cli.ts`. Nothing under `packages/cli-engine/**`, `packages/cli/src/auth/**`, `packages/cli/src/v8/auth/**`, the publish machinery or the version fields is touched.

**The `skills-cli` / `skills@latest` reasoning holds.** Both the legacy controller and the port import `SKILLS_CLI_PACKAGE` from `packages/cli/src/lib/agent/constants.ts:3`, so the two CLIs invoke the same package by construction. Following the constant is right and the inventory's wording is the thing that is wrong.

**`agent status` degrades exactly the way legacy degrades.** Same `skillsInstalled` fallback (`skillsList.status === "ok" ? skills.length > 0 : statusScope === "project" && setupStatus.skillsInstalled`), same `statusSource` ladder (`skills-cli`, else `skills-lock` for project scope, else `unavailable`), and the two warning sentences word for word, including "Falling back to skills-lock.json" for project scope and its absence for global scope. Global scope never borrows the project lock. The result record is field-for-field `types/agent.ts`'s `AgentStatusResult`, and the same is true of `AgentInstallResult` and of `feedback`'s `FeedbackResult`. The one structural change is that legacy's `warnings: string[]` becomes an engine `warn` diagnostic, `AGENT.SKILLS_LIST_UNAVAILABLE`; the run still settles 0.

**`agent status`'s missing errored settlement is the right call, not a gap.** Neither legacy nor the port has an `AGENT.*` error code for `status` — a skills CLI that cannot be read is the fallback, not a failure — so there is no errored settlement to pin. What the dispatch pinned instead is the whole of the real failure behavior: the project fallback with its diagnostic and `statusSource: "skills-lock"`, the global case with `statusSource: "unavailable"` and no fallback, and the install next action offered in both.

**`feedback`'s hand-rolled validation matches legacy exactly.** Same limits (4000 characters for the message, 320 for the email, the same `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), same order (message empty, message too long, then email), same trim-before-check, and the same refusal before any network call — pinned by asserting the loopback server received nothing. Each check has its own dotted `FEEDBACK.*` code at exit 2 per R-S2b-5. The missing-positional case is genuinely left to the engine: `positional.string` is required by default (`packages/cli-engine/src/args.ts:126-128`), so `feedback` with no argument settles `CLI.INVALID_ARGUMENTS`, and that is pinned too. The endpoint override is read from `ctx.env`, never `process.env`. `postFeedback` is a line-for-line move: the same `AbortSignal.any([ctx.signal, AbortSignal.timeout(3_000)])`, the same "is this an abort or a timeout" test on every catch (`if (signal.aborted) throw error`), the same `TimeoutError` name check, and the same treatment of a non-JSON 2xx body as a success.

**Tests are the right kind, and nothing leaves the machine.** `execa` is faked at the module seam with `vi.mock`, and the only other code in these paths that looks like a child process — `resolveSkillsPackageRunner` and `resolvePrismaCliPackageCommand` — is pure filesystem reads, so no test can spawn anything. `feedback` runs against a loopback server on port 0, every test that reaches the network sets `PRISMA_CLI_FEEDBACK_URL`, and the one run that does not set it (`feedback --json` with no message) fails in the parser before any fetch; the unreachable-service case points at `127.0.0.1:9`. No test can contact the production endpoint. The suite is 27 tests in 248 ms, which is consistent with no spawn and no remote call. R-S2b-9's axes are complete per command — success, errored, json envelope — and the unauthenticated axis is pinned twice over, by asserting `needs.credentials === false` on all four definitions and by never seeding a session in any run.

**Mounting outside a command family is right for these four, and `build logs` is still the odd one out.** A `CommandFamily` carries two things: a config section and a docs base URL (`packages/cli-engine/src/command-family.ts:5-20`). `agent *` and `feedback` need neither. They call no Management API, declare no credentials and read no config; they are contributed by the shell itself, not by a platform package, exactly like `telemetry`. Putting them in the platform family would claim an ownership that does not exist and would give them that family's future docs base URL, which is wrong for local utilities. The mount comment says so plainly. This is the opposite case from D3-R1-F4: `build logs` is a platform command that reaches `/v1/builds/{buildId}/logs` through `ctx.api`, so it does have an owner. I would leave these four where they are and move `build logs` into the platform family.

**Observations, not findings.**

- `openStateStore` (`v8/agent/status.ts:21-28`) is the third copy of the same six lines, after `v8/service/target.ts:83-91` and `v8/auth/agent-setup-tip.ts:44-51`. `v8/auth/**` is out of bounds for this dispatch, so consolidating them is S2d work.
- `feedback.ts` hand-rolls `{kind: "user-choice"}` advice actions where the service group has an `adviceAction` helper (`v8/service/errors.ts:15`). For a single command with no group, inlining is fine.
- `agent install --dry-run` uses the `info` summary tone where legacy always used the success tone. Human-only, and arguably more honest about a run that installed nothing.
- `agent status`'s human output moves the skills list below the field rows and renders it as a table; legacy interleaved it right after the "skills:" row. Human rendering is not pinned per command under standing ruling 4.

**Not findings — for the orchestrator.**

- **Three groups now ship with no command family** — `agent`, `telemetry`, and `build logs` per D3-R1-F4. The engine's own comment describes familyless commands as "Harness-mounted commands with no family are unowned" (`packages/cli-engine/src/execution/command-tree.ts`), which reads as though the mode exists for the test harness and the shell is not meant to use it. Standing ruling 1 also gives every subgroup exactly one owner. Either the shell needs a family of its own for its local utilities, or the engine's comment should say that familyless is a supported shell mode. It is one decision for the whole tree and it is above this dispatch.
- **The D4 commit also rewrites the dispatch-2 agent-setup entry to call the prompt's drop "final", on the grounds that "the operator was told and did not object".** Standing ruling 10 makes divergences an operator-review item, and no ruling to that effect is recorded anywhere in this file, unlike the Q2 drop which is in the orchestrator notes. Worth turning into either an explicit ruling or an explicit "awaiting ratification" note. The entry's factual claim does check out: the dismissal timestamp is still read and reported, through `readPrismaAgentSetupStatus` reading `state.agent.setupPromptDismissedAt` (`packages/cli/src/adapters/local-state.ts:266-269`) and `agent status` returning it as `promptDismissedAt`.
- **The review worktree is not clean, again.** While this review ran, the dispatch-3 fixer was editing `parity-divergences-s2c.md`, `v8/build/logs.ts`, `v8/cli.ts`, `v8/service/errors.ts`, `v8/service/logs.ts`, `v8/service/target.ts` and the two log-stream tests. Every reference above is to the reviewed commits — 9f29e58 for code and tests, da04dee for the divergence file — not to the working tree.

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
- 2026-08-10, continuation orchestrator picks the slice up after a rate
  limit. Baseline reproduced green (977 tests) only after `pnpm build` —
  the engine and telemetry packages must be built before vitest can
  resolve them. D3's review was run (round 1, NOT SATISFIED, five
  findings), D4 was implemented and committed at 1004 tests, and D4's
  review was run (round 1, NOT SATISFIED, two findings, both about the
  record rather than the code).
- 2026-08-10: **merge-down from `bot/s2a-foundations` deliberately
  held.** That branch moved five commits ahead of our base, and its tip
  (`4b006d1`) says in its own message that no test suite has been run
  against it and its implementer was halted mid-work. Merging it would
  make this branch's verification meaningless. Our base `9ffbb01` is
  still an ancestor of that tip, so the PR against `s2a-foundations`
  shows only our commits. Merge down once that stream is green; adopt
  any new test-harness credential seeding shape during the merge.
- 2026-08-10: **D3-R1-F1 adjudicated against the reviewer's conclusion**
  — see the block under the finding. The dispute was settled by running
  the credential surfaces rather than reading them. Both the reviewer
  and the outgoing orchestrator's brief were each right about a
  different code state: `service logs` streams on this branch and breaks
  on the very next merge-down, because `auth login` changes the
  credential file's shape there. The interim error and its test stay;
  only the wording changes.
- 2026-08-10: **the in-scope command count is 20, not 24.** The
  contract's headline counts the four `service env *` commands that its
  own scope note then assigns to `project env` in S2b, and `service run`
  is ruled dropped. Nothing is missing; the headline and the scope note
  disagree with each other. Worth one correction in the contract at S2d
  consolidation.
- 2026-08-10: **the D2 agent-setup prompt entry now reads "final", and
  its provenance is this ledger, not a recorded ruling.** The outgoing
  orchestrator's continuation brief records that the operator was told
  and did not object, and instructs the next dispatch to record it as
  final unless overruled; D4 did so on that instruction. Flagged to the
  operator for an explicit yes or no at PR time. (D4's reviewer raised
  the same point; the entry's factual claim checks out either way.)
- 2026-08-10: **three groups now ship without a command family**
  (`agent`, `telemetry`, and `build logs` until D3-R1-F4 is cleared).
  A family carries only an optional config section and docs base URL,
  neither of which any family in this CLI sets, so being familyless has
  no behavioral effect today — but the engine's own comment
  (`packages/cli-engine/src/execution/command-tree.ts:134-135`) calls
  familyless commands "unowned", which reads as though the mode is not
  meant for shell use. One decision for the whole tree, above this
  slice: either the shell declares a family for local utilities, or the
  engine states that familyless is supported.
