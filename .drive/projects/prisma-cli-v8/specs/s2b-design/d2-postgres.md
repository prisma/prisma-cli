# D2 design — the postgres group (11 commands)

Binding design for dispatch D2. Parent: `conventions.md` (layout,
mounting, error-mapping, consent, secrets, tests). Grounding:
`scratchpad fact sheet facts-d2-postgres.md` extracted from the legacy
code; legacy references cite `packages/cli/src/...`. Every "ports
verbatim" below means byte-identical strings except the pinned
substitutions of §0.

## 0. Rename substitutions (R-S2b-1, applied everywhere)

- Command paths, ids, files, groups: `database` → `postgres`
  (`postgres.connection.rotate` etc.). No alias.
- Inside ANY user-facing string (help, examples, why/fix text,
  nextAction commands): a legacy command reference
  `prisma-cli database …` becomes `${CLI_NAME} postgres …`. The
  resource noun "database" in prose is NOT renamed (the resource is a
  Prisma Postgres database).
- The legacy package-runner command formatter
  (`resolvePrismaCliPackageCommandFormatterSync`) is NOT used in v8
  strings: every command string in nextActions is
  `${CLI_NAME} postgres …` (S1/S2a precedent). Divergence entry
  (one class entry).
- Legacy fix text `"Re-run with --trace for the underlying API
  response details."` becomes `"Re-run with --log-level verbose for
  the underlying API response details."` (`--trace` is dropped by
  standing ruling 8). Divergence entry.

## 1. Group mounting

Groups and briefs (legacy descriptions ported, rename applied):

| group | brief |
| --- | --- |
| `postgres` | Manage Prisma Postgres databases for a project |
| `postgres backup` | Inspect platform-created database backups |
| `postgres connection` | Manage one-time-view database connection strings |

Mount paths: `postgres list|show|create|usage|restore|remove`,
`postgres backup list`,
`postgres connection list|create|rotate|remove`.
Family keys: `postgresList`, `postgresShow`, `postgresCreate`,
`postgresUsage`, `postgresRestore`, `postgresRemove`,
`postgresBackupList`, `postgresConnectionList`,
`postgresConnectionCreate`, `postgresConnectionRotate`,
`postgresConnectionRemove`.

## 2. Shared machinery (implemented once, in the named files)

### 2.1 `v8/postgres/context.ts` — group context helper

`resolvePostgresContext(ctx, { projectRef, branchName }, commandName)`:

1. Workspace: per conventions §3a (the pinned workspace source).
   Missing workspace → the ported `AUTH.USAGE_ERROR` "Workspace
   required" (copy verbatim from `workspaceRequiredError`,
   errors.ts:141: summary `Workspace required`, why `This command
   needs an active workspace, but the authenticated session does not
   have one.`, nextAction user-choice from fix `Run ${CLI_NAME} auth
   login and choose a workspace.` + run-command `${CLI_NAME} auth
   login`).
2. Project resolution: call the EXISTING
   `resolveProjectTarget({ context-free inputs })`
   (`lib/project/resolution.ts:155`) with
   `listProjects: () => listRealWorkspaceProjects(client, workspace,
   signal)` where `client` is `ctx.api`. Conversion of resolution
   errors stays in the existing
   `projectResolutionErrorToCliError`; the v8 error mapper (§2.5)
   maps the resulting CliErrors.
3. Provider: `createManagementDatabaseProvider(ctx.api,
   { workspaceId: workspace.id })` — the `formatCommand` option is
   NOT passed (v8 strings are `${CLI_NAME}`-phrased; the provider's
   fallback formatter output is replaced by the v8 error mapper
   rewriting nextSteps into nextActions, see §2.5).

`resolvePostgresProviderOnly(ctx)` (for `connection rotate|remove`):
no workspace requirement, no project resolution —
`createManagementDatabaseProvider(ctx.api, { workspaceId:
workspace?.id })` with workspace best-effort per conventions §3a.
Matches legacy `requireDatabaseProviderOnly` (database.ts:765).

