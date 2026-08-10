# S2b design — conventions binding every dispatch

Status: BINDING (grounded in the `facts/` extraction sheets;
nothing here is implementer judgment). Operator rulings 2026-08-10:
DECISION 1 ratified (readAuthState helper until ctx.session());
DECISION 2 ratified (drafted consent questions; deny → exit 2);
DECISION 3 ruled, corrected 2026-08-10: interactivity gating is the
EXISTING `needs: { interaction: true }` (S2a, execution/needs.ts) —
declare it, no engine change needed; the browser-wait helper +
openUrl effect arrive as mechanics via merge-down; consent-grant
flags are engine-owned (see §5). No TTY/CI reads in commands or
helpers, ever. Child documents: `d1-project.md`, `d2-postgres.md`,
`d3-bucket-branch-git.md` — one per dispatch, each pinning its
commands exhaustively. Precedence: slice contract
`../s2b-resources.md` (R-S2b-1..10) > this file > child docs; a child
doc may only add detail, never contradict a rule.

## 1. File layout (R-S2b-10, pinned)

One command per file, named for the command path minus the group
directory, kebab-case:

```text
packages/cli/src/v8/project/list.ts          → projectListCommand
packages/cli/src/v8/project/show.ts          → projectShowCommand
packages/cli/src/v8/project/create.ts        → projectCreateCommand
packages/cli/src/v8/project/link.ts          → projectLinkCommand
packages/cli/src/v8/project/rename.ts        → projectRenameCommand
packages/cli/src/v8/project/remove.ts        → projectRemoveCommand
packages/cli/src/v8/project/transfer.ts      → projectTransferCommand
packages/cli/src/v8/project/env-add.ts       → projectEnvAddCommand
packages/cli/src/v8/project/env-update.ts    → projectEnvUpdateCommand
packages/cli/src/v8/project/env-list.ts      → projectEnvListCommand
packages/cli/src/v8/project/env-remove.ts    → projectEnvRemoveCommand
packages/cli/src/v8/postgres/list.ts         → postgresListCommand
packages/cli/src/v8/postgres/show.ts         → postgresShowCommand
packages/cli/src/v8/postgres/create.ts       → postgresCreateCommand
packages/cli/src/v8/postgres/usage.ts        → postgresUsageCommand
packages/cli/src/v8/postgres/restore.ts      → postgresRestoreCommand
packages/cli/src/v8/postgres/remove.ts       → postgresRemoveCommand
packages/cli/src/v8/postgres/backup-list.ts  → postgresBackupListCommand
packages/cli/src/v8/postgres/connection-list.ts   → postgresConnectionListCommand
packages/cli/src/v8/postgres/connection-create.ts → postgresConnectionCreateCommand
packages/cli/src/v8/postgres/connection-rotate.ts → postgresConnectionRotateCommand
packages/cli/src/v8/postgres/connection-remove.ts → postgresConnectionRemoveCommand
packages/cli/src/v8/bucket/list.ts           → bucketListCommand
packages/cli/src/v8/bucket/create.ts         → bucketCreateCommand
packages/cli/src/v8/bucket/delete.ts         → bucketDeleteCommand
packages/cli/src/v8/bucket/key-list.ts       → bucketKeyListCommand
packages/cli/src/v8/bucket/key-create.ts     → bucketKeyCreateCommand
packages/cli/src/v8/bucket/key-delete.ts     → bucketKeyDeleteCommand
packages/cli/src/v8/branch/list.ts           → branchListCommand
packages/cli/src/v8/git/connect.ts           → gitConnectCommand
packages/cli/src/v8/git/disconnect.ts        → gitDisconnectCommand
```

Definitions + handler colocated in the file (S1 whoami pattern).
Shared per-group presentation helpers in
`packages/cli/src/v8/<group>/presentation.ts`. Shared per-group error
mapping in `packages/cli/src/v8/<group>/errors.ts` (v8 auth
precedent). Cross-group helpers (project-ref resolution presentation,
consent helpers) — only if two groups need the identical function —
live in `packages/cli/src/v8/resources-shared/`; a child doc names
each such file explicitly or it does not exist.

## 2. Mounting (pinned)

`packages/cli/src/v8/cli.ts` gains, per dispatch:

