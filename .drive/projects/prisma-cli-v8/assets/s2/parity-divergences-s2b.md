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
    `prisma-cli auth login`. Its fix text also loses the clause ", or
    rerun the command in a TTY to sign in interactively." and reads
    "Run prisma-cli auth login." — auto-login is gone (R-S2b-2), so
    rerunning in a terminal can no longer sign anyone in and the
    sentence pointed at a remedy v8 does not have (operator ruling
    2026-08-10; conventions §4). The legacy shell keeps the original
    sentence, which is still true there.
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
46. **A rejected project listing is reported as an empty workspace —
    ported defect, unchanged from the old shell.** (Numbered after D3
    because the sequence is file-wide; found in the closure review and
    recorded here because `project list` is where it surfaces.)
    `listRealWorkspaceProjects` (`controllers/project.ts`) destructures
    only `data` from the SDK response and discards `error` and
    `response`, so any non-2xx becomes `data === undefined` and then an
    empty project list. `project list` therefore prints "No projects
    found." and exits 0 when the API rejects the request, and because
    `resolveProjectTarget` resolves project names through the same
    function, every command that resolves a project by name reports
    "Choose a Project before running this command" or a not-found when
    the real cause is a rejected request. The behaviour is identical in
    the legacy shell — this slice changes nothing and inherits it — and
    the database, branch, bucket, app and env controllers share it.
    Found during the S2b closure review; pinned by the `project list`
    case "reports an empty workspace when the projects route rejects
    the request" so a future change to that function surfaces as a
    failing test rather than a silent one. Whether to surface the error
    instead is the operator's decision, not this slice's: the fix is a
    legacy body change and it would change behaviour for the old shell
    too.

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
    `CLI.PROMPT_INVALID`, exit 2; and cancelling the prompt with
    Ctrl-C or EOF settles `CLI.PROMPT_CANCELLED`, exit 3 — an exit
    code these commands never produced before, because they had no
    prompt to cancel.
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
30. **`database-plan-limit.test.ts` trimmed to its provider cases.**
    Seven cases drove the ported `database show` through the legacy
    shell and are deleted; the mapped plan-limit error is covered by
    the v8 postgres tests, both with and without a subscription
    lookup result. The eleven provider unit cases stay, because the
    provider is the operation layer v8 calls (d2 §5): the plan-limit
    discriminator, the responses that must not be classified as plan
    limits, and the 3-second subscription-lookup timeout. The one
    behavior that goes with the deleted cases is the legacy shell's
    cancel path (exit 130 with `COMMAND_CANCELED` when the caller
    aborts during enrichment); in v8 cancellation is engine-owned.

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

## D3 — the `bucket`, `branch` and `git` groups

Delivered: `bucket list|create|delete`, `bucket key list|create|delete`,
`branch list`, `git connect` and `git disconnect` — all nine commands,
`git connect` included.

`git connect` shipped in two parts. Everything but the wait for the
GitHub App installation landed first; the wait followed once the operator
extended the engine (commit c463aa1) with an optional `interval` on
`BrowserWaitRequest` and an `open-url` kind on `NextAction`, and settled
the three facts d3 §3.8 had pinned against a helper that could not supply
them. The four resolutions are recorded below as divergences 42 to 45 —
42 is the `open-url` change, 43 to 45 the rest — and in §3.8's STEP 5
RESOLVED block.

### Divergences

D1's class entries 1 (exit codes), 2 (auto-login dropped), 5 (nextActions
from fix and nextSteps), 6 (package-runner strings dropped), 7 (`--trace`
→ `--log-level verbose`), 9 (engine blocks replace the legacy rail
rendering) and 18 (the shell-context adapter, used here for project
resolution) apply identically, as do D2's 26 (list data rows go to
stdout), 27 (pre-result progress lines dropped) and 28 (`verboseContext`
dropped). On top of them:

31. **Error-code maps** (see below), including the mechanical passthrough
    of raw API codes as `BUCKET.<code>`, `BRANCH.<code>` and
    `GIT.<code>`.
