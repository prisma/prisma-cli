# S2b parity divergences

Divergences introduced by the S2b resource port. Grows per dispatch;
D4 consolidates. The auth stream owns `parity-divergences.md` — this
file never duplicates it.

## D1 — the `project` group

Delivered: `project list|show|create|link|rename`,
`project env add|update|list|remove` (9 of 11). `project remove` and
`project transfer` are held for the engine-owned consent-grant flag
(conventions §5, d1-project.md §3.6/§3.7), so their divergences are
not recorded yet.

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
14. **401/403 on env API calls.** The legacy `apiCallError` mapped
    them to `AUTH_REQUIRED` with a `prisma auth login` next step (a
    copy bug — every other string says `prisma-cli`). In v8 the code
    is not mapped: SDK auth failures propagate through `ctx.api` and
    the engine settles `CLI.CREDENTIALS_REQUIRED`. The copy bug does
    not port.
15. **`project rename` name-validation copy** still reads "Project
    create requires a name" — the legacy copy bug ports verbatim
    (recorded, not fixed).
16. **Preview-default warning becomes a diagnostic.** The legacy
    `warnings` string on `project env add` (branch scope, key absent
    from preview) becomes a `warn` diagnostic. Its code
    `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` is **not pinned by the
    design** — it needs operator confirmation.
17. **Env file-mode nextSteps.** The legacy `splitFileNextSteps`
    comment lines (`# existing keys: …`) become `run-command` actions
    whose label and command are the comment string, because §4 maps
    every nextSteps entry uniformly.

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
| raw API `error.code` X | `PROJECT.X` |
| `AUTH_REQUIRED` | not mapped — the engine settles `CLI.CREDENTIALS_REQUIRED` |
| `FEATURE_UNAVAILABLE` (fixture only) | unreachable in v8 |

The held commands' codes (`PROJECT.REMOVE_BLOCKED`,
`PROJECT.TRANSFER_REJECTED`, `PROJECT.TRANSFER_RECIPIENT_REQUIRED`,
`PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE`,
`PROJECT.CONFIRMATION_REQUIRED`, `PROJECT.LINK_TARGET_REQUIRED`,
`AUTH.WORKSPACE_NOT_AUTHENTICATED`, `AUTH.WORKSPACE_AMBIGUOUS`) are
already in the mapper but no delivered command reaches them.

### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `project list` | `project list` | R-S2b-2, 5, 9, 10; d1 §3.1 | 1, 2, 3, 5, 6, 8, 9 |
| `project show` | `project show` | R-S2b-2, 5, 9, 10; d1 §3.2 | 1, 2, 3, 5, 9, 12 |
| `project create` | `project create` | R-S2b-2, 5, 9, 10; d1 §3.3 | 1, 2, 3, 5, 9 |
| `project link` | `project link` | R-S2b-2, 5, 6, 9, 10; d1 §3.4 | 1, 2, 3, 5, 9, 11, 12 |
| `project rename` | `project rename` | R-S2b-2, 5, 9, 10; d1 §3.5 | 1, 2, 3, 5, 9, 15 |
| `project env add` | `project env add` | R-S2b-2, 5, 9, 10; d1 §3.8 | 1, 2, 3, 4, 5, 9, 13, 14, 16, 17 |
| `project env update` | `project env update` | R-S2b-2, 5, 9, 10; d1 §3.9 | 1, 2, 3, 4, 5, 9, 13, 14, 17 |
| `project env list` | `project env list` | R-S2b-2, 5, 9, 10; d1 §3.10 | 1, 2, 3, 4, 5, 8, 9, 13, 14 |
| `project env remove` | `project env remove` | R-S2b-2, 5, 8, 9, 10; d1 §3.11 | 1, 2, 3, 4, 5, 9, 10, 13, 14 |
| `project remove` | `project remove` | held (conventions §5) | not yet ported |
| `project transfer` | `project transfer` | held (conventions §5) | not yet ported |