Both helpers never call `requireAuthenticatedAuthState` /
`authenticatedManagementApiClient` — `needs.credentials` + `ctx.api`
replace them (R-S2b-2).

### 2.2 Database resolution

Reuse the legacy `resolveDatabase(provider, target, databaseRef,
branchName, signal)` flow (database.ts:912) — call it if importable
without dragging fixture machinery; otherwise the handler-side copy
in `v8/postgres/resolve.ts` reproduces it EXACTLY:

- blank ref → usage error `Database id or name required` / `This
  command needs a database id or name.` / nextAction from `Pass a
  database id or name.` + run-command `${CLI_NAME} postgres list`
  → `POSTGRES.USAGE_ERROR`, exit 2.
- 0 matches → `POSTGRES.NOT_FOUND` (legacy `DATABASE_NOT_FOUND`),
  copy verbatim incl. the scope suffix
  `` in project "…"[ on branch "…"] ``, exit 2 (legacy 1→2 class).
- >1 → `POSTGRES.AMBIGUOUS`, copy + `meta.matches` verbatim, exit 2.
- 1 match → `provider.showDatabase(id, { projectId, signal })`,
  `ensureProjectId` fallback exactly as database.ts:955-960.

### 2.3 Exact-id confirmation + consent

Per conventions §5 (rewritten at merge-down — engine consent tokens;
holds lifted): no per-command `confirm` flags, no
`requirePostgresConfirmation` helper, no `POSTGRES.CONFIRMATION_
REQUIRED`. Each consent command calls `ctx.prompt.consent(<its
pinned why sentence>, { token: <exact id> })` before the mutation,
at the same point the legacy check sat. The copy below remains the
question-text source. The v8 consent helper
`v8/postgres/consent.ts::requirePostgresConfirmation` reproduces
`requireExactConfirmation` (database.ts:976) semantics: pass iff
`confirm === id` (strict). On flag mismatch/absence in
non-interactive contexts → `POSTGRES.CONFIRMATION_REQUIRED`, exit 2,
copy per command (see per-command sections; `fix` →
run-command nextAction `${CLI_NAME} <command rerun with --confirm>`),
meta `{ expectedConfirm, receivedConfirm }` verbatim
(`receivedConfirm: null` when absent). Interactive without the flag:
`ctx.prompt.consent(question)` with the question pinned per command
(§ per-command); grant → proceed; deny/cancel → conventions §5.

### 2.4 Plan-limit error (ports PR #127)

The v8 mapper detects legacy `PLAN_LIMIT_REACHED` CliErrors →
`POSTGRES.PLAN_LIMIT_REACHED`, exit 2, summary/why verbatim
(`Workspace plan limit reached` / `Database operations are blocked
because this workspace has used the operations included in its plan.
This is a workspace plan limit, not a Prisma outage.`), meta verbatim
(`workspaceId, blockedFeature, planName, usageBlocked, upgradeUrl`),
nextActions exactly one `user-choice`:
- with upgradeUrl: label `Upgrade the workspace plan`, reason
  `` Upgrade at ${upgradeUrl}${planName ? ` (current plan: ${planName})` : ""}. ``
- without: label `Upgrade the workspace plan`, reason `Open Prisma
  Console and upgrade the affected workspace plan.`

The legacy `humanLines` full-rendering override does not port (no v8
equivalent; engine renders the error layout). Divergence entry:
plan-limit recovery lines move from bespoke human rendering to
why + nextAction + meta. The 3s best-effort subscription lookup
(`readWorkspaceSubscription`, provider.ts:871) still runs inside the
provider — unchanged, no port work.

### 2.5 Error mapper `v8/postgres/errors.ts`

Follows `v8/auth/errors.ts` helper shape (conventions §4). Catches
CliError from the operation layer and maps by code. Complete map —
implementers add no entries:

