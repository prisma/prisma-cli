# Facts: `database` group (11 commands) — legacy commander CLI, verbatim extraction

All paths are relative to the repository root (written below as `<wt>`,
the checkout of branch `claude/prisma-cli-v8-onboarding-30e694`). Key
files:

- Registration: `<wt>/packages/cli/src/commands/database/index.ts`
- Controllers: `<wt>/packages/cli/src/controllers/database.ts`
- Provider: `<wt>/packages/cli/src/lib/database/provider.ts`
- Presenters: `<wt>/packages/cli/src/presenters/database.ts`
- Descriptors: `<wt>/packages/cli/src/shell/command-meta.ts`
- Errors: `<wt>/packages/cli/src/shell/errors.ts`
- Types: `<wt>/packages/cli/src/types/database.ts`
- Grounding inventory: `<wt>/.drive/projects/prisma-cli-v8/assets/s2/command-inventory.md`

---

## Shared: command tree registration

`createDatabaseCommand(runtime)` (commands/database/index.ts:64-82) builds group `database` (descriptor id `"database"`), attaches `addCompactGlobalFlags`, then adds subcommands in this order: `list`, `show`, `create`, `usage`, `restore`, `remove`, `backup` (group, compact flags, one child `list`), `connection` (group, compact flags, children in order `list`, `create`, `rotate`, `remove`).

Every leaf gets `addGlobalFlags(command)`. The project/branch flag pair is one helper (index.ts:84-88):

```ts
function addProjectAndBranchOptions(command: Command): Command {
  return command
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--branch <git-name>", "Branch git name"));
}
```

Group descriptors (command-meta.ts):

- `database` (219-227): description `"Manage Prisma Postgres databases for a project"`, examples `"prisma-cli database list"`, `"prisma-cli database create my-db"`, `"prisma-cli database connection create db_123"`.
- `database.backup` (443-447): `"Inspect platform-created database backups"`, example `"prisma-cli database backup list db_123"`.
- `database.connection` (458-466): `"Manage one-time-view database connection strings"`, examples `"prisma-cli database connection list db_123"`, `"prisma-cli database connection create db_123"`, `"prisma-cli database connection remove conn_123 --confirm conn_123"`.

## Shared: auth + provider construction + project resolution

`requireDatabaseContext(context, flags, commandName)` (controllers/database.ts:705-763) is used by every command that takes `--project/--branch`. Flow:

1. `requireAuthenticatedAuthState(context)` (from `controllers/auth.ts`; per inventory §3.4 it launches interactive OAuth login on a TTY if unauthenticated, else throws `AUTH_REQUIRED`).
2. If `authState.workspace` is missing → `workspaceRequiredError()` (errors.ts:141-149): a `usageError` (`USAGE_ERROR`, exit 2, domain `"auth"`) with summary `"Workspace required"`, why `"This command needs an active workspace, but the authenticated session does not have one."`, fix `"Run prisma-cli auth login and choose a workspace."`, nextSteps `["prisma-cli auth login"]`.
3. Real mode (`isRealMode` = neither `context.runtime.fixturePath` nor env `PRISMA_CLI_MOCK_FIXTURE_PATH`, database.ts:91-96): `authenticatedManagementApiClient(context.runtime.env, context.runtime.signal)`; null → `authRequiredError()` (errors.ts:101-115: code `AUTH_REQUIRED`, domain `auth`, exit 1, summary `"Authentication required"`, why `"This command needs an authenticated session."`, fix `"Run prisma-cli auth login, or rerun the command in a TTY to sign in interactively."`, nextSteps `["prisma-cli auth login"]`).
4. `resolveProjectTarget({context, workspace, explicitProject: flags.projectRef, listProjects: () => listRealWorkspaceProjects(client, workspace, signal), commandName})` (lib/project/resolution.ts:155-183). Resolution order inside: implicit local pin (`.prisma/local.json`) then explicit/pin match against the listed projects. **`PRISMA_PROJECT_ID` does NOT affect these commands**: `resolveProjectTarget` accepts an `envProjectId` option, but `requireDatabaseContext` does not pass one (see the call quoted above) and only `controllers/app.ts` reads the variable, for `app deploy`/`app run`. Corrected 2026-08-11 against the source; `facts-d1-project.md` §14.1 step 2 and §15.2 say the same. Unbound → `ProjectSetupRequiredError` whose message is `` `This directory is not linked to a Prisma Project, and ${commandLabel} will not choose one from package or directory names.` `` (resolution.ts:106-126). Errors are converted via `projectResolutionErrorToCliError` (resolution.ts:352) to `PROJECT_NOT_FOUND` / `PROJECT_AMBIGUOUS` / `PROJECT_SETUP_REQUIRED` / `LOCAL_STATE_STALE` / `LOCAL_PROJECT_WORKSPACE_MISMATCH` CliErrors.
5. Provider: `createManagementDatabaseProvider(client, { formatCommand: resolvePrismaCliPackageCommandFormatterSync(context.runtime.cwd), workspaceId: workspace.id })` (database.ts:738-743).

Fixture mode instead builds `createFixtureDatabaseProvider(context)` (database.ts:789-910) over `context.api` and resolves projects via `listFixtureWorkspaceProjects`.

`requireDatabaseProviderOnly(context)` (database.ts:765-787) — used by `connection remove` and `connection rotate` only (no project resolution at all): requires auth state, builds the client, and calls `createManagementDatabaseProvider(client, { formatCommand, workspaceId: authState.workspace?.id })`. Note `workspaceId` may be undefined here.

`resolvePrismaCliPackageCommandFormatterSync(cwd)` (lib/agent/cli-command.ts:28-32) returns a formatter that prefixes args with the package-manager runner (`pnpm dlx | bunx | npx -y @prisma/cli@latest ...`, overridable via `PRISMA_CLI_PACKAGE_RUNNER`/`_NAME`/`_SPEC`/`PRISMA_CLI_BINARY`). The provider's default formatter fallback is `formatPrismaCliCommand(args)` (shell/cli-command.ts:13-18), plain join with a `prisma-cli`-style prefix.