32. **`bucket delete` gains a consent prompt.** The legacy command had a
    `--confirm <bucket-id>` flag and no prompt at all. In v8 the flag is
    the engine's shared repeatable `--confirm`, with the same CLI
    spelling and the same exact-bucket-id value; interactively the user
    types the bucket id. The question is the legacy confirmation `why`
    sentence verbatim: "Deleting this bucket permanently removes all
    objects and access keys." The legacy `CONFIRMATION_REQUIRED` error is
    unreachable, so the bucket mapper has no entry for it and
    `meta.expectedConfirm` / `meta.receivedConfirm` are gone. `--yes`
    never grants consent; a wrong typed answer is `CLI.PROMPT_INVALID`,
    exit 2; cancelling with Ctrl-C or EOF settles `CLI.PROMPT_CANCELLED`,
    exit 3 — an exit code this command never produced before.
33. **`bucket key delete` still has no confirmation.** The legacy
    inconsistency ports unchanged: deleting a bucket needs consent,
    revoking one of its keys does not. Recorded for review, not fixed.
34. **Fixture-only errors die with the fixture machinery.**
    `BUCKET_NOT_FOUND`, `BUCKET_KEY_NOT_FOUND` and the bucket domain's
    `BRANCH_NOT_FOUND` were raised only by the fixture provider. In real
    mode the Management API's own code passes through as
    `BUCKET.<code>`, so none of the three has a v8 counterpart.
35. **`bucket key create --role` invalid values.** The engine's enum
    parse failure replaces commander's choices error. The controller's
    own defaulting is unchanged: any value that is not exactly `read`,
    the omitted flag included, is `read_write`.
36. **`bucket key create` credentials are a masked field block.** The
    four stdout lines are unchanged and exact —
    `S3_ENDPOINT=`, `S3_ACCESS_KEY_ID=`, `S3_SECRET_ACCESS_KEY=`,
    `S3_BUCKET=`, in that order — and the json `result` still carries the
    secrets. The human card gains the same four values as field rows,
    with `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` masked
    (`sensitive: true`); the legacy human output named no values at all.
37. **`branch list` keeps its resolution quirk.** It declares no
    `--project` flag and passes no command name to the resolver, so an
    unbound directory still reads "…and this command will not choose
    one…" and still lacks the retry-with-`--project` next step. The
    fixture-mode branch of the legacy controller — which returned
    `projectName: "not resolved"` and an empty list instead of erroring —
    has no v8 counterpart.
38. **`git connect` declares `needs.interaction`.** Every non-interactive
    run now fails early with the engine's `CLI.INTERACTION_REQUIRED`
    (exit 2), before any API call. That removes two legacy behaviors: a
    non-interactive run that succeeded because the repository was already
    reachable, and the immediate `REPO_INSTALLATION_REQUIRED` /
    `REPO_NOT_ACCESSIBLE` errors carrying `installUrl` in `meta`.
39. **`git connect` and `git disconnect` keep their raw json result.**
    Neither had a serializer, so `--json` still emits
    `{ workspace, project, resolution, repositoryConnection }` —
    resolution object included, unlike the bucket and branch results,
    which strip or reshape. Unchanged; recorded for review.
40. **The legacy 401/403 → `AUTH_REQUIRED` mapping does not port.** The
    engine settles every real credentials failure itself, so what still
    reaches the git mapper is the permission residue of a returned 403.
    It maps mechanically to `GIT.AUTH_REQUIRED` — D1's class entry 14,
    same reasoning, including that entry's fix-text change: the offer
    to rerun in a TTY to sign in interactively is dropped, so the fix
    reads "Run prisma-cli auth login."
41. **`PROJECT_AMBIGUOUS`'s hardcoded `app deploy` next step ports
    verbatim** for `bucket list`, `bucket create` and the git commands, as
    it did in D1. A pre-existing quirk, recorded rather than fixed.
42. **Install-URL next steps become `open-url` actions.** The legacy
    `REPO_INSTALLATION_REQUIRED` and `REPO_NOT_ACCESSIBLE` errors put the
    raw install URL first in `nextSteps`, beside real commands.
    Conventions §4's mechanical mapping would turn it into a
    `run-command` whose command is a URL, which tells a consumer to
    execute it. `NextAction` now has an `open-url` kind and a `url`
    field, so the git mapper sends a `nextSteps` entry that is a URL to
    `{ kind: "open-url", label: <the URL>, url: <the URL> }` and leaves
    command strings on the `run-command` mapping. The URL text is
    unchanged.