| legacy code (exit) | v8 code (exit 2 unless noted) |
| --- | --- |
| `USAGE_ERROR` domain database (2) | `POSTGRES.USAGE_ERROR` |
| `USAGE_ERROR` domain auth — workspace required (2) | `AUTH.USAGE_ERROR` |
| `DATABASE_NOT_FOUND` (1) | `POSTGRES.NOT_FOUND` |
| `DATABASE_AMBIGUOUS` (1) | `POSTGRES.AMBIGUOUS` |
| `CONFIRMATION_REQUIRED` (2) | `POSTGRES.CONFIRMATION_REQUIRED` |
| `PLAN_LIMIT_REACHED` (1) | `POSTGRES.PLAN_LIMIT_REACHED` |
| `DATABASE_CONNECTION_MISSING` (1) | `POSTGRES.CONNECTION_MISSING` |
| `DATABASE_CONNECTION_STRING_MISSING` (1) | `POSTGRES.CONNECTION_STRING_MISSING` |
| `DATABASE_BACKUPS_UNSUPPORTED` (1) | `POSTGRES.BACKUPS_UNSUPPORTED` |
| `DATABASE_RESTORE_CONFLICT` (1) | `POSTGRES.RESTORE_CONFLICT` |
| `DATABASE_BACKUP_NOT_FOUND` (1) | `POSTGRES.BACKUP_NOT_FOUND` |
| `DATABASE_API_ERROR` (1) | `POSTGRES.API_ERROR` |
| any other API-passthrough code `X` (1) | `POSTGRES.X` (mechanical: prefix the raw API code; e.g. API code `planLimitReached` never reaches here — caught above) |
| `PROJECT_NOT_FOUND` / `PROJECT_AMBIGUOUS` / `PROJECT_SETUP_REQUIRED` / `LOCAL_STATE_STALE` / `LOCAL_PROJECT_WORKSPACE_MISMATCH` | `PROJECT.NOT_FOUND` / `PROJECT.AMBIGUOUS` / `PROJECT.SETUP_REQUIRED` / `PROJECT.LOCAL_STATE_STALE` / `PROJECT.LOCAL_WORKSPACE_MISMATCH` — shared with D1's mapper (single source in `v8/project/errors.ts`; D2 imports) |
| `AUTH_REQUIRED` / `AUTH_CONFIG_INVALID` | unreachable in v8 (needs.credentials / S2a auth errors); if seen, bug — rethrow |

For every mapped error: summary/why verbatim (+ §0 substitutions);
legacy `fix` → one `user-choice` nextAction (label = fix text);
legacy `nextSteps` strings → `run-command` nextActions (command =
the string, §0-substituted); `meta` verbatim.

### 2.6 Presentation helpers `v8/postgres/presentation.ts`

- `postgresTargetLabel(projectName, branchName)` →
  `branchName ? `${projectName} / ${branchName}` : projectName`
  (legacy `formatDatabaseTarget`).
- `formatStatus(db)` → `db.status ?? (db.isDefault ? "default" :
  "unknown")` (legacy presenters/database.ts).
- `formatBackupSize(size)` → legacy rules verbatim: null →
  `unknown`; else B/KiB/MiB/GiB, 1024 boundaries, one decimal.
- Secret-bearing card rows use `sensitive: true` for the
  connection-string row (conventions §6).

## 3. Per-command design

CONSENT SUPERSESSION (merge-down 2026-08-10): in sections 3.5, 3.6,
3.10, 3.11 below, IGNORE any `confirm: flag.string(...)` declaration
and any drafted yes/no "consent question ... pending ratification"
text — both predate the engine consent-token mechanism. The binding
form is conventions §5: no flag declaration; at the legacy check's
position call `ctx.prompt.consent(<the section's pinned confirmation
why sentence>, { token: <the section's exact id> })`; the engine's
shared `--confirm` grants non-interactively; the consent test matrix
is conventions §5's. The sections' summaries/why sentences/rerun
nextActions/meta notes remain the copy source, except
`meta.expectedConfirm/receivedConfirm` (engine-owned error now; no
such meta).