## Shared: database resolution (id-or-name)

`resolveDatabase(provider, target, databaseRef, branchName, signal)` (database.ts:912-953):

- Empty/whitespace ref → `usageError("Database id or name required", "This command needs a database id or name.", "Pass a database id or name.", ["prisma-cli database list"], "database")` (exit 2).
- Calls `provider.listDatabases({projectId: target.project.id, branchName, signal})` and filters `database.id === ref || database.name === ref`.
- 0 matches → `databaseNotFoundError(ref, target.project.name, branchName)` (database.ts:1018-1035):

```
code: DATABASE_NOT_FOUND, domain: database, exitCode: 1
summary: "Database not found"
why: `No database matched "${databaseRef}"${scope}.`   // scope = ` in project "${projectName}"` + optional ` on branch "${branchName}"`
fix: "Pass a database id or name from prisma-cli database list."
nextSteps: ["prisma-cli database list"]
```

- >1 matches → `databaseAmbiguousError(ref, matches, branchName)` (database.ts:1037-1060):

```
code: DATABASE_AMBIGUOUS, domain: database, exitCode: 1
summary: "Database resolution is ambiguous"
why: branchName ? `Multiple databases matched "${databaseRef}" on branch "${branchName}".`
               : `Multiple databases matched "${databaseRef}".`
fix: "Pass the database id, or pass --branch <git-name> to narrow the match."
nextSteps: ["prisma-cli database list"]
meta: { matches: [{id, name, branchName}, ...] }
```

- Exactly 1: `provider.showDatabase(selected.id, {projectId, signal})` then `ensureProjectId(shown ?? selected, target.project.id)` (fills `projectId` if absent, database.ts:955-960).

## Shared: exact-id confirmation

`requireExactConfirmation(options)` (database.ts:976-1007). Passes only when `options.confirm === options.id` (strict string equality; undefined ≠ id). Otherwise:

```ts
throw new CliError({
  code: "CONFIRMATION_REQUIRED",
  domain: "database",
  summary: options.summary ?? `Confirm ${options.resourceName} removal`,
  why: options.why ?? `Removing this ${options.resourceName} is destructive and requires the exact id.`,
  fix: `Rerun with --confirm ${options.id}.`,
  exitCode: 2,
  nextSteps: [options.nextStep ?? `prisma-cli ${options.commandName} ${options.id} --confirm ${options.id}`],
  meta: { expectedConfirm: options.id, receivedConfirm: options.confirm ?? null },
});
```

Note the default nextStep uses a hard-coded `prisma-cli` prefix (not the package-runner formatter); restore and rotate pass explicit `nextStep` strings built with the formatter.

## Shared: usage date validation (verbatim rules)

`parseUsageDate(value, flagName, dayBoundary, formatCommand)` (database.ts:613-672):

- `undefined` → `undefined` (flag omitted = no query param).
- Trimmed value matching `/^\d{4}-\d{2}-\d{2}$/` AND a valid calendar date is expanded: `--from` (dayBoundary "start") → `` `${trimmed}T00:00:00.000Z` ``; `--to` (dayBoundary "end") → `` `${trimmed}T23:59:59.999Z` ``.
- Trimmed value matching `/^\d{4}-\d{2}-\d{2}T/` with `Date.parse` not NaN AND valid calendar date on the first 10 chars → passed through unchanged.
- Calendar validity (database.ts:666-672): `Date.parse(datePart + "T00:00:00.000Z")` must round-trip — `new Date(ts).toISOString().startsWith(datePart)` — so rollovers like `2026-02-30` are rejected.
- Otherwise → `usageError("Invalid usage period", `${flagName} must be an ISO date such as 2026-06-01 or an ISO datetime such as 2026-06-01T12:00:00Z.`, `Pass an ISO date or datetime to ${flagName}.`, [formatCommand(["database","usage","<database>","--from","2026-06-01","--to","2026-06-30"])], "database")` — exit 2.
- Range check (database.ts:374-392): after parsing both, `if (from && to && Date.parse(from) > Date.parse(to))` → `usageError("Invalid usage period", "--from must not be later than --to.", "Pass a --from date that is on or before the --to date.", [same example], "database")`.

Design intent comment (database.ts:626-632): the Management API validates `startDate`/`endDate` as full ISO datetimes; date-only input is expanded to UTC day boundaries so `--from X --to Y` stays a calendar-day-inclusive range.

## Shared: backup --limit validation

`parseBackupLimit(value, formatCommand)` (database.ts:674-703): omitted → `undefined`. Else `Number(value.trim())`; `!Number.isInteger(limit) || limit < 1 || limit > 100` → `usageError("Invalid backup limit", "--limit must be an integer between 1 and 100.", "Pass a --limit between 1 and 100.", [formatCommand(["database","backup","list","<database>","--limit","50"])], "database")` — exit 2.

## Shared: API error mapping and plan-limit machinery (PR #127)

All Management-API failures in the real provider funnel through `databaseApiError(options)` (provider.ts:794-865), invoked as `toDatabaseApiError(summary, result.response, result.error, signal)` with a per-operation summary string.

**Plan-limit branch.** `isPlanLimitApiError(error)` (provider.ts:867-869) is true when the API body has `error.error.code === "planLimitReached"`. Then:

1. If `workspaceId` is known, fetch `GET /v1/workspaces/{id}/subscription` via `readWorkspaceSubscription` (provider.ts:871-902): best-effort, `SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 3_000` ms timeout via its own AbortController combined with the outer signal (`AbortSignal.any`), every failure path returns `null` (but re-throws user aborts via `signal?.throwIfAborted()`).
2. Build the error (provider.ts:823-848):

