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
**The acceptance criteria below are the contract's, written for a
twenty-command slice. Three commands were removed late by operator
ruling — `service deploy` and `service build` dropped, `service logs`
shelved — so two criteria now describe work that is deliberately not
here. The rows say so rather than being quietly reworded; S2d
consolidates the contract.**

| Acceptance criterion | Status |
| --- | --- |
| All in-scope commands mounted, green on R-S2b-9 matrix | met for the slice as ruled — **17 mounted**, matrix complete per command. The contract's headline "24" counted the four `service env` commands its own scope note then moved to S2b, giving 20; the operator then dropped `service deploy` and `service build`, shelved `service logs`, and `service run` was already ruled dropped |
| `service` rename complete; no `app` path in v8 | met |
| Deploy/promote/rollback/remove event sequences pinned | met for what ships — remove pins first/second/last; promote and rollback bracket the SDK transitions. The deploy phase sequence was pinned and is **gone with the command**; this criterion cannot be met in full and does not need to be |
| Divergence file complete | met, verified against the code by the final review: 17 commands, the ten removed next actions, the shelve-versus-drop distinction, and the workspace-from-session entry all checked rather than trusted |
| Q2 ruled+implemented or parked with legacy intact | met — `service run` ruled dropped and recorded, with no exit-code passthrough mechanism and no S2d carve-out needed |
| Legacy fixture tests for ported commands deleted | **deliberately not done — operator decision needed at PR time.** The commander shell still serves these commands until S2d deletes it; removing its tests now leaves live code uncovered for the whole interval. Recommendation: delete nothing here, delete the shell and its tests together. Accepted by every reviewer |
| Root verification green; PR ≥1k LOC; review loop run | green at the tip: **965 cli tests**, 234 engine tests, typecheck, lint. LOC floor cleared many times over. Review loop run — four dispatch reviews, an architect and a principal-engineer pass over the whole slice, a verification round, and a final pass after the removals |

### Finding status (orchestrator-owned)

| Round | Findings | Status |
| --- | --- | --- |
| D1 round 1 | F1, F2, F3 | closed in `c7c10de` |
| D2 round 1 | F1–F5 | closed in `040c750`, `55bb185`, `a0b0ea6` |
| D3 round 1 | F1–F5 | closed in `8e3b181` + `f7b3635`; **independently verified closed by the slice review**, not accepted from the fix report. F1 was closed per the orchestrator adjudication under it, not per the finding's own conclusion |
| D4 round 1 | F1, F2 | closed in `f7b3635`; independently verified closed by the slice review |
| Slice review | ENG-F1–F4, ARCH-F1–F4 | closed in `ed7151e` + `0459208`; **independently verified closed** by the round-2 verification pass, which re-counted the affected commands itself and proved the new deploy coverage by mutating `app-provider.ts` and watching the suite fail. ENG-F1 was record-only here: the code fix belongs to the S2a stream (see the merge-down note) |
| Slice review round 2 | R2-F1 | closed in `6458ad9` — a cancellation regression the ARCH-F1 fix introduced. Recorded as deliberately untested; see the finding. **Moot since: it was in `service deploy`, which the operator then dropped** |
| Final review (post-removal) | FINAL-F1, F2, F3 | F3 (the stale scoreboard) closed by the orchestrator above. F1 and F2 dispatched — F1 restores coverage of `renameAppCopy`, `fromLegacyCliError` and the compute-config path, which the three deleted test suites took with them although all three still run on the surviving commands |

**All findings raised in this slice are closed.** The one open item is not
a finding against this branch: the credential reader that breaks 13 of
these commands on merge-down belongs to the S2a stream.

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

### SLICE-ENG-F1 — the scheduled credential breakage is 13 commands, not one: `requireWorkspace` reads the same file the same way (should-fix)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:485-487`, against `packages/cli/src/v8/service/target.ts:93-101` and `packages/cli/src/auth/operations.ts:152-163`.

The log-stream credential entry, rewritten after the D3-R1-F1 adjudication, is right about the trigger and wrong about the blast radius. It tells the operator: "From the first `auth login` run after that lands, `service logs` is the one command that fails for a signed-in user whose other commands all work." The other commands do not all work.

Every service command resolves its workspace through `requireWorkspace` (`target.ts:93-101`), which calls `readAuthState(ctx.env, ctx.signal)`. That function builds `new FileTokenStorage(env, signal)` and asks it for tokens (`packages/cli/src/auth/operations.ts:152-153`); when there are none it returns `{authenticated: false, workspace: null}` (`:155-163`), and `requireWorkspace` throws `SERVICE.WORKSPACE_REQUIRED` (`packages/cli/src/v8/service/errors.ts:88-97`). That is the **same** call `ctx.getCredentials()` makes — `makeGetCredentials` is `new FileTokenStorage(env).getTokens()` (`packages/cli/src/auth/credentials.ts:20`). So whatever flips one flips the other.

I checked the incoming state rather than reasoning about it. On `bot/s2a-foundations`, `auth login` calls `ctx.credentialManager.createSession` (`bot/s2a-foundations:packages/cli/src/v8/auth/login.ts:132`); the manager's state file is `{version, sessions, currentWorkspaceId}` with no `tokens` key (`bot/s2a-foundations:packages/cli/src/auth/state-file.ts:26-30`), `writeCredentialState` replaces the whole file (`:169-193`), and both surfaces resolve to the same path by default (`state-file.ts:57-71` and `client.ts:25-32` both fall through to `defaultAuthFilePath(env)`). `@prisma/credentials-store` reads `data.tokens || []`, so `FileTokenStorage.getTokens()` returns null. `readAuthState` on that branch is untouched — byte-identical to ours.

The consequence: after that merge-down, 13 of the 20 commands fail for a signed-in user without `PRISMA_SERVICE_TOKEN` — `deploy` (`deploy.ts:463` calls `requireWorkspace` directly), `show`, `open`, `list-deploys`, `logs`, `promote`, `rollback`, `remove` (all through `resolveServiceReadState` → `resolveServiceProjectContext` → `requireWorkspace`, `target.ts:267`), and the five `domain` commands (through `resolveServiceDomainTarget`, `target.ts:651`). `service logs` fails first, at `SERVICE.WORKSPACE_REQUIRED`, before it ever reaches the credential error the entry is about. Only `show-deploy` survives, because it treats a workspace failure as "no remembered project" and continues (`show-deploy.ts:50-54`); `service build`, `build logs`, `agent *` and `feedback` never ask.

Nothing in the suite can catch this: all 12 service test files that reach `requireWorkspace` replace `readAuthState` with a mock returning `SIGNED_IN` (e.g. `packages/cli/tests/v8-service-logs.test.ts:17-20`), so the workspace and the engine's credential check come from two different seeds in the tests and from one file in production.

This asks for no code — `packages/cli/src/auth/**` is a hard boundary. It asks the entry to state the real scope, because the operator is being asked to rule on an engine gap whose cost the record puts at one command and which is actually most of the slice. It also belongs beside the merge-down note in the orchestrator section: the merge is currently described as a routine "adopt any new test-harness credential seeding shape", and on this evidence it is a stop-the-line change.

### SLICE-ENG-F2 — the stream record entry claims every legacy field is carried; `kind` and `details` are not (low)

`packages/cli/src/v8/service/logs.ts:249-253` and `packages/cli/src/v8/build/logs.ts:177-181`, against `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:395-399`.

The dispatch-3 fix carries the per-record fields, and the entry now says "a json consumer keeps everything legacy published per record". Two fields are still dropped from terminal records, and the entry does not list them among its two acknowledged losses.

Legacy published the whole record — `data: record` (`packages/cli/src/controllers/app.ts:1806-1815`, `packages/cli/src/controllers/build.ts:87-95`). A terminal record is `{type, kind, code, message, retryable, cursor, details?}` for `service logs` (`@prisma/compute-sdk` `log-stream.d.ts:9-17`) and `{type, kind, code, message, retryable, cursor}` for `build logs` (`build/logs.ts:21-28`). Both ports attach `{cursor, code, retryable}` and put `message` in `line`, so `kind` is lost on both streams and `details` is lost on `service logs`.

`kind` is the field that says whether the stream ended cleanly or in failure, and it is the only one that does so in a vocabulary the consumer already knows — `code` is a server-defined string. On `build logs` that costs little, because a `kind: "error"` terminal also settles the run as `BUILD.FAILED`. On `service logs` it costs the whole signal: a terminal error record is reported as one diagnostic `output` frame and the run still settles 0 (`packages/cli/tests/v8-service-logs.test.ts:204-230` pins exactly that), so a json consumer that used to read `data.kind === "error"` now has nothing to read. Carry the two fields, or add them to the entry's list of losses — the fix that closed D3-R1-F3 is a one-line change either way.

### SLICE-ENG-F3 — the divergence file cites standing rulings by numbers that name different rulings (low)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:157`, `:349`, `:610`, against `../specs/s2-overview.md:18-58`.

Three justifications point the operator at the wrong rule.

- `:157` and `:349` justify dropping `verboseContext` and the `--verbose` block with "S2 ruling 7". Standing ruling 7 is "Telemetry is essential". The ruling the entries mean is 8, "`--trace` is dropped (log levels cover it)" — and even that names `--trace`, not `--verbose`, so the entry is asserting a slightly wider rule than the overview states.
- `:610` justifies the bare `agent` help examples with "Standing ruling 5 forbids the binary name in an example". Standing ruling 5 is "`ctx.api`: the management API client lives directly on `CommandContext`". The rule that does say this is an operator ruling of 2026-08-09 recorded on the engine interface itself: "Invocations WITHOUT the binary name … at help render time every `{bin}` is substituted" (`.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts:786-791`). The substance is right; only the citation is wrong.

The other rule citations in the file check out (`R-S2b-6` at `:111` and `:270` is "Interactive pickers", `R-S2c-1`/`R-S2c-2` are the rename and the streams). This file is the operator's parity artifact, so a reference that lands on the wrong ruling is worth one pass to correct.

### SLICE-ENG-F4 — nothing asserts the paths the 20 commands are actually mounted at (low)

`packages/cli/src/v8/cli.ts:85-119` with `packages/cli/tests/v8-bin.test.ts:269-299` and `packages/cli/tests/v8-service-testkit.ts:280-297`.

`cli.ts`'s `commands` record is the only place the user-facing command paths exist, and no assertion covers it. `v8-bin.test.ts` checks that `buildCli()` does not throw and that a root `--help` prints `USAGE` and `auth`; neither would notice a path typo, because the engine validates collisions and reserved flags, not spelling. The tests that do exercise these commands build their own tree from `SERVICE_COMMANDS` in the testkit — a hand-maintained second copy of the same map — and the agent and feedback suites declare a third and fourth (`packages/cli/tests/v8-agent.test.ts:14-18`, `packages/cli/tests/v8-feedback.test.ts:53-58`). So `"service list-deploys"` in `cli.ts` could read `"service list-deploy"` and all 1012 tests would still pass while the shipped binary answered to a name nothing documents.

The 20 paths are correct today; I read them against the mount map and the group briefs. The gap is that the slice quadrupled the size of that map and added no way to notice it drifting. One assertion over `buildCli()`'s mounted paths — or having the testkit consume the same map `cli.ts` does, rather than restating it — closes it for every later slice too.

