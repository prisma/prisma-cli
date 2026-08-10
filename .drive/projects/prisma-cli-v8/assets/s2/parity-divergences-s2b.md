# S2b parity divergences

Divergences introduced by the S2b resource port. Grows per dispatch;
D4 consolidates. The auth stream owns `parity-divergences.md` — this
file never duplicates it.

## D1 — the `project` group

Delivered: all 11 commands — `project
list|show|create|link|rename|remove|transfer` and
`project env add|update|list|remove`. `remove` and `transfer` landed
in round 2, once the engine's consent tokens arrived
(conventions §5).

### Class divergences

1. **Exit codes.** Every errored settlement exits 2. The legacy
   commands exited 1 for `PROJECT_NOT_FOUND`, `PROJECT_AMBIGUOUS`,
   `PROJECT_SETUP_REQUIRED`, `LOCAL_STATE_STALE`,
   `LOCAL_PROJECT_WORKSPACE_MISMATCH`, `LOCAL_STATE_WRITE_FAILED`,
   `PROJECT_CREATE_FAILED`, `PROJECT_RENAME_FAILED`,
   `ENV_VARIABLE_ALREADY_EXISTS`, `ENV_VARIABLE_NOT_FOUND`,
   `ENV_BRANCH_NOT_FOUND`, `ENV_BRANCH_SCOPE_IS_PRODUCTION`,
   `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH`,
   `ENV_FILE_APPLY_FAILED`, `ENV_API_ERROR` and the API-passthrough
   codes; usage errors already exited 2.
2. **Auto-login dropped** (R-S2b-2). Every command declares
   `needs.credentials`; an unauthenticated invocation settles with the
   engine's `CLI.CREDENTIALS_REQUIRED` (exit 2) instead of launching
   an interactive browser login.
3. **Error codes** are dotted (§ "Error code map" below).
4. **`verboseContext` dropped.** `--verbose` is a log level in v8, so
   the env results no longer carry the resolved-context block, and the
   "Resolved context" / "Env target" verbose blocks do not port. The
   json `result` is unchanged, because the legacy serializers already
   stripped `verboseContext`.
5. **NextActions.** The legacy `fix` prose becomes exactly one
   `user-choice` action and each legacy `nextSteps` string becomes a
   `run-command` action whose label is the command. The legacy
   `journey` field has no v8 counterpart and is dropped.
6. **Package-runner command strings dropped.** Command strings in
   nextActions are `${CLI_NAME} …`, never
   `npx -y @prisma/cli@latest …`.
7. **`--trace` fix text** becomes `--log-level verbose`.
8. **List data rows go to stdout** in human mode (`project list`,
   `project env list`); legacy human mode wrote nothing to stdout.
9. **Human rendering** is engine blocks, not the legacy rail-and-card
   bytes. The title, field labels, table columns and empty-state
   sentences port verbatim.

### D1-specific divergences

10. **`rm` alias dropped** for `project env remove` (R-S2b-8). The v8
    tree has exact paths only.
11. **`project link` picker, non-interactive.** Without a positional
    and without a TTY (or under `--yes`), the engine's
    `CLI.PROMPT_REQUIRED` (exit 2) replaces the legacy
    `PROJECT_LINK_TARGET_REQUIRED` error. Its `meta.candidates`,
    `meta.suggestedProjectName` and its rich nextActions are lost —
    **flagged for operator review**.
12. **`PROJECT_AMBIGUOUS`** was exit 1 in the legacy code (the
    inventory says 2); it is exit 2 in v8 like every other errored
    settlement.
13. **`--role` invalid values.** The engine's enum parse failure
    replaces commander's `Allowed choices are production, preview.`
    message.
14. **The legacy `AUTH_REQUIRED` code maps mechanically to
    `PROJECT.AUTH_REQUIRED`** (summary, why and next steps verbatim,
    exit 2 instead of 1). The engine owns every real credentials
    failure — an expired stored session settles
    `CLI.CREDENTIALS_REQUIRED` and a rejected env token settles
    `AUTH.SERVICE_TOKEN_REJECTED`, both before a handler sees them —
    so what still reaches `apiCallError` is the permission residue, a
    returned 403, which is not a sign-in problem. The legacy next
    step's `prisma auth login` copy bug normalizes to
    `prisma-cli auth login`.
15. **`project rename` name-validation copy** still reads "Project
    create requires a name" — the legacy copy bug ports verbatim
    (recorded, not fixed).