Common to all 11: `needs: { credentials: true }`; command family =
platform; no events; diagnostics always empty; no documented 4–99
exit codes (`exitCodes` omitted). Result `data` = the legacy result
object minus `verboseContext` (the verbose-context block does not
port — `--verbose` is a log level in v8, not a data toggle;
divergence entry, one class). Json presentation = the legacy
serializer shape minus `verboseContext` (which `stripVerboseContext`
already removed — so key-identical to legacy `--json` output; state
per command below).

### 3.1 `postgres list` — `v8/postgres/list.ts`

- help.summary: `List Prisma Postgres databases for the resolved
  project`; examples: `postgres list`,
  `postgres list --branch feature/foo`, `postgres list --json`.
- args.flags: `project: flag.string({ brief: "Project id or name",
  placeholder: "id-or-name" })`, `branch: flag.string({ brief:
  "Branch git name", placeholder: "git-name" })`.
- Handler: `resolvePostgresContext` →
  `provider.listDatabases({ projectId, branchName, signal:
  ctx.signal })` → sort `branchName ?? "" → name → id` ascending
  via localeCompare (legacy `sortDatabases`).
- data: `{ projectId, projectName, branchName: branchName ?? null,
  databases }`.
- human: summary block info `Listing databases for the resolved
  project.`; fields block `project:` + (`branch:` when set); empty →
  list block `["No databases found."]`; else table
  `Name | Branch | Region | Status | Id` — Branch `unscoped` when
  null, Region `unknown` when null, Status via `formatStatus`.
- stdout: the table's data rows as tab-joined
  `name\tbranch\tregion\tstatus\tid` lines (S2a workspace-list
  precedent: list data rows are the machine payload); empty list →
  no stdout lines. Divergence entry (legacy wrote nothing to stdout).
- json: legacy `serializeDatabaseList` shape verbatim:
  `{ context: { project, branch? }, items: [{ name, id, status }],
  count, projectId, branchName, databases }` (items.status =
  `isDefault ? "default" : null`).
- next: none.
- Tests: success (2 dbs, sort proven); success empty; `--branch`
  filter passthrough; json envelope (commandId `postgres.list`, keys
  as above); unauthenticated (engine sign-in error, exit 2); errored
  (API failure → `POSTGRES.API_ERROR` or passthrough-coded, exit 2);
  plan-limit (`POSTGRES.PLAN_LIMIT_REACHED`, meta + nextAction
  pinned).

### 3.2 `postgres show <database>` — `v8/postgres/show.ts`

- help.summary: `Show database metadata without secret values`;
  examples: `postgres show db_123`,
  `postgres show acme-preview --branch preview --json`.
- args.positionals: `database: positional.string({ brief: "Database
  id or name", placeholder: "database" })`; flags: project, branch
  (as 3.1).
- Handler: context → `resolveDatabase` → `provider.listConnections
  (database.id, { signal })`.
- data: `{ projectId, projectName, database, connections }`.
- human: summary info `Showing database metadata.`; fields in order:
  `project`, `database` (name), `id`, `branch` (`unscoped` when
  null), `region` (`unknown` when null), `status` (formatStatus),
  `connections` (count as string).
- stdout: `label: value` lines mirroring the fields block (S1 whoami
  precedent).
- json: `{ projectId, projectName, database, connections }` (legacy
  `stripVerboseContext` shape).
- next: none.
- Tests: success by id; success by name; not-found →
  `POSTGRES.NOT_FOUND` exit 2 (why includes project/branch scope);
  ambiguous → `POSTGRES.AMBIGUOUS` + meta.matches; json; unauth.

### 3.3 `postgres create <name>` — `v8/postgres/create.ts` (secret)

- help.summary: `Create a Prisma Postgres database and print its
  one-time connection URL`; examples: `postgres create my-db`,
  `postgres create my-db --branch feature/foo --region eu-central-1`.
- args.positionals: `name: positional.string({ brief: "Database
  name", placeholder: "name" })`; flags: `region: flag.string({
  brief: "Prisma Postgres region id", placeholder: "region" })`,
  project, branch.