### SLICE-ARCH-F1 — `service deploy` hand-rolls the local-binding failure instead of calling the operation layer's mapper (should-fix)

`packages/cli/src/v8/service/deploy.ts:497-511`, against `packages/cli/src/controllers/app.ts:662-664` and `packages/cli/src/lib/project/setup.ts:94-145`.

The operation layer already owns this failure. `bindProjectToDirectory` returns a `Result` whose error is one of five tagged types, and `projectDirectoryBindingErrorToCliError` (`setup.ts:94-125`) is the function that turns it into user-facing text. Legacy `app deploy` calls that mapper (`controllers/app.ts:663`). The v8 port is the only caller in the tree that does not: it checks `bound.isErr()` and builds its own `CliStructuredError` instead. R-S2b-10 is explicit that handlers call the existing operation layer rather than rewrite it, and every other legacy error surface in this slice does exactly that — `computeConfigErrorToCliError` and `projectResolutionErrorToCliError` are both used, through `fromLegacyCliError`. This is the one mapper of the three that is skipped.

Four things change for the user as a result.

1. **Three error variants the operation layer deliberately re-throws are now swallowed into a write failure.** `matchError` in the mapper re-throws `LocalResolutionPinWriteAbortedError`, `LocalResolutionPinGitignoreUpdateAbortedError` and `LocalResolutionPinSerializationError` rather than converting them (`setup.ts:99-124`). The first two are the abort signal firing mid-write — Ctrl-C during the first deploy of an unlinked directory. In v8 all three now settle as `SERVICE.LOCAL_STATE_WRITE_FAILED` at exit 2, advising the user to "Check write permissions for the .prisma directory", which for a cancelled run is simply untrue.
2. **`why` is the stringified error object.** `why: String(bound.error)` yields the error class name followed by its internal message (these are `TaggedError` subclasses of `Error`, `packages/cli/src/lib/project/local-pin.ts:86-120`), so a user reads `LocalResolutionPinWriteFailedError: Could not write .prisma/local.json.` where legacy wrote either "The CLI could not write .prisma/local.json." or "The CLI could not update .gitignore to keep local Project binding state out of git." The two failures are no longer told apart.
3. **`meta` is dropped.** Legacy carried `pinPath` or `gitignorePath` plus `operation` (`create-directory` / `write-temp-file` / `rename-temp-file`); v8 carries neither, so an agent reading the json envelope cannot tell which step failed.
4. **The legacy `fix` is dropped** in favour of shorter advice that names only `.prisma` and not `.gitignore`.

Separately, `SERVICE.LOCAL_STATE_WRITE_FAILED` is one of only three codes this slice emits that the divergence file's error-code tables do not list. The other two, `SERVICE.BRANCH_DATABASE` and `SERVICE.BUILD_SETTINGS_LEGACY`, are warn diagnostics whose class the file already covers in prose; this one is an errored settlement, and R-S2b-5 asks for every code mapping to be enumerated.

The smallest correction is one call: `throw fromLegacyCliError(projectDirectoryBindingErrorToCliError(bound.error))`. It produces the same `SERVICE.LOCAL_STATE_WRITE_FAILED` code, restores the summary, the two distinct `why` sentences, the `fix` and the `meta`, and leaves the three re-thrown variants re-thrown. Add the code to the dispatch-2 mapping table alongside it.

### SLICE-ARCH-F2 — nine service commands report a finished action as though it were still running, with an information marker (should-fix)

`packages/cli/src/v8/service/presentation.ts:31-33` (the shared `title` helper) and its callers at `:82`, `:203-206`, `:296`, `:332`, `:352`, `:376`, `:395-398`, `:466`, `:481`.

`title()` hard-codes `tone: "info"`, and the engine renders a summary block's tone as its leading symbol — `ok` is `✔`, `info` is `ℹ` (`packages/cli-engine/src/execution/rendering.ts:65-77`). That summary block is the only success signal a result command has in human mode; the engine prints no completion line of its own. So a successful run currently ends like this:

- `service remove` → `ℹ Removing the service and every deployment it owns.`
- `service promote` → `ℹ Promoting a deployment to production.`
- `service rollback` → `ℹ Rolling production back to an earlier deployment.`
- `service domain remove` → `ℹ Removing a custom domain from the selected service.`
- `service domain add` → `ℹ Adding a custom domain to the selected service.`
- `service domain retry` → `ℹ Retrying custom domain verification.`
- `service build` → `ℹ Building the local service artifact.`
- `service open` → `ℹ Opening the live URL for the selected service.`
- `service deploy` with no target (deploy-all) → `ℹ Deployed 2 services.`

A user who runs `service remove` and reads the last line cannot tell whether the service was removed or whether the CLI is announcing what it is about to do. The tense says "in progress" and the marker says "for your information".

This is not a matter of taste, because the slice contradicts itself and the layout precedent. Three commands in the same slice get it right: `service deploy` renders `✔ Deployed <service> to <branch>.` (`presentation.ts:293-300`), `service domain wait` renders `✔ <hostname> is live at <url>` (`:503-507`), and `feedback` renders `✔ Feedback sent. Thank you!` (`packages/cli/src/v8/feedback.ts:95`). So `service deploy` and `service deploy` with no target — the same command — disagree with each other. S2a set the pattern the other seven should follow: `auth logout` prints an `info` title describing the action and then a separate `ok` summary confirming the outcome (`packages/cli/src/v8/auth/logout.ts:23-37`), and `auth workspace use` and `auth workspace logout` do the same. Read-only commands correctly stay on `info` — `auth whoami`, `telemetry status`, and in this slice `service show`, `list-deploys`, `show-deploy` and `domain show`.

Standing ruling 4 says human rendering is not pinned per command. That governs what the tests assert, not whether the output tells the user the command succeeded.

The smallest correction is to give each of the nine either an `ok`-toned title in the past tense, as `service deploy` already does, or a trailing `ok` summary, as `auth logout` already does. `title()` can keep meaning "an informational heading" and simply stop being the only block these commands emit.

### SLICE-ARCH-F3 — `service deploy`'s tests replace the mapping layer, and eight of the nine masked methods have no other caller (should-fix)

`packages/cli/tests/v8-service-deploy.test.ts:16-19` (the `vi.mock("../src/lib/app/app-provider", …)`) and `:63-176` (`installFakeProvider`), against `packages/cli/tests/v8-service-testkit.ts:107-138` and `:229-272`.

Round 1 of dispatch 2 recorded this seam as a defensible non-finding, on the grounds that "`deployApp` is a compute-SDK upload/build flow with callbacks that no HTTP fake reaches". That reasoning is correct and I am not disputing it. What the note did not weigh is how much else the mock takes with it. Mocking the `createAppProvider` factory replaces the whole provider, so nine methods are answered by a hand-written object: `deployApp`, and also `createProject`, `resolveBranch`, `createBranchDatabase`, `deleteBranchDatabase`, `listEnvironmentVariables`, `createEnvironmentVariable`, `updateEnvironmentVariable` and `deleteEnvironmentVariable` (`packages/cli/src/lib/app/app-provider.ts:281-342` and `:487-562`). Eight of those nine are plain request and response mapping with no callbacks at all.

`service deploy` is the only production caller of all nine (`packages/cli/src/v8/service/deploy-target.ts:206`, `:341`; `packages/cli/src/v8/service/branch-database.ts:202`, `:299`, `:330`, `:346`, `:379`, `:422`, `:428`). So when this file mocks them, nothing anywhere in the repository covers them. `deployApp`'s live-pointer mapping is the sharpest case: `liveDeploymentId: deployed.promoted ? deployed.deploymentId : deployed.previousDeploymentId` (`app-provider.ts:539-561`) is the same "which deployment is actually live" question that a72f34a had to correct once already, and the deploy test asserts a value the test itself authored.

The group already has the right pattern, twice over. `releaseRoutes` (`v8-service-testkit.ts:229-272`) models the compute SDK's own start / stop / poll / delete HTTP flow, so `promote`, `rollback` and `remove` run the real provider and the real SDK against route fakes. `service logs` mocks only the one SDK entry point it cannot reach over HTTP (`vi.mock("@prisma/compute-sdk", …)` for `streamLogs`, `v8-service-logs.test.ts:22-25`) and leaves `listApps` / `listDeployments` / `showDeployment` real.

The smallest correction follows those two: stop mocking `createAppProvider`, serve the project, branch, database and env-var calls through `readFlowRoutes`-style routes, and fake only the compute SDK's deploy entry point. That leaves exactly one method uncovered instead of nine, and it is the one the dispatch-2 note actually argued for.

### SLICE-ARCH-F4 — the `--db` engine-gap record asks for a larger engine change than the gap needs (low)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:280-287`, against `packages/cli-engine/src/execution/command-snapshot.ts:57-114` and `packages/cli-engine/src/run-summary.ts:8-27`.

The entry's statement of the divergence is right: a handler cannot tell `--no-db` from "not passed", so both take the prompt path. Its closing ask is what I am questioning — "the engine needs a declarable tri-state (or non-negatable) boolean before this is parity" — because the engine already derives the missing fact and simply sends it somewhere else.

`explicitFlagKeys` (`command-snapshot.ts:57-95`) scans argv for which flag names appear, and lines 77-82 deliberately mark the base flag when they see a `--no-<flag>` token. `buildCommandSnapshot` then labels every declared flag `source: "cli"` or `source: "default"`, documented as "flags explicitly present on argv are 'cli'" (`run-summary.ts:12-24`). Combined with the parsed boolean the handler already receives, that settles all three states: `default` means absent, `cli` with `true` means `--db`, `cli` with `false` means `--no-db`. The engine computes this at parse time on every run. It hands it only to `RunHooks.onSettled`, after the run is over, for telemetry.

The gap is therefore not in the flag model. It is that a fact the engine already holds never reaches the handler — the same shape as the interactivity fact the `--db` prompt entry needs four lines further down, and as the token `service logs` needs. Stating it that way changes what the operator would build: an accessor over an existing computation, rather than a new flag type with its own negation rules. Restate the ask; the divergence itself is recorded correctly and nothing in the code needs to change.

### SLICE-R2-F1 — pressing Ctrl-C during the local Project binding write now reports an internal error (low) — CLOSED by the orchestrator in the tip commit

**Orchestrator note: fixed exactly as the finding recommends —
`ctx.signal.throwIfAborted()` immediately before the mapper call, which
is the idiom already used 55 lines above in the same function for the
pin read. Raising the signal's own reason gives the engine a value it
recognizes as an abort, so Ctrl-C settles as a cancellation instead of
falling through to the crash path.**

**Not covered by a test, deliberately.** Pinning it needs the run
aborted between `resolveDeployProjectContext` returning and the binding
write, and there is no event or other observable seam in that window —
the only two statements between them are a field read and the binding
call itself. Every way of forcing an abort earlier risks the test
passing because some earlier await rejected, which would assert nothing
about this line. A fragile test that can pass for the wrong reason is
worse than none, so the gap is recorded here instead. It closes for free
if the deploy flow ever emits a step event before the binding.

`packages/cli/src/v8/service/deploy.ts:500-503`, against `deploy.ts:443-447` in the same function, `packages/cli/src/lib/project/setup.ts:98-124`, `packages/cli-engine/src/execution/settlement.ts:113-133` and `packages/cli/src/shell/command-runner.ts:40-43`.