16. **Preview-default warning becomes a diagnostic.** The legacy
    `warnings` string on `project env add` (branch scope, key absent
    from preview) becomes a `warn` diagnostic under the code
    `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` (d1-project.md §4.8; the
    operator ratifies it through this list). The local-pin warnings
    of `project remove` and `project transfer` become `warn`
    diagnostics the same way, under the already-pinned
    `PROJECT.LOCAL_STATE_WRITE_FAILED`.
17. **Env file-mode nextSteps.** A `#`-comment line in the legacy
    `splitFileNextSteps` output is not an action of its own: it
    becomes the `reason` of the run-command action it introduces, so
    `# existing keys: "A"` explains the `project env update --file
    …existing` step rather than standing beside it.
18. **Legacy shell-context adapter.** The pinned resolution and env
    functions (`resolveProjectTarget`, `inspectProjectBinding`,
    `resolveEnvWriteInput`, `runEnvAddFile`, `runEnvUpdateFile`,
    `cleanupLocalPinForProject`, `rewriteOrClearLocalPinForProject`)
    take the legacy shell `CommandContext` but read only
    `runtime.cwd`, `runtime.env` and `runtime.signal`. v8 calls them
    through the runtime-slice adapter in `v8/project/context.ts`
    (d1-project.md §4.9) — accepted for this slice; the signature
    cleanup belongs to S2d, when the legacy shell dies.
19. **Consent is engine-owned** (conventions §5). `project remove`
    and `project transfer` declare no `--confirm` flag; the engine
    injects the shared repeatable one, with the same CLI spelling and
    the same exact-project-id value. Interactively the user types the
    project id (there was no prompt at all before). The legacy
    `CONFIRMATION_REQUIRED` error is gone: a missing or wrong grant is
    the engine's `CLI.CONSENT_REQUIRED` (exit 2, was exit 2) or
    `CLI.PROMPT_INVALID`, and its `meta.expectedConfirm` /
    `meta.receivedConfirm` do not survive. `--yes` never grants
    consent.
20. **Transfer's recipient resolution** drops the fixture branch and
    calls `resolveRecipientWorkspaceSession` directly; the
    service-token guard, the recipient error mapping and every copy
    string are unchanged.

### Error code map

| legacy code | v8 code |
| --- | --- |
| `USAGE_ERROR` (project/app domain) | `PROJECT.USAGE_ERROR` |
| `USAGE_ERROR` "Workspace required" (auth domain) | `AUTH.USAGE_ERROR` |
| `PROJECT_NOT_FOUND` | `PROJECT.NOT_FOUND` |
| `PROJECT_AMBIGUOUS` | `PROJECT.AMBIGUOUS` |
| `PROJECT_SETUP_REQUIRED` | `PROJECT.SETUP_REQUIRED` |
| `LOCAL_STATE_STALE` | `PROJECT.LOCAL_STATE_STALE` |
| `LOCAL_PROJECT_WORKSPACE_MISMATCH` | `PROJECT.LOCAL_WORKSPACE_MISMATCH` |
| `LOCAL_STATE_WRITE_FAILED` | `PROJECT.LOCAL_STATE_WRITE_FAILED` |
| `PROJECT_CREATE_FAILED` | `PROJECT.CREATE_FAILED` |
| `PROJECT_RENAME_FAILED` | `PROJECT.RENAME_FAILED` |
| `ENV_VARIABLE_ALREADY_EXISTS` | `PROJECT.ENV_VARIABLE_ALREADY_EXISTS` |
| `ENV_VARIABLE_NOT_FOUND` | `PROJECT.ENV_VARIABLE_NOT_FOUND` |
| `ENV_BRANCH_NOT_FOUND` | `PROJECT.ENV_BRANCH_NOT_FOUND` |
| `ENV_BRANCH_SCOPE_IS_PRODUCTION` | `PROJECT.ENV_BRANCH_SCOPE_IS_PRODUCTION` |
| `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` | `PROJECT.ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` |
| `ENV_FILE_APPLY_FAILED` | `PROJECT.ENV_FILE_APPLY_FAILED` |
| `ENV_API_ERROR` | `PROJECT.ENV_API_ERROR` |
| `PROJECT_API_ERROR` | `PROJECT.API_ERROR` |
| `PROJECT_REMOVE_BLOCKED` | `PROJECT.REMOVE_BLOCKED` |
| `PROJECT_TRANSFER_REJECTED` | `PROJECT.TRANSFER_REJECTED` |
| `TRANSFER_RECIPIENT_REQUIRED` | `PROJECT.TRANSFER_RECIPIENT_REQUIRED` |
| `TRANSFER_RECIPIENT_UNAVAILABLE` | `PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE` |
| `WORKSPACE_AMBIGUOUS` / `WORKSPACE_NOT_AUTHENTICATED` | `AUTH.WORKSPACE_AMBIGUOUS` / `AUTH.WORKSPACE_NOT_AUTHENTICATED` |
| `AUTH_REQUIRED` | `PROJECT.AUTH_REQUIRED` |
| raw API `error.code` X | `PROJECT.X` |
| `FEATURE_UNAVAILABLE` (fixture only) | unreachable in v8 |

