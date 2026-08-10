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

## Round notes

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