43. **The install wait moves onto the engine's browser-wait helper.**
    The legacy handler opened the browser itself, wrote one wait line to
    stderr and ran its own poll loop. `ctx.prompt.browserWait` now owns
    all three: it emits one `endpoint` event carrying the wait sentence
    and the install URL — which is what the single legacy stderr line
    was — opens the browser, and polls on the engine clock. The handler
    supplies only the URL, the message, the cadence and the question
    being polled, and emits no events of its own. The poll question is
    unchanged: re-list the workspace's GitHub App installations and look
    for the repository in them.
44. **`opened` is dropped from the wait's terminal errors.**
    `browserWait` does not report whether the browser actually opened.
    Both legacy branches existed to make sure the user still had the
    install URL when no browser opened, and the engine now always writes
    the URL, so the distinction has no work left to do.
    `GIT.REPO_INSTALLATION_REQUIRED` therefore always carries the
    browser-opened fix text, "Finish installing the GitHub App in the
    browser, then rerun prisma-cli git connect.", and both terminal
    errors carry `meta: { repository, installUrl }` — the `opened` key
    is gone. Which of the two errors is raised is unchanged:
    `GIT.REPO_NOT_ACCESSIBLE` when at least one installation could be
    inspected, `GIT.REPO_INSTALLATION_REQUIRED` otherwise.
45. **The poll cadence is unchanged but now belongs to the engine.**
    `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS` (default 2000) and
    `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` (default 120000) are still
    read from the environment with the legacy positive-integer parsing —
    a non-positive or unparseable value falls back to the default — and
    are passed to `browserWait` as `interval` and `timeout`. The engine
    raises `CLI.BROWSER_WAIT_TIMEOUT` when the timeout elapses; the
    handler catches exactly that code and settles the legacy terminal
    error in its place, so the timeout the user sees is unchanged.
    Cancelling with Ctrl-C splits by timing: while the wait is sleeping
    between polls — where a user spends almost all of a two-minute wait —
    it settles `CLI.PROMPT_CANCELLED`, exit 3, where the legacy loop
    aborted with the shell's `COMMAND_CANCELED`, exit 130. When a poll
    request is already in flight the abort surfaces from the SDK client
    instead, and the engine settles `CLI.ABORTED`, exit 130 — the legacy
    exit code, unchanged. Both paths are tested. The split is accepted
    rather than smoothed over: reshaping the second into the first would
    mean catching the engine's own abort settlement inside the handler,
    and the engine is a hard boundary for this slice (conventions §14).

### Error code maps

| legacy code | v8 code |
| --- | --- |
| `USAGE_ERROR` (bucket domain) | `BUCKET.USAGE_ERROR` |
| `BUCKET_KEY_SECRET_MISSING` | `BUCKET.KEY_SECRET_MISSING` |
| `BUCKET_API_ERROR` | `BUCKET.API_ERROR` |
| raw API `error.code` X (bucket) | `BUCKET.X` |
| `CONFIRMATION_REQUIRED` (bucket) | unreachable — the engine's `CLI.CONSENT_REQUIRED` replaces it |
| `BUCKET_NOT_FOUND` / `BUCKET_KEY_NOT_FOUND` / `BRANCH_NOT_FOUND` (fixture only) | unreachable in v8 |
| `BRANCH_API_ERROR` | `BRANCH.API_ERROR` |
| raw API `error.code` X (branch) | `BRANCH.X` |
| `USAGE_ERROR` (project domain, raised by git) | `GIT.USAGE_ERROR` |
| `REPO_PROVIDER_UNSUPPORTED` | `GIT.REPO_PROVIDER_UNSUPPORTED` |
| `REPO_ALREADY_CONNECTED` | `GIT.REPO_ALREADY_CONNECTED` |
| `REPO_INSTALLATION_REQUIRED` | `GIT.REPO_INSTALLATION_REQUIRED` |
| `REPO_NOT_ACCESSIBLE` | `GIT.REPO_NOT_ACCESSIBLE` |
| `REPO_NOT_CONNECTED` | `GIT.REPO_NOT_CONNECTED` |
| `REPO_CONNECTION_FAILED` | `GIT.REPO_CONNECTION_FAILED` |
| `AUTH_REQUIRED` (403 residue, git) | `GIT.AUTH_REQUIRED` |
| raw API `error.code` X (git) | `GIT.X` |
| `USAGE_ERROR` "Workspace required" (auth domain) | `AUTH.USAGE_ERROR` |
| `PROJECT_NOT_FOUND` / `PROJECT_AMBIGUOUS` / `PROJECT_SETUP_REQUIRED` / `LOCAL_STATE_STALE` / `LOCAL_PROJECT_WORKSPACE_MISMATCH` | the project group's codes, mapped by the single source in `v8/project/errors.ts` |

### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `bucket list` | `bucket list` | R-S2b-2, 5, 9, 10; d3 §3.1 | 1, 2, 5, 6, 7, 9, 18, 26, 28, 31, 41 |
| `bucket create` | `bucket create` | R-S2b-2, 5, 9, 10; d3 §3.2 | 1, 2, 5, 6, 7, 9, 18, 27, 28, 31, 34, 41 |
| `bucket delete` | `bucket delete` | R-S2b-2, 3, 5, 9, 10; d3 §3.3 | 1, 2, 5, 6, 7, 9, 31, 32, 34 |
| `bucket key list` | `bucket key list` | R-S2b-2, 5, 9, 10; d3 §3.4 | 1, 2, 5, 6, 7, 9, 26, 31, 34 |
| `bucket key create` | `bucket key create` | R-S2b-2, 4, 5, 9, 10; d3 §3.5 | 1, 2, 5, 6, 7, 9, 27, 31, 34, 35, 36 |
| `bucket key delete` | `bucket key delete` | R-S2b-2, 5, 9, 10; d3 §3.6 | 1, 2, 5, 6, 7, 9, 31, 33, 34 |
| `branch list` | `branch list` | R-S2b-2, 5, 9, 10; d3 §3.7 | 1, 2, 5, 6, 7, 9, 18, 26, 28, 31, 37 |
| `git connect` | `git connect` | R-S2b-2, 5, 7, 9, 10; d3 §3.8 | 1, 2, 5, 6, 7, 9, 18, 31, 38, 39, 40, 41, 42, 43, 44, 45 |
| `git disconnect` | `git disconnect` | R-S2b-2, 5, 9, 10; d3 §3.9 | 1, 2, 5, 6, 7, 9, 18, 31, 39, 40, 41 |

### Legacy tests deleted

- `bucket.test.ts` and `branch.test.ts` in full. Every case in both
  drove one of the seven ported bucket and branch commands through the
  legacy shell, help cases included, and neither file held a provider or
  adapter unit test. There is no bucket-provider unit test anywhere, so
  nothing survived them to keep.
- `project.test.ts`: the six git connect and git disconnect fixture
  cases. The project and env help cases stay — they belong to D1 and
  still pass, and one of them also asserts the legacy shell's git help,
  which lives until the shell is deleted in S2d.
- `project-real-mode.test.ts`: six cases in two passes. With the first
  D3 commit went connecting through an installed GitHub App, the
  already-connected-same-repository short-circuit, and disconnecting
  through the source-repositories API. Once `git connect`'s wait landed,
  three more followed: the non-interactive install intent when the
  workspace has no GitHub App installation, the interactive wait that
  connects after approval, and `REPO_NOT_ACCESSIBLE` when the App cannot
  see the repository. All six are covered by `v8-git.test.ts`.

Kept deliberately: `git-adapter.test.ts` (URL-parsing units for
`parseGitHubRepositoryUrl`, an operation-layer function v8 calls);
`branch-controller.test.ts` and `branch-usecases.test.ts` (unit tests for
the branch helpers, which survive as the operation layer — d3 §5's rule,
not the unported-group rule: `branch list` is ported and has a
conformance row); `read-branch.test.ts` and `local-branch.test.ts`
(unported, until S2d);
the two pagination-cursor-stall cases in `project-real-mode.test.ts`,
which cover `listScmInstallations` and `findRepositoryInInstallation`,
operation-layer functions v8 calls and does not otherwise cover; and the
one `project-real-mode.test.ts` case from the GitHub App install path,
"creates an install intent when the stored GitHub App installation is
unavailable". It drives a stored installation answering 422 and being
skipped inside `findRepositoryInInstallations`, an operation-layer
function v8 calls and does not otherwise exercise. Its three siblings
were held while `git connect`'s wait was unported and were deleted once
the wait landed and gave them v8 equivalents.