- Family-map entries (camelCase keys): `projectList`, `projectShow`,
  `projectCreate`, `projectLink`, `projectRename`, `projectRemove`,
  `projectTransfer`, `projectEnvAdd`, `projectEnvUpdate`,
  `projectEnvList`, `projectEnvRemove`, `postgresList`, …,
  `bucketKeyDelete`, `branchList`, `gitConnect`, `gitDisconnect` —
  all in the existing (single) platform command family alongside the
  auth entries.
- Mount-map entries with exact paths: `"project list"`, …,
  `"project env add"`, …, `"postgres backup list"`,
  `"postgres connection rotate"`, …, `"bucket key create"`,
  `"branch list"`, `"git connect"`, `"git disconnect"`.
- Group declarations with briefs: `project`, `project env`,
  `postgres`, `postgres backup`, `postgres connection`, `bucket`,
  `bucket key`, `branch`, `git`. Brief strings: the legacy group
descriptions from command-meta.ts, enumerated verbatim in each child
doc's mounting section.

No `database` path or identifier survives anywhere in v8 code, help,
ids, or tests (R-S2b-1).

## 3. Auth (R-S2b-2, pinned)

Every command in this slice declares `needs: { credentials: true }`.
No auto-login. No handler calls the legacy auth guard
(`requireAuthenticatedAuthState` / interactive login) — the engine's
early failure (`CLI.CREDENTIALS_REQUIRED`, exit 2) is the only
unauthenticated behavior. Handlers touch the management API
exclusively through `ctx.api`.

### 3a. Workspace source (OPERATOR DECISION 1 — ratified 2026-08-10)

Resource commands need the active workspace (project listing filter,
provider `workspaceId`, plan-limit lookup). `ctx` exposes only
`getCredentials` (`{token}`) and `api` today; the credential-manager
rework (in flight on `s2a-foundations`) adds `ctx.session()` carrying
the workspace. Interim pin, pending ratification: one helper
`resolveActiveWorkspace(ctx)` in
`packages/cli/src/v8/resources-shared/workspace.ts` calls the auth
module's `readAuthState(ctx.env, ctx.signal)` (exactly as v8 whoami
does) and returns `state.workspace`; missing → the ported
`AUTH.USAGE_ERROR` "Workspace required". When `ctx.session()` lands
via merge-down, the helper body swaps to it — one file, no
handler churn.

## 4. Error mapping (R-S2b-5, pinned)

- Dotted namespaces by group: `PROJECT.*`, `POSTGRES.*`, `BUCKET.*`,
  `BRANCH.*`, `GIT.*`. The subcode is the legacy flat code minus any
  redundant group prefix (`PROJECT_NOT_FOUND` → `PROJECT.NOT_FOUND`,
  `DATABASE_CONNECTION_NOT_FOUND` → `POSTGRES.CONNECTION_NOT_FOUND`,
  `ENV_VARIABLE_NOT_FOUND` → `PROJECT.ENV_VARIABLE_NOT_FOUND`,
  `REPO_NOT_CONNECTED` → `GIT.REPO_NOT_CONNECTED`). The child docs
  enumerate EVERY legacy code reachable by their commands with its
  exact v8 code — an implementer never invents a code.
- Every errored settlement exits 2 (legacy 1→2 recorded once as a
  class divergence; the S2a precedent).
- `summary`/`why` text ports verbatim. Legacy `fix` prose maps to one
  `user-choice` nextAction; legacy `nextSteps` strings fold into
  nextActions (S1/S2a precedent). `meta` is preserved verbatim.
- Mapping is implemented in `v8/<group>/errors.ts` following the
  exact helper shape of `v8/auth/errors.ts`: a
  `<GROUP>_CODE_MAP: Record<string, `${string}.${string}`>` table +
  `map<Group>OperationError(error: unknown): CliStructuredError |
  null` returning null for non-CliError/unmapped codes; callers
  `notOk(mapped)` or rethrow (engine settles `CLI.INTERNAL_ERROR`,
  exit 1). `new CliStructuredError(code, summary, { why, meta,
  nextActions })`; `meta` only when non-empty.
- nextActions on mapped errors: legacy `fix` → exactly one
  `{ kind: "user-choice", label: fix }`; each legacy `nextSteps`
  command string additionally maps to
  `{ kind: "run-command", label: <the command string>, command:
  <the command string> }` (§0 substitutions applied). This preserves
  more than the S2a auth mapper (which dropped nextSteps as
  duplicative there) — divergence-list note, one class entry.