The SLICE-ARCH-F1 fix is right and I am not disputing it: routing through `projectDirectoryBindingErrorToCliError` is what the finding asked for, and leaving the three re-thrown variants re-thrown is what the mapper does. The consequence for two of those three variants was not checked, and it is worse than what the fix replaced.

`LocalResolutionPinWriteAbortedError` and `LocalResolutionPinGitignoreUpdateAbortedError` are produced only when the abort signal has already fired (`local-pin.ts:348-355` and `:390-397`, both `signal?.throwIfAborted()` wrapped in a `Result.try`) — the user pressed Ctrl-C during the pin write on the first deploy of an unlinked directory. The mapper re-throws them unchanged, so a `TaggedError` leaves the handler. The engine recognises an abort in exactly two shapes: the thrown value is identical to `signal.reason`, or it is an `Error` whose `name` is the string `"AbortError"` (`settlement.ts:113-121`). Neither holds here. `better-result`'s `TaggedError` sets `name` to the tag, so the name is `"LocalResolutionPinWriteAbortedError"` (checked by running it, not by reading it), and the engine aborts with the plain string `"SIGINT"` or `"SIGTERM"` as the reason (`engine.ts:229-234`). `settleThrown` therefore falls through to `settleBug`, and the run ends on a `CLI.INTERNAL_ERROR` envelope at exit 1 with no next actions.

Legacy did not do that. `toCliError` converts **any** thrown value into a clean cancellation whenever `runtime.signal.aborted` is true (`command-runner.ts:41-42`), so legacy `app deploy` reported a cancelled command. Before this fix v8 reported `SERVICE.LOCAL_STATE_WRITE_FAILED` at exit 2 with advice about write permissions — also wrong, but a structured command error rather than a crash report.

The correction is one line, and the same function already contains it: the pin **read** path calls `ctx.signal.throwIfAborted()` before throwing its own error (`deploy.ts:446`), which throws `signal.reason` itself and so satisfies the engine's first test, settling `CLI.ABORTED` at 130. Adding the identical call immediately before `throw fromLegacyCliError(…)` closes this and leaves `LocalResolutionPinSerializationError` settling as an internal error, which is the right settlement for a genuine bug.

Filed low because reaching it needs SIGINT inside the pin-write window of a first deploy. It is still a CLI that answers Ctrl-C with "internal error".

### FINAL-F1 — the rename, the legacy-error mapper and the compute-config path lost their only tests with the three deleted suites (should-fix)

`packages/cli/src/v8/service/errors.ts:42-93`, `:633-649`, `packages/cli/src/v8/service/target.ts:117-181`, `:554`, `:602`, against the deleted `packages/cli/tests/v8-service-build.test.ts`, `packages/cli/tests/v8-service-deploy.test.ts` and `packages/cli/tests/v8-service-logs.test.ts`.

Three pieces of shared code that the eleven surviving service commands still run were only ever tested through the three commands that are now gone. None of the three is broken — I read each path and it behaves exactly as it did before the removals. What is gone is any test that would notice if it stopped.

**The rename.** `renameAppCopy` (`errors.ts:42-47`) is the whole of R-S2c-1's error-copy surface. The only assertion on it lived in `v8-service-build.test.ts` (at `691566e`, `:171-193`): it ran a multi-target config through `service build` and asserted the serialized error contained neither the string "app target" nor the string "prisma-cli app ". That file is deleted. The function still changes what a user of the shipped commands reads. `ComputeConfigTargetUnknownError`'s summary is `Unknown app target "<target>"` (`packages/cli/src/lib/app/compute-config.ts:274`), and every sentence `formatDomainFailureFix` produces names `prisma-cli app domain retry` or `prisma-cli app domain show` (`packages/cli/src/lib/app/domain-guidance.ts:27-41`), reaching the user through `domainVerificationFailedError` (`errors.ts:388`). I searched all of `packages/cli/tests`: no v8 test asserts any renamed string. The scoreboard row that says the rename is complete now has nothing executable behind it.

**The legacy-error mapper.** `fromLegacyCliError` (`errors.ts:64-93`) produces six of the dispatch-1 error table's rows — `SERVICE.COMPUTE_CONFIG_INVALID`, `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN`, `SERVICE.PROJECT_AMBIGUOUS`, `SERVICE.PROJECT_SETUP_REQUIRED`, `SERVICE.LOCAL_STATE_STALE` and `SERVICE.LOCAL_PROJECT_WORKSPACE_MISMATCH` — all reachable from the eleven commands that resolve a project through `resolveServiceProjectContext` (`target.ts:246-262`). The only v8 test that drove it was `v8-service-deploy.test.ts`'s `SERVICE.PROJECT_SETUP_REQUIRED` case (at `691566e`, `:875-888`), which was also the only proof of the D1-R1-F3 fix that carries a legacy `fix` through alongside typed legacy actions. Grepping the surviving `packages/cli/tests/v8-*` files for those six codes returns nothing; every `SERVICE.*` code the surviving suites assert comes from a native builder in `errors.ts`.

**Compute-config resolution.** `resolveComputeManagementContext` (`target.ts:169-181`) runs on all eleven commands, through `resolveServiceReadState:554` and `resolveServiceDomainTarget:602`. It decides the project directory and the config-named service, which the D3-R1-F2 fix made rank above the remembered selection (`target.ts:580` and `:631`), and it is where `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` comes from when the positional names a target the config does not define, or names one with no config file present at all (`errors.ts:633-649`). That positional is documented as exactly this on every command that declares it (`show.ts:32-37`). At `691566e` the only v8 tests that wrote a `prisma.compute.*` file for a service command were in the three deleted suites (`v8-service-logs.test.ts:295` and `:328` among them); no surviving suite writes one, so none of this code runs under test. The one v8 test that still writes a compute config is `v8-agent.test.ts:496`, and it exercises the skills-lock walk-up, not this path.

One test closes all three at once: run `service show <unknown-target>` in a directory holding a two-target `prisma.compute.json` and assert the settled code is `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` with the summary `Unknown service target "<unknown-target>"`. That single run loads the config, selects a target, maps a legacy error through `fromLegacyCliError`, and renames the copy. A second short case — `service show web` where the config defines `web`, run with no scripted answers so a picker would fail it — restores the config-named-service coverage the D3-R1-F2 fix had.

### FINAL-F2 — the divergence file states an escalation count its own entries cannot be checked against (low)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:257` and `:579`, against `:255`, `:283`, `:391`, `:412`, `:528-543` and `:601`.

Two sentences carry the arithmetic. Line 257 says "six engine gaps went to the operator during this slice, three are now retired … and three are still open". Line 579 says the deploy and build drop "took the open escalations from six to four (the `service logs` shelve below then took them to three)".

The retired half checks out: three entries carry "(RETIRED — was an escalated engine gap)" in their headings, at `:255`, `:283` and `:412`. The open half does not. Only two entries carry "(ESCALATED — engine gap)": the `build logs` exit code at `:391` and the crash-recovery action at `:601`. The third open gap is the one where the `agent` group's help examples cannot carry a package runner (`:528-543`), and that entry is written as a group-wide question — "Worth settling once, group-wide, alongside the same question for every other ported group" — with no escalation marker of any kind. An operator counting escalations from the file's own headings finds two open, not three. The entry was unmarked before the rewrite as well, so this is not new; what is new is that the file now asserts a number that depends on counting it. Either mark that heading the way the other five are marked, or name the third open gap in one of the two counting sentences.

### FINAL-F3 — the ledger's AC scoreboard still describes the twenty-command slice (low)

`.drive/projects/prisma-cli-v8/reviews/code-review-s2c.md:16`, `:18` and `:22`.

The divergence file was rewritten for the new shape and this table was not, and this table is the first thing the PR author reads.

- Row 1 concludes "for 20 mounted in total. That is every in-scope command". The shipped map holds 26 paths, of which 17 belong to this slice (`packages/cli/src/v8/cli.ts:38-67`, asserted as an exact set at `packages/cli/tests/v8-bin.test.ts:277-307`).
- Row 3 supports "Deploy/promote/rollback/remove event sequences pinned" with "deploy pins the full phase sequence as an ordered array". The test that did so went with `v8-service-deploy.test.ts`, and `service deploy` is not a command.
- Row 7 records verification as "1012 cli tests" and the slice as "~16,000 added across 21 commits". At `HEAD` the cli suite is 965 tests across 72 files, which I ran.

### MERGE-F1 — refusing a credential that names no workspace matches legacy only when legacy could not reach the server, and neither that nor the defect it fixes is recorded (should-fix)

`packages/cli/src/v8/service/target.ts:91-109`, against `packages/cli/src/auth/operations.ts:133-192` and `:194-229`, with `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:100-116` and `packages/cli/src/v8/service/errors.ts:100-109`.

**The change itself is right, and it repairs a real defect.** I compared it against the legacy source rather than reasoning about it. The code `requireWorkspace` replaced was `const state = await readAuthState(ctx.env, ctx.signal); if (!state.workspace) throw workspaceRequiredError();`. With `PRISMA_SERVICE_TOKEN` set, `readAuthState` hands off to `readServiceTokenAuthState`, which decodes the token's claims and, finding no workspace, returns `{authenticated: false, workspace: null}` (`operations.ts:206-220`) — so legacy settled `SERVICE.WORKSPACE_REQUIRED` for exactly this case. The merged code throws the same error from the same builder. It is also strictly better than what this branch had immediately before the merge: `ctx.session()` composed an environment session as `workspaceId: serviceTokenWorkspaceId(token) ?? ""` (`6d80563:packages/cli/src/auth/credential-manager.ts:344`), so `requireWorkspace` returned `{id: "", name: ""}` and the run went on to filter projects by an empty workspace id and print a blank workspace name. That is the case the final reviewer flagged for the orchestrator at the end of these notes; the merge closes it.

**One difference from legacy survives, and it is not in the record.** Legacy asked the server before it looked at the claims. `readServiceTokenAuthState` calls `readCurrentPrincipalAuthState` first (`operations.ts:199-203`), which reads `GET /v1/me` — documented in the Management API types as "Returns the user, workspace, and credential represented by the current token" and typed `workspace: {id, name} | null`. When the server named a workspace, legacy used it and the command ran, whatever the token's own claims said. The merged path is local-only: `ActiveCredential.workspaceId` comes from `serviceTokenWorkspaceId(token)` and nothing else (`packages/cli/src/auth/credential-manager.ts:575-583`). So a service token that the platform associates with a workspace but whose JWT carries neither a `workspace_id` claim nor a `sub` of the form `workspace:<id>` used to work and is now refused. The claims derivation is otherwise wider than legacy's, not narrower — legacy read only the `sub` form (`operations.ts:59-65`) — so this is the one direction in which the new path resolves less.

**The refusal also hands the user advice that cannot clear it.** `workspaceRequiredError` offers one next action, "Sign in" → `auth login` (`errors.ts:106`). Under `PRISMA_SERVICE_TOKEN` that does not help: `createSession` writes the stored session but deliberately leaves the process pinned to the environment credential (`packages/cli/src/auth/credential-manager.ts:210-212` with `:411-413`), so the next run resolves the same environment token and fails the same way until the variable is unset. Legacy's advice had the same hole, so this is not a regression — but the merge is what routes this case here, and the case is now reachable where before it silently produced an empty workspace.