`PROJECT.CONFIRMATION_REQUIRED` and `PROJECT.LINK_TARGET_REQUIRED`
remain in the mapper table but are unreachable: the engine's consent
and prompt errors replace them.

### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `project list` | `project list` | R-S2b-2, 5, 9, 10; d1 §3.1 | 1, 2, 3, 5, 6, 8, 9 |
| `project show` | `project show` | R-S2b-2, 5, 9, 10; d1 §3.2 | 1, 2, 3, 5, 9, 12, 18 |
| `project create` | `project create` | R-S2b-2, 5, 9, 10; d1 §3.3 | 1, 2, 3, 5, 9 |
| `project link` | `project link` | R-S2b-2, 5, 6, 9, 10; d1 §3.4 | 1, 2, 3, 5, 9, 11, 12 |
| `project rename` | `project rename` | R-S2b-2, 5, 9, 10; d1 §3.5 | 1, 2, 3, 5, 9, 15, 18 |
| `project env add` | `project env add` | R-S2b-2, 5, 9, 10; d1 §3.8 | 1, 2, 3, 4, 5, 9, 13, 14, 16, 17, 18 |
| `project env update` | `project env update` | R-S2b-2, 5, 9, 10; d1 §3.9 | 1, 2, 3, 4, 5, 9, 13, 14, 17, 18 |
| `project env list` | `project env list` | R-S2b-2, 5, 9, 10; d1 §3.10 | 1, 2, 3, 4, 5, 8, 9, 13, 14, 18 |
| `project env remove` | `project env remove` | R-S2b-2, 5, 8, 9, 10; d1 §3.11 | 1, 2, 3, 4, 5, 9, 10, 13, 14, 18 |
| `project remove` | `project remove` | R-S2b-2, 3, 5, 9, 10; d1 §3.6 | 1, 2, 3, 5, 9, 16, 18, 19 |
| `project transfer` | `project transfer` | R-S2b-2, 3, 5, 9, 10; d1 §3.7 | 1, 2, 3, 5, 9, 16, 18, 19, 20 |

## D2 — the `postgres` group

Delivered: all 11 commands —
`postgres list|show|create|usage|restore|remove`,
`postgres backup list`, and
`postgres connection list|create|rotate|remove`.

### Divergences

D1's class entries 1 (exit codes), 2 (auto-login dropped), 5
(nextActions from fix and nextSteps), 6 (package-runner strings
dropped), 7 (`--trace` → `--log-level verbose`), 9 (engine blocks
replace the legacy rail rendering) and 18 (the shell-context adapter,
used here for project resolution) apply identically. On top of them:

21. **Rename** (R-S2b-1). The group, its subgroups, every command
    path and id (`postgres.connection.rotate`), every help string and
    example, and every command reference inside `why`, `fix` and
    nextAction text move from `database` to `postgres`. No alias
    survives. The resource noun "database" in prose is unchanged —
    the resource is a Prisma Postgres database.
22. **Error-code map** (see below), including the mechanical
    passthrough of raw API codes as `POSTGRES.<code>`.
23. **Consent is engine-owned** for `restore`, `remove`,
    `connection rotate` and `connection remove`: no `--confirm` flag
    is declared, the engine injects the shared one with the same
    spelling and the same exact-id value, and interactively the user
    types that id. The legacy `CONFIRMATION_REQUIRED` error is
    unreachable, so `POSTGRES.CONFIRMATION_REQUIRED` has no entry in
    the mapper and `meta.expectedConfirm` / `meta.receivedConfirm`
    are gone. `--yes` never grants consent; a wrong typed answer is
    `CLI.PROMPT_INVALID`, exit 2.
24. **Consent prompts are new.** The legacy commands had no
    interactive confirmation at all — only the flag. The prompt's
    question is each command's legacy confirmation `why` sentence,
    verbatim.
25. **Plan-limit rendering.** PR #127's `humanLines` full-page
    override does not port. The error keeps its summary, why and meta
    verbatim and carries exactly one `user-choice` nextAction whose
    reason is the upgrade URL and plan name when the best-effort
    subscription lookup returned them, and the Console guidance
    otherwise.