- API-passthrough codes (raw API `error.code` in the legacy CliError
  `code` field) map mechanically to `<GROUP>.<RAW_CODE>`.

## 5. Consent (R-S2b-3, pinned)

Applies to: `project remove`, `project transfer`,
`postgres restore`, `postgres remove`, `postgres connection rotate`,
`postgres connection remove`, `bucket delete`. (`bucket key delete`
has no confirmation today and gains none — divergence review note
only, not a behavior change.)

- The consent-grant flag is ENGINE-OWNED (operator ruling
  2026-08-10): commands do NOT declare per-command `confirm` flags —
  an engine consent-flag mechanism lands on `s2a-foundations`
  (details arrive with the merge-down) and is expected to preserve
  the user-facing `--confirm <exact-id>` semantics (must equal the
  resolved resource id). Until its details land, every consent
  command in this slice is ON HOLD: D1 ships 9 of 11 commands
  (remove/transfer held), D2 holds restore/remove/connection
  rotate/connection remove wiring, D3 holds bucket delete. Handlers
  keep the exact-id CHECK semantics and copy pinned per command;
  only the flag's declaration/plumbing waits for the engine
  mechanism.
- Interactive invocation WITHOUT the flag: `ctx.prompt.consent(q)`
  where `q` is the pinned per-command question text (child docs) —
  question texts are the child docs' drafted wordings, ratified
  2026-08-10 (OPERATOR DECISION 2; legacy exact-id commands have no
  prompt today, so the wordings were drafted from the confirmation
  copy).
- Consent answered "no" (the prompt returns `false`): the handler
  returns `notOk(new CliStructuredError("<GROUP>.CONSENT_DECLINED",
  "Consent declined", { why: "The operation was not confirmed." }))`,
  exit 2 — matching the legacy interactive-decline precedent (exit
  2), distinct from prompt CANCELLATION (Ctrl-C/EOF →
  `CLI.PROMPT_CANCELLED`, exit 3, engine-owned). Ratified 2026-08-10.
- Non-interactive without the flag: the engine's structural failure
  `CLI.CONSENT_REQUIRED`, exit 2 (consent is undefaultable; `--yes`
  never grants it).
- Prompt cancel (Ctrl-C/EOF): exit 3.
- `--confirm` present but mismatched: the legacy CONFIRMATION_REQUIRED
  content mapped to the group's dotted `*.CONFIRMATION_REQUIRED`,
  exit 2, meta (`expectedConfirm`/`receivedConfirm`) verbatim.
- Every exit-code change from legacy (1→2, 0-on-cancel→3) is a
  divergence row (ledger Q5 default).

## 6. Secrets (R-S2b-4, pinned)

Commands: `postgres create`, `postgres connection create`,
`postgres connection rotate`, `bucket key create`.

- The secret is the `stdout` presentation payload — exact line
  format per child doc (ports the legacy renderStdout bytes).
- Human Blocks show the secret masked via `sensitive: true` field
  rows.
- The json envelope `result` carries the secret exactly as the legacy
  serializer did.

## 7. Operation layer (R-S2b-10, pinned)

Handlers call the EXISTING controller/provider operation functions —
no reimplementation of API flows, resolution logic, or validation.
Where an operation takes an SDK/client argument, the handler passes a
client built from `ctx.api` (the exact per-operation call sites are
pinned in each child doc's operation-calls section). Local file side effects (`.prisma/local.json`,
`.gitignore` append) reuse the existing lib functions. The child docs
name the exact function per command step; calling anything else is
out of contract.

## 8. Presentation (pinned)

- `human`: blocks via the engine vocabulary. Every command's block
  sequence is pinned in its child-doc section (summary tone + text,
  field rows with exact labels, table columns with exact headers and
  row cell derivations, sort order).
- `stdout`: pinned per command; empty for commands with no legacy
  renderStdout payload EXCEPT list/show data rows where the child doc
  says otherwise (S2a workspace-list precedent: table data rows go to
  stdout). The child doc states the exact lines for every command —
  no implementer choice.
- `json`: ports the legacy serializer key-for-key (child doc lists
  the keys). Commands with no legacy serializer present the raw
  result (S1 precedent) — child doc says which.
- `next`: exact NextAction list per command per state (child doc).
- Title lines follow the S1 card convention: a `summary` block whose
  text is the legacy descriptor-derived sentence pinned per command.

## 9. Events (pinned)