```ts
new CliError({
  code: "PLAN_LIMIT_REACHED",
  domain: "database",
  summary: "Workspace plan limit reached",
  why: "Database operations are blocked because this workspace has used the operations included in its plan. This is a workspace plan limit, not a Prisma outage.",
  fix: upgradeUrl
    ? `Upgrade the workspace plan at ${upgradeUrl}.`
    : "Open Prisma Console and upgrade the affected workspace plan.",
  meta: {
    workspaceId: options.workspaceId ?? null,
    blockedFeature: null,
    planName,        // subscription?.planName || null
    usageBlocked,    // subscription?.usageBlocked ?? null
    upgradeUrl,      // subscription?.upgradeUrl || null
  },
  exitCode: 1,
  nextSteps: [],
  humanLines: [
    "Workspace plan limit reached [PLAN_LIMIT_REACHED]",
    "",
    "Database operations are blocked because this workspace has used the operations included in its plan. This is a workspace plan limit, not a Prisma outage.",
    "",
    workspaceLine,       // `Workspace: ${workspaceId}` or "Workspace: unavailable"
    ...recoveryLines,    // optional `Current plan: ${planName}`, then
                         // `Upgrade: ${upgradeUrl}` or
                         // "Upgrade: Open Prisma Console and upgrade the affected workspace plan."
  ],
});
```

`humanLines` fully replaces the standard human error rendering. `nextActions` is NOT set (empty). Tests: `database-plan-limit.test.ts`.

**Plan-limit precedence over status-specific mappings.** The special-status branches in `showDatabase` (404→null), `listBackups` (422→`DATABASE_BACKUPS_UNSUPPORTED`), and `restoreDatabase` (409→`DATABASE_RESTORE_CONFLICT`, 404→`DATABASE_BACKUP_NOT_FOUND`) each check `!isPlanLimitApiError(result.error)` first, so a planLimitReached body always wins regardless of HTTP status.

**API-code passthrough (generic branch, provider.ts:851-864).** When not plan-limit:

```ts
const status = options.response?.status ?? 0;
return new CliError({
  code: options.error?.error?.code ?? "DATABASE_API_ERROR",
  domain: "database",
  summary: options.summary,   // e.g. "Failed to list databases"
  why: options.error?.error?.message ?? `The Management API returned status ${status || "unknown"}.`,
  fix: options.error?.error?.hint ?? "Re-run with --trace for the underlying API response details.",
  exitCode: 1,
  nextSteps: [],
});
```

So the CliError `code` is the raw API `error.code` string when present ("DATABASE_API_ERROR or API-provided code"), and `why`/`fix` prefer the API's `message`/`hint`.

Per-operation summary strings (provider.ts): `"Failed to list databases"` (257), `"Failed to show database"` (295), `"Failed to create database"` (322), `"Failed to remove database"` (344), `"Failed to list database connections"` (364), `"Failed to create database connection"` (391), `"Failed to remove database connection"` (413), `"Failed to fetch database usage"` (434), `"Failed to list database backups"` (462), `"Failed to restore database"` (509), `"Failed to rotate database connection"` (531).

## Shared: output channel semantics

`runCommand` / `writeCommandSuccess` (shell/command-runner.ts:103-144): with `--json`, only the JSON envelope goes to stdout (renderJson output replaces `result`). Human mode: `renderStdout` lines (secrets) go to **stdout**, `renderHuman` + warnings + verbose diagnostics go to **stderr**; with `--quiet` only the renderStdout payload prints. When both exist a blank line is appended to the human block before the stdout payload is written. JSON envelope shape: success `{ok:true, command, result, warnings, nextSteps, nextActions}`, error `{ok:false, command, error:{code,domain,severity,summary,why,fix,where,meta,docsUrl}, warnings, nextSteps, nextActions}` (inventory §3.1).

`CliError` fields (errors.ts:13-66): `{code, domain, summary, why, fix, debug, where, meta, docsUrl, exitCode (default 1), nextSteps, nextActions, humanLines}`. `usageError(...)` = code `USAGE_ERROR`, exit 2.

## Shared: default connection name

`defaultConnectionName()` (database.ts:1009-1016):

```ts
function defaultConnectionName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 17);           // YYYYMMDDHHmmssSSS (17 digits)
  const suffix = randomBytes(2).toString("hex");   // 4 hex chars
  return `cli-${timestamp}-${suffix}`;
}
```

Applied in `runDatabaseConnectionCreate` as `name: flags.name?.trim() || defaultConnectionName()` (database.ts:303) — so an all-whitespace `--name` also falls back to the default.

## Shared: verbose context block

Every project-scoped result carries `verboseContext` (the `ResolvedProjectTarget`: `{workspace, project, resolution}`). Human renderers append `renderResolvedProjectContextBlock` (presenters/verbose-context.ts:18-32), which only renders under `--verbose` (via `renderVerboseBlock`), titled `"Resolved context"` with rows: workspace, workspace id, project, project id, project source (`--project` | environment | `.prisma/local.json` | platform mapping | created | prompt | unbound), optional target name, optional branch rows. JSON serializers strip it with `stripVerboseContext` (verbose-context.ts:69-74) — the plain result minus `verboseContext`.

## Shared: provider normalization types

`DatabaseSummary` (types/database.ts): `{id, name, projectId, branchId: string|null, branchName: string|null, region: string|null, status: string|null, isDefault: boolean|null, createdAt: string|null}`. `normalizeDatabase` (provider.ts:545-565) maps branchName from `branchGitName ?? branchName ?? branch?.gitName ?? branch?.name ?? null` and region from string `region` | `region.id` | `regionId` | null.

`DatabaseConnectionSummary`: `{id, name, databaseId, createdAt: string|null}`; `normalizeConnection` (provider.ts:567-577) defaults `name` to the connection id.