Two things to do, neither large. Record the change in the "The workspace comes from the engine, not the credential file" entry: today that entry ends "`SERVICE.WORKSPACE_REQUIRED` itself is unchanged and still raised when there is no session" (`:115-116`), which is no longer the whole truth — it is now also raised when there is a credential that names no workspace, and legacy's online lookup that sometimes avoided that is gone. And give the error a second next action naming `PRISMA_SERVICE_TOKEN`, so the environment case is told what will actually fix it.

### MERGE-F2 — the new refusal is untested, and the service harness has no way to seed the credential that reaches it (should-fix)

`packages/cli/src/v8/service/target.ts:101-104`, `packages/cli/src/v8/service/errors.ts:100-109`, `packages/cli/tests/v8-service-testkit.ts:320-362`.

`SERVICE.WORKSPACE_REQUIRED` is built in one place and asserted in none. A search of `packages/cli/src` and `packages/cli/tests` for the code returns exactly one hit, the builder itself. Both halves of the new condition are uncovered, for different reasons:

- `credential === null` cannot be reached by a command that declares `needs.credentials`, because the engine settles those runs first (`packages/cli-engine/src/execution/needs.ts:112-135`). `v8-service-session.test.ts:143-160` pins that, correctly, as `CLI.CREDENTIALS_REQUIRED`.
- `credential.workspaceId === undefined` is reachable in production — set `PRISMA_SERVICE_TOKEN` to a token with no workspace claim and every service command takes it — but no test can produce it. `makeServiceCli` seeds only `sessions` and `selectedWorkspaceId`, and a stored session's `workspaceId` is its key, so it is never absent. The seam exists one level down: `createTestCli` accepts an `environmentCredential` (`packages/cli-engine/src/testing.ts:94-97`), and seeding one with a claimless token would drive the new branch end to end.

This is the branch the merge added and the doc comment above it argues for. It should have a test, and adding the option to `ServiceCliOptions` is a few lines.

### MERGE-F3 — the credential seed still reaches the harness inside a spread, so the next rename is silently ignored the same way this one was (should-fix)

`packages/cli/tests/v8-service-testkit.ts:329-354`.

The seed rename that broke 104 tests on the first merge was accepted by the type checker rather than rejected, and the reason is still in the file. `makeServiceCli` passes the seed as `...(options.authenticated === false ? {} : { sessions: […], selectedWorkspaceId: workspace.id })`. TypeScript's excess-property check applies to the properties written directly in an object literal, not to properties that arrive through a spread. I confirmed this against the repo's own compiler rather than assuming it: with the same spec type, `take({ commands: {}, sessions: [], currentWorkspaceId: "ws_1" })` fails with TS2353, and the identical set of properties delivered through `...(cond ? {} : {…})` compiles clean.

So the harness will accept any future seed key the engine does not have, and an authenticated run will silently become an unauthenticated one. It fails eventually — a hundred tests go red at once — but it fails as a mass outage with no indication of the cause, which is what happened. Writing `sessions` and `selectedWorkspaceId` as ordinary properties, with `undefined` for the unauthenticated case, restores the compile-time check.

I checked the rest of the harness for the same class of problem and found none. The route table throws on an unrouted request rather than falling back (`v8-service-testkit.ts:116-119`), and the unauthenticated axis is genuinely unauthenticated: with no seed the in-memory manager pins to `{kind: "none"}` and returns `null`, and `createTestCli` only puts `PRISMA_SERVICE_TOKEN` into a run's environment when an `environmentCredential` is seeded (`packages/cli-engine/src/testing.ts:178-184`), which `makeServiceCli` never does.

### MERGE-F4 — the folded S8 slice says three open questions and lists four (low)

`.drive/projects/prisma-cli-v8/plan.md:93` with `:98`.

The fold is otherwise exact — I diffed the base's S8 section against the merged one and the only change is the added item. But the paragraph that introduces the list still reads "Three questions need answers that only S3 can give", and the new item is not one only S3 can give: it is a question for the engine and the API owners, which is what its own text says. Correct the count, and say where the fourth question's answer comes from.

### MERGE-F5 — the retired log-stream entry was renamed in one line and left stale in five (low)

`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md:420-436`, against `:100` and `packages/cli-engine/src/credential-manager.ts`.

The merge renamed one bullet in this section from `ctx.session()` to `ctx.activeCredential()` and appended a correcting paragraph at `:440`. The rename made the surrounding text worse rather than better:

- The section still opens "On the current base the only accessor that reaches a session command at all is `ctx.getCredentials()`" (`:420-422`) in the present tense, and the three bullets under it now describe a runtime that never existed on any branch — `ctx.activeCredential()` and `ctx.getCredentials()` were never present at the same time.
- The renamed bullet attributes a quotation to a file that no longer contains it: "The token is INTERNAL" was in `packages/cli-engine/src/credential-manager.ts:15` before the merge and is gone from the tree now.
- `:436` cross-references the section by its old title, "The workspace comes from the engine's session, not the credential file". The merge renamed that heading to "The workspace comes from the engine, not the credential file" (`:100`), so the only pointer into it is now broken.
- The correcting paragraph at `:440` says "The paragraph above describes a runtime that no longer exists". The paragraph immediately above it is the one about the test harness; the stale claims are two paragraphs further up.

The smallest fix is to put this section firmly in the past tense — it is already headed RETIRED — and to repair the cross-reference. Related and trivial: `packages/cli/tests/v8-service-session.test.ts:4` had the longer accessor name substituted into a wrapped comment without rewrapping, so that one line now runs well past the block around it.

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

### Slice review (principal engineer) — reviewer

**The seven open findings, verified in the code rather than from the fix reports. All seven are closed.**

- **D3-R1-F1 — closed.** All three places now name the trigger and neither claims the command works nor that it is broken. The error builder's comment (`packages/cli/src/v8/service/errors.ts:231-238`) says the answer is decided by the shape of the credential file, that today's `{tokens: […]}` shape makes the error unreachable, and that the auth rework flips it. The pinned test's comment (`packages/cli/tests/v8-service-logs.test.ts:592-598`) says the manager-plus-no-raw-token seed models the runtime that arrives with the rework, which is accurate: the harness defines `getCredentials` as the seeded value, so an unseeded raw token reproduces exactly the post-rework combination of a valid session and no readable token. The divergence entry (`parity-divergences-s2c.md:474-489`) says the same thing at length. The error and its test were kept, per the adjudication. **The entry is accurate about the trigger and wrong about the scope — SLICE-ENG-F1.**
- **D3-R1-F2 — closed.** The naming decision moved into `resolveServiceReadState`, which now computes `namedService = options.serviceName ?? compute.configServiceName` (`target.ts:606`) — the shipping precedence, `appName = appName ?? compute.configAppName` (`controllers/app.ts:1583`). This is strictly better than the old code even for the case the finding did not raise: the old `serviceNamed` counted the raw positional, which is a `prisma.compute.ts` target key, not a service name. `resolveExplicitDeployment` branches on `state.namedService !== undefined` (`logs.ts:41`), so a configured directory takes the scoped lookup and refuses a sibling's deployment. **No other caller changed.** `skipSelectionWhenUnnamed` is passed only by `logs.ts:193`; for every other caller the option is absent, so `selected` is computed by the same `resolveExistingServiceSelection` call with the same argument as before, and `show`, `open`, `list-deploys` and `release.ts` (promote / rollback / remove) are byte-identical in behavior. `show-deploy` does not use the function; the domain commands go through `resolveServiceDomainTarget`, untouched. The three new tests earn their keep — the compute-config scoping case fails with `SERVICE.DEPLOYMENT_NOT_FOUND` only because the config is read, and the bare-`--deployment` case runs with no scripted answers, so a picker would fail it.
- **D3-R1-F3 — closed.** Both streams attach their record fields: `build logs` carries `cursor`, `level`, `source` and `step` (`build/logs.ts:158-163`), `service logs` carries `byteStart` and `byteEnd` (`logs.ts:237`), and reported terminal records carry `cursor`, `code` and `retryable` on both. **Keeping the two losses was right.** The unframed normal close is genuinely unreachable: the engine has no event kind that is framed in json and silent in human mode, and inventing one is an engine change; the entry states the cost precisely (a build with no log records at all reports no cursor). The framed headers are forced by the rule that a handler must not read the output format, and the entry counts the extra frames (one for `build logs`, three for `service logs`). The record is honest about those two and overstated about the rest — SLICE-ENG-F2.
- **D3-R1-F4 — closed.** `buildLogs: buildLogsCommand` is in the platform family (`cli.ts:66`). Family membership is by object identity (`packages/cli-engine/src/execution/command-tree.ts:134-141`), so the key name does not matter and the docs base URL, when one is ever set, will reach it.
- **D3-R1-F5 — closed, and more thoroughly than asked.** `ndjsonStream` now cuts every record in half and omits the final newline (`v8-build-logs.test.ts:34-48`), so every test in the file drives both the partial-line buffer and the end-of-stream tail. A dedicated case feeds the body one character per chunk (`:139-165`). The first branch is proven by the records arriving at all; the second by the last record arriving despite no trailing newline.
- **D4-R1-F1 — closed.** The corrected entry (`parity-divergences-s2c.md:567-587`) matches the code: `writeCommandSuccess` calls `writeJsonSuccess` for every `--json` run and consults `renderJson` only for the `result` field (`packages/cli/src/shell/command-runner.ts:103-118`), and `writeJsonSuccess` prints the full envelope (`packages/cli/src/shell/output.ts:22-29`). The entry now says the missing serializer changed nothing on the wire and that `feedback`'s json surface differs only in the engine-global ways, which is right.
- **D4-R1-F2 — closed.** The drop is recorded (`parity-divergences-s2c.md:606-620`), including the engine constraint and the point the finding asked for: help says `agent install` while the same command's own next action says `npx -y @prisma/cli@latest agent status`. Two small inaccuracies in the entry: it cites the wrong ruling number (SLICE-ENG-F3), and it names `resolvePrismaCliPackageCommandSync` where the examples actually go through `resolvePrismaCliPackageCommandFormatterSync` (`packages/cli/src/shell/command-meta.ts:22-29`) — both real functions, but the formatter is the one in play.

**What the whole-slice reading adds.** Four findings, above. Only the first is about anything a user will hit; the rest are record accuracy and one coverage hole.

**The four parts are more consistent than four dispatches usually are.** Definition exports are `<group><Verb>Command` throughout, result types sit in a `results.ts` and human rendering in a `presentation.ts` for both groups that have more than one command, and the two session commands are the only `defineSessionCommand` users. Where the parts differ, the difference tracks a real difference in the work: `service logs` imports the service group's error builders and next-action helpers, while `build logs` and `feedback` declare their own — right, because those two are the only commands in their namespaces (`BUILD.*`, `FEEDBACK.*`) and importing `service/errors.ts` would give them `SERVICE.`-prefixed codes. The agent group has zero `ctx.report` calls, which looks like a progress gap on a command that shells out to a package manager, but legacy printed nothing there either (`controllers/agent.ts` writes to no output stream), so the port is faithful, not lazy.

**The one shared helper that grew a caller-specific option grew it correctly.** `resolveServiceReadState` now carries `skipSelectionWhenUnnamed` and returns `namedService` for `service logs` alone. The option is honestly named after what it does, the doc comment says which command needs it and why, and the branch is inert for every other caller. The two other cross-boundary changes are the same shape: `executeAppBuild`'s `io` tap and `removeApp`'s `progress` pass-through are both additive optional parameters, and the legacy call sites pass neither.