- Handler: trim name; whitespace-only → `POSTGRES.USAGE_ERROR`
  (`Database name required` / `Database create needs a non-empty
  name.` / nextActions: user-choice `Pass a database name.` +
  run-command `${CLI_NAME} postgres create <name>`), exit 2. Context
  → `provider.createDatabase({ projectId, name, branchName, region,
  signal })` → `ensureProjectId`.
- data: `{ projectId, projectName, database, connection,
  connectionString }`.
- human: summary ok `` Created database "${name}" in
  ${postgresTargetLabel(...)}. `` + list block `["The connection URL
  below is shown once, so save it now."]` + fields block with row
  `connection URL` value = connectionString, `sensitive: true`. (The
  legacy `Creating database...` progress line does not port — sync
  command, no events; divergence entry, class: pre-result progress
  lines dropped for sync commands.)
- stdout: exactly `[connectionString]` (legacy
  `renderDatabaseCreateStdout`).
- json: `{ projectId, projectName, database, connection,
  connectionString }`.
- next: none.
- Tests: success (stdout = bare URL; human masks; envelope carries
  connectionString); whitespace name → usage error; connection
  missing (`POSTGRES.CONNECTION_MISSING`, copy verbatim);
  connection-string missing (`POSTGRES.CONNECTION_STRING_MISSING`);
  plan-limit; json; unauth.

### 3.4 `postgres usage <database>` — `v8/postgres/usage.ts`

- help.summary: `Show usage metrics for a database`; examples:
  `postgres usage db_123`,
  `postgres usage acme-production --from 2026-06-01 --to 2026-06-30`.
- args.positionals: `database` (as 3.2); flags: `from: flag.string({
  brief: "Start of the usage period", placeholder: "iso-date" })`,
  `to: flag.string({ brief: "End of the usage period", placeholder:
  "iso-date" })`, project, branch.
- Handler: parse dates FIRST (before context), reproducing
  `parseUsageDate` rules verbatim (fact sheet "usage date
  validation": date-only regex → UTC day-boundary expansion
  T00:00:00.000Z / T23:59:59.999Z; datetime prefix + calendar
  round-trip check; invalid → `POSTGRES.USAGE_ERROR` `Invalid usage
  period` with the exact legacy why per flag; from>to → the exact
  range-error copy). Then context → `resolveDatabase` →
  `provider.getUsage(database.id, { from, to, signal })`.
- data: `{ projectId, projectName, database, period, metrics,
  generatedAt }`.
- human: summary info `Showing database usage metrics.`; fields:
  `project`, `database`, `id`, `period` = `` `${start||"unknown"} to
  ${end||"unknown"}` ``, `operations` = `${used} ${unit}`, `storage`
  = `${used} ${unit}`, `generated` (`||"unknown"`).
- stdout: `label: value` mirror. json: strip shape. next: none.
- Tests: success; date-only expansion asserted via fake client
  receiving expanded query; invalid date → usage error exit 2
  (both flag variants); from>to; json; unauth.

### 3.5 `postgres restore <database>` — `v8/postgres/restore.ts` (consent)

- help.summary: `Restore a database from a backup after exact id
  confirmation`; example:
  `postgres restore db_123 --backup bkp_456 --confirm db_123`.
- args.positionals: `database: positional.string({ brief: "Target
  database id or name", placeholder: "database" })`; flags:
  `backup: flag.string({ brief: "Backup to restore from",
  placeholder: "backup-id" })`, `sourceDatabase: flag.string({
  brief: "Database the backup belongs to (defaults to the target)",
  placeholder: "database" })`, `confirm: flag.string({ brief: "Exact
  target database id required to restore", placeholder:
  "database-id" })`, project, branch.
