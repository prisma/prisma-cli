# S2b — code review artifact

Slice: s2b-resources (contract `../specs/s2b-resources.md`, plan
`../plans/s2b-resources.md`, design `../specs/s2b-design/`).

## Subagent IDs

| Role | ID | Notes |
| --- | --- | --- |
| implementer | — | Opus (operator override 2026-08-10: rate-limit headroom; supersedes the brief's Fable) |
| reviewer | — | Opus (per handover brief) |

## Scoreboard

| Dispatch | Round | Verdict | Date |
| --- | --- | --- | --- |
| D1 | 1 | ANOTHER ROUND NEEDED | 2026-08-10 |
| D1 | 2 | SATISFIED | 2026-08-10 |
| D2 | 1 | SATISFIED | 2026-08-10 |
| D3 | 1 | SATISFIED (git connect step 5 excluded) | 2026-08-10 |

## Findings log

### D1 round 1

**D1-R1-01 — must-fix — `packages/cli/src/v8/project/errors.ts:80`**
`mapProjectOperationError` returns `null` for the legacy `AUTH_REQUIRED`
code, so `apiCallError`'s 401/403 CliError is rethrown and the engine
settles `CLI.INTERNAL_ERROR` exit 1. The amended d1-project.md §2.1 row
requires a handler-built
`CliStructuredError("CLI.CREDENTIALS_REQUIRED", …)` carrying the
engine's exact summary/nextAction copy, exit 2 (never a rethrow). The
file's doc comment states the superseded round-1 rule and must change
with it. Add a test: an env API call returning 401/403 settles
`CLI.CREDENTIALS_REQUIRED` exit 2.

**D1-R1-02 — must-fix — `packages/cli/src/v8/project/errors.ts:67`**
`nextActionsFor` maps every legacy `nextSteps` string to a
`run-command` action, including the `#`-comment lines that
`splitFileNextSteps` and the file-apply-failure steps emit
(`packages/cli/src/controllers/app-env-file.ts:345-372`). Amended
d1-project.md §3.8 pins the opposite: a `#`-comment line is not an
action — it becomes the `reason` of the immediately following
run-command action. Fix the mapper and assert the resulting
`nextActions` in the env add/update file-mode error tests (today
`tests/v8-project.test.ts:1277` and `:1414` assert only `meta`).

**D1-R1-03 — should-fix —
`.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2b.md:67-84`**
Entries 14, 16 and 17 record the pre-amendment behavior: 14 says 401/403
is "not mapped" (now a handler-built `CLI.CREDENTIALS_REQUIRED` plus the
accepted single-source duplication of engine copy), 16 says the
`PROJECT.ENV_PREVIEW_DEFAULT_MISSING` code is "not pinned by the design"
(d1-project.md §4.8 pins it; the operator ratifies via this list), 17
describes comment lines as their own run-command actions. Also missing:
d1-project.md §4.9 — legacy functions taking the shell `CommandContext`
are called through the `v8/project/context.ts` runtime-slice adapter,
accepted for this slice, structural cleanup deferred to S2d.

**D1-R1-04 — should-fix — `packages/cli/tests/v8-project.test.ts:1348`,
`:1480`, `:1629`** Enumerated env cases are missing, which conventions
§10 forbids without a plan amendment. `project env update`: no
branch-scope success, no file-mode success, and none of the scope usage
errors (both flags / neither / both input sources / bad assignment).
`project env remove`: no branch-scope success and no scope usage errors.
`project env list`: the local-git case is only the "branch the platform
does not know yet" variant; the branch-known-to-the-platform variant
(the production/preview target computation, fact sheet §10) is untested.
Add them, or get d1-project.md's env case list amended.

### D1 round 2 — dispositions

Round-2 commits: 9063f7a, b7269f8, 9b37f1c, cfbc7fe (the branch was
rebased onto the updated s2a-foundations, so the round-1 hashes are
gone).

- **D1-R1-01 — FIXED.** `packages/cli/src/v8/project/errors.ts` drops
  the `AUTH_REQUIRED` early return entirely, so the code falls through
  the mechanical `PROJECT.<RAW_CODE>` rule to `PROJECT.AUTH_REQUIRED`
  with the legacy summary, why and next steps — the final §2.1 pin, not
  the interim hand-built engine error. The doc comment now states why
  (the engine settles every real credentials failure; what reaches the
  mapper is 403 permission residue).
  `tests/v8-project.test.ts:1423` drives a 403 env write and asserts the
  code, summary, why and both nextActions verbatim.
- **D1-R1-02 — FIXED.** `errors.ts` gains `runCommandActions`: a
  `#`-comment step sets `reason` on the next run-command action and is
  never an action itself. `tests/v8-project.test.ts:1372` asserts the
  full three-action list for the split-file duplicate-keys error,
  including both `reason` strings.
- **D1-R1-03 — FIXED.** Divergence entries 14, 16 and 17 are restated
  to the amended pins (mechanical `PROJECT.AUTH_REQUIRED`; the ratified
  `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` plus the local-pin warn reuse;
  comment lines as reasons), 18/19/20 are added (shell-context adapter,
  engine-owned consent, transfer recipient resolution), and the
  conformance table carries all 11 commands.
- **D1-R1-04 — FIXED.** The enumerated env cases are restored:
  `env update` gains branch-scope success, file-mode success, file
  apply-failure, both-flags, neither, both input sources, bad
  assignment and the bare-KEY fallback; `env remove` gains branch scope,
  both flags and neither; `env list` gains both known-branch local-git
  cases (preview overrides and the production branch).

### D2 round 1

No must-fix findings. The three below are cheap and should land before
the PR, but none of them changes behavior in normal operation.

**D2-R1-01 — should-fix — `packages/cli/src/v8/postgres/restore.ts:52-55`**
The success nextAction is built from `result.database.id`, which is the
database summary the restore API call returned. Legacy builds it from
the resolved target database's id
(`packages/cli/src/controllers/database.ts:471-549`, the `nextSteps`
entry), and d2-postgres.md §3.5 pins `${CLI_NAME} postgres show
${database.id}` where `database` is the target resolved in that
section's step 2. The two ids are the same whenever the API echoes the
target back, so this is not a behavior change today; it only differs if
a restore response omits or changes the id, in which case v8 prints a
broken command and legacy prints a correct one. Use the resolved target
database's id.

**D2-R1-02 — should-fix — `packages/cli/tests/v8-postgres.test.ts:277-298`**
Nothing in the test file asserts the `--trace` → `--log-level verbose`
substitution, which conventions §0 pins and divergence entry 8 records.
The substitution runs in `portFixText`
(`packages/cli/src/v8/postgres/errors.ts:56-59`) and fires on the most
common API-error path: the generic passthrough branch defaults `fix` to
"Re-run with --trace …" whenever the API response carries no `hint`
(`packages/cli/src/lib/database/provider.ts:851-864`). This test already
drives exactly that path but asserts only `code`, `summary` and `why`.
Add the `nextActions` assertion here.

**D2-R1-03 — should-fix — `packages/cli/tests/v8-postgres.test.ts:319-330`**
The plan-limit test that returns a successful subscription lookup
asserts neither the enriched `meta` fields (`planName`, `usageBlocked`,
`upgradeUrl`) nor the nextAction's `reason`. That reason is the whole
substance of divergence 25: d2-postgres.md §2.4 pins it as
`` Upgrade at ${upgradeUrl}${planName ? ` (current plan: ${planName})` : ""}. ``,
and it is what replaces PR #127's dropped `humanLines` rendering. Only
the no-subscription variant's reason is asserted, at
`tests/v8-postgres.test.ts:653-666`. Assert the with-URL reason and the
three enriched meta keys.

### D2 round 1 — dispositions (orchestrator, 2026-08-10)

All three fixed. No second D2 review round: the verdict was already
SATISFIED and none of the three was a must-fix.

- **D2-R1-01 — FIXED.** `restorePresentations` now takes the resolved
  target database id and builds the success nextAction from it, which is
  what d2-postgres.md §3.5 pins. No test distinguishes the two ids,
  because the restore response fixture echoes the target back and adding
  a case that diverges them would be a new case, which conventions §10
  forbids without a plan amendment. Flagging it here rather than
  silently adding one.
- **D2-R1-02 — FIXED.** The API-passthrough test now asserts the
  `nextActions`, which proves the `--trace` → `--log-level verbose`
  substitution end to end: the provider's default fix text is the only
  place it fires.
- **D2-R1-03 — FIXED, and it exposed a real coverage gap.** Asserting
  the enriched fields failed, because both plan-limit tests registered
  their subscription route as
  `GET /v1/workspaces/{workspaceId}/subscription` while the provider
  requests `/v1/workspaces/{id}/subscription`. The route never matched,
  so the lookup always came back empty and both tests were exercising
  the same unenriched fallback. The enriched branch of d2 §2.4 — the
  `Upgrade at <url> (current plan: <name>)` reason that replaces PR
  #127's dropped rendering, and the `planName` / `usageBlocked` /
  `upgradeUrl` meta — had no coverage at all. Both route keys are
  corrected, so the enrichment case now enriches and the
  no-result case now genuinely fails its lookup.

### D3 round 1

One should-fix finding. Nothing else in the dispatch departs from the
contract, the conventions or the design. `git connect` step 5 (the
browser wait) is excluded from this round by the coordinator and is not
counted against the dispatch.

**D3-R1-01 — should-fix — `packages/cli/src/v8/bucket/errors.ts:31`,
`packages/cli/src/v8/branch/errors.ts:30`,
`packages/cli/src/v8/git/errors.ts:38`**
Each of the three new mappers carries its own copy of `portFixText`, and
no test in `v8-bucket.test.ts`, `v8-branch.test.ts` or `v8-git.test.ts`
asserts the `--trace` → `--log-level verbose` substitution those copies
perform. Conventions §0 pins it and D1's class entry 7 records it. The
substitution is reachable on the ordinary API-failure path in all three
groups, because `bucketApiError`
(`packages/cli/src/lib/bucket/provider.ts:290-309`), `branchApiError`
(`packages/cli/src/controllers/branch.ts:178-197`) and
`repoConnectionFixForStatus`'s default arm
(`packages/cli/src/controllers/project.ts:2283-2297`) all fall back to
"Re-run with --trace …" when the API supplies no `hint`. Three tests
already drive that exact path but assert only `code`, `summary` and
`why`: `tests/v8-bucket.test.ts:360-381`, `tests/v8-branch.test.ts:220-241`
and the `BUCKET.notFound` cases at `tests/v8-bucket.test.ts:520-535` and
`:885-903`. Add the `nextActions` assertion to at least the bucket and
branch cases. This is the same gap as D2-R1-02, where asserting the
untested field turned out to expose a test route that never matched.

### D3 round 1 — dispositions (orchestrator, 2026-08-10)

**D3-R1-01 — FIXED in all three groups.** Unlike D2-R1-02, the
assertions passed first time, so there was no hidden defect underneath
this one.

- `bucket` and `branch` needed no new cases: the existing
  passthrough tests already drive the default fix text, so they now
  assert the single `user-choice` action carrying the substituted
  string.
- `git` needed one new case, because `repoConnectionFixForStatus` has
  four arms and every existing test hit a status-specific one (409 on
  connect, 422 on disconnect). The default arm — the group's only
  place where the substitution fires — was unreachable from the
  enumerated case list. Rather than add a case silently, d3 §3.9's
  test list is amended to require both arms, and the new case drives
  a 500 through `git disconnect`.

Two items the reviewer raised for D4 are carried into the closure
dispatch and are not D3 defects: divergence 40's `GIT.AUTH_REQUIRED`
retains the stale "rerun the command in a TTY to sign in
interactively" fix text, which reads wrong under R-S2b-2 and is
untested in both groups that map it; and the five near-identical
group mappers have drifted on whether they handle `#`-comment next
steps.

## Round notes

### D3 round 1 — 2026-08-10

The port is faithful and I found no must-fix defect. All nine command
files match their d3 §3.x section on args, flags, positional
placeholders, briefs, examples, `needs`, handler step order, the pinned
operation calls, block sequence, field labels, stdout lines, json shape
and next actions. Both orchestrator amendment blocks are honored: `bucket
delete` declares no `confirm` flag and the bucket mapper has no
`CONFIRMATION_REQUIRED` row; the positional placeholders are `bucket-id`,
`key-id` and `git-url`; `bucket key create`'s field rows carry the four
environment-variable names with the two secrets masked; the git
`--project` placeholder is `id-or-name`; and the divergence entries are
numbered 31 to 42. The §3.8 test-list amendment is honored too — every
`git connect` case that reaches the handler runs with a TTY, and the new
non-interactive case proves the run settles `CLI.INTERACTION_REQUIRED` at
exit 2 with the fake client recording zero calls.

Copy is verbatim against the fact sheet everywhere I checked, and I
checked every string the nine commands can emit. Spot-checks that matter:
`bucket create`'s summary keeps its trailing period and its
`formatBucketTarget` branch suffix; `bucket key create`'s four stdout
lines are byte-exact and in the pinned order; the three bucket usage
errors keep their distinct `why` sentences ("Bucket deletion needs a
bucket id.", "Bucket key listing needs a bucket id.", "Bucket key
creation needs a bucket id.") and their distinct `fix` texts; `bucket key
delete`'s combined "Bucket id and key id required" error keeps its
`<bucketId>` placeholder next step; and every git error — the no-url
usage error, `REPO_PROVIDER_UNSUPPORTED`, `REPO_ALREADY_CONNECTED`,
`REPO_NOT_CONNECTED` and both status-specific `REPO_CONNECTION_FAILED`
fix texts — is asserted verbatim in the tests.

The operation layer is reused rather than reimplemented, and more
thoroughly than in D1. `branch list`'s handler is `listRealBranches`
line for line minus the auth guard and `verboseContext`, including
`sortBranches(branches.map(toBranchSummary))` in that order. The git
commands import not just the flow functions §2.2 names but also the error
constructors (`repoAlreadyConnectedError`, `repoConnectionApiError`,
`repoNotConnectedError`, `unsupportedRepositoryProviderError`), the
comparison helper `repositoryFullNamesMatch` and the presenter helper
`formatGitConnectionDetail`, so no legacy copy is retyped anywhere.
`git/context.ts`'s `ctx.api as unknown as SourceRepositoryApiClient` is
not an invention either: `runGitConnect` does the identical double cast
at `packages/cli/src/controllers/project.ts:1136`.

Consent on `bucket delete` follows conventions §5. No `confirm` flag is
declared anywhere under `packages/cli/src/v8/` (grep-verified across all
30 commands), the handler calls
`ctx.prompt.consent("Deleting this bucket permanently removes all
objects and access keys.", { token: bucketId })` at the position the
legacy exact-id check sat, and the question is that legacy `why`
sentence verbatim. The matrix is complete and non-vacuous, and it is the
first in the slice to add the sixth case §3.3 enumerates:
non-interactive `--confirm` succeeds and drives a real DELETE (asserted),
without `--confirm` and under `--yes` the run settles
`CLI.CONSENT_REQUIRED` exit 2, the typed bucket id succeeds, a wrong
typed answer settles `CLI.PROMPT_INVALID` exit 2, and an EOF settles
`CLI.PROMPT_CANCELLED` exit 3.

Secrets on `bucket key create` follow R-S2b-4. The four `S3_*=` lines are
the stdout payload in the pinned order, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` are masked in the human card through
`sensitive: true`, `S3_ENDPOINT` and `S3_BUCKET` are plain, and the json
result carries all four values unchanged. All three are asserted.

Error mapping matches conventions §4 and d3 §2.1. Every code the three
maps list is present, none is invented, the mechanical
`BUCKET.<code>` / `BRANCH.<code>` / `GIT.<code>` fallback covers API
passthrough, all three mappers delegate the five project-resolution codes
to `v8/project/errors.ts` as the single source, and the workspace-required
error is thrown as an `AUTH.USAGE_ERROR` structured error that the engine
settles directly. The three new mappers omit the `#`-comment-to-`reason`
handling that D1 and D2 carry; that handling came from a project-specific
amendment about env-file next steps, conventions §4 does not require it,
and no bucket, branch or git error produces a comment line, so the omission
is a consistency gap rather than a defect. Worth folding into whatever
D4 does about the five near-identical mapper copies.

On your first question — the `commandName` widening in
`packages/cli/src/v8/project/context.ts:47-58` does not change any D1
behavior. `ResolveProjectOptions.commandName` was already optional
(`packages/cli/src/lib/project/resolution.ts:149`), the function body is
otherwise untouched and still forwards the value straight into
`resolveProjectTarget`, and all four D1 call sites (`env-shared.ts:79`,
`rename.ts:72`, `env-list.ts:97`, plus D2's and D3's own) still pass a
string, so the resolver receives exactly what it received before. The
widening is purely permissive at the type level. No D1 or D2 test file
changed in this range, and `branch list`'s test asserts the resulting
"this command" why-text verbatim, which is the legacy quirk the widening
exists to preserve.

On your second question — no, I do not see the URL-as-command problem
anywhere else in D3. I enumerated every `nextSteps` value the nine
commands can reach: the bucket controller and provider produce only
`prisma-cli …` command strings or empty arrays, `branchApiError` produces
an empty array, and the five reachable git errors produce
`prisma-cli git connect …`, `prisma-cli git disconnect`,
`prisma-cli project show` and the usage error's example command. The only
two URL entries in the whole group are the ones you already raised, both
in `packages/cli/src/controllers/project.ts:2208` and `:2229`, and both
sit behind the unwritten wait. There is a milder relative worth naming:
several next steps are command templates with literal placeholders —
`prisma-cli bucket key list <bucketId>`,
`prisma-cli git connect git@github.com:owner/repo.git`, and the shared
`prisma-cli project link <id-or-name>` — so they become `run-command`
actions that fail if run verbatim. That is a pre-existing legacy shape
that D1 already ships and the design says to port unchanged, so it is not
a D3 defect, but it belongs in the same operator conversation as
divergence 42: the question is whether `run-command` should mean
"runnable as-is".

The divergence section is the most thorough in the file. Entries 31 to 42
cover all six items d3 §4 asks for plus the six the design asks to be
recorded as review notes; the shared D1 and D2 class entries are cited
rather than duplicated; three error-code maps are complete; nine
conformance rows are present and their per-row divergence lists are
accurate (`bucket delete` and the key commands correctly omit 18 and 28
because they resolve no project and never carried `verboseContext`;
`bucket create` omits 26 because it writes nothing to stdout). The
`git connect` incompleteness is stated plainly at the top of the section
with the three unsupplied facts named, which is the right place for it.

Legacy deletions match the section's claims exactly. `bucket.test.ts` and
`branch.test.ts` are gone in full; `project.test.ts` lost its six git
fixture cases and kept its two help cases; `project-real-mode.test.ts`
lost the three cases `v8-git.test.ts` now covers and kept the four
install-and-wait cases, the two pagination-cursor cases and the two
project-resolution cases. `git-adapter.test.ts` and the four branch unit
files are still present.

Boundaries hold. Twenty-nine files changed and none is under
`packages/cli/src/v8/auth/`, `packages/cli/src/auth/`,
`packages/cli-engine/` or `.github/workflows/`. Legacy source edits are
fourteen `export` keyword additions across `controllers/branch.ts` (4),
`controllers/project.ts` (9) and `presenters/project.ts` (1), all with
unchanged bodies — `repoAlreadyConnectedError`'s signature only rewrapped
across lines for the added keyword. Every one is named by d3 §2.2 or used
by a pinned flow step. For the PR description's legacy-edits list, those
fourteen join D1's ten and D2's six.

Two observations for D4, neither a D3 finding. First, divergence 40's
`GIT.AUTH_REQUIRED` keeps the legacy fix text "Run prisma-cli auth login,
or rerun the command in a TTY to sign in interactively." — the TTY half
of that sentence is stale under R-S2b-2, which drops auto-login. D1
ratified this exact outcome for `PROJECT.AUTH_REQUIRED` and D3 follows it
deliberately, so reopening it here would contradict a settled decision,
but the copy is misleading and D4 should decide whether to amend it in
both groups at once. It also has no test in either group. Second, the
`bucket key create --role` enum rejection (divergence 35) has no test;
§3.5 does not enumerate one, so nothing is missing from the plan.

Not checked, deliberately: the verification suite (your independent run
on this tip is trusted); rendered human bytes; `git connect` step 5 and
its marked hole at `packages/cli/src/v8/git/connect.ts:138-153`,
including the four §3.8 test cases that belong to it
(installation-required, not-accessible, poll-then-found, poll timeout) —
those four are the only enumerated cases missing from D3, they are all
wait-path cases, and they must land with the wait round; anything under
D1 or D2 beyond the `commandName` widening you asked about.

### D2 round 1 — 2026-08-10

The port is faithful and I found no must-fix defect. All eleven command
files match their d2-postgres.md §3.x section on args, flags, briefs,
examples, `needs: { credentials: true }`, handler step order, the pinned
provider calls, block sequence, field labels, stdout lines, json
serializer and next actions. Spot-checked copy is verbatim against the
fact sheet, including the not-found scope suffix, the ambiguous
`meta.matches` shape, both connection-string-missing variants, the
backup-limit and usage-date usage errors, and the restore detail lines.
`formatBackupSize` and `formatStatus` in
`v8/postgres/presentation.ts` are line-for-line reproductions of the
legacy presenter's private helpers. Every command reuses the legacy
operation layer rather than reimplementing it: `resolveDatabase`,
`sortDatabases`, `ensureProjectId`, `parseUsageDate`,
`parseBackupLimit` and `defaultConnectionName` are imported from the
controller, and the provider is built from `ctx.api`.

Consent is engine-owned exactly as conventions §5 requires. No `confirm`
flag is declared anywhere under `packages/cli/src/v8/` (grep-verified —
the only `--confirm` occurrences are help examples and legacy nextStep
strings). All four consent commands call
`ctx.prompt.consent(<question>, { token: <exact id> })` at the position
the legacy exact-id check sat: `restore` and `remove` after resolving
the database, `connection rotate` and `connection remove` before any API
call. Each question is the section's pinned confirmation `why` sentence,
verbatim, and each token is the exact resolved resource id. All four
five-case matrices are complete and non-vacuous: non-interactive
`--confirm <id>` succeeds and drives the real API call (the tests assert
the restore body, the database DELETE, the rotate response and the
connection DELETE), the same run without `--confirm` and the same run
with `--yes` both settle `CLI.CONSENT_REQUIRED` exit 2, the typed id
succeeds, and a wrong typed answer settles `CLI.PROMPT_INVALID` exit 2.

Secrets follow R-S2b-4 on all three commands. `postgres create`,
`postgres connection create` and `postgres connection rotate` share
`secretBlocks`, which puts the URL on stdout as the single bare line,
masks it in the human card through a `sensitive: true` field row, and
leaves it untouched in the json result (the engine falls back to
`data` when a command declares no `json` presentation —
`packages/cli-engine/src/execution/settlement.ts:65-68`). In json mode
the engine materializes no stdout at all, so the secret appears only in
the envelope, which is the legacy behavior.

The rename is complete. No `database` command path, id, help string or
example survives in v8 code or tests (grep-verified). What remains is
the resource noun: field labels, positional placeholders, the legacy
`domain: "database"` argument to `usageError` (which the mapper drops),
and the `["database", …]` argument arrays handed to the legacy command
formatter. Those last ones become `prisma-cli database …` strings that
`portCommandReferences`
(`packages/cli/src/v8/postgres/errors.ts:45-49`) rewrites to
`prisma-cli postgres …`; eleven tests assert the rewritten strings, so
the substitution is proven rather than assumed. The same helper strips
the package-runner prefix the provider's fallback formatter produces,
which is why d2 §2.1's "do not pass `formatCommand`" instruction works.

Error mapping matches conventions §4 and d2 §2.5. Every reachable legacy
code is present, none is invented, the mechanical `POSTGRES.<RAW_CODE>`
fallback covers API passthrough, plan-limit is intercepted before the
table, and the five project-resolution codes are delegated to
`v8/project/errors.ts` as the single source. The mapper deliberately
has no `CONFIRMATION_REQUIRED` entry: d2 §2.5's table still lists one,
but conventions §5 deletes it as unreachable, and conventions outrank
the child doc. The implementation and the divergence list both follow
conventions, which is the correct resolution of that conflict. The
"Workspace required" case never reaches the mapper either, because
`resolveActiveWorkspace` throws a `CliStructuredError` carrying
`AUTH.USAGE_ERROR` directly and the engine settles a thrown structured
error as errored, exit 2
(`packages/cli-engine/src/execution/settlement.ts:123-130`).

Test-case completeness holds. I walked every §3.x "Tests:" line against
the file and found no dropped case: list has all seven, show all six,
create all seven, usage all six, restore all ten including the source
variant, remove all six, backup list all seven with the three `--limit`
values, connection list all five, connection create all five, rotate all
seven, connection remove all five. Conventions §10's "no cases added,
none dropped" is met.

Legacy test deletions are correct. `database.test.ts` keeps only the
shell help case, which exercises the legacy command tree rather than any
ported command, and every deleted case drove one of the eleven ported
commands. `database-plan-limit.test.ts` keeps exactly the eleven
provider unit cases (three `it` blocks plus two `it.each` tables of three
and five), which d2 §5 requires because the provider is the operation
layer v8 calls; the seven deleted cases drove `database show` through
the legacy shell. Divergence entry 30 records the one behavior that goes
with them, the legacy shell's cancel path.

Boundaries hold. Twenty-three files changed in the range and none is
under `packages/cli/src/v8/auth/`, `packages/cli/src/auth/`,
`packages/cli-engine/` or `.github/workflows/`. The only legacy source
edit is `packages/cli/src/controllers/database.ts`: six `export` keyword
additions (`parseUsageDate`, `parseBackupLimit`, `resolveDatabase`,
`ensureProjectId`, `sortDatabases`, `defaultConnectionName`) with no
body change, all six named by d2 §2.2, §3.1, §3.3, §3.4, §3.7 and §3.9.
Note for the PR description, per conventions §0.4's D1 precedent: these
six exports belong in the "legacy edits" list.

The divergence list is thorough. Entries 21–30 cover all twelve items d2
§4 asks for (the four that are class-shared with D1 are cited as such
rather than duplicated), the error-code map carries every row of §2.5,
and all eleven conformance rows are present. The per-row divergence
lists are accurate down to detail — `connection rotate` and
`connection remove` correctly omit 18 and 28 because they resolve no
project and never carried `verboseContext`, and `create` correctly omits
26 because its stdout payload is legacy behavior rather than the new
list-rows convention.

Two smaller observations, neither worth a finding. First,
`portPostgresCommand`'s fallback that prefixes `${CLI_NAME} ` runs after
the group rewrite, so a nextStep string with no prefix at all would keep
the word `database`; I traced every legacy nextSteps value this group
can raise and all of them are prefixed, either hard-coded or
formatter-built, so the branch is unreachable. Second, the mapper ports
command references inside `fix` but not inside `why`, which d2 §0 words
broadly enough to cover both; again, no reachable `why` in this group
contains a command reference, and D1's mapper behaves the same way.

Not checked, deliberately: the verification suite (the orchestrator's
run on the current tip is trusted), rendered human bytes, the
`v8-golden-rendering.test.ts` surface (d2 names no new entries, so
conventions §10 asks for no change — but the masked-secret row has no
golden representative anywhere yet, which is worth a design decision at
D4), anything under D1, and anything under D3. The D3 edit to
`v8/project/context.ts`'s `resolvePinnedProject` signature landed in the
worktree during this review; it is outside my range and does not affect
the postgres callers, which always pass a command name.

### D1 round 2 — 2026-08-10

All four round-1 findings are fixed as the amended design specifies, and
the two new commands conform.

Consent is engine-owned exactly as conventions §5 requires: no `confirm`
flag is declared anywhere under `packages/cli/src/v8/` (grep-verified),
both handlers call
`ctx.prompt.consent(<question>, { token: project.id })` after resolving
the project positional, and each question is the pinned legacy
confirmation `why` sentence verbatim. Both consent matrices are complete
and non-vacuous — non-interactive `--confirm <id>` succeeds and drives a
real API call, without it and under `--yes` the run settles
`CLI.CONSENT_REQUIRED` exit 2, the typed project id succeeds, and a
wrong typed answer settles `CLI.PROMPT_INVALID` exit 2.

`project remove` and `project transfer` otherwise follow §3.6/§3.7:
positional-only resolution, the pinned provider calls, the legacy pin
cleanup and rewrite/clear helpers, the mutual-exclusion and
recipient-required ordering, the service-token guard, blocks and field
labels verbatim, json falling back to the unchanged result, and the
`auth workspace use <value>` next action only under `--to-workspace`.
Pin-cleanup failures surface as `warn` diagnostics under
`PROJECT.LOCAL_STATE_WRITE_FAILED`, the post-round-2 pin. The recipient
error mapping is reproduced command-side because the legacy mapper is
private, but it calls the same legacy error constructors, so the copy is
identical.

The session adaptation is clean. `resolveActiveWorkspace` now calls
`ctx.session()` and reshapes it to `{ id, name }` with the pinned
`workspaceName ?? workspaceId` fallback; the auth-module import is gone
from `resources-shared/workspace.ts`, and the only remaining
`src/auth` import in v8 project code is `transfer.ts` pulling the
recipient machinery, which §2.3 pins explicitly. The test harness seeds
`sessions` + `currentWorkspaceId` and mocks only
`resolveRecipientWorkspaceSession`.

The four new legacy exports (`transferRecipientRequiredError`,
`transferRecipientUnavailableError`, `cleanupLocalPinForProject`,
`rewriteOrClearLocalPinForProject`) are export-keyword-only additions
with no body changes, and all four are named by §3.6/§3.7.

Boundaries hold on the round-2 diff: ten files changed, none under
`packages/cli/src/v8/auth/`, `packages/cli/src/auth/`,
`packages/cli-engine/` or `.github/workflows/`. Deleting
`project-mutations.test.ts` outright is correct — it held only
`project remove` and `project transfer` cases, both now ported, which is
§5's "whole files if nothing else remains".

Not checked, deliberately: the verification gate (the implementer's run
is trusted; the pre-existing `pnpm lint` failure inside
`packages/cli-engine` at the rebase base is excluded by the
coordinator), rendered human bytes, and anything under d2/d3.

### D1 round 1 — 2026-08-10

The port is faithful. Every command file matches its d1-project.md
section on args, briefs, `needs: { credentials: true }`, handler flow,
block sequence, stdout lines, json serializer and next actions;
spot-checked copy (create's 403 why, the duplicate/missing variable
errors, the setup-canceled usage error, workspace-required) is verbatim
against the fact sheet. Handlers call the pinned operation functions
through `ctx.api`. Where a handler reproduces a legacy controller body
inline (env add/update/remove single-write paths) it is line-for-line
identical to the controller it cannot call, which is the only option
left once the legacy auth guard is dropped.

Both must-fix findings are the two post-round-1 amendments; the code
predates commit 684d577, so this is round-2 work, not a regression.

Template work is sound. `v8/cli.ts` extracts the three constants and
`buildCli()` consumes them unchanged — behavior-neutral apart from the
project entries the dispatch adds. `v8-mount-coverage.test.ts` asserts
coverage in both directions by object identity with the telemetry
allowlist, plus a group-declaration check.

Boundaries hold: nothing under `packages/cli/src/v8/auth/`,
`packages/cli/src/auth/`, `packages/cli-engine/` or `.github/workflows/`
changed. Legacy source edits are exactly ten `export` keyword additions
across `controllers/app-env.ts`, `controllers/project.ts` and
`presenters/app-env.ts`, with no body changes. Four of those exports go
beyond the helpers d1-project.md §2.3 names (`resolveEnvWriteInput`,
`listVariables`, `listOverviewVariables`, `formatScopeFlag`) — all
required by the pinned flows; §0.4 asks that every such edit be listed
in the PR description, which is still to be written.
`tests/v8-update-check.test.ts` also gains an `importOriginal` spread on
its `node:child_process` mock, unclaimed in the commit message but
harmless.

Deletions are correct: `project-controller.test.ts` is gone entirely,
`project.test.ts` keeps its git connect/disconnect and help cases, and
`project-mutations.test.ts` keeps every `project remove` /
`project transfer` case. The env legacy tests are mock-client driven
rather than fixture driven, so keeping them matches §5's qualifier.

`project remove` and `project transfer` are absent, which is the
operator's hold ruling.

Not checked, deliberately: the verification gate (the implementer's run
is trusted), rendered human bytes, and anything under d2/d3.

## Orchestrator notes

- Design docs in `../specs/s2b-design/` are normative for implementer
  dispatches; zero creative freedom is the operator's standing
  instruction for this slice.
- 2026-08-10: first D1 implementer (Fable) stopped pre-code by
  operator model switch; fresh persistent implementer spawned on
  Opus with the corrected brief (consent flags engine-owned;
  remove/transfer held; needs.interaction on git connect).