**`service deploy`, read fresh against `runSingleAppDeploy`.** The ordering matches position for position: exclusive project inputs, compute target, merged inputs, service directory, project directory, local pin, branch, port, region, requested-shape entrypoint check, project context, pin binding, framework, runtime, second entrypoint check, env vars, service listing, selection, the deploy line, customization, production protection, third entrypoint check after customization, entrypoint resolution, build settings, legacy-settings inspection, branch database, `deployApp`, then the two state writes. The three entrypoint assertions are not redundant — the first covers `--framework` before anything else runs, the second covers a detected framework, and the third covers a framework the user switched to at the customization prompt. `enforceProductionDeploy` reproduces `resolveCurrentProductionDeployment`'s fallback chain exactly (`liveDeploymentId` match, then any `live === true`, then the first deployment, then null) including the empty-list short-circuit, and the `--no-promote` bypass sits in the same place. `parseDeployPortMapping(String(runtime.port))` looks dropped but is not: its only early return is on a falsy string, and `String(number)` is never falsy, so `{http: runtime.port}` is the same value. Two differences I checked and accepted: the port passes `DEFAULT_HTTP_PORT` explicitly where legacy closed over it, and an unreadable local pin now reports `SERVICE.LOCAL_STATE_STALE` where legacy rethrew an unexpected read exception as a crash — the latter is commented at `deploy.ts:440-445`, keeps the abort case propagating, and is better behavior, though it means a permission error on `.prisma/local.json` is reported as a stale binding.

**Nothing in the slice parses a flag it never reads.** I traced all 60 declared flags and positionals to a consumption point, following one hop where a handler forwards `args`. Three declared values are unreachable rather than unread, and all three are already accounted for: `--no-db` cannot reach `branch-database.ts:73` because the engine's boolean flag is two-state (the recorded `--db` tri-state gap), and the `--timeout` and `--build-type` defaults make their in-code fallbacks dead. None is a defect.

**Not findings — for the orchestrator.**

- **The merge-down decision now has a bigger number attached to it.** SLICE-ENG-F1 is filed as a record correction because that is all this slice can do about it, but the underlying fact is an operator decision, not a wording one: on the base branch as it stands, merging down takes 13 of this slice's 20 commands from working to failing for any signed-in user without `PRISMA_SERVICE_TOKEN`. The orchestrator note about the held merge-down currently reads as a scheduling matter ("merge down once that stream is green"). It is a compatibility matter as well, and the fix is not in this slice's tree.
- **The two credential seams in the test harness cannot both be right.** `makeServiceCli` seeds the engine's credential manager for `needs.credentials` and every service test separately mocks `readAuthState` for the workspace. In production those are one file. That split is what makes the previous point invisible to the suite, and it is not a `rawTokenSeed` problem — `rawTokenSeed` is confined to the log-stream file and is honestly documented. Whatever seeding shape the merge-down adopts should join the two.
- **`prisma-cli` is spelled literally in three places in new v8 code** (`deploy-target.ts:350-352`, `branch-database.ts:251`) where `CLI_NAME` is the stated convention (`packages/cli/src/cli-name.ts:1-7`). No user sees a difference today, because `CLI_NAME` is `"prisma-cli"` and the `deploy-target.ts` strings are rewritten by `renameAppCopy` on the way out. It becomes a real defect the day the binary is renamed, which S2d is scheduled to decide. Sweep it then, with the rest of the naming work.

### Slice review (architect) — reviewer

**What was checked.** The whole slice as a shape rather than line by line: the mount map in `v8/cli.ts`; the three resolution seams (`service/target.ts`, `service/deploy-target.ts`, `service/release.ts`) with all 21 of their consumers and the exact symbols each imports; `errors.ts` and `results.ts` against the divergence file's code tables, by extracting every `SERVICE.*` / `BUILD.*` / `AGENT.*` / `FEEDBACK.*` string the slice emits and diffing it against the tables; `presentation.ts` in full; the kind, `needs` and argument surface of all 20 definitions; the seam of all 16 test files; and the engine itself — `commands.ts`, `context.ts`, `args.ts`, `command-snapshot.ts`, `run-summary.ts`, `settlement.ts`, `command-tree.ts`, `rendering.ts` — once per recorded gap. I read the code lens reviewer's four findings before writing; nothing here duplicates them.

**The layering held, and it is the best thing about the slice.** The v8 tree imports 17 distinct modules from `lib/` and rewrites almost none of them: `deploy-plan`, `env-vars`, `local-pin`, `project/setup`, `project/resolution`, `compute-config`, `read-branch`, `app/build`, `app/branch-database`, `domain-guidance`, `bun-project`, `git/local-branch` and the four `lib/agent/**` modules are all called, not copied. The only operation-layer changes are the two additive pass-throughs the contract allows (`executeAppBuild`'s `io`, `removeApp`'s `progress`).

I tested the duplication question the only way that settles it: for every block of copied-looking code in `v8/`, is the original **exported** and does it live in `lib/` rather than `controllers/`? The answer was no every time. `lib/app/production-deploy-gate.ts` exports one function, `enforceProductionDeployGate`, which takes the shell context and does its own `--yes` consent, so v8 cannot call it and reimplements the check; the pure live-deployment fallback inside it is private. `lib/app/branch-database-deploy.ts` exports only `maybeSetupBranchDatabase` plus two types — every one of the ten helpers `v8/service/branch-database.ts` reproduces is private to that file, and the primitives underneath it (`lib/app/branch-database`) *are* imported rather than copied. The same holds for `v8/agent/skills-cli.ts` against `controllers/agent.ts`, `v8/feedback.ts` against `controllers/feedback.ts`, and `forEachNdjsonRecord` against `controllers/build.ts`: private in every case. The one exported function that was copied instead of imported, `detectDeployFramework` (`controllers/app.ts:4116`, inlined at `deploy-target.ts:691-709`), lives in `controllers/`, and importing it would pull the legacy controller import graph into `v8/` — the same reason `target.ts` gives for its own copies.

So the shape is right: every duplicate in this slice is a copy of something that dies with the shell, not a fork of something that survives it. That was the main risk in a 16,000-line port and it did not happen. The cost is bounded and known — two copies of each behavior until S2d, which is what the D1 note already accepted.

The exceptions are small and countable. Beyond the two the ledger already records (`target.ts` copying private controller helpers, and `listWorkspaceProjects`), the slice added two duplications of its own: `listWorkspaceProjects` is now written **twice inside v8** (`target.ts:228-255` and `deploy.ts:360-387`, identical but for taking a workspace instead of a workspace id), and the six-line state-store opener is on its third copy (`target.ts:82-91`, `agent/status.ts:21-28`, `v8/auth/agent-setup-tip.ts:44-51`). Neither is worth a finding by itself; together they say the group has not formed the habit of looking for the helper before writing one. There is exactly one real bypass of the operation layer, and it is SLICE-ARCH-F1.

**`target.ts` is a coherent seam, with one accretion I would leave alone.** Its exports fall into three clean layers: primitives (`openServiceStateStore`, `requireWorkspace`, `readServiceEnvOverride`, `serviceProvider`, `listServices`, `resolveComputeTarget`), projections (`toServiceSummary`, `toServiceDomainSummary`, `applyLiveDeploymentHint`, `sortDeploymentsNewestFirst`, `normalizeDomainHostname`), and two composed flows (`resolveServiceReadState` for the read and release commands, `resolveServiceDomainTarget` for the five domain commands). `deploy` uses the primitives and composes its own flow in `deploy-target.ts`, because its resolution genuinely differs — it may create a Project, write a pin and name a service that does not exist yet. Three flows over one set of primitives is the right shape for this group, not accretion.

The one option that is a special case is `skipSelectionWhenUnnamed`, passed by `service logs` alone, together with the `namedService` field that only `logs` reads. I considered filing it and decided against: the alternative is `logs` calling the four primitives itself, which would duplicate the compute-context / project-context / listing sequence for real. The boolean is the cheaper of the two. It is worth watching, because a second per-command option on that function would tip it.

The genuine unevenness is on the argument surface, not the resolution surface. `domain-shared.ts` exists precisely to share the `--service` / `--project` / `[service]` block across the domain commands, and then seven other commands declare the same block inline — nine copies of the identical `--project` brief across the group. They all agree today; I checked. A group that has a helper for exactly this and uses it in a third of the places gives the next porting slice no answer to "how do we declare a target?".

**Error and result modelling is consistent inside the slice; the pain is at its edges.** Every errored settlement in the group is a `CliStructuredError` built in one of two ways — a native `SERVICE.*` builder in `errors.ts`, or `fromLegacyCliError` prefixing `SERVICE.` onto a legacy flat code — and the two never disagree about a code. The apparent duplicates are faithful: `frameworkNotDetectedError` / `deployFrameworkNotDetectedError` and `entrypointUnsupportedError` / `deployEntrypointUnsupportedError` share a code and differ in copy because legacy's copy differed per command. `results.ts` is shaped for its consumers — `service | null` on the read results because a project can have no service, non-null on `open` and the domain target because those commands cannot proceed without one.

Three things will hurt at consolidation, and only the first is this slice's to fix.

- `fromLegacyCliError` prefixes `SERVICE.` onto **whatever** code the legacy error carries, including project-domain codes. That is what R-S2b-5 asks for and it is recorded, but it means the mapping is implicit: `SERVICE.PROJECT_AMBIGUOUS`, `SERVICE.PROJECT_CREATE_FAILED`, `SERVICE.LOCAL_PROJECT_WORKSPACE_MISMATCH` and `SERVICE.COMPUTE_CONFIG_TARGET_REQUIRED` appear in the divergence tables and nowhere in the source, so the table is the only inventory of them. Whoever consolidates S2b and S2c has to derive that list from two files rather than read it.
- `toEngineNextAction` (`errors.ts:19-27`) does **not** run typed legacy `nextActions` through `renameAppCopy`, unlike every prose field beside it. It is safe today — I traced every reachable legacy error with typed actions and the only one is `PROJECT_SETUP_REQUIRED`, whose commands are `project` commands plus `prisma-cli <commandName> --project …` with `commandName` already the v8 spelling. It stops being safe the moment a `lib/app/**` error with typed actions becomes reachable, and `production-deploy-gate.ts:154-172` is exactly such an error (its actions say `prisma-cli app deploy --prod`) that v8 currently sidesteps by rebuilding the error natively.
- `errors.ts` is 1,185 lines and 56 builders in one file, keyed only by naming convention. That is manageable now and will not be after `PROJECT.*`, `POSTGRES.*` and `BUCKET.*` join it in S2d.

**Command kinds are right, including the ones the contract singles out.** The five long-running operations (`deploy`, `promote`, `rollback`, `remove`, `domain wait`) are result commands emitting `step-started` / `step-finished`, `progress` and `status`, exactly as R-S2c-3 asks; they all have a real result to return, so a session would have been wrong. The two streams are session commands per R-S2c-2, which is right for the same reason in reverse — neither has a result, and the event stream is the json surface. `service build` is a result command with no `needs.credentials` and no `ctx.api` touch, per R-S2c-5. `server-command` is correctly unused. The one place the kind choice bites is `build logs`: a session cannot settle exit 1, which is engine gap 3 and correctly escalated rather than worked around.