- Handler order (legacy database.ts:471): (1) blank `--backup` →
  `POSTGRES.USAGE_ERROR` `Backup id required` / `Database restore
  needs the backup to restore from.` / nextActions from fix+nextStep
  referencing `${CLI_NAME} postgres backup list <database>`; (2)
  context; resolve target; resolve source when `--source-database`
  set (same branch scope) else source = target; (3) confirmation via
  §2.3 with copy: summary `Confirm database restore`, why `Restoring
  immediately and irreversibly overwrites all data in the target
  database, so it requires the exact target database id.`,
  rerun nextAction `` ${CLI_NAME} postgres restore ${database.id}
  --backup ${backupId}[ --source-database ${source.id}] --confirm
  ${database.id} ``; consent question (interactive, pending operator
  ratification — conventions §5): `Restore database ${database.id}
  from backup ${backupId}? This immediately and irreversibly
  overwrites all data in the target database.`; (4)
  `provider.restoreDatabase({ targetDatabaseId, sourceDatabaseId,
  backupId, projectId, signal })`.
- data: `{ projectId, projectName, database: restored, source: {
  databaseId, backupId } }`.
- human: summary ok `Restoring database from backup.`; fields:
  `project`, `database`, `id`, `backup`, + `source` only when source
  ≠ target; list block:
  `` The restore is running; the database status is
  "${status ?? "recovering"}" until it completes. `` and
  `Connections and credentials are preserved.`
- stdout: none. json: strip shape.
- next: run-command `${CLI_NAME} postgres show ${database.id}` (the
  only success nextAction in the group — legacy nextSteps).
- Tests: success (incl. nextAction); missing --backup; confirm
  matrix (absent non-interactive → engine consent failure exit 2;
  absent interactive → consent grant proceeds / deny per conventions
  §5 / cancel exit 3; mismatched --confirm →
  `POSTGRES.CONFIRMATION_REQUIRED` + meta); 409 →
  `POSTGRES.RESTORE_CONFLICT`; 404 → `POSTGRES.BACKUP_NOT_FOUND`;
  source-database variant; json; unauth.

### 3.6 `postgres remove <database>` — `v8/postgres/remove.ts` (consent)

- help.summary: `Remove a database after exact id confirmation`;
  example: `postgres remove db_123 --confirm db_123`.
- args: positional `database` (brief `Database id or name`); flags
  `confirm: flag.string({ brief: "Exact database id required to
  remove", placeholder: "database-id" })`, project, branch.
- Handler: context → resolve → confirmation (§2.3, default copy:
  summary `Confirm database removal`, why `Removing this database is
  destructive and requires the exact id.`, rerun nextAction
  `${CLI_NAME} postgres remove ${id} --confirm ${id}`; consent
  question pending ratification: `Remove database ${id}? This
  permanently deletes the database and its data.`) →
  `provider.removeDatabase(database.id, { signal })`.
- data: `{ projectId, projectName, database }` (pre-removal
  summary).
- human: summary ok `Removing database.`; fields `project`,
  `database`, `id`; list block `["Database and its connection
  metadata were removed."]`.
- stdout: none. json: strip shape. next: none.
- Tests: success; consent matrix (as 3.5); not-found/ambiguous;
  json; unauth.

### 3.7 `postgres backup list <database>` — `v8/postgres/backup-list.ts`

- help.summary: `List backups for a database`; examples:
  `postgres backup list db_123`,
  `postgres backup list acme-production --limit 50`.
- args: positional `database`; flags `limit: flag.string({ brief:
  "Maximum number of backups to return", placeholder: "n" })`,
  project, branch. (`limit` stays a string flag parsed by the
  handler — the legacy integer/range rule is the contract, not the
  engine's number parsing: trim → Number → integer 1..100 else
  `POSTGRES.USAGE_ERROR` `Invalid backup limit` / `--limit must be
  an integer between 1 and 100.` / nextActions from fix + example
  `${CLI_NAME} postgres backup list <database> --limit 50`.)
- Handler: parse limit FIRST → context → resolve →
  `provider.listBackups(database.id, { limit, signal })`.
- data: `{ projectId, projectName, database, backups, retentionDays,
  hasMore }`.