26. **List commands write their data rows to stdout** in human mode
    (`postgres list`, `postgres backup list`, `postgres connection
    list`); legacy human mode wrote nothing to stdout. `show` and
    `usage` mirror their field rows the same way.
27. **Pre-result progress lines dropped.** `Creating database...`,
    `Creating connection...` and `Rotating connection...` have no v8
    counterpart: these are sync commands with no events.
28. **`verboseContext` dropped** from every result, and with it the
    `--verbose` "Resolved context" and metadata blocks. The json
    envelope is unchanged, since the legacy serializers already
    stripped it.
29. **Fixture-only `DATABASE_CONNECTION_NOT_FOUND`** has no v8
    counterpart: in real mode an unknown connection is an API
    passthrough code on rotate and remove.
30. **`database-plan-limit.test.ts` deleted.** Every case drove a
    ported command. The mapped plan-limit error is covered by the v8
    postgres tests with and without a subscription result; the
    provider's own enrichment internals (the 3s lookup timeout, the
    cancel path) are no longer covered by a command-level test.

### Error code map

| legacy code | v8 code |
| --- | --- |
| `USAGE_ERROR` (database domain) | `POSTGRES.USAGE_ERROR` |
| `USAGE_ERROR` "Workspace required" (auth domain) | `AUTH.USAGE_ERROR` |
| `DATABASE_NOT_FOUND` | `POSTGRES.NOT_FOUND` |
| `DATABASE_AMBIGUOUS` | `POSTGRES.AMBIGUOUS` |
| `DATABASE_CONNECTION_MISSING` | `POSTGRES.CONNECTION_MISSING` |
| `DATABASE_CONNECTION_STRING_MISSING` | `POSTGRES.CONNECTION_STRING_MISSING` |
| `DATABASE_BACKUPS_UNSUPPORTED` | `POSTGRES.BACKUPS_UNSUPPORTED` |
| `DATABASE_RESTORE_CONFLICT` | `POSTGRES.RESTORE_CONFLICT` |
| `DATABASE_BACKUP_NOT_FOUND` | `POSTGRES.BACKUP_NOT_FOUND` |
| `DATABASE_API_ERROR` | `POSTGRES.API_ERROR` |
| `PLAN_LIMIT_REACHED` | `POSTGRES.PLAN_LIMIT_REACHED` |
| raw API `error.code` X | `POSTGRES.X` |
| `PROJECT_NOT_FOUND` / `PROJECT_AMBIGUOUS` / `PROJECT_SETUP_REQUIRED` / `LOCAL_STATE_STALE` / `LOCAL_PROJECT_WORKSPACE_MISMATCH` | the project group's codes, mapped by the single source in `v8/project/errors.ts` |
| `CONFIRMATION_REQUIRED` | unreachable — the engine's `CLI.CONSENT_REQUIRED` replaces it |
| `AUTH_REQUIRED` / `AUTH_CONFIG_INVALID` | unreachable behind `needs.credentials` |

### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `postgres list` | `database list` | R-S2b-1, 2, 5, 9, 10; d2 §3.1 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 25, 26, 28 |
| `postgres show` | `database show` | R-S2b-1, 2, 5, 9, 10; d2 §3.2 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres create` | `database create` | R-S2b-1, 2, 4, 5, 9, 10; d2 §3.3 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 25, 27, 28 |
| `postgres usage` | `database usage` | R-S2b-1, 2, 5, 9, 10; d2 §3.4 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres restore` | `database restore` | R-S2b-1, 2, 3, 5, 9, 10; d2 §3.5 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 23, 24, 28 |
| `postgres remove` | `database remove` | R-S2b-1, 2, 3, 5, 9, 10; d2 §3.6 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 23, 24, 28 |
| `postgres backup list` | `database backup list` | R-S2b-1, 2, 5, 9, 10; d2 §3.7 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres connection list` | `database connection list` | R-S2b-1, 2, 5, 9, 10; d2 §3.8 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres connection create` | `database connection create` | R-S2b-1, 2, 4, 5, 9, 10; d2 §3.9 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 27, 28 |
| `postgres connection rotate` | `database connection rotate` | R-S2b-1, 2, 3, 4, 5, 9, 10; d2 §3.10 | 1, 2, 5, 6, 7, 9, 21, 22, 23, 24, 27, 29 |
| `postgres connection remove` | `database connection remove` | R-S2b-1, 2, 3, 5, 9, 10; d2 §3.11 | 1, 2, 5, 6, 7, 9, 21, 22, 23, 24, 29 |