R-S2c-3 also says the polling "drives events through the injectable clock". There is no clock on `CommandContext`, so `domain wait` polls with `setTimeout` and `Date.now()` and the tests set `PRISMA_CLI_DOMAIN_WAIT_POLL_MS: "1"` to make real time cheap. The continuation brief records this as escalation 5, "accepted for now"; it is not in the divergence file, which is correct — it changes nothing a user can see.

**Test seams: chosen well everywhere except the one command that matters most.** Eleven of the sixteen files fake `ctx.api` and let the real `createAppProvider` mapping run — that is the right level, and `releaseRoutes` goes further by modelling the compute SDK's own start / stop / poll / delete HTTP flow so `promote`, `rollback` and `remove` exercise the SDK too. `service logs` mocks only `streamLogs`, the one SDK entry point no HTTP fake reaches, and leaves resolution real. `agent` fakes `execa` at the module seam, which is the process boundary and the only sane choice. `feedback` runs a loopback server because a session command gets no HTTP seam from the engine, and its own file comment says so. Those are all seams picked for a reason.

`service deploy` is the exception, and it is the command with the most behavior and the highest cost of being wrong. Mocking the `createAppProvider` factory takes out nine methods, eight of which are ordinary request and response mapping that the group's own testkit already knows how to serve, and `service deploy` is the only production caller of all nine — so nothing anywhere covers them. That is SLICE-ARCH-F3. It is the difference between "we cannot fake the SDK upload" (true, and the dispatch-2 note's actual argument) and "we cannot fake the provider" (not true, and what the mock does).

**What this hands S2d.** Easier than it could have been, with a short cleanup list. The commander shell's *behavior* is fully duplicated for these 20 commands, so deleting `src/commands/**`, `src/controllers/**` and `src/presenters/**` takes nothing v8 needs — every dependency runs the other way, into `lib/`. What does have to move rather than die is `src/shell/`: v8 imports `shell/errors` (`CliError`, the type the whole operation layer throws), `shell/runtime` (the legacy `CommandContext` type), `shell/next-actions` and `shell/command-arguments`. Those four are not commander machinery; they are operation-layer types living in a directory named after the thing being deleted, and `v8/auth/**` already depends on them, so this predates the slice. Naming that in S2d's contract now would save a surprise later.

The list of things S2d should sweep, all small: two identical `as unknown as LegacyCommandContext` casts fabricating a fake shell context (`target.ts:113-117`, `deploy.ts:354-358`) — both correct today and both compile-time lies that stop being honest when the shell type goes; the third copy of the state-store opener; the second copy of `listWorkspaceProjects`; the nine inline copies of the domain arg block; and `target.ts`'s ~250 lines of copied private controller helpers, whose originals die with the shell. The ruled decision to keep the legacy fixture tests is right and is the single biggest thing S2d inherits, but it is a deletion, not a migration.

**The six engine gaps are one missing idea, not six holes.** Read together they are all the same shape: the engine's contract between a command and itself is declared once, statically, and there is no run-time channel in either direction. Everything a command needs at run time that is not "declare up front" or "return a result and emit events" has no way across.

Four of the six are the outward direction — the command cannot contribute a value to something the engine composes and owns the rendering of. A session command cannot contribute an exit code to the settlement (`build logs`, gap 3; `commands.ts:280-284` returns `Result<void>`, and `command-tree.ts:72-84` confines documented codes to 4–99). The bin cannot contribute next actions to an internal-error envelope (`settlement.ts:175-190` writes `nextActions: []` literally, and `onSettled` fires afterwards with no error object — the crash-recovery gap). A handler cannot contribute a validator to the prompt loop the engine runs (`context.ts` gives `prompt.text` only `placeholder` and `default` — the Project-name gap). A definition cannot contribute an example computed at run time (`commands.ts:30-43`, `help.examples` is a static `readonly string[]` — the `agent` help gap).

Two are the inward direction — the engine holds a fact and does not hand it to the handler. The token exists and `ctx.getCredentials()` is documented as staged for deletion with no replacement (`context.ts:41-48` — the log-stream gap). And the flag-source fact the `--db` tri-state needs is already computed at parse time, complete with `--no-<flag>` handling, and routed to telemetry instead of to the handler (SLICE-ARCH-F4). The same direction explains the two items the file records as consequences rather than gaps: the handler cannot see interactivity (so the `--db` advice fires on a declined answer as well as an unaskable one), and the handler cannot see the output format (so the stream headers are framed under `--json`).

That is the judgement worth carrying to the operator: this is not six unrelated engine asks that can be prioritised against each other. It is one design property with two faces, and a decision about the property answers most of them at once. An inbound decision — put the invocation facts the engine already computes on `CommandContext` (flag source, interactivity, a token or a pre-authenticated stream client, the API base URL) — closes gaps 1 and 4 and both recorded consequences, and is small because nothing new has to be computed. An outbound decision — one contribution-point pattern, a callback the engine calls at the moment it composes a thing — closes gaps 2, 3, 5 and 6 with one mechanism applied at four call sites. Sequenced that way the six are two changes, not six.

**Not findings — for the orchestrator.**

- **The AC scoreboard still reads as it did before the last two commits.** It records the divergence file as "NOT met" on the D3 and D4 surfaces, citing five findings that `8e3b181` and `f7b3635` addressed, and none of the seven D3/D4 findings carries the "CLOSED in" marker the D1 and D2 entries use. The code lens reviewer has verified all seven closed. Whoever opens the PR reads this file; it should not still say the file is incomplete.
- **The cross-slice error-code question is now overdue, not just open.** It has been raised in three separate round notes (D1 round 1, D1 round 2, and implicitly here) and never ruled. S2d consolidates the divergence files, and the consolidation is where a `SERVICE.PROJECT_NOT_FOUND` and a `PROJECT.PROJECT_NOT_FOUND` for one failure become a user-facing inconsistency rather than a table entry. It wants a ruling before S2d starts, not during it.
- **The engine's own gap set deserves one conversation, not six tickets.** See the judgement above. If the operator would find it useful, the two decisions could be written up as a single short engine amendment for S3 rather than six escalations carried forward — the individual entries are all recorded accurately (with the one qualification in SLICE-ARCH-F4) and would survive being restated that way.

### Slice review round 2 (verification) — reviewer

**Verdict: NOT SATISFIED.** All eight findings are closed, verified in the code rather than accepted from the fix report. One new low finding, SLICE-R2-F1, is open: the SLICE-ARCH-F1 fix turns a Ctrl-C during the local Project binding write into a `CLI.INTERNAL_ERROR` envelope.

- **SLICE-ENG-F1 — closed.** The count is 13, and 13 is right.
- **SLICE-ENG-F2 — closed.** The entry now lists exactly what the code emits.
- **SLICE-ENG-F3 — closed.** All three citations corrected; the rest of the file's citations check out.
- **SLICE-ENG-F4 — closed.** One shipped map, an exact-set assertion over it, and every test harness derived from it.
- **SLICE-ARCH-F1 — closed.** The mapper is called; summary, both `why` sentences, `fix` and `meta` are back. See SLICE-R2-F1 for the one consequence the fix did not check.
- **SLICE-ARCH-F2 — closed.** All nine now end on a past-tense `ok` line; the three that were already right did not regress.
- **SLICE-ARCH-F3 — closed.** The provider factory mock is gone and the coverage is real — proven by mutation, not by reading.
- **SLICE-ARCH-F4 — closed.** I verified the engine claim in the engine before accepting the rewrite.

**Verification state.** At `0459208`: `pnpm --filter @prisma/cli test` green at 1019, `pnpm --filter @prisma/cli-engine test` green at 234, `pnpm typecheck` green, `pnpm lint` exits 0. The one file I mutated (`packages/cli/src/lib/app/app-provider.ts`) was restored to `HEAD` and the tree is clean.

**SLICE-ARCH-F2, command by command.** `presentation.ts` gains a `completed()` helper (`tone: "ok"`) beside the existing `title()` (`tone: "info"`), and all nine now use it: `service build` ("Built the local service artifact."), `deploy` with no target ("Deployed 2 services."), `promote` ("Promoted dep_1 to production."), `rollback` ("Rolled hello-world back to dep_1."), `remove` ("Removed hello-world and every deployment it owned."), `domain add` ("Added shop.acme.com to hello-world."), `domain remove`, `domain retry`, and `open` ("Opened the live URL for the selected service."). Every one is pinned by a `presentedSummary` assertion on tone and text; the tests that needed it gained `isTty: {stdout: true}`, which is required because the human presentation is only materialized outside json format (`command-context.ts:33-54`, `shared-flags.ts:103-104`) and which cannot turn a run interactive, because interactivity keys off stdin alone (`shared-flags.ts:150-152`). The three that were already right are untouched in substance: `service deploy` and `service domain wait` were refactored into the same helper with the identical block, and `feedback` was not touched. The six remaining `title()` callers are all reads — `show`, `list-deploys`, `show-deploy`, `domain show`, and the two branch exceptions.

**The two branch exceptions are genuine reads.** `service open` keeps `info` only when `result.opened` is false, which is the case where `ctx.openUrl` did not open anything; the text also moved to the past tense ("Resolved the live URL…"), so it no longer reads as in progress either. `domain add` keeps `info` only when `result.existing` is true, which is the API answering that the hostname was already on this service — nothing was added. Both are pinned.

**The `alreadyLive` argument is right and covered.** `promote.ts:74` and `rollback.ts:77` already computed `alreadyLive`, and both already skip the SDK call under `if (!alreadyLive)`, so the old "Promoting a deployment to production." line was claiming an action that provably did not happen. The argument is now threaded to the presentation, which says "dep_2 was already live for hello-world." instead. Promote's already-live case was already tested and gained the summary assertion; rollback had no already-live case at all and gained one, with the warn diagnostic and `events: []` asserted beside it.

**SLICE-ARCH-F1.** `deploy.ts:500-503` is now `throw fromLegacyCliError(projectDirectoryBindingErrorToCliError(bound.error))`, exactly the line the finding prescribed. `setup.ts` is unchanged, so `LocalResolutionPinSerializationError`, `LocalResolutionPinWriteAbortedError` and `LocalResolutionPinGitignoreUpdateAbortedError` still re-throw. `fromLegacyCliError` carries `meta` when it is non-empty (`errors.ts:86`) and turns `fix` into a user-choice action (`:65`), so `pinPath`/`gitignorePath` plus `operation` and the legacy fix advice are all restored, and the two distinct `why` sentences are told apart again. The code is unchanged at `SERVICE.LOCAL_STATE_WRITE_FAILED` and is now in the dispatch-2 mapping table. A new test injects the failure for real — it writes a *file* where `.prisma` belongs — and pins summary, `why`, `meta.pinPath`, `meta.operation` and the rewritten `service deploy --project` action. The one thing the fix did not weigh is SLICE-R2-F1.