`extractConnectionString` (provider.ts:654-664) preference order: `endpoints.pooled.connectionString` → top-level `connectionString` → `endpoints.direct` → `endpoints.accelerate` → null.

`normalizeUsage` (provider.ts:666-686) defaults: period start/end `""`, operations `{used: 0, unit: "ops"}`, storage `{used: 0, unit: "GiB"}`, generatedAt `""`.

`normalizeBackupList` (provider.ts:688-702): backups with `backupType ?? "unknown"`, `status ?? "unknown"`, `size ?? null`, `createdAt ?? ""`; `retentionDays` from `meta.backupRetentionDays ?? null`; `hasMore` from `pagination.hasMore ?? false`.

---

## 1. `database list`

**Registration** (index.ts:90-117): `new Command("list")`, descriptor `database.list`. No positionals. Flags: `--project <id-or-name>` "Project id or name", `--branch <git-name>` "Branch git name", + full globals. No renderStdout.

**Descriptor** (command-meta.ts:390-399): description `"List Prisma Postgres databases for the resolved project"`; examples `"prisma-cli database list"`, `"prisma-cli database list --branch feature/foo"`, `"prisma-cli database list --json"`.

**Controller** `runDatabaseList(context, {projectRef, branchName})` (database.ts:98-127): `requireDatabaseContext(context, flags, "database list")` → `provider.listDatabases({projectId, branchName, signal})` → `sortDatabases`. Real provider (provider.ts:239-278): paginated `client.GET("/v1/databases", {query: {projectId, branchGitName: branchName, cursor}})`, sequential loop over `pagination.nextCursor` while `hasMore`.

**Sort** `sortDatabases` (database.ts:962-974): `localeCompare` on `branchName ?? ""`, then `name`, then `id` — branch → name → id ascending.

**Result** `{command: "database.list", result: {projectId, projectName, branchName: flags.branchName ?? null, verboseContext, databases}, warnings: [], nextSteps: []}`.

**Human output** `renderDatabaseList` (presenters/database.ts:25-76): title line `` `${strong(label)} ${dim("→")} ${dim("Listing databases for the resolved project.")}` `` then a `│` rail with `project:` and (if set) `branch:` rows; empty case `"No databases found."`; else a column table with headers `Name Branch Region Status Id` — Branch shows `"unscoped"` when null, Region `"unknown"` when null, Status via `formatStatus` = `status ?? (isDefault ? "default" : "unknown")`.

**JSON** `serializeDatabaseList` (78-96): spread of `serializeList({context: {project, branch?}, items: [{noun: "database", label: name, id, status: isDefault ? "default" : null}]})` — which yields `{context, items: [{name, id, status}], count}` (output/patterns.ts:93-106) — plus `projectId`, `branchName`, `databases` (full summaries).

**Errors**: auth/workspace/project-resolution shared errors; `PLAN_LIMIT_REACHED` or API passthrough with summary `"Failed to list databases"`.

## 2. `database show <database>`

**Registration** (index.ts:119-148): positional `<database>` "Database id or name" (required); `--project`, `--branch`; globals.

**Descriptor** (400-408): `"Show database metadata without secret values"`; examples `"prisma-cli database show db_123"`, `"prisma-cli database show acme-preview --branch preview --json"`.

**Controller** `runDatabaseShow` (database.ts:129-162): shared context (`"database show"`) → `resolveDatabase` → `provider.listConnections(database.id, {signal})`. Real: `GET /v1/databases/{databaseId}` (show; 404 non-plan-limit → `null`, which makes resolveDatabase fall back to the list entry) and `GET /v1/databases/{databaseId}/connections`.

**Result** `{command: "database.show", result: {projectId, projectName, verboseContext, database, connections}}`.

**Human** `renderDatabaseShow` (98-131): `renderShow` card titled `"Showing database metadata."` with fields in order: `project`, `database` (name), `id` (dim), `branch` (`"unscoped"` dim when null), `region` (`"unknown"` dim when null), `status` (formatStatus), `connections` (count as string). No secret values.

**JSON** `serializeDatabaseShow` = `stripVerboseContext(result)` → `{projectId, projectName, database, connections}`.

**Errors**: shared + `DATABASE_NOT_FOUND` / `DATABASE_AMBIGUOUS`; API summaries `"Failed to show database"`, `"Failed to list database connections"`.

## 3. `database create <name>`

**Registration** (index.ts:150-184): positional `<name>` "Database name" (required); `--region <region>` "Prisma Postgres region id"; `--project`, `--branch`; globals. HAS `renderStdout`.

**Descriptor** (409-418): `"Create a Prisma Postgres database and print its one-time connection URL"`; examples `"prisma-cli database create my-db"`, `"prisma-cli database create my-db --branch feature/foo --region eu-central-1"`.

**Controller** `runDatabaseCreate` (database.ts:164-206): trims name; empty → `usageError("Database name required", "Database create needs a non-empty name.", "Pass a database name.", ["prisma-cli database create <name>"], "database")` (exit 2). Then shared context (`"database create"`) → `provider.createDatabase({projectId, name, branchName, region, signal})`. NOTE: no `resolveDatabase` here; commander requires the positional so only whitespace names hit the usage error.

**Real provider** (provider.ts:309-333): `POST /v1/databases` body `{projectId, name, source: {type: "empty"}, branchGitName?, region?}`. Response → `normalizeCreatedDatabase` (provider.ts:579-600): takes `connections[0]`; missing →

```
code: DATABASE_CONNECTION_MISSING, domain: database, exit 1
summary: "Created database did not return a connection string"
why: "The Management API created the database but did not include the one-time connection payload."
fix: "Create a connection explicitly with prisma-cli database connection create <database>."
nextSteps: [`prisma-cli database connection create ${database.id}`]
```