- human: summary info `Listing platform-created database backups.`;
  fields `database:` + `retention: ${retentionDays} days` when
  non-null; empty → list `["No backups found."]`; else table
  `Id | Type | Status | Size | Created` (Size via formatBackupSize,
  Created `unknown` when ""), API order preserved; when hasMore:
  list `["More backups exist; raise --limit to see them."]`.
- stdout: table data rows tab-joined. json: legacy
  `serializeDatabaseBackupList` shape: `{ context: { project,
  database }, items: [{ name: id, id, status: null }], count,
  projectId, database, backups, retentionDays, hasMore }`.
- next: none.
- Tests: success; empty; hasMore line; limit validation (0, 101,
  non-integer → exit 2); 422 → `POSTGRES.BACKUPS_UNSUPPORTED` copy
  verbatim; json; unauth.

### 3.8 `postgres connection list <database>` — `v8/postgres/connection-list.ts`

- help.summary: `List database connection metadata without secret
  values`; examples: `postgres connection list db_123`,
  `postgres connection list acme-preview --branch preview --json`.
- args: positional `database`; flags project, branch.
- Handler: context → resolve → `provider.listConnections`.
- data: `{ projectId, projectName, database, connections }`.
- human: summary info `Listing database connection metadata.`;
  fields `database:`; empty → list `["No database connections
  found."]`; else table `Name | Id | Created` (Created `unknown`
  when null), API order.
- stdout: table data rows tab-joined. json: legacy serializer:
  `{ context: { project, database }, items: [{ name, id, status:
  null }], count, projectId, database, connections }`.
- next: none. Tests: success; empty; not-found; json; unauth.

### 3.9 `postgres connection create <database>` — `v8/postgres/connection-create.ts` (secret)

- help.summary: `Create a database connection and print its one-time
  connection URL`; examples: `postgres connection create db_123`,
  `postgres connection create db_123 --name readonly`.
- args: positional `database`; flags `name: flag.string({ brief:
  "Connection name", placeholder: "name" })`, project, branch.
- Handler: context → resolve → `provider.createConnection({
  databaseId, name: flags.name?.trim() || defaultConnectionName(),
  signal })` — `defaultConnectionName` reproduced verbatim
  (`cli-<17-digit compact ISO>-<4 hex>`; whitespace `--name` falls
  back).
- data: `{ projectId, projectName, database, connection,
  connectionString }`.
- human: summary ok `` Added a connection to "${database.name}" in
  ${postgresTargetLabel(...)}. `` + list `["The connection URL below
  is shown once, so save it now."]` + sensitive connection-URL field
  row.
- stdout: `[connectionString]`. json: strip shape (carries
  connectionString). next: none.
- Tests: success (stdout URL, masked human, default name pattern
  `^cli-\d{17}-[0-9a-f]{4}$` when --name omitted); named create;
  string-missing → `POSTGRES.CONNECTION_STRING_MISSING`; json;
  unauth.

### 3.10 `postgres connection rotate <connection>` — `v8/postgres/connection-rotate.ts` (consent + secret)

- help.summary: `Rotate connection credentials and print the new
  one-time connection URL`; example:
  `postgres connection rotate conn_123 --confirm conn_123`.
- args: positional `connection: positional.string({ brief:
  "Connection id", placeholder: "connection-id" })`; flags
  `confirm: flag.string({ brief: "Exact connection id required to
  rotate", placeholder: "connection-id" })`. NO project/branch.
- Handler order (legacy database.ts:551): (1) blank id →
  `POSTGRES.USAGE_ERROR` `Connection id required` / `Database
  connection rotation needs a connection id.` / nextActions incl.
  example `${CLI_NAME} postgres connection rotate <connection-id>
  --confirm <connection-id>`; (2) confirmation BEFORE any API call —
  copy: summary `Confirm database connection rotation`, why
  `Rotating revokes the previous credentials and breaks clients
  still using them, so it requires the exact connection id.`, rerun
  nextAction `${CLI_NAME} postgres connection rotate ${id} --confirm
  ${id}`; consent question pending ratification: `Rotate connection
  ${id}? The previous credentials stop working immediately.`; (3)
  `resolvePostgresProviderOnly` → `provider.rotateConnection(id,
  { signal })`.