**SLICE-ARCH-F3, checked by breaking the code.** `vi.mock("../src/lib/app/app-provider", …)` is gone. The only remaining fake is a `ComputeClient` subclass overriding `deploy` — the compute-SDK upload the dispatch-2 note actually argued for — so `deployApp`'s own request assembly and response mapping run for real, and so do the other eight: `createProject`, `resolveBranch`, `createBranchDatabase`, `deleteBranchDatabase`, `listEnvironmentVariables`, `createEnvironmentVariable`, `updateEnvironmentVariable` and `deleteEnvironmentVariable`, each through a route in `deployRoutes`. The routes are not decorative: `fakeManagementClient` throws on an unrouted request (`v8-service-testkit.ts:116-119`), so every one of those calls provably reaches the wire. Two new tests exist purely to reach the two env-var methods that had no other caller (`PATCH` for an existing branch `DIRECT_URL`, `DELETE` for a stale one). The coverage is real rather than nominal: I replaced `liveDeploymentId: deployed.promoted ? deployed.deploymentId : deployed.previousDeploymentId` with the plain newest-deployment expression (`app-provider.ts:545-547`) and ran the suite — `v8-service-deploy.test.ts:473` fails, `expected 'dep_new' to be 'dep_old'`, and so does the provider's own `app-provider.test.ts:511`. I restored the file from `HEAD`.

**SLICE-ENG-F4.** `MOUNTED_COMMANDS` in `cli.ts:41-75` is now the shipped map and `buildCli` passes it straight through (`:128`), so there is one copy. `v8-bin.test.ts:277-308` asserts `Object.keys(MOUNTED_COMMANDS).sort()` against a hand-written list of all 29 paths with `toEqual`, so a missing mount and an unexpected mount both fail — and because that list is written out by hand it is a second, independent statement of the truth, which is the point. A second new test runs `--help` for every mounted path through the real tree. The testkit derives rather than restates: `mountedCommands(groups)` filters the shipped map, `SERVICE_COMMANDS` is `mountedCommands(["service", "build"])`, and the agent and feedback suites call it too, so the three duplicate maps the finding named are gone.

**SLICE-ENG-F2.** Both streams now attach `kind`, and `service logs` attaches `details` when the record has one. Read against the SDK's own types that is now the whole record: `TerminalRecord` is `{type, kind, code, message, retryable, cursor, details?}` and the port carries every field except `type`, with `message` in `line`; `build logs`'s terminal record has no `details` and the entry says so. Pinned both ways — a terminal error with `details` and one without.

**SLICE-ENG-F3.** `:157` and `:370` now cite ruling 8 and, at `:157`, say plainly that ruling 8 names `--trace` and not `--verbose` — which is the wider-rule problem the finding raised, not just the number. The `agent` examples entry now cites the operator ruling of 2026-08-09 on `HelpSpec.examples`, and that file says exactly what the entry says it says (`engine-interface-draft.ts:787-790`). I re-checked every remaining rule citation in the file: `R-S2c-1` at `:12`, `:186`, `:382`, `:589`, `R-S2c-2` at `:391`, and `R-S2b-6` at `:111` and `:279` all name the rule the entry means.

**SLICE-ARCH-F4, verified in the engine.** `explicitFlagKeys` scans argv for flag names and lines 77-82 mark the base flag on a `--no-<flag>` token; `buildCommandSnapshot` labels each declared flag `"cli"` or `"default"`. The snapshot is built once (`engine.ts:328`) and read in exactly one other place — the `onSettled` hook (`:303-310`) — so it genuinely never reaches `CommandContext`. Combined with the parsed boolean, the three states are distinguishable whichever way the flag's default falls. The rewritten entry says that and asks for an accessor rather than a new flag type. Accurate.

**SLICE-ENG-F1 — I counted the 13 myself.** Every service command reaches `readAuthState` through exactly one path, and there are only three: `deploy.ts:466` calls `requireWorkspace` directly; `show`, `open`, `list-deploys`, `logs`, `promote`, `rollback` and `remove` reach it through `resolveServiceReadState` → `resolveServiceProjectContext:267` (promote, rollback and remove via `resolveServiceReleaseState`, `release.ts:35`); the five `domain` commands reach it through `resolveServiceDomainTarget:651`. That is 8 + 5 = 13. `show-deploy` is the fourth caller and swallows the failure — `requireWorkspace(ctx).then(id, () => null)` at `show-deploy.ts:52-55` — so it degrades to a missing live-deployment hint. `service build` declares no `needs` and reads no auth state; `build logs` declares `needs.credentials` but never touches the auth file, so the credential manager still serves it; `agent *` and `feedback` do neither. A repository-wide grep for `readAuthState` under `src/v8/` returns those four service call sites and the three `auth` commands, and nothing else. 13 is right.

**The two deliberate deviations — both correct.**

- **`LEGACY_CLI_NAME` for the three `deploy-target.ts` strings.** The reasoning holds and I checked the mechanism rather than the argument. Those strings are `nextSteps` on a legacy `CliError` that `fromLegacyCliError` then filters with `step.startsWith("prisma-cli ")` (`errors.ts:72`) before rewriting each survivor through `renameAppCopy` and `toV8CommandLine`. Substituting `CLI_NAME` would make the producer and the filter disagree the moment the binary is renamed, and the filter fails silently — the three actions would simply stop appearing. Keeping the legacy spelling on the input side and letting the rewriter produce `CLI_NAME` on the output side is the right place to draw the line, and it is drawn consistently: the constant is defined once (`errors.ts:34`), used at all five places that produce or match the legacy prefix, and no literal `prisma-cli ` remains anywhere under `src/v8/`. The companion change is the same judgement from the other side — `branch-database.ts:251` is plain advice that no rewriter touches, so it correctly became `CLI_NAME`. Every legacy `nextSteps` producer in `lib/` writes the literal, so nothing else can fall through the filter. One note, not a finding: `LEGACY_CLI_NAME` is a repo-wide fact about legacy copy that now lives in the service group's `errors.ts`; `cli-name.ts` is its natural home when S2d does the naming sweep.
- **The human-summary divergence bullet belongs.** Standing ruling 4 is a testing rule — it says assertions target the envelope, presented data, events and exit codes, and that a single golden suite pins rendering globally. It does not say user-visible differences from the shipping CLI go unrecorded, and standing ruling 10 says the opposite: divergences are enumerated for operator review, not discovered. This is a real difference on every human-mode run of twelve commands, and the bullet states it accurately — legacy did open each block with a present-progressive title, and the example it quotes is verbatim (`presenters/app.ts:763`, "Removing the selected app."). One bullet in the existing human-output section is the proportionate form; a per-command table would not be.

**Observations, not findings.**

- The new per-command summary assertions pin the exact sentence, not just the tone. They are assertions on presented data, which standing ruling 4 allows, and the tone is the thing the finding was about — but a copy edit to any of those nine lines now breaks a test in a different file. Worth knowing before the next copy pass.
- `mountedCommands(["agent"])` would return an empty map on a typo'd group name, and `v8-agent.test.ts`'s `needs.credentials` loop would then pass over nothing. Every other test in that file runs a real command through the same map and would fail loudly, so the risk is contained.

### Final review (post-removal) — reviewer

**Verdict: NOT SATISFIED.** One should-fix and two low findings, all three about what the reshaping left behind rather than about the seventeen commands themselves. Nothing I found argues against any of the three removals.

**What was checked.** `git diff 691566e..HEAD` in full, and `git diff 9ffbb01..HEAD` for the shape of what remains. I did not re-read the seventeen surviving commands line by line; the four questions the brief asks were the whole scope. I ran `pnpm --filter @prisma/cli test` myself at `HEAD`: 965 tests across 72 files, green.

**Question 1 — nothing dangling in the code, and the sweep was wide.** A search of `packages/`, `docs/` and the repository root for `service deploy`, `service build`, `service logs`, `service.deploy`, `service.build` and `service.logs` returns exactly six hits, all of them comments in surviving tests explaining why an action is absent (`v8-service-show.test.ts:87`, `v8-service-list-deploys.test.ts:60`, `v8-service-open.test.ts:117`, `v8-service-remove.test.ts:46`, `v8-service-rollback.test.ts:188`, `v8-service-domain.test.ts:174`). No help text, no example, no error copy and no next action names a removed command. The legacy shell's own `app deploy` / `app build` / `app logs` copy is untouched, which is right — it still ships those commands.

Every error builder left in `errors.ts` has exactly one live caller; I checked all twenty-six by name. Every `SERVICE.*` code the source can emit — twenty-five of them, extracted from the source rather than from the record — appears in the divergence file's tables or its prose. The two `SERVICE.DEPLOYMENT_NOT_FOUND` variants that only `service logs` raised are gone and the two that survive are still raised, by `show-deploy.ts:43` and `release.ts:70`. `SERVICE.COMPUTE_CONFIG_TARGET_REQUIRED` was correctly deleted from the table: the only caller of `resolveComputeTarget` now passes `targetOptional: true` (`target.ts:174`), so `ComputeConfigTargetRequiredError` never converts to a settled error any more. `SERVICE.LOCAL_STATE_STALE` was correctly kept: it is still reachable from every read command through `projectResolutionErrorToCliError` (`packages/cli/src/lib/project/resolution.ts:288`, `:722-723`). The `io` tap added to `lib/app/build.ts` for `service build` is reverted byte for byte against `9ffbb01`, and the only operation-layer change the slice still carries is `removeApp`'s `progress` pass-through, which `service remove` needs.

One loose end, too small to file. `listServices` (`target.ts:304`) lost its last importer when `deploy.ts` and `logs.ts` went and is now used only inside its own file, while the same commits took `export` off `readServiceEnvOverride`, `resolveComputeTarget` and the two environment-variable constants for exactly that reason. The testkit's `SERVICE_COMMANDS` (`v8-service-testkit.ts:299`) and `SERVICE_GROUPS` (`:279`) are the same case — their only outside importer was `v8-service-build.test.ts`. Three `export` keywords, no dead code behind any of them. `renameAppCopy`, `resolveServiceProjectContext` and `resolveExistingServiceSelection` are exported without importers too, but they were already that way before the removals.

**Question 2 — the surviving code reads as designed, and the `resolveServiceReadState` simplification is honest.** The option and the field both went, and the remaining call is behaviour-identical: the old code computed `namedService = options.serviceName ?? compute.configServiceName` and passed it to `resolveExistingServiceSelection`; the new code passes the same expression inline (`target.ts:575-581`). `skipSelectionWhenUnnamed` was only ever passed by `logs.ts:193` and `namedService` only ever read by `logs.ts:41`, so no surviving command took either branch. The same is true of the `preloaded` option on `resolveComputeTarget` and of `computeTargetDirectory`, both of which had no caller left. `getCredentials` came off `ServiceContext` because nothing asks for it. `presentation.ts` and `results.ts` read as a group that lost two commands rather than as a group with holes in it: the `completed()` and `title()` helpers still have callers of both kinds, `deploymentNextActions` is still shared by promote and rollback, and the result types that went were the deploy-only ones.

**Question 3 — the record is accurate, with the one exception in FINAL-F2.** I verified the counts against the code rather than reading them. Seventeen commands is right: `MOUNTED_COMMANDS` holds twenty-six paths, nine of which are S2a's `auth` and `telemetry`, and `v8-bin.test.ts:277` asserts that exact set. The ten removed next actions are right — six in `errors.ts` (`noDeploymentsError`, `releaseTargetRequiredError`, `noPreviousDeploymentError`, `domainTargetRequiredError`, `selectedServiceMissingError`, and the domain-add 422 branch of `domainCommandError`), three in `presentation.ts` (`show`, `list-deploys`, `remove`) and one in `list-deploys.ts`. The claim that all ten are pinned is right: each is covered by an exact-set assertion on the surviving actions, added in the same commit. The shelve-versus-drop distinction holds throughout — `service logs` is described as returning in S8 and `deploy` and `build` as not returning, and the S8 slice entry and the transport design exist. The list of what went with `service logs` matches what the diff removed, item for item. The "workspace comes from the engine's session" entry checks out where it matters most: the credential manager's reader does adopt the legacy `{tokens: […]}` shape into sessions (`packages/cli/src/auth/legacy-state.ts:19-40`), which is what makes the eleven surviving commands survive the merge-down, and the arithmetic of "of the 13 that broke, 11 still ship" is correct. Three retired escalations are correctly labelled; the third open one is not, which is FINAL-F2.

