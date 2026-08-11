# Logic map — the `postgres` command group

Written from the code on branch `s2b2-domain-extraction` (which is `main` plus a spec draft). It answers two questions for each of the 11 `postgres` commands: where does the business logic actually live today, and what would a use case for that command need injected?

Paths are relative to `packages/cli/` unless they start with `packages/`. This document assumes no prior reading of the code.

## Terms used here

- **Handler** — the function passed to `defineCommand({ handler })` in a file under `src/v8/postgres/`. The engine calls it with the parsed arguments and one context object.
- **Provider** — `src/lib/database/provider.ts`. A 905-line object with 11 methods, each of which makes a request to the Prisma Management API and turns the response into a CLI-shaped record. Constructed per command run.
- **Controller** — `src/controllers/database.ts`. Originally the command bodies for the older commander-based CLI. The `postgres` handlers do not call those bodies; they call six helper functions that happen to live in the same file.
- **The group was renamed.** These commands were called `database` before, and everything they call still says "database" — the controller file, the provider file, the error codes, the result types. Only the user-facing command name changed.
- **Consent** — the engine's typed confirmation. `ctx.prompt.consent(question, { token })` makes the user type an exact string. Described fully in "Consent" below.

## The shape in one paragraph

The handlers hold input validation and all presentation and almost nothing else. Of the code the 11 commands reach that is not presentation, about 900 lines sit in the provider and about 200 in six helper functions in the controller file — so roughly four fifths of this group's own logic is in the provider. On top of that sits project resolution, another few hundred lines that this group does not own: it is shared with the `project`, `bucket`, `branch` and `git` groups.

## The shared spine

Nine of the 11 commands begin the same way, and seven of them then resolve a database the same way. Both routines are described once here; the per-command blocks refer back.

### `resolvePostgresContext` — the opening move for 9 of 11 commands

Defined in `src/v8/postgres/context.ts`. It runs three steps and returns `{ provider, target, projectId, projectName }`.

