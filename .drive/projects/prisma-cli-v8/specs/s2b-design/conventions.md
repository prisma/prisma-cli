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
`getCredentials` (`{token}`) and `api` today; RESOLVED at the 2026-08-10 merge-down (session model, engine commit
9384a95): `ctx.session(): Promise<Session | null>` exists — Session
`{ workspaceId, workspaceName?, expiresAt?, source, current }`. The
helper `resolveActiveWorkspace(ctx)` in
`packages/cli/src/v8/resources-shared/workspace.ts` returns the legacy
`{ id, name }` workspace shape from `workspaceId`/`workspaceName` —
`name` falls back to the workspace id when nothing names it (name is a
required string reaching human output; pinned 2026-08-10); having no
workspace behind `needs.credentials` is defensive-only → the ported
`AUTH.USAGE_ERROR` "Workspace required" (copy unchanged). No handler
reads the auth module.

**Amended 2026-08-10 (rev-6 credential model, auth-stream commit
96e5628).** `ctx.session()` no longer exists. Its replacement is
`ctx.activeCredential(): Promise<ActiveCredential | null>`, and
`workspaceId` on it is `string | undefined` rather than required — a
credential whose claims name no workspace now reports none instead of
manufacturing an empty id. So the helper reads `ctx.activeCredential()`
and raises the same "Workspace required" error in two cases rather than
one: a null credential, and a credential carrying no `workspaceId`. The
second is exactly what that error's `why` already describes — "the
authenticated session does not have one" — so the copy is unchanged and
this is not a divergence. The `workspaceName ?? workspaceId` fallback
is unchanged.

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
- Fix-text substitutions (OPERATOR RULING 2026-08-10). Two clauses in
  legacy `fix` prose describe mechanisms v8 does not have, so every
  group mapper rewrites them: `--trace` becomes `--log-level verbose`,
  and the legacy `authRequiredError` offer ", or rerun the command in a
  TTY to sign in interactively." is deleted, leaving "Run
  `${CLI_NAME} auth login`." R-S2b-2 removed auto-login, so no v8 run
  can sign in by being rerun in a terminal, and the sentence sent people
  to a remedy that no longer exists. The legacy shell keeps the original
  string — it still auto-logs-in, and `shell/errors.ts` is shared — so
  the rewrite lives in the v8 mappers, never in legacy source.
  Divergence entry; both groups that map `AUTH_REQUIRED` test it.
- nextActions on mapped errors: legacy `fix` → exactly one
  `{ kind: "user-choice", label: fix }`; each legacy `nextSteps`
  command string additionally maps to
  `{ kind: "run-command", label: <the command string>, command:
  <the command string> }` (§0 substitutions applied). This preserves
  more than the S2a auth mapper (which dropped nextSteps as
  duplicative there) — divergence-list note, one class entry.
- API-passthrough codes (raw API `error.code` in the legacy CliError
  `code` field) map mechanically to `<GROUP>.<RAW_CODE>`.

## 5. Consent (R-S2b-3, pinned — rewritten at the 2026-08-10 merge-down, engine commit 6bb8452)

Applies to: `project remove`, `project transfer`,
`postgres restore`, `postgres remove`, `postgres connection rotate`,
`postgres connection remove`, `bucket delete`. (`bucket key delete`
has no confirmation today and gains none — divergence review note
only.) The former holds are LIFTED — all seven commands ship.

- The consent mechanism is ENGINE-OWNED end to end. Commands declare
  NO confirm flag; the engine injects the shared repeatable
  `--confirm <value>` flag.
- Handler call: `await ctx.prompt.consent(question, { token })` where
  `token` is the EXACT resolved resource id (project.id, database.id,
  connection id, bucket id — the legacy exact-id semantics) and
  `question` is the command's pinned legacy confirmation `why`
  sentence, verbatim (child docs). The previously ratified yes/no
  question drafts are superseded by the engine's type-to-confirm
  rendering; the ratified sentences survive as the question text.
- Semantics (engine-owned, not re-tested per command beyond the
  matrix): interactive → type-to-confirm (clack re-prompts wrong
  answers; plain line tier fails structurally on a wrong scripted
  answer, exit 2); non-interactive and `--yes` → satisfied iff one
  `--confirm <value>` equals the token exactly (values consumed once
  per run); otherwise the engine's `CLI.CONSENT_REQUIRED` (exit 2,
  message names the expected value and the `--confirm <token>`
  usage); Ctrl-C/EOF → `CLI.PROMPT_CANCELLED`, exit 3.