**Question 4 — the matrix still holds; the coverage that went is shared code, which is FINAL-F1.** Every surviving command still has success, errored, json envelope and unauthenticated cases; the picker is still proven once, on `service show`; both consent points still have grant, decline, non-interactive, wrong-token and `--yes` cases. No survivor lost an axis, because each of the three deleted commands owned its own suite. Removing the deploy next actions was pinned rather than merely done, in all ten places. What did weaken is not per command: the rename surface, the legacy-error mapper and the compute-config resolution were only ever driven by the deleted suites, and all three still run on the eleven shipped service commands.

**Not findings — for the orchestrator.**

- **The dispatch plan was not updated with the contract.** `plans/s2c-services.md:7,12,17` still hands dispatches the `service build|deploy|logs` scope. The brief rules the contract's stale scope out of bounds because S2d consolidates it; the plan is the same class of document and I am flagging it for the same treatment rather than filing it.
- **A service token with no workspace claim now resolves to an empty workspace id.** `requireWorkspace` takes `session.workspaceId` (`target.ts:88-99`), and the manager composes an environment session as `workspaceId: serviceTokenWorkspaceId(token) ?? ""` (`packages/cli/src/auth/credential-manager.ts:344`). Where the legacy reader asked the Management API for the workspace behind `PRISMA_SERVICE_TOKEN`, the new path derives it from the token's own claims and falls back to an empty string. The divergence entry records the name half of this honestly ("presents as its workspace id") and does not reach the case where there is no derivable id at all. `packages/cli/src/auth/**` is a hard boundary for this slice and is untouched by it, so this is the auth stream's to answer, not a finding here.
- **FINAL-F3 is a section I did not edit deliberately.** The scoreboard is reviewer-maintained, but the brief scoped my write to appending this note, so I filed the correction rather than making it.

### Merge review (rev-6 credential surface) — reviewer

**Verdict: NOT SATISFIED.** Three should-fix and two low findings. None of them says the merge got the adaptation wrong. The one change that mattered — how `requireWorkspace` treats a credential that names no workspace — is correct, and it closes a defect this branch was carrying before the merge. What is missing is the record around it, a test for the branch it added, and a harness weakness the merge walked into and left in place.

**What was checked.** `git log --oneline --merges -2` and `git diff 6d80563...HEAD` in full, plus `git diff fec6678..HEAD` to see the merge from the base's side. I ran all four checks at `HEAD` myself: `pnpm --filter @prisma/cli test` is 987 tests across 73 files, `pnpm --filter @prisma/cli-engine test` is 256 tests across 14 files (the brief's 234 was the pre-merge count; the base brought more), `pnpm typecheck` and `pnpm lint` both clean. Outside `packages/cli/src/v8/auth/**`, the merge touched exactly two source files: `service/target.ts` and `v8/runtime.ts`, the latter only to drop the deleted `getCredentials` wiring.

**Question 1 — the new refusal, measured against the legacy source.** The answer is in MERGE-F1 and it has three parts. On the path legacy actually took offline, the behaviour is identical: `readServiceTokenAuthState` decoded a service token's claims, found no workspace, returned signed-out state, and the old `requireWorkspace` threw `SERVICE.WORKSPACE_REQUIRED` — which is the same error the merged code throws from the same builder. Against the state of this branch one commit earlier, the merge is a repair: `ctx.session()` gave an environment token with no workspace claim an empty-string workspace id, and the run continued with it. One difference from legacy remains: legacy asked `GET /v1/me` before it read the claims and used the workspace the server named, so a token the platform can place but whose JWT cannot is now refused where it used to work. That difference entered at `691566e`, not at this merge, but the merge is the first commit at which the "no workspace" case has a behaviour of its own, and the divergence file still describes `SERVICE.WORKSPACE_REQUIRED` as firing only when there is no session.

**Question 2 — nothing was dropped and nothing was applied twice.** The three command removals hold: `src/v8/service/` has no `deploy.ts`, `build.ts` or `logs.ts`, `MOUNTED_COMMANDS` has no mount for them, and a search of `packages/cli/src/v8` for `service deploy`, `service build` and `service logs` returns nothing. The removed next actions are still removed. The restored coverage from `6d80563` is byte-identical at `HEAD` — `git diff 6d80563 HEAD` over `v8-service-compute-config.test.ts`, `v8-service-remove.test.ts` and `v8-service-domain.test.ts` is empty. The `v8-bin.test.ts` conflict was resolved correctly in both directions: the base's deletion of the `makeGetCredentials` tests and the `FileTokenStorage` module mock survived, and the branch's exact-set mount assertion and per-path help run sit on top of them; the assertion's 26 paths match `MOUNTED_COMMANDS` exactly and the test passes. Coming from the other side, the base changed only one file inside the branch's area — that same test — so there was nothing else to revert. `git diff fec6678..HEAD` shows deletions in four files only: `plan.md`, `cli.ts`, `app-provider.ts` and `v8-bin.test.ts`, all of them the branch's own work.

**Question 3 — stale references.** Outside the two auth trees, `ctx.session()` and `getCredentials` appear nowhere in `packages/cli/src`, `packages/cli/tests` or `packages/cli-engine`. Every remaining `currentWorkspaceId` is the credential file's own field name, which is still spelled that way on disk (`packages/cli/src/auth/state-file.ts:27-35`), so those are correct. The `prisma-cli app *` strings in `packages/cli/src/shell/command-meta.ts` belong to the commander shell, which still ships those commands. What is stale is in the divergence file, and it is MERGE-F5: the retired log-stream section was half-renamed, keeps present-tense claims about a deleted accessor, quotes text that no longer exists in the file it cites, and cross-references a heading the same commit renamed.

**Question 4 — the harness.** The seed rename is fixed, but the reason it could be ignored is not, and that is MERGE-F3. The seed reaches `createTestCli` inside a spread, and TypeScript does not apply its excess-property check to spread properties — I proved that against the repo's own compiler rather than asserting it. So the same silent failure is available to the next rename. I looked for other places the harness could fail open and found none: the fake Management API throws on an unrouted request instead of falling back, and the unauthenticated axis is real — no seed means the manager pins to "none" and returns null, and `PRISMA_SERVICE_TOKEN` only enters a run's environment when an environment credential is seeded, which the service testkit never does. The gap that is left is coverage rather than fail-open: the branch the merge added cannot be reached from `makeServiceCli` at all (MERGE-F2).

**Question 5 — the plan resolution is honest.** I diffed the base's S8 section against the merged one: the base's text is preserved to the byte and one numbered item was added. The dependency graph is the base's, unchanged, and the branch's competing `S8 (after S2c; …)` line is gone rather than duplicated. Both documents' other sections survive — the branch's "Follow-ups parked on other work" and the base's "Coverage ledger" are both present. The added question is accurate about why `service logs` was shelved: it matches the shelving commit's own account (WebSocket upgrade, HTTP-only engine client, the port reaching for a raw token, credentials never reaching commands), the design it points at exists, and its §7 does ask the plain-HTTP question the fold says it asks. The one error is the count — MERGE-F4.

**Not findings — for the orchestrator.**

- **The test harness's credential manager derives a workspace from fewer tokens than the shipping one.** `InMemoryCredentialManager` reads only the `workspace_id` claim (`packages/cli-engine/src/in-memory-credential-manager.ts:86-90`), while `FileCredentialManager` uses `serviceTokenWorkspaceId`, which accepts `workspace_id` or a `sub` of the form `workspace:<id>` (`packages/cli/src/auth/claims.ts:33-43`). A service token that names its workspace only through `sub` therefore resolves in production and reports no workspace under test — the harness would show a refusal the product would not make. `packages/cli-engine/**` is a hard boundary, so this is a note rather than a finding, but it matters directly to MERGE-F2: a test written against the harness today would pin the wrong answer for that token shape.
- **The same function can return an empty string where its interface says it never will.** `ActiveCredential.workspaceId` is documented "Never the empty string" (`packages/cli-engine/src/credential-manager.ts:62-65`), and the shipping derivation enforces it (`claims.ts:26-28` requires a non-empty string). The engine's test manager does not — it accepts any string, `""` included. Nothing is broken today, because `requireWorkspace` tests the value for truthiness rather than for `undefined`, but the harness can construct a credential the interface forbids. Also a hard-boundary note.
- **`SERVICE.WORKSPACE_REQUIRED`'s advice needs a second next action either way.** MERGE-F1 asks for it, and `errors.ts` is inside this slice, so it can be fixed here — but the condition it fires on is an environment-credential state owned by the auth stream, so the wording should probably be agreed with them rather than settled unilaterally.

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
  shows only our commits.
- 2026-08-10, **UPGRADED after SLICE-ENG-F1: the merge-down is a
  compatibility decision, not a scheduling one, and the defect is
  S2a's rather than ours.** The auth rework on that branch changes the
  credential *writer* — `auth login` now calls
  `credentialManager.createSession`, which writes `{version, sessions,
  currentWorkspaceId}` — but leaves the *reader*
  `readAuthState` untouched (`packages/cli/src/auth/operations.ts` is
  byte-identical between `9ffbb01` and `bot/s2a-foundations`), and that
  reader still goes through `FileTokenStorage`, which parses
  `data.tokens || []`.
  So on the merged result, a signed-in user without
  `PRISMA_SERVICE_TOKEN` reads back as unauthenticated. In this slice
  that is **13 of the 20 commands**, not just `service logs`: `deploy`,
  `show`, `open`, `list-deploys`, `logs`, `promote`, `rollback`,
  `remove` and all five `domain` commands, every one of them through
  `requireWorkspace` → `readAuthState`
  (`packages/cli/src/v8/service/target.ts:93-101`, reached by
  `resolveServiceProjectContext:267`).
  (An earlier draft of this note said 14 and counted `show-deploy`. That
  was wrong, and the fix-round implementer caught it by reading the code
  rather than deferring to the note: `show-deploy` is the one caller
  that swallows the failure —
  `requireWorkspace(ctx).then(id, () => null)`,
  `packages/cli/src/v8/service/show-deploy.ts:51-55` — so it degrades to
  a missing live-deployment hint instead of failing. It uses neither
  shared resolver, so that is its only auth path.)
  `service build`, `build logs`, the three `agent` commands and
  `feedback` are unaffected because they never read auth state.
  `readAuthState` is shared, so the blast radius is not confined to this
  slice — any other ported group calling it breaks the same way.
  **No test in this slice can see it**: every service test mocks
  `readAuthState` at the module seam, so the harness has two credential
  seams where production has one file. Whichever seeding shape the
  merge-down adopts must join them.
  This is for the S2a stream to fix before its branch goes green — the
  correction is in `readAuthState`, not in this tree. Do not merge down
  until it is fixed.
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