1. **`resolveActiveWorkspace(ctx)`** — `src/v8/resources-shared/workspace.ts`. Calls `ctx.activeCredential()` (the engine's local credential record, no network) and reads `workspaceId` off it. Absent workspace id throws a structured `AUTH.USAGE_ERROR` telling the user to run `prisma auth login`. Business logic, trivially small.
2. **`resolvePinnedProject(ctx, workspace, flags.project, commandName)`** — `src/v8/project/context.ts`, which wraps `resolveProjectTarget` in `src/lib/project/resolution.ts`. This is the substantial one, and it is shared with the `project`, `bucket`, `branch` and `git` groups:
   - When `--project` was given, it is matched against the workspace's project list by id or by name; no match throws `PROJECT_NOT_FOUND`, several matches throws `PROJECT_AMBIGUOUS`.
   - Otherwise it reads `.prisma/local.json` in the invocation directory (`readLocalResolutionPin`, `src/lib/project/local-pin.ts`) — a two-field file holding a workspace id and a project id. A pin naming a different workspace than the signed-in one throws `LOCAL_PROJECT_WORKSPACE_MISMATCH`. A pin naming a project the workspace no longer has throws `LOCAL_STATE_STALE`. Invalid JSON or an unexpected shape is treated as stale.
   - The project list itself comes from `listRealWorkspaceProjects(ctx.api, workspace, ctx.signal)` in `src/controllers/project.ts`: one `GET /v1/projects`, filtered to the active workspace, sorted by name then id. A rejected request throws rather than returning an empty list — the comment there records that the earlier behaviour reported "No projects found." and exited 0 while the API was refusing the request.
   - With no explicit project and no pin, it throws `PROJECT_SETUP_REQUIRED`. Building that error reads two more things from the filesystem: the `name` field of `package.json` in the invocation directory, and failing that the directory's own base name. That guessed name is offered as a suggestion only, never used to select a project.
   - `src/v8/project/context.ts` also holds `legacyOperationContext`, a Proxy that fabricates the older CLI's context object out of `ctx.cwd`, `ctx.env` and `ctx.signal` and throws a named error if anything reads a fourth field. It exists only because `resolveProjectTarget` still takes that older shape.
3. **`createManagementDatabaseProvider(ctx.api, { workspaceId })`** — builds the provider over the engine-owned API client. The workspace id is passed for one purpose only: the plan-limit lookup described under "The provider".

The two connection commands that address a connection by id (`rotate`, `remove`) skip all of this and call `resolvePostgresProviderOnly(ctx)` instead, which reads `ctx.activeCredential()` for a workspace id if there is one and constructs the provider. No workspace requirement, no project resolution, no filesystem access.

### `resolveDatabase` — turning "acme-preview" into a database

Defined in `src/controllers/database.ts` lines 912-953, called by 7 of the 11 commands — every one except `postgres list`, `postgres create`, `postgres connection rotate` and `postgres connection remove`. Given a user-typed reference:

1. Trims it; an empty string throws a `USAGE_ERROR` telling the user to pass an id or name.
2. Calls `provider.listDatabases({ projectId, branchName, signal })` — which pages through every database in the project (filtered by branch when `--branch` was given).
3. Filters for records whose `id` **or** `name` equals the reference exactly. No prefix matching, no fuzzy matching.
4. Zero matches throws `DATABASE_NOT_FOUND`, naming the project and branch in the message. Two or more throws `DATABASE_AMBIGUOUS`, whose `meta.matches` carries the id, name and branch of each candidate, with the advice to pass an id or add `--branch`.
5. Then calls `provider.showDatabase(selected.id, { projectId, signal })` and prefers that record over the one from the list, falling back to the listed one when the show request returns 404. This second request is why resolution costs two round trips.
6. Runs the result through `ensureProjectId`, which substitutes the caller's project id when the record's own is missing or empty.

This is unambiguously business logic, and it is the most expensive rule in the group. Combined with project resolution it means a command like `postgres connection list acme-preview` makes four API requests before it does the thing it was asked to do.

### Error mapping — the closing move for all 11 commands

Every handler wraps its whole body in `try/catch` and passes anything thrown to `mapPostgresOperationError` (`src/v8/postgres/errors.ts`). Anything that is not the older CLI's `CliError` class is rethrown untouched. A `CliError` is converted to the engine's `CliStructuredError` with a dotted code: nine known codes map to fixed `POSTGRES.*` names, `PLAN_LIMIT_REACHED` gets special handling, five project-resolution codes are handed to the project group's mapper so their wording stays identical, and any other code passes through as `POSTGRES.<RAW_CODE>`.

The mapper also rewrites text. Two regular expressions run over every `fix` string and every `nextSteps` entry: one replaces a package-runner prefix such as `npx @prisma/cli@8.0.0 ` with `prisma `, and the other rewrites `prisma database ` to `prisma postgres `. A third replaces `--trace` with `--log-level verbose`, and a fourth deletes an offer to "rerun the command in a TTY to sign in interactively", which the new CLI cannot do. In other words, the errors thrown by the provider and controller contain command lines written for a differently-named CLI, and the handler layer patches them on the way out.

### Round trips per command

Counting Management API requests in normal operation, excluding pagination beyond the first page and excluding the plan-limit lookup:

| Command | Requests | Made up of |
| --- | --- | --- |
| `postgres list` | 2 | projects, databases |
| `postgres show` | 4 | projects, databases, database, connections |
| `postgres create` | 2 | projects, create database |
| `postgres usage` | 4 | projects, databases, database, usage |
| `postgres restore` | 4, or 6 with `--source-database` | projects, databases, database, [databases, database,] restore |
| `postgres remove` | 4 | projects, databases, database, delete |
| `postgres backup list` | 4 | projects, databases, database, backups |
| `postgres connection list` | 4 | projects, databases, database, connections |
| `postgres connection create` | 4 | projects, databases, database, create connection |
| `postgres connection rotate` | 1 | rotate |
| `postgres connection remove` | 1 | delete connection |

### Output channels per command

The engine gives a handler four optional presentations. `human` is a list of blocks written to stderr. `stdout` is the machine-readable payload written to stdout. `json` is the object placed in the `--json` envelope's `result`; when a handler supplies none, the envelope falls back to whatever the handler passed as `data`. `next` is a list of suggested follow-up actions.

| Command | human | stdout | json | next |
| --- | --- | --- | --- | --- |
| `postgres list` | yes | yes | yes | — |
| `postgres show` | yes | yes | falls back to `data` | — |
| `postgres create` | yes | yes | falls back to `data` | — |
| `postgres usage` | yes | yes | falls back to `data` | — |
| `postgres restore` | yes | — | falls back to `data` | yes |
| `postgres remove` | yes | — | falls back to `data` | — |
| `postgres backup list` | yes | yes | yes | — |
| `postgres connection list` | yes | yes | yes | — |
| `postgres connection create` | yes | yes | falls back to `data` | — |
| `postgres connection rotate` | yes | yes | falls back to `data` | — |
| `postgres connection remove` | yes | — | yes | — |

Seven of the eleven have no `json` function, so for those the object a use case returns **is** the published `--json` contract. That constrains the return type of any use case for them: renaming a field there is a user-visible change.

---

## The 11 commands

### 1. `postgres list`

**Handler:** `src/v8/postgres/list.ts` (110 lines; the handler body is about 30 of them, the rest is presentation).

**What the handler does.**

- *Input parsing:* none of its own. `--project` and `--branch` arrive as strings from the engine and are used as given, untrimmed and unvalidated.
- *Business logic:* delegates entirely — the shared context resolution, then `provider.listDatabases`, then `sortDatabases`.
- *Assembly:* builds a `DatabaseListResult` of `{ projectId, projectName, branchName: flags.branch ?? null, databases }`.
- *Presentation:* two row builders. `databaseRows` renders for a person — a missing branch becomes the word "unscoped", a missing region becomes "unknown", the status comes from `formatStatus`. `databaseStdoutRows` renders the same five columns for a program, with an empty field wherever the human version writes a placeholder word. An empty list becomes the line "No databases found." instead of a table.

**Calls, in order.**

1. `resolvePostgresContext` — `src/v8/postgres/context.ts` (see the shared spine).
2. `provider.listDatabases` — `src/lib/database/provider.ts`. Loops `GET /v1/databases?projectId=&branchGitName=&cursor=` until the response's `pagination.hasMore` is false, then normalises each record.
3. `sortDatabases` — `src/controllers/database.ts` lines 962-974. Sorts by branch name (absent sorts as empty), then name, then id, all with `localeCompare`. A pure function, 13 lines.
4. `formatStatus` / `statusValue` — `src/v8/postgres/presentation.ts`. `formatStatus` returns the record's status, or "default" when the record is the project's default database, or "unknown". `statusValue` returns the status or an empty string, deliberately dropping the default-database fact because it is a different fact.
5. `serializeDatabaseList` — `src/presenters/database.ts`, only under `--json`. Wraps the databases in a generic list envelope with a `context` block naming the project and branch, and one item per database whose `status` is "default" or null.

**Where the business logic sits.** Below the handler, without exception. Pagination and normalisation in the provider, sorting in the controller file, everything about which project and which workspace in the shared resolution routine.

**External services.** The Management API (projects, databases, and the subscription endpoint on the plan-limit path); the local state file `.prisma/local.json`; the filesystem (`package.json` and the directory name, only when project resolution fails); the credential record; the abort signal.

### 2. `postgres show`

**Handler:** `src/v8/postgres/show.ts` (103 lines).

**What the handler does.**

- *Input parsing:* passes the positional through untouched; the trimming and the empty check happen inside `resolveDatabase`.
- *Business logic:* delegates — shared context, `resolveDatabase`, then `provider.listConnections(database.id)`.
- *Presentation:* seven field rows, in two versions again. The human version writes "unscoped" for a missing branch, "unknown" for a missing region, and `formatStatus` for the status; the stdout version writes empty fields. Both include a `connections` row that is the **count** of connections, not their contents — the command deliberately shows no secret values. Rendered on stdout as `label: value` lines.

**Calls, in order.** `resolvePostgresContext`; `resolveDatabase` (`src/controllers/database.ts`); `provider.listConnections` (`GET /v1/databases/{id}/connections`, then `normalizeConnection` per record, which defaults a missing name to the connection's id).

**Where the business logic sits.** All of it below the handler. The handler's only original contribution is the decision to show a count rather than a list, which is presentation.

**External services.** As `postgres list`.

### 3. `postgres create`

**Handler:** `src/v8/postgres/create.ts` (92 lines).

**What the handler does.**

- *Input parsing:* trims the positional name, and throws a `USAGE_ERROR` ("Database name required") when it is empty. This is the handler's own code and it is genuine input validation — but note that the error it builds is the older CLI's `CliError`, carrying a hand-written `nextSteps` line, which the error mapper then rewrites.
- *Business logic:* shared context, then `provider.createDatabase({ projectId, name, branchName, region, signal })`, then `ensureProjectId(created.database, projectId)`.
- *Presentation:* `secretBlocks(headline, connectionString)` with a headline built from `postgresTargetLabel(projectName, branchName)` — which joins them as `project / branch`, or just the project when the database is not branch-scoped. The connection URL is placed in a field row marked `sensitive: true`, which the engine renders as `********`. `stdout` prints the bare URL and nothing else.

**Calls, in order.** `resolvePostgresContext`; `provider.createDatabase` — `POST /v1/databases` with a body of `{ projectId, name, source: { type: "empty" }, branchGitName?, region? }`, then `normalizeCreatedDatabase`, which takes the first entry of the response's `connections` array and throws `DATABASE_CONNECTION_MISSING` if there is none; then `ensureProjectId` (`src/controllers/database.ts`, 6 lines); then `postgresTargetLabel` and `secretBlocks` (`src/v8/postgres/presentation.ts`).

**Where the business logic sits.** Below the handler, except the name check. `ensureProjectId` is very nearly a no-op here: the provider already substituted the project id during normalisation, so the helper only catches the case where the API returns an empty string.

**External services.** As `postgres list`.

### 4. `postgres usage`

**Handler:** `src/v8/postgres/usage.ts` (165 lines).

**What the handler does.**

- *Input parsing:* calls `parseUsageDate` twice, once per flag, then checks that `--from` is not later than `--to` and throws a `USAGE_ERROR` if it is.
- *Business logic:* shared context, `resolveDatabase`, `provider.getUsage(database.id, { from, to, signal })`.
- *Presentation:* seven field rows for a person, eight for a program. The human card renders the period as one row, `"<start> to <end>"`, substituting "unknown" for either bound if absent, and appends each metric's unit to its number. The stdout version splits the period into two rows, drops the units, and writes an empty field for anything absent — with the comment recording that the units and bounds remain available in the `--json` record.

**Calls, in order.**

1. `parseUsageDate(value, flagName, "start" | "end", formatter)` — `src/controllers/database.ts` lines 616-672. Returns undefined for an absent flag. For a date-only value such as `2026-06-01`, it expands to a full UTC day boundary: `--from` becomes `T00:00:00.000Z` and `--to` becomes `T23:59:59.999Z`, so that `--from X --to Y` covers whole calendar days inclusively. It validates the calendar date by round-tripping it through `toISOString` and comparing, because `Date.parse` alone silently rolls `2026-02-30` over into March. Full ISO datetimes are accepted as given. Anything else throws a `USAGE_ERROR` naming the flag. No clock is read — the expansion is a pure function of the input string.
2. The cross-flag check, using `Date.parse` on both values.
3. `resolvePostgresContext`, `resolveDatabase`.
4. `provider.getUsage` — `GET /v1/databases/{id}/usage` with `startDate`/`endDate` query parameters, then `normalizeUsage`, which fills absent metrics with `0` and absent units with the strings "ops" and "GiB", and absent period bounds and generation time with empty strings.

**Where the business logic sits.** Split. The day-boundary rule and the inclusive-range decision are business rules living in the controller file; the shape validation and the flag names are input concerns living in the same function. Everything else is below the handler.

**External services.** As `postgres list`. No clock.

### 5. `postgres restore`

**Handler:** `src/v8/postgres/restore.ts` (160 lines).

**What the handler does.**

- *Input parsing:* trims `--backup` and throws a `USAGE_ERROR` when absent, whose advice points at `postgres backup list <database>`.
- *Business logic:* shared context; `resolveDatabase` for the target; `resolveDatabase` again for `--source-database` when given, otherwise the source is the target; then the consent; then `provider.restoreDatabase({ targetDatabaseId, sourceDatabaseId, backupId, projectId, signal })`.
- *Consent:* `ctx.prompt.consent(CONSENT_QUESTION, { token: database.id })`, where the question is "Restoring immediately and irreversibly overwrites all data in the target database, so it requires the exact target database id." The token is the **resolved** id, so the two or four API requests that resolve the databases happen before the user is asked anything.
- *Presentation:* field rows for project, database, id and backup, plus a `source` row only when the source database differs from the target. A list block quotes the resulting status, defaulting to the word "recovering" when the API reported none, and states that connections and credentials are preserved. A `next` action offers `prisma postgres show <target id>`.

**Calls, in order.** `resolvePostgresContext`; `resolveDatabase` (target); `resolveDatabase` (source, conditional); `ctx.prompt.consent`; `provider.restoreDatabase` — `POST /v1/databases/{targetDatabaseId}/restore` with a body naming the source database and backup.

**Where the business logic sits.** Below the handler, except the missing-backup check and the decision of what the consent token should be. Note that this handler does not call `ensureProjectId` on the restored record, where the older command body did; the outcome is identical because the provider already substitutes the project id during normalisation.

**External services.** As `postgres list`, plus the prompt.

### 6. `postgres remove`

**Handler:** `src/v8/postgres/remove.ts` (81 lines).

**What the handler does.**

- *Input parsing:* none; the positional goes straight to `resolveDatabase`.
- *Business logic:* shared context, `resolveDatabase`, consent, `provider.removeDatabase(database.id)`.
- *Consent:* token is the resolved database id; question is "Removing this database is destructive and requires the exact id."
- *Presentation:* a success summary, three field rows, and one list line stating that the database and its connection metadata were removed. No stdout output at all.

**Calls, in order.** `resolvePostgresContext`; `resolveDatabase`; `ctx.prompt.consent`; `provider.removeDatabase` (`DELETE /v1/databases/{id}`).

**Where the business logic sits.** Entirely below the handler.

**External services.** As `postgres list`, plus the prompt.

### 7. `postgres backup list`

**Handler:** `src/v8/postgres/backup-list.ts` (118 lines).

**What the handler does.**

- *Input parsing:* `parseBackupLimit(flags.limit, formatter)` — `src/controllers/database.ts` lines 674-703. Converts the string, and throws a `USAGE_ERROR` unless it is an integer between 1 and 100. The 1-100 range is a rule about what the API will accept, expressed as flag validation.
- *Business logic:* shared context, `resolveDatabase`, `provider.listBackups(database.id, { limit, signal })`.
- *Presentation:* `backupRows` for a person — the type, status and creation time fall back to "unknown", and the size goes through `formatBackupSize`, which picks B, KiB, MiB or GiB with one decimal place. `backupStdoutRows` for a program — the raw byte count, empty fields for absent values, with the comment noting that "2.0 KiB" would not parse back to 2048. A retention row appears only when the API reported a retention period. When the response says more backups exist, a line advises raising `--limit`.

**Calls, in order.** `parseBackupLimit`; `resolvePostgresContext`; `resolveDatabase`; `provider.listBackups` (`GET /v1/databases/{id}/backups?limit=`); `serializeDatabaseBackupList` under `--json`.

**Where the business logic sits.** Below the handler, except the limit range. One notable rule lives in the provider: a `422` response becomes `DATABASE_BACKUPS_UNSUPPORTED`, explaining that the platform does not manage backups for this database — for example a database the customer brought themselves.

**External services.** As `postgres list`.

### 8. `postgres connection list`

**Handler:** `src/v8/postgres/connection-list.ts` (114 lines).

**What the handler does.** Nothing of its own beyond assembly and presentation: shared context, `resolveDatabase`, `provider.listConnections`. The human table shows name, id and creation time with "unknown" for an absent time; the stdout version writes an empty field instead. No secret values are printed — the connection URL is not part of a connection record after creation.

**Calls, in order.** `resolvePostgresContext`; `resolveDatabase`; `provider.listConnections`; `serializeDatabaseConnectionList` under `--json`.

**Where the business logic sits.** Entirely below the handler.

**External services.** As `postgres list`.

### 9. `postgres connection create`

**Handler:** `src/v8/postgres/connection-create.ts` (85 lines).

**What the handler does.**

- *Input parsing:* `args.flags.name?.trim() || defaultConnectionName()` — an absent or blank name falls back to a generated one.
- *Business logic:* shared context, `resolveDatabase`, `provider.createConnection({ databaseId, name, signal })`.
- *Presentation:* the same one-time-secret card as `postgres create`, with a headline naming the database and the project-and-branch label. Bare URL on stdout.

**Calls, in order.** `resolvePostgresContext`; `resolveDatabase`; `defaultConnectionName` (conditional); `provider.createConnection` (`POST /v1/databases/{id}/connections`, then `normalizeCreatedConnection`).

**`defaultConnectionName`** — `src/controllers/database.ts` lines 1009-1016. Builds `cli-<17-character UTC timestamp>-<4 hex characters>` from `new Date().toISOString()` with punctuation stripped, plus two bytes from `node:crypto`'s `randomBytes`. This is the only place in the group that reads the clock, and the only place that uses randomness.

**Where the business logic sits.** Below the handler, apart from the fallback-name decision, which is one expression in the handler and one 8-line function in the controller file.

**External services.** As `postgres list`, plus the system clock and a source of random bytes.

### 10. `postgres connection rotate`

**Handler:** `src/v8/postgres/connection-rotate.ts` (86 lines).

**What the handler does.**

- *Input parsing:* trims the positional connection id and throws a `USAGE_ERROR` when empty.
- *Consent:* `ctx.prompt.consent(..., { token: connectionId })` — using the **raw** argument, and running **before** anything touches the network. The question is "Rotating revokes the previous credentials and breaks clients still using them, so it requires the exact connection id."
- *Business logic:* `resolvePostgresProviderOnly(ctx)` — credential read only, no workspace requirement, no project resolution — then `provider.rotateConnection(connectionId, { signal })`.
- *Presentation:* chooses the subject of the headline from the response: the database's name in quotes when the rotate response carried a database, otherwise `connection <id>`. Then the same one-time-secret card, and the bare URL on stdout.

**Calls, in order.** `ctx.prompt.consent`; `resolvePostgresProviderOnly` (`src/v8/postgres/context.ts`); `provider.rotateConnection` (`POST /v1/connections/{id}/rotate`, then `normalizeRotatedConnection`).

**Where the business logic sits.** Almost all in the provider — this command has no project resolution, no database resolution and no sorting. The handler's only decision of substance is the wording fallback when the API did not name the database.

**External services.** The Management API (connections, and the subscription endpoint on the plan-limit path); the credential record; the prompt; the abort signal. **No filesystem access and no project state.**

### 11. `postgres connection remove`

**Handler:** `src/v8/postgres/connection-remove.ts` (83 lines).

**What the handler does.**

- *Input parsing:* trims the positional connection id, throws a `USAGE_ERROR` when empty.
- *Consent:* raw id as the token, before any network call. Question: "Removing this database connection is destructive and requires the exact id."
- *Business logic:* `resolvePostgresProviderOnly`, then `provider.removeConnection(connectionId, { signal })`.
- *Presentation:* a success summary, one field row echoing the id the user typed, and a line stating that the connection metadata was removed and no one-time secrets were shown. Its `json` presentation is a hand-written `{ connection: { id } }`.

**Where the business logic sits.** There is barely any: one API call. Everything else is input handling and presentation. The result object is built from the user's own input, not from the response — the delete returns nothing.

**External services.** As `postgres connection rotate`.

---

## The provider

`src/lib/database/provider.ts`, 905 lines. Its stated virtue is that it is independent of both CLIs. That is nearly true, and the exceptions matter. What follows is what it holds beyond making requests, and for each part, whether it is a business rule that belongs in a use case or a detail that belongs behind a port.

Rough composition: about 200 lines of type declarations describing the API's response shapes; about 330 lines of the 11 methods; about 190 lines of normalisation functions; about 110 lines of error classification including the plan-limit path; the rest error constructors.

### What it holds

**1. Pagination.** `listDatabases` is the only method that pages: it loops on `pagination.nextCursor` until `hasMore` is false, accumulating every record. Nothing above it knows this happens. **Port detail** — it is a statement about how this API returns collections.

**2. Response normalisation.** This is the largest single block and it exists because the API's records are inconsistent. `normalizeDatabase` accepts the branch name from any of four fields (`branchGitName`, `branchName`, `branch.gitName`, `branch.name`), and the region from any of three shapes (a plain string, an object with `id`, or a separate `regionId`), and defaults the project id to one the caller supplies. `normalizeConnection` defaults a missing connection name to the connection's own id. `normalizeUsage` replaces absent metrics with `0` and absent units with "ops" and "GiB". `normalizeBackupList` converts absent values to empty strings and carries a comment explaining why it does not write "unknown" there: that word would reach the `--json` envelope as though the API had said it, and a consumer could not tell it from a real value. **Port detail** — every line of it is about one API's quirks. But it produces the type the use case would return, so the port's output type is the domain type, not the API's.

**3. Choosing which connection URL to hand the user.** `extractConnectionString` prefers, in order: the pooled endpoint's connection string, then a top-level `connectionString`, then the direct endpoint's, then the accelerate endpoint's. That preference order is a product decision — it decides what the user actually gets when they run `postgres create`. **A business rule expressed in the API's vocabulary.** It can only be evaluated where the raw response is, so in practice it stays behind the port; but it should be recorded as a rule, not treated as plumbing, because changing it changes what customers connect through.

**4. Rules about what a valid response must contain.** Three errors are raised by the normalisers rather than by status codes: `DATABASE_CONNECTION_MISSING` when a created database came back with no connection at all; `DATABASE_CONNECTION_STRING_MISSING` when a created or rotated connection came back without a URL — the message explains that these are one-time-view secrets and there will be no second chance; and `DATABASE_API_ERROR` when a database record arrives with no project context and none can be substituted. **Business rules.** They express what the CLI considers a usable answer.

**5. Status-code classification.** Four specific mappings, each of which changes what the user is told:
   - `showDatabase`: `404` returns `null` rather than throwing, which is what lets `resolveDatabase` fall back to the listed record.
   - `listBackups`: `422` becomes `DATABASE_BACKUPS_UNSUPPORTED`, explained as the platform not managing backups for this database, for example a customer-supplied one.
   - `restoreDatabase`: `409` becomes `DATABASE_RESTORE_CONFLICT` ("provisioning or already recovering"); `404` becomes `DATABASE_BACKUP_NOT_FOUND`, and the code carries a comment justifying that inference — the target and source databases were both resolved before the call, so the only thing that can be missing is the backup.
   - Every one of these is guarded by `!isPlanLimitApiError(...)`, so a plan-limit refusal wearing a 404, 409 or 422 is not misread as a missing backup or a conflict.

   **Mixed.** The mapping from status code to meaning is port detail. The *meanings* — "backups are not available for this kind of database", "this database is busy recovering" — are domain facts the use case should be able to react to, so they need to arrive as typed errors, not as strings.

**6. Plan-limit enrichment, and its 3-second lookup.** This is the most interesting piece. When any request fails with the API error code `planLimitReached`, `databaseApiError` does not simply raise. If a workspace id was supplied at construction, it makes a **second** request, `GET /v1/workspaces/{id}/subscription`, under its own budget: a fresh `AbortController` with a 3,000 ms timer (`SUBSCRIPTION_LOOKUP_TIMEOUT_MS`), combined with the caller's signal through `AbortSignal.any`, so either can stop it. Any failure, any timeout, any thrown error yields `null` and the original plan-limit error is raised anyway — with `planName`, `usageBlocked` and `upgradeUrl` all null. It calls `signal.throwIfAborted()` before and after the lookup so that a user pressing Ctrl-C is not swallowed by the enrichment's catch-all. The resulting error carries a `meta` block with the workspace id, plan name, blocked flag and upgrade URL, and also a `humanLines` array — a fully pre-rendered page of text for the older CLI, which the new one throws away and replaces with a single "Upgrade the workspace plan" action built in `src/v8/postgres/errors.ts`.

   **This is business logic wearing adapter clothes.** The rule being expressed is: *when the workspace has run out of its plan's capacity, find out which plan and where to upgrade, but never make the user wait more than three seconds to learn they were refused.* That is a decision about what the user is told and how long they wait for it. It is testable without HTTP if the lookup and the clock are injected.

**7. Generic API error passthrough.** Anything unclassified becomes a `CliError` whose code is the API's own error code when present (falling back to `DATABASE_API_ERROR`), whose explanation is the API's message, and whose advice is the API's hint. The v8 mapper then emits it as `POSTGRES.<RAW_CODE>`. **Port detail**, and a sound one: it means a new API error code reaches the user intact rather than being flattened.

### Two threads still tie the provider to a CLI

- **It constructs `CliError`** — the older shell's error class from `src/shell/errors.ts`, carrying `exitCode`, `nextSteps`, `humanLines` and a `domain` field. A provider that is genuinely independent of both CLIs should not know what an exit code is.
- **It takes a `formatCommand` function** so its errors can suggest runnable command lines. The v8 handlers pass none, so it falls back to a default formatter, and then `src/v8/postgres/errors.ts` rewrites the resulting strings with regular expressions to fix the CLI name and the group name. Producing command strings at the bottom of the stack and correcting them at the top is the clearest sign that they should not be produced there at all.

### The answer on the provider

Most of the provider is adapter detail and belongs behind a port: pagination, normalisation, status-code translation, and the API-message passthrough. Three things are business rules currently trapped inside it and should be pulled up or at least named as rules: **which connection URL the user is given**, **what counts as an unusable response** (the three missing-secret and missing-context errors), and **the plan-limit enrichment with its three-second budget**. One thing is presentation that should not be there at all: **the `humanLines` page**, which the new CLI already discards.

For the plan-limit enrichment specifically, there are two workable shapes:

- *Keep it in the adapter.* The port raises an already-enriched `PlanLimitReached` error. Cheapest, unchanged behaviour, but the three-second policy stays untestable without a fake HTTP layer, and every port implementation has to repeat it.
- *Split it.* The port raises a plain `PlanLimitReached` carrying only the workspace id; the use case catches it, calls a separate subscription port under its own timeout using an injected clock, and re-raises the enriched error. This puts the policy — "enrich if you can, but never delay the refusal by more than three seconds" — where it can be tested with fakes. The cost is that every one of the 11 use cases needs the same catch-and-enrich step, so it wants to be a small shared wrapper rather than eleven copies.

The second is the better split. Recommend it, and note the cost honestly.

---

## Consent

Four commands take a typed confirmation: `postgres remove`, `postgres restore`, `postgres connection rotate`, `postgres connection remove`.

### How it works today

All four call `ctx.prompt.consent(question, { token })`. In the engine (`packages/cli-engine/src/execution/prompts.ts` and `context.ts`):

- Interactively, the user must type the token exactly. On a real terminal the prompt library lets them try again; with piped or scripted input a wrong answer fails immediately, because a piped answer cannot be corrected.
- Non-interactively, the only way to consent is `--confirm <token>` on the command line. Each `--confirm` value is consumed once, so two consents need two values.
- `--yes` can never grant a consent. It is structurally undefaultable: unlike every other prompt, `consent` takes no default parameter.
- Failure throws. `CLI.CONSENT_REQUIRED` exits 2; cancelling exits 3. The handler never observes a `false` — `consent` returns `true` or raises.

The four commands differ in one important way. `connection rotate` and `connection remove` consent on the **raw** string the user typed, before any network call, so a wrong `--confirm` costs nothing. `postgres remove` and `postgres restore` consent on the **resolved** database id, which means the command has already made three or four API requests — and for `restore` has already resolved the source database as well — before the user is asked anything.

### Where each part belongs under the split

Three separable things are tangled together in one call:

1. **The requirement** — "removing a database requires explicit consent, and the thing consented to is the database's id" — is a business rule. It holds whether the confirmation comes from a terminal prompt, a dialog box or an API header. It belongs with the use case.
2. **The question text** — "Removing this database is destructive and requires the exact id." — is user-facing copy. It is presentation and belongs in the handler, next to the rest of the command's wording.
3. **The asking** — rendering, reading the terminal, matching `--confirm`, choosing exit code 2 or 3 — belongs to the shell and the engine, and already lives there.

Given that a use case must not know about prompts, the shape that works is: **the use case never asks, but it does require proof.**

- For `connection rotate` and `connection remove` this is free. There is nothing to resolve, so the handler consents on the raw argument and only then calls the use case. The use case needs to know nothing about it.
- For `postgres remove` and `postgres restore` the token is a value only the use case can produce, so the work has to be split in two. Expose resolution as its own operation — `resolveDatabase(projectId, reference, branch)` — which `show`, `usage`, `backup list` and `connection list` all want anyway, and make `remove(databaseId)` and `restore(targetId, sourceId, backupId)` take ids that have already been resolved. The handler then does: resolve, ask, act. The consent sits between two use-case calls rather than inside one.

That costs one extra call in two commands and keeps prompts entirely out of the use-case layer. The alternative — passing the use case a `confirm(token)` callback or a "consent port" — reads better at the call site but puts a user-interaction concept into the use case under a different name, which is the thing being avoided.

One design note worth recording: if `remove(databaseId)` takes an already-resolved id, nothing in its type stops a caller passing an unresolved one and skipping the confirmation. If that matters, the resolution operation should return a small wrapper type that only it can produce, and the destructive operations should require that type.

---

## Secrets

Three commands print a credential that the API will never show again: `postgres create`, `postgres connection create`, `postgres connection rotate`.

The handling splits cleanly, and the split is not where one might first guess.

| Part | Which side | Where it lives today |
| --- | --- | --- |
| Obtaining the URL from the response, including the pooled/direct/accelerate preference order | Use case, behind the port | `extractConnectionString`, `src/lib/database/provider.ts` |
| Raising an error when the response carried no URL | Use case | `normalizeCreatedConnection` / `normalizeRotatedConnection`, same file |
| The fact that the value is one-time-only, which is what makes "save it now" true | Use case — it is a domain fact about Prisma Postgres connections | Stated in the error messages and in the human copy |
| Returning the URL as part of the result | Use case | The three `Database*Result` types in `src/types/database.ts` |
| Masking it in the human card | Handler, and in fact the engine | `secretBlocks` sets `sensitive: true`; `packages/cli-engine/src/execution/rendering.ts` writes `********` |
| The line "The connection URL below is shown once, so save it now." | Handler — it is copy | `src/v8/postgres/presentation.ts` |
| Printing the bare URL on stdout | Handler | `stdout: () => [result.connectionString]` in each of the three files |
| Choosing the headline subject when the rotate response did not name the database | Handler | `src/v8/postgres/connection-rotate.ts` |

So: the use case produces the secret and knows it is a one-time value; the handler decides which channel it is written to and how it is displayed; and the masking itself is not even the handler's code — it is the engine's, triggered by one flag on a field row.

Two things to record while making the split:

- **The secret crosses the boundary inside the returned value.** All three commands pass the whole result, connection string included, into `ctx.present({ data: result }, ...)`, and none of the three supplies a `json` presentation — so `--json` emits the raw record with the secret in it. That is deliberate, because a script needs the URL. But it means any future logging, telemetry or debug dump of a use case's return value would leak a live credential. If use-case results are ever logged, these three need an explicit exception.
- **Human mode already keeps the secret off stderr and on stdout.** The engine writes human blocks to stderr and the `stdout` lines to stdout, so `prisma postgres create db > url.txt` captures exactly the URL and nothing else, while the person watching sees `********`. Any redesign has to preserve that division.

---

## Candidate ports

The smallest set of injected interfaces covering every external service the 11 commands touch. Two layers, because project resolution is shared with four other command groups and should not be re-implemented here.

### Owned by the postgres group

**1. `PostgresApi`** — the Management API for databases, connections, backups, usage and restore. Eleven methods, and they already exist: this is exactly the current `DatabaseProvider` interface in `src/lib/database/provider.ts`.

```
listDatabases({ projectId, branchName?, signal? })      -> DatabaseSummary[]
showDatabase(databaseId, { projectId?, signal? })       -> DatabaseSummary | null
createDatabase({ projectId, name, branchName?, region?, signal? })
removeDatabase(databaseId, { signal? })
listConnections(databaseId, { signal? })
createConnection({ databaseId, name, signal? })
removeConnection(connectionId, { signal? })
getUsage(databaseId, { from?, to?, signal? })
listBackups(databaseId, { limit?, signal? })
restoreDatabase({ targetDatabaseId, sourceDatabaseId, backupId, projectId, signal? })
rotateConnection(connectionId, { signal? })
```

What has to change for it to be a port rather than an implementation detail: its errors must stop being the shell's `CliError` and become a typed set the use case can match on — at minimum `NotFound`, `PlanLimitReached`, `BackupsUnsupported`, `RestoreConflict`, `BackupNotFound`, `ResponseIncomplete` and a catch-all carrying the API's own code, message and hint. And it must stop building command-line strings.

**2. `WorkspaceSubscription`** — one method, read a workspace's plan: plan name, upgrade URL, and whether usage is blocked. Kept separate from `PostgresApi` because it is a different resource, and more importantly because it is *optional*: the use case must be able to give up on it and still produce the error. Needed by all 11 commands, since any of them can hit a plan limit.

**3. `ConnectionNameFactory`** — one method returning the generated default connection name. Used only by `postgres connection create`. The alternative is to inject a `Clock` and a random-bytes source separately and keep the formatting rule in the use case; that is two ports instead of one, and the clock has no other use in this group. A single factory is the smaller surface and the easier fake. Choose separate `Clock` and `Random` ports only if the plan-limit timeout also moves into the use case, in which case a `Clock` is needed anyway.

### Inherited from project resolution

Every command except `connection rotate` and `connection remove` must decide which project it is operating on. That decision is not postgres business — it is shared with `project`, `bucket`, `branch` and `git`. It should be a single use case those groups call, not something re-implemented per group. Its own ports are:

**4. `ProjectCatalogue`** — list the projects in a workspace. One method. Today: `listRealWorkspaceProjects` in `src/controllers/project.ts`.

**5. `ProjectDirectoryState`** — the local state file. For this group, one read: given a directory, return the recorded workspace id and project id, or "missing", or "unreadable". Today: `readLocalResolutionPin` over `.prisma/local.json`. The `project link` and `project create` commands also write it, so the port grows a write for that group.

**6. `DirectoryFacts`** — the two things read from the working directory when project resolution fails and the CLI has to suggest a name: the `name` field of `package.json`, and the directory's own base name. Small, and only on an error path, but it is a real filesystem read and the error's content depends on it.

### Deliberately not ports

- **The credential store.** `ctx.activeCredential()` supplies the workspace id and nothing else on this path. The engine already owns credentials and builds the API client from them. The workspace id should be an argument to the use case, not something the use case fetches.
- **The prompt.** Covered under "Consent" — the handler asks, the use case takes the result.
- **The abort signal.** It is a parameter, not a service. Every port method already accepts one and should keep doing so.
- **Environment variables.** Nothing in the `postgres` group reads `ctx.env`. (The older command bodies read `PRISMA_CLI_MOCK_FIXTURE_PATH` to switch to a fixture provider, but the v8 handlers never take that branch.)
- **The clock**, unless the plan-limit timeout moves up. `parseUsageDate` looks like it needs one and does not — its day-boundary expansion is a pure function of the input string. The only clock read in the group is inside the generated connection name.

**Minimum honest count: three ports owned by this group, three more inherited from project resolution — six in total, or four if project resolution is treated as a single collaborating use case rather than something this group assembles itself.**

---

## What resists the split

**1. The reader-versus-machine duplication is real presentation and must stay in the handler.** Every listing and showing command builds each field twice: "unscoped", "unknown", "default", "2.0 KiB" for a person; an empty string or a raw byte count for a program. `formatStatus` against `statusValue`; `formatBackupSize` against the raw number; the usage period as one row against two. None of this can move into a use case. But it imposes a rule on the use case's return type: **absence must be returned as `null` or an empty string, never as a word.** If a use case ever returns "unknown", the machine-readable channel is silently corrupted, and the comment in `normalizeBackupList` shows the team has already had to reason about exactly this.

**2. `parseUsageDate` genuinely straddles the line.** Expanding `2026-06-01` to `T00:00:00.000Z` for `--from` and `T23:59:59.999Z` for `--to` exists because the API demands full ISO datetimes *and* because `--from X --to Y` should cover whole calendar days inclusively. The inclusivity decision is a business rule. The shape validation, and the error text that names `--from` by name, are input concerns. A clean split would have the handler check the shape and the use case apply the boundaries — but then the "which flag was wrong" information has to travel between them. Whatever is chosen, this function cannot simply be labelled "input parsing" and left in the handler without losing a rule.

**3. The consent token for two commands is a resolved value.** As set out above, this forces `postgres remove` and `postgres restore` into two use-case calls with the prompt between them, or forces a prompt-shaped dependency into the use case. There is no third option that keeps both single-call and prompt-free.

**4. Errors that contain command lines cannot cleanly leave the shell.** The provider and the controller helpers build `nextSteps` strings such as `prisma-cli database backup list <id>`, and `src/v8/postgres/errors.ts` then rewrites them with regular expressions to fix the CLI name and the renamed group. A use case that produces a command line has taken a dependency on the CLI's name and its command tree. The rule to adopt: **use-case errors carry structured facts — which database, which flag, which backup — and the handler writes the command line.** Until that happens, the rewriting mapper stays, and it stays wrong in the same way for every new command.

**5. The plan-limit `humanLines` page.** A pre-rendered block of display text constructed at the very bottom of the stack, in the provider, for a CLI that is being retired. The new CLI already discards it. It should not survive the move, and its removal is a small, safe, separate change.

**6. `ensureProjectId` is neither business logic nor presentation.** Six lines that substitute a project id when the record lacks one. It duplicates what `normalizeDatabase` in the provider already does, which is why it is very nearly a no-op on the v8 path — it only bites when the API returns an empty string rather than a missing field. Its two callers are inconsistent: `postgres create` calls it, `postgres restore` does not, and both behave identically. It should move into the provider and then disappear.

**7. Seven of the eleven commands have no `json` presentation**, so the object a use case returns is the published `--json` contract for those commands. That is not a defect, but it does mean the use-case return types are a public interface, and reshaping them for architectural tidiness would be a user-visible change. Worth deciding deliberately rather than discovering later.

**8. `postgres connection remove` has almost nothing to put in a use case.** One API call, a result assembled from the user's own input rather than from any response, and a confirmation the handler can take on its own. A use case for it would be a single delegating method. That is fine — consistency across the group is worth a thin wrapper — but it should be chosen knowingly, not defended as though it carried logic.

---

## File index

| File | Role in this group |
| --- | --- |
| `src/v8/postgres/list.ts` `show.ts` `create.ts` `usage.ts` `restore.ts` `remove.ts` `backup-list.ts` `connection-list.ts` `connection-create.ts` `connection-rotate.ts` `connection-remove.ts` | The 11 handlers |
| `src/v8/postgres/context.ts` | `resolvePostgresContext`, `resolvePostgresProviderOnly`, shared flag and positional definitions |
| `src/v8/postgres/presentation.ts` | `formatStatus`, `statusValue`, `formatBackupSize`, `backupRows`, `backupStdoutRows`, `secretBlocks`, `postgresTargetLabel` |
| `src/v8/postgres/errors.ts` | Legacy error to structured `POSTGRES.*` mapping, plus the command-string rewriting |
| `src/lib/database/provider.ts` | The 11 API methods, all normalisation, all status-code classification, the plan-limit enrichment |
| `src/controllers/database.ts` | Six helpers this group calls: `resolveDatabase`, `sortDatabases`, `ensureProjectId`, `parseUsageDate`, `parseBackupLimit`, `defaultConnectionName`, plus the two error constructors they raise. The rest of the file is the older CLI's command bodies and a fixture provider, neither of which this group touches. |
| `src/v8/resources-shared/workspace.ts` | `resolveActiveWorkspace` |
| `src/v8/project/context.ts` | `resolvePinnedProject` and the fabricated legacy context |
| `src/lib/project/resolution.ts` | `resolveProjectTarget` and the project-resolution errors |
| `src/lib/project/local-pin.ts` | Reads and writes `.prisma/local.json` |
| `src/controllers/project.ts` | `listRealWorkspaceProjects` |
| `src/presenters/database.ts` | `serializeDatabaseList`, `serializeDatabaseConnectionList`, `serializeDatabaseBackupList` — the three `--json` shapes |
| `src/types/database.ts` | The 11 result types and the two summary types |
| `packages/cli-engine/src/context.ts` | `CommandContext`, `PromptSurface` |
| `packages/cli-engine/src/execution/prompts.ts` | Consent behaviour: typing the token, `--confirm`, why `--yes` cannot grant it |
| `packages/cli-engine/src/execution/rendering.ts` | Renders a `sensitive` field row as `********` |