- data: `{ connection, database: {id,name}|null, connectionString }`
  (no project fields — legacy shape).
- human: summary ok `` Rotated credentials for ${database ?
  `"${database.name}"` : `connection ${connection.id}`}. The
  previous credentials no longer work. `` + one-time list line +
  sensitive URL row.
- stdout: `[connectionString]`. json: result unchanged (legacy
  identity serializer). next: none.
- Tests: success; blank id; consent matrix; rotate-response
  string-missing (`POSTGRES.CONNECTION_STRING_MISSING`, the rotate
  variant copy: `Rotated connection strings are one-time-view
  secrets…`); real-mode 404 → API passthrough code, exit 2; json;
  unauth.

### 3.11 `postgres connection remove <connection>` — `v8/postgres/connection-remove.ts` (consent)

- help.summary: `Remove a database connection after exact id
  confirmation`; example:
  `postgres connection remove conn_123 --confirm conn_123`.
- args: positional `connection` (as 3.10); flag `confirm` (brief
  `Exact connection id required to remove`). NO project/branch.
- Handler: blank id → `POSTGRES.USAGE_ERROR` `Connection id
  required` / `Database connection removal needs a connection id.`
  (example nextAction `${CLI_NAME} postgres connection remove
  <connection-id> --confirm <connection-id>`); confirmation (§2.3,
  default copy: summary `Confirm database connection removal`, why
  `Removing this database connection is destructive and requires the
  exact id.`; consent question pending ratification: `Remove
  connection ${id}? Clients using it lose access.`); provider-only →
  `provider.removeConnection(id, { signal })`.
- data: `{ connection: { id } }`.
- human: summary ok `Removing database connection.`; fields
  `connection` = id; list `["The connection metadata was removed.
  Existing one-time secrets were not shown."]`.
- stdout: none. json: `{ connection }`. next: none.
- Tests: success; blank id; consent matrix; json; unauth.

## 4. Divergence entries this dispatch adds

1. Rename class: every `database` path/id/help/example →
   `postgres` (R-S2b-1); no alias.
2. Exit-code class: all errored paths exit 2 (legacy 1) — commands
   enumerated per conformance row; `CONFIRMATION_REQUIRED` stays 2;
   consent cancel = 3 (new).
3. Error-code map of §2.5 (flat → dotted), row per code.
4. Auto-login drop (R-S2b-2 / Q1) — all 11 commands.
5. Consent prompts added for restore/remove/rotate/connection-remove
   (legacy: flag-only, no prompt) with pinned question texts —
   operator ratification per conventions §5.
6. Plan-limit humanLines rendering → structured why/nextAction/meta
   (§2.4).
7. Package-runner formatter dropped from command strings (§0).
8. `--trace` fix-text substitution (§0).
9. verboseContext / `--verbose` context block dropped (log-level
   ruling); resolution provenance no longer rendered.
10. List commands write data rows to stdout in human mode (S2a
    precedent; legacy stdout was empty).
11. Sync-command progress lines (`Creating database...` etc.)
    dropped.
12. Fixture-only `DATABASE_CONNECTION_NOT_FOUND` dies with fixture
    machinery (real mode passes API codes through) — no v8
    counterpart.

## 5. Legacy test deletion (this dispatch)

Delete from `packages/cli/tests/database.test.ts` every fixture-mode
case exercising the 11 ported commands (the file's entire
command-level surface); keep any case that exercises unported shell
behavior. `database-plan-limit.test.ts`: port assertions are
superseded by 3.1's plan-limit test — delete the file if all its
cases target ported commands, else keep the remainder. Provider unit
tests (`app-provider`-style, database provider internals) are NOT
deleted — the provider survives as the operation layer.

## 6. Conformance rows

The implementer appends one row per command to
`assets/s2/parity-divergences-s2b.md` (conventions §11 format),
citing this doc's section as "rules applied".