then `normalizeCreatedConnection` (see command 9) which can throw `DATABASE_CONNECTION_STRING_MISSING`.

**Result** `{command: "database.create", result: {projectId, projectName, verboseContext, database (ensureProjectId), connection, connectionString}}`.

**Output**: `renderDatabaseCreateStdout` (presenters:137-143) returns exactly `[result.connectionString]` — the bare URL, one line, nothing else, on stdout. Human (stderr, presenters:145-167):

```
Creating database...
<success glyph> Created database "<name>" in <project[ / branch]>.
  The connection URL below is shown once, so save it now.
```

(`formatDatabaseTarget` = `branchName ? `${projectName} / ${branchName}` : projectName`.) Under `--verbose`, appends metadata rows: optional `workspace`, `project`, `branch` (or "unscoped"), `database` `name  (id)`, `region`, `status`, `connection` `name  (id)` (presenters:604-628).

**JSON** `serializeDatabaseCreate` = `stripVerboseContext` → includes `connectionString` in clear.

**Errors**: shared; `PLAN_LIMIT_REACHED`; passthrough summary `"Failed to create database"`; `DATABASE_CONNECTION_MISSING`; `DATABASE_CONNECTION_STRING_MISSING`. nextSteps on success: `[]`.

## 4. `database usage <database>`

**Registration** (index.ts:186-225): positional `<database>` "Database id or name"; `--from <iso-date>` "Start of the usage period"; `--to <iso-date>` "End of the usage period"; `--project`, `--branch`; globals.

**Descriptor** (419-427): `"Show usage metrics for a database"`; examples `"prisma-cli database usage db_123"`, `"prisma-cli database usage acme-production --from 2026-06-01 --to 2026-06-30"`.

**Controller** `runDatabaseUsage` (database.ts:364-426): parses dates FIRST (before auth/context) via `parseUsageDate` + range check (see shared section), then shared context (`"database usage"`) → `resolveDatabase` → `provider.getUsage(database.id, {from, to, signal})`. Real: `GET /v1/databases/{databaseId}/usage` with query `startDate`/`endDate` only when set (provider.ts:421-442).

**Result** `{command: "database.usage", result: {projectId, projectName, verboseContext, database, period, metrics, generatedAt}}`.

**Human** `renderDatabaseUsage` (337-375): `renderShow` card titled `"Showing database usage metrics."`, fields: `project`, `database`, `id` (dim), `period` = `` `${start||"unknown"} to ${end||"unknown"}` ``, `operations` = `` `${used} ${unit}` ``, `storage` = `` `${used} ${unit}` ``, `generated` (dim, `||"unknown"`).

**JSON** `serializeDatabaseUsage` = `stripVerboseContext`.

**Errors**: `USAGE_ERROR` ("Invalid usage period", 2 variants) exit 2; shared; `DATABASE_NOT_FOUND`/`DATABASE_AMBIGUOUS`; passthrough summary `"Failed to fetch database usage"`.

## 5. `database restore <database>`

**Registration** (index.ts:227-280): positional `<database>` "Target database id or name"; `--backup <backup-id>` "Backup to restore from"; `--source-database <database>` "Database the backup belongs to (defaults to the target)"; `--confirm <database-id>` "Exact target database id required to restore"; `--project`, `--branch`; globals. No renderStdout.

**Descriptor** (428-435): `"Restore a database from a backup after exact id confirmation"`; example `"prisma-cli database restore db_123 --backup bkp_456 --confirm db_123"`.

**Controller** `runDatabaseRestore` (database.ts:471-549), in order:

1. Missing/blank `--backup` → `usageError("Backup id required", "Database restore needs the backup to restore from.", `Pass --backup <backup-id> from ${formatCommand(["database","backup","list","<database>"])}.`, [that list command], "database")` exit 2.
2. Shared context (`"database restore"`); `resolveDatabase` for target; if `--source-database` set, `resolveDatabase` again for the source (same branch scope), else source = target.
3. Confirmation via `requireExactConfirmation` with overrides — verbatim consent copy:
   - summary: `"Confirm database restore"`
   - why: `"Restoring immediately and irreversibly overwrites all data in the target database, so it requires the exact target database id."`
   - fix: `` `Rerun with --confirm ${database.id}.` ``
   - nextStep: `` `${formatCommand(["database","restore",database.id,"--backup",backupId])}${sourceDatabaseArg} --confirm ${database.id}` `` where `sourceDatabaseArg` is `""` when source===target else `` ` --source-database ${sourceDatabase.id}` ``
   - exit 2, meta `{expectedConfirm, receivedConfirm}`. (`--confirm` must equal the resolved **target database id**, never the name.)
4. `provider.restoreDatabase({targetDatabaseId, sourceDatabaseId, backupId, projectId, signal})`.

**Real provider** (provider.ts:472-520): `POST /v1/databases/{targetDatabaseId}/restore` body `{source: {type: "backup", databaseId: sourceDatabaseId, backupId}}`. Status mappings (all skipped when body is planLimitReached):

- 409 → `restoreConflictError` (provider.ts:776-792):

```
code: DATABASE_RESTORE_CONFLICT, domain: database, exit 1
summary: "Database cannot be restored right now"
why: apiMessage ?? `Database "${targetDatabaseId}" is provisioning or already recovering.`
fix: "Wait for the database to become ready, then retry the restore."
nextSteps: [formatCommand(["database","show",targetDatabaseId])]
```

- 404 → `restoreBackupNotFoundError` (provider.ts:752-774) — code comment: target and source were resolved before the call so a 404 identifies the backup:

```
code: DATABASE_BACKUP_NOT_FOUND, domain: database, exit 1
summary: "Database backup not found"
why: apiMessage ?? `No backup matched "${backupId}" for database "${sourceDatabaseId}".`
fix: `Pass a backup id from ${formatCommand(["database","backup","list",sourceDatabaseId])}.`
nextSteps: [that list command]
```