- Sync commands: no events.
- `git connect` (R-S2b-7): waits through the engine's browser-wait
  prompt-family primitive (operator ruling 2026-08-10; landing on
  s2a-foundations) — the primitive owns announce/open/poll events;
  the handler emits none. Mapping pinned in d3-bucket-branch-git.md
  §3.8. Commands and helpers NEVER read TTY/CI state.

## 10. Tests (R-S2b-9, pinned)

- One test file per group:
  `packages/cli/tests/v8-project.test.ts`, `v8-postgres.test.ts`,
  `v8-bucket.test.ts`, `v8-branch.test.ts`, `v8-git.test.ts`.
- Structure copies `v8-auth.test.ts`: `createTestCli({ commands:
  <flat mount map>, groups, credentials: { token: "tok_1" },
  managementApi: { client: <fake> }, now: () => new Date(0) })`;
  the fake client is a plain object implementing exactly the SDK
  methods the operation layer calls (typed `as ManagementApiClient`),
  returning recorded SDK-shaped responses; the auth module (workspace
  read) is mocked via `vi.mock("../src/auth")` exactly as
  v8-auth.test.ts does. Unauthenticated cases: omit `credentials`.
  Envelope assertions via the `resultFrame(result.json)` helper
  (copy from v8-auth.test.ts). Adopt the credential-manager seeding
  surface if it lands mid-slice — merge-down rule from the handover
  brief.
- Matrix per command: success; errored (at least one mapped legacy
  error); json envelope (commandId, result keys, exitCode,
  nextActions); unauthenticated (needs failure: engine sign-in error,
  exit 2); consent grant/deny/non-interactive + cancel where §5
  applies; picker path (scripted answers) where R-S2b-6 applies.
  Child docs enumerate the exact case list per command — the
  implementer adds no cases and drops none without a plan amendment.
- Assertions target `exitCode`, `presented` (data + presentation
  arrays), `events`, and the json `result` frame — never raw bytes.
- Golden rendering: extend `v8-golden-rendering.test.ts` by exactly
  the entries the child docs name (one representative per new output
  surface class), nothing else.
- Build-time coverage test (D1 template, inherited by D2/D3): no such
  test exists today (v8-bin.test.ts only asserts `buildCli()` does
  not throw), and `buildCli` hides its spec. D1 therefore refactors
  `v8/cli.ts` to export the spec pieces as module constants —
  `platformCommandFamily` (the `defineCommandFamily` result),
  `mountedCommands` (the mount map record), `cliGroups` — consumed by
  `buildCli()` unchanged. New test `v8-mount-coverage.test.ts`
  asserts by object identity: every value in
  `platformCommandFamily.commands` appears in `mountedCommands`, and
  every `mountedCommands` value is either in the family or in the
  enumerated shell-owned allowlist (`telemetry status|enable|disable`).
- Legacy fixture-test deletion: only the fixture cases covering
  commands ported in the SAME dispatch are deleted, per child doc's
  explicit file/case list; files keep unported-command cases.

## 11. Divergences (R-S2b-1/2/3/5/8 + standing ruling 10, pinned)

New file `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2b.md`
(never edit the shared `parity-divergences.md` — the auth stream owns
it). Grows per dispatch. Format: the S2a file's section style PLUS a
per-command conformance table:

```markdown
| command | inventory entry | rules applied | divergences |
```

Every rename, dropped alias, error-code change, exit-code change, and
presentation-surface change gets a row/entry. D4 consolidates.

## 12. Verification gate (every dispatch, pinned)

```bash
pnpm --filter @prisma/cli-engine test
pnpm --filter @prisma/cli test
pnpm --filter @repo/cli-telemetry test
pnpm typecheck
pnpm lint
```

All measured by pnpm's own exit code. Green before every commit.

## 13. Commits (pinned)

Stage explicitly (never `git add -A`). Commit as the bot:
`git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`,
body ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
One commit per dispatch minimum; separate commits for legacy-test
deletion. Push to `git@github-wmadden-electric:prisma/prisma-cli.git`.
PR base: `s2a-foundations` (operator ruling 2026-08-10, supersedes
the brief's stacked-on-main note).

## 14. Hard boundaries (from the handover brief, restated)

Never touch: `packages/cli/src/v8/auth/**`, `packages/cli/src/auth/**`,
`packages/cli-engine/**` (an engine change needed = STOP),
`.github/workflows/publish.yml`, versioning scripts. Unpinned fact →
STOP and surface; never improvise.