- DELETED from the design (unreachable in v8): the per-group
  `*.CONFIRMATION_REQUIRED` mapper entries, the
  `*.CONSENT_DECLINED` deny path, and the legacy
  `meta.expectedConfirm/receivedConfirm` surface — the engine error
  replaces them all. Divergence entries: legacy per-command
  `--confirm` flag → shared engine flag (same CLI spelling);
  CONFIRMATION_REQUIRED → CLI.CONSENT_REQUIRED (meta gone); yes/no
  never existed for these commands (type-to-confirm is the new
  interactive surface).
- Consent test matrix per command: non-interactive `--confirm <id>` →
  success; non-interactive without → `CLI.CONSENT_REQUIRED` exit 2;
  interactive scripted answer = the token → success; wrong scripted
  answer → structural failure exit 2; `--yes` without `--confirm` →
  `CLI.CONSENT_REQUIRED` exit 2.

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
- **The stdout lane carries data, not decoration (amended 2026-08-11).**
  "Table data rows go to stdout" means the values, not the cells the
  human table happens to render. Where a human column glues two facts
  together for readability, stdout takes the raw one. The case that
  forced this: `project env list`'s first column is
  `` `${key} (${source})` ``, and reusing it for stdout made a piped
  line read `STRIPE_KEY (project)` — a consumer would have to split on
  `" ("` to recover the key, which defeats the entire reason the lane
  exists. stdout carries the bare key; anything needing the source uses
  `--json`, which carries the whole record. Check every list command's
  stdout rows against this, not just the one that was caught.
- **Cancellation is never remapped (amended 2026-08-11).** A handler
  that wraps a rejected operation in a mapped error must first rethrow
  when `ctx.signal.aborted`, so a cancelled run settles as cancelled
  rather than as a failure of the thing it was doing. Both wrapping
  sites — `project create` and `project link`, each around
  `createProject` — do this.
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

### 10a. Closure amendments (orchestrator, 2026-08-10)

Four additions the closure review pass required. Each is an amendment
because §10 otherwise forbids adding cases the child docs do not name.

1. **An errored case for `project list` and `project env list`.**
   R-S2b-9 requires one per command and d1 §3.1 and §3.10 omitted it;
   the contract outranks the child doc, so the omission is the error.
   These are the only two commands whose error mapper no test reaches,
   and a mapper returning null where it should map is a defect this
   slice has already shipped once and had to fix. `project list` drives
   a 403 and asserts `PROJECT.AUTH_REQUIRED` at exit 2; `project env
   list` drives a 500 and asserts `PROJECT.ENV_API_ERROR` at exit 2.
2. **A golden-rendering entry for a masked secret card.** §10 asks for
   one representative per new output surface class, and the masked
   secret is one — no child doc named it, so none was added. Without it
   nothing in this package proves `sensitive: true` reaches the screen
   as `********`; the engine could regress and the suite would stay
   green. `bucket key create` is the representative: assert the exact
   stderr card including the mask and the exact four stdout lines.
   Note what the mask is and is not — the card masks while stdout
   prints the same secret in the clear a line later, because that is
   how the caller receives it. It is a scroll-back and screen-share
   courtesy, not containment.
3. **The mount-coverage test asserts a literal command list.** Its
   three existing assertions compare the two maps only to each other,
   so deleting a command from both leaves it green and it would pass on
   a five-command CLI. It gains a fourth assertion comparing the sorted
   mount paths to a literal sorted array — the only one that can catch
   a deletion or a misspelling, and the test S2c and S2d will lean on.
4. **The legacy-context adapter reports its own limits.** `v8/project/
   context.ts` casts a three-field object to the legacy `CommandContext`.
   The cast is accepted for this slice and the structural fix stays with
   S2d, but a future legacy edit reading a fourth field currently
   compiles clean and throws an unhelpful runtime error — worst case
   inside `project transfer`, after the project has already moved. The
   adapter therefore refuses unknown reads with a message naming the
   key, proven by a test driving all five call sites.

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