(The fixture provider's equivalent `backupNotFoundError` at database.ts:1062-1082 has identical copy without the API-message override.)

- other errors → passthrough summary `"Failed to restore database"`.

**Result** `{command: "database.restore", result: {projectId, projectName, verboseContext, database: restored, source: {databaseId: sourceDatabase.id, backupId}}, warnings: [], nextSteps: [formatCommand(["database","show",database.id])]}` — the ONLY database command with a success nextStep.

**Human** `renderDatabaseRestore` (465-496): `renderMutate` card titled `"Restoring database from backup."`; context rows `project`, `database`, `id` (dim), `backup`, plus `source` row only when source ≠ target; operation `"Restoring database"` count 1; details:

```
The restore is running; the database status is "<status ?? "recovering">" until it completes.
Connections and credentials are preserved.
```

**JSON** `serializeDatabaseRestore` = `stripVerboseContext`.

## 6. `database remove <database>`

**Registration** (index.ts:335-376): positional `<database>` "Database id or name"; `--confirm <database-id>` "Exact database id required to remove"; `--project`, `--branch`; globals.

**Descriptor** (436-441): `"Remove a database after exact id confirmation"`; example `"prisma-cli database remove db_123 --confirm db_123"`.

**Controller** `runDatabaseRemove` (database.ts:208-247): shared context (`"database remove"`) → `resolveDatabase` → `requireExactConfirmation({resourceName: "database", commandName: "database remove", id: database.id, confirm})` — default copy: summary `"Confirm database removal"`, why `"Removing this database is destructive and requires the exact id."`, fix `` `Rerun with --confirm ${id}.` ``, nextSteps `` [`prisma-cli database remove ${id} --confirm ${id}`] ``, exit 2 → `provider.removeDatabase(database.id, {signal})` (real: `DELETE /v1/databases/{databaseId}`, provider.ts:335-350).

**Result** `{command: "database.remove", result: {projectId, projectName, verboseContext, database}}` (the pre-removal summary).

**Human** `renderDatabaseRemove` (173-197): `renderMutate` titled `"Removing database."`; context `project`, `database`, `id` (dim); operation `"Removing database"` count 1; detail `"Database and its connection metadata were removed."`.

**JSON** `serializeDatabaseRemove` = `stripVerboseContext`.

**Errors**: shared; `CONFIRMATION_REQUIRED` exit 2; `DATABASE_NOT_FOUND`/`DATABASE_AMBIGUOUS`; passthrough `"Failed to remove database"`.

## 7. `database backup list <database>`

**Registration** (index.ts:295-333, under group `backup` 282-293): positional `<database>` "Database id or name"; `--limit <n>` "Maximum number of backups to return"; `--project`, `--branch`; globals.

**Descriptor** (448-456): `"List backups for a database"`; examples `"prisma-cli database backup list db_123"`, `"prisma-cli database backup list acme-production --limit 50"`.

**Controller** `runDatabaseBackupList` (database.ts:428-469): `parseBackupLimit` FIRST (before auth), then shared context (`"database backup list"`) → `resolveDatabase` → `provider.listBackups(database.id, {limit, signal})`. Real (provider.ts:444-470): `GET /v1/databases/{databaseId}/backups` with `query.limit` only when defined; 422 non-plan-limit → `backupsUnsupportedError(databaseId, result.error)` (provider.ts:735-750):

```
code: DATABASE_BACKUPS_UNSUPPORTED, domain: database, exit 1
summary: "Backups are not available for this database"
why: apiMessage ?? `The platform does not manage backups for database "${databaseId}", for example because it is a remote/BYO database.`
fix: "Use your own backup tooling for externally managed databases."
nextSteps: []
```

else passthrough `"Failed to list database backups"`.

**Result** `{command: "database.backup.list", result: {projectId, projectName, verboseContext, database, backups, retentionDays, hasMore}}`.

**Human** `renderDatabaseBackupList` (381-441): title `"Listing platform-created database backups."`; rail rows `database:` and (when retentionDays !== null) `` `retention: ${retentionDays} days` ``; empty `"No backups found."`; table columns `Id Type Status Size Created` (sizes via `formatBackupSize`: `"unknown"` for null, then `B`/`KiB`/`MiB`/`GiB` with one decimal, 1024 boundaries); when `hasMore`: `"More backups exist; raise --limit to see them."` No client-side sorting — API order preserved.

**JSON** `serializeDatabaseBackupList` (443-463): `serializeList({context: {project, database}, items: [{noun: "backup", label: id, id, status: null}]})` spread + `projectId`, `database`, `backups`, `retentionDays`, `hasMore`.

## 8. `database connection list <database>`

**Registration** (index.ts:432-464): positional `<database>` "Database id or name"; `--project`, `--branch`; globals.

**Descriptor** (467-475): `"List database connection metadata without secret values"`; examples `"prisma-cli database connection list db_123"`, `"prisma-cli database connection list acme-preview --branch preview --json"`.

**Controller** `runDatabaseConnectionList` (database.ts:249-282): shared context (`"database connection list"`) → `resolveDatabase` → `provider.listConnections(database.id, {signal})` (real: `GET /v1/databases/{databaseId}/connections`).

**Result** `{command: "database.connection.list", result: {projectId, projectName, verboseContext, database, connections}}` — structurally identical to `database.show`'s result.

**Human** `renderDatabaseConnectionList` (203-247): title `"Listing database connection metadata."`; rail row `database:`; empty `"No database connections found."`; table `Name Id Created` (Created `"unknown"` when null). API order preserved.

**JSON** `serializeDatabaseConnectionList` (249-269): `serializeList({context: {project, database}, items: [{noun: "connection", label: name, id, status: null}]})` spread + `projectId`, `database`, `connections`.

## 9. `database connection create <database>`

**Registration** (index.ts:466-504): positional `<database>` "Database id or name"; `--name <name>` "Connection name"; `--project`, `--branch`; globals. HAS renderStdout.

**Descriptor** (476-485): `"Create a database connection and print its one-time connection URL"`; examples `"prisma-cli database connection create db_123"`, `"prisma-cli database connection create db_123 --name readonly"`.

**Controller** `runDatabaseConnectionCreate` (database.ts:284-320): shared context (`"database connection create"`) → `resolveDatabase` → `provider.createConnection({databaseId: database.id, name: flags.name?.trim() || defaultConnectionName(), signal})`. Real (provider.ts:376-402): `POST /v1/databases/{databaseId}/connections` body `{name}` → `normalizeCreatedConnection` (provider.ts:602-625): missing connection string →

```
code: DATABASE_CONNECTION_STRING_MISSING, domain: database, exit 1
summary: "Created connection did not return a connection string"
why: "Database connection strings are one-time-view secrets, but the Management API did not include one in this create response."
fix: "Create another database connection and store the returned URL immediately."
nextSteps: [`prisma-cli database connection create ${fallbackDatabaseId}`]
```

**Result** `{command: "database.connection.create", result: {projectId, projectName, verboseContext, database, connection, connectionString}}`.

**Output**: `renderDatabaseConnectionCreateStdout` (271-277) = `[result.connectionString]` — bare URL on stdout. Human (279-301):

```
Creating connection...
<success glyph> Added a connection to "<db name>" in <project[ / branch]>.
  The connection URL below is shown once, so save it now.
```

Verbose rows (630-652): optional workspace, project, branch, database `name  (id)`, connection `name  (id)`.

**JSON** `serializeDatabaseConnectionCreate` = `stripVerboseContext` (includes `connectionString`).

**Errors**: shared; `DATABASE_NOT_FOUND`/`AMBIGUOUS`; `DATABASE_CONNECTION_STRING_MISSING`; passthrough `"Failed to create database connection"`; `PLAN_LIMIT_REACHED`.

## 10. `database connection rotate <connection>`

**Registration** (index.ts:394-430): positional `<connection>` "Connection id"; `--confirm <connection-id>` "Exact connection id required to rotate"; globals only — **no `--project`/`--branch`** (provider-only auth path; the positional must be the connection **id**, no name resolution). HAS renderStdout.

**Descriptor** (486-494): `"Rotate connection credentials and print the new one-time connection URL"`; example `"prisma-cli database connection rotate conn_123 --confirm conn_123"`.

**Controller** `runDatabaseConnectionRotate` (database.ts:551-611):

1. Blank id → `usageError("Connection id required", "Database connection rotation needs a connection id.", "Pass the connection id to rotate.", [formatCommand(["database","connection","rotate","<connection-id>","--confirm","<connection-id>"])], "database")` exit 2.
2. Confirmation BEFORE any API call, with overrides — verbatim consent copy:
   - summary: `"Confirm database connection rotation"`
   - why: `"Rotating revokes the previous credentials and breaks clients still using them, so it requires the exact connection id."`
   - fix: `` `Rerun with --confirm ${connectionId}.` ``
   - nextStep: `formatCommand(["database","connection","rotate",connectionId,"--confirm",connectionId])`
   - exit 2, meta `{expectedConfirm, receivedConfirm}`.
3. `requireDatabaseProviderOnly(context)` (no workspace requirement, no project resolution) → `provider.rotateConnection(connectionId, {signal})`.

**Real provider** (provider.ts:522-541): `POST /v1/connections/{id}/rotate` → `normalizeRotatedConnection` (provider.ts:704-733): missing connection string →

```
code: DATABASE_CONNECTION_STRING_MISSING, domain: database, exit 1
summary: "Rotated connection did not return a connection string"
why: "Rotated connection strings are one-time-view secrets, but the Management API did not include one in this rotate response."
fix: "Re-run the rotation, or create a replacement connection and store the returned URL immediately."
nextSteps: []
```

`database` in the record is `{id, name}` only when the response embeds both, else `null`.

**Result** `{command: "database.connection.rotate", result: {connection, database: {id,name}|null, connectionString}}` — no projectId/projectName/verboseContext.

**Output**: `renderDatabaseConnectionRotateStdout` (502-508) = `[result.connectionString]`. Human (510-535):

```
Rotating connection...
<success glyph> Rotated credentials for <"db name" | connection conn_id>. The previous credentials no longer work.
  The connection URL below is shown once, so save it now.
```

Verbose rows (543-571): optional database `name  (id)`, connection `name  (id)`.

**JSON** `serializeDatabaseConnectionRotate` (537-541) = `result` unchanged (no strip needed).

**Errors**: `USAGE_ERROR` exit 2; `CONFIRMATION_REQUIRED` exit 2; `DATABASE_CONNECTION_NOT_FOUND` (fixture path only, database.ts:1084-1094: summary `"Database connection not found"`, why `` `No database connection matched "${connectionId}".` ``, fix `"Pass a connection id from prisma-cli database connection list <database>."`, exit 1, nextSteps `["prisma-cli database connection list <database>"]`); real mode maps an API 404 through the generic passthrough (`"Failed to rotate database connection"` + API code/message); `DATABASE_CONNECTION_STRING_MISSING`.

## 11. `database connection remove <connection>`

**Registration** (index.ts:506-540): positional `<connection>` "Connection id"; `--confirm <connection-id>` "Exact connection id required to remove"; globals only — no `--project`/`--branch`. No renderStdout.

**Descriptor** (495-502): `"Remove a database connection after exact id confirmation"`; example `"prisma-cli database connection remove conn_123 --confirm conn_123"`.

**Controller** `runDatabaseConnectionRemove` (database.ts:322-362):

1. Blank id → `usageError("Connection id required", "Database connection removal needs a connection id.", "Pass the connection id to remove.", ["prisma-cli database connection remove <connection-id> --confirm <connection-id>"], "database")` exit 2. (Hard-coded `prisma-cli` example here, unlike rotate which uses the formatter — inconsistency to note.)
2. `requireExactConfirmation({resourceName: "database connection", commandName: "database connection remove", id: connectionId, confirm})` — default copy: summary `"Confirm database connection removal"`, why `"Removing this database connection is destructive and requires the exact id."`, nextSteps `` [`prisma-cli database connection remove ${id} --confirm ${id}`] ``, exit 2.
3. `requireDatabaseProviderOnly(context)` → `provider.removeConnection(connectionId, {signal})` (real: `DELETE /v1/connections/{id}`).

**Result** `{command: "database.connection.remove", result: {connection: {id: connectionId}}}`.

**Human** `renderDatabaseConnectionRemove` (309-329): `renderMutate` titled `"Removing database connection."`; context row `connection` = id (dim); operation `"Removing database connection"` count 1; detail `"The connection metadata was removed. Existing one-time secrets were not shown."` No verbose-context block.

**JSON** `serializeDatabaseConnectionRemove` (331-335) = `{connection: result.connection}`.

**Errors**: `USAGE_ERROR`, `CONFIRMATION_REQUIRED` (exit 2), fixture `DATABASE_CONNECTION_NOT_FOUND`, real passthrough `"Failed to remove database connection"`.

---

## Provider interface signatures (provider.ts:81-130, verbatim)

```ts
export interface DatabaseProvider {
  listDatabases(options: { projectId: string; branchName?: string; signal?: AbortSignal }): Promise<DatabaseSummary[]>;
  showDatabase(databaseId: string, options?: { projectId?: string; signal?: AbortSignal }): Promise<DatabaseSummary | null>;
  createDatabase(options: DatabaseCreateInput): Promise<DatabaseCreateRecord>;
  removeDatabase(databaseId: string, options?: { signal?: AbortSignal }): Promise<void>;
  listConnections(databaseId: string, options?: { signal?: AbortSignal }): Promise<DatabaseConnectionSummary[]>;
  createConnection(options: DatabaseConnectionCreateInput): Promise<DatabaseConnectionCreateRecord>;
  removeConnection(connectionId: string, options?: { signal?: AbortSignal }): Promise<void>;
  getUsage(databaseId: string, options?: { from?: string; to?: string; signal?: AbortSignal }): Promise<DatabaseUsageRecord>;
  listBackups(databaseId: string, options?: { limit?: number; signal?: AbortSignal }): Promise<DatabaseBackupListRecord>;
  restoreDatabase(options: DatabaseRestoreInput): Promise<DatabaseSummary>;
  rotateConnection(connectionId: string, options?: { signal?: AbortSignal }): Promise<DatabaseConnectionRotateRecord>;
}
```

`DatabaseCreateInput = {projectId, name, branchName?, region?, signal?}`; `DatabaseConnectionCreateInput = {databaseId, name, signal?}`; `DatabaseRestoreInput = {targetDatabaseId, sourceDatabaseId, backupId, projectId, signal?}`. The SDK client (`ManagementApiClient` from `@prisma/management-api-sdk`) is captured in the provider closure by `createManagementDatabaseProvider(client, options?)` — no per-call client argument; controllers never touch the client directly except to construct the provider.

## Inventory cross-check (§6, code vs doc)

- Inventory §6: the current shell has **no `postgres` command or alias** — only `database`, described `"Manage Prisma Postgres databases"`. The rename to `postgres` is a pure rename with no alias to preserve.
- Inventory §3.3: `CONFIRMATION_REQUIRED` is exit **2** for database exact-id confirms (matches code) but exit 1 elsewhere (app remove/domain remove) — the port should normalize consent grades.
- Inventory §1 marks all 11 commands: sync, auth `platform+login`, engine kind `result`; create / connection create / connection rotate flagged "secret on stdout"; restore / remove / connection rotate / connection remove flagged "needs --confirm".

## Discrepancies found (code vs inventory/doc)

1. Inventory §4 `database list` says auth is "`requireAuthenticatedAuthState` + `requireComputeAuth`" — code actually uses `requireAuthenticatedAuthState` + `authenticatedManagementApiClient` (controllers/database.ts:710, 717); no symbol named `requireComputeAuth` on this path.
2. Inventory §4 `connection rotate` lists `DATABASE_CONNECTION_NOT_FOUND` as its error; in real mode a 404 from `POST /v1/connections/{id}/rotate` maps through the generic passthrough (API code or `DATABASE_API_ERROR`), so `DATABASE_CONNECTION_NOT_FOUND` is only guaranteed in fixture mode. Same for `connection remove`.
3. `requireDatabaseProviderOnly` (rotate/remove connection) does NOT require a workspace (`workspaceRequiredError` is only in `requireDatabaseContext`), and its `workspaceId` may be undefined — plan-limit errors on those two commands then render `"Workspace: unavailable"` with no subscription lookup.
4. Confirmation-error nextSteps are inconsistent: default (`database remove`, `connection remove`) hard-codes a `prisma-cli` prefix; `restore`/`rotate` pass formatter-built commands (`pnpm dlx …` etc.). The `connection remove` blank-id usage example is also hard-coded while `rotate`'s is formatter-built.
5. `databaseNotFoundError` in the fixture provider is thrown without project/branch context (bare `No database matched "…".`), while the resolveDatabase path includes `in project "…" on branch "…"`.
6. `database.show` and `database.connection.list` return structurally identical results but different serializers: show → `stripVerboseContext` (raw shape), connection list → `serializeList` envelope + extras.
7. PLAN_LIMIT_REACHED sets `nextActions: []` despite the inventory's `nextActions` recovery-journey machinery; recovery guidance lives only in `humanLines` and `meta` (PR #127 behavior as shipped).
