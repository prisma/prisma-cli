# Verbatim facts: bucket / bucket key / branch list / git connect|disconnect

All paths relative to `packages/cli/src` unless they start with `.drive/`
or `packages/`, which are relative to the repository root. Extracted from code on branch `claude/prisma-cli-v8-onboarding-30e694` (worktree labeled s2b-resources-work). Grounded against `.drive/projects/prisma-cli-v8/assets/s2/command-inventory.md` (§1 rows 44–46, 59–64; per-command sections at lines 441–463 and 524–547).

---

## Shared sections

### S1. Global flags

`shell/global-flags.ts:23-61`.

- `addGlobalFlags(command)` (leaf commands): `--json` "Emit structured JSON output.", `-q, --quiet` "Reduce human-oriented output.", `-v, --verbose` "Increase human-oriented output detail.", `--trace` "Show deeper diagnostics for failures.", `-y, --yes` "Accept supported confirmation prompts.", `--interactive` "Force interactive behavior when prompts are supported.", `--no-interactive` "Disable interactive behavior and prompts.", `--color` "Force color output in supported terminals.", `--no-color` "Disable color output."
- `addCompactGlobalFlags(command)` (group nodes `bucket`, `bucket key`, `branch`, `git`): `--json`, `-q, --quiet`, `-v, --verbose`, `--trace`, `--no-interactive`, `-y, --yes` only.
- `resolveGlobalFlags` (`global-flags.ts:81-100`) also scans raw argv because Commander v12 can swallow a flag defined at both parent and child level.

### S2. Command runner contract

`shell/command-runner.ts:68-165`.

- `runCommand<T>(runtime, commandName, options, handler, presenter)` where presenter has `renderStdout?`, `renderHuman`, `renderJson?`.
- JSON mode (`--json`): `writeJsonSuccess(output, { ...success, result: presenter.renderJson ? presenter.renderJson(success.result) : success.result })` — **when `renderJson` is absent, the raw controller result object is emitted as `result`** (command-runner.ts:105-116). This is the git connect/disconnect case.
- Quiet mode: only `renderStdout` lines are written. Human mode: `renderHuman` lines + warnings + optional verbose diagnostics on stderr, then `renderStdout` lines on stdout (with a blank separator line if both exist).
- Errors: `CliError` → JSON envelope or human error, `process.exitCode = cliError.exitCode`. SDK `AuthError` → `authRequiredError(["prisma-cli auth login"], { debug })`. Abort → `commandCanceledError()` (code `COMMAND_CANCELED`, exit 130).

### S3. Auth requirement

- `requireAuthenticatedAuthState(context)` (`controllers/auth.ts:206`): in real mode, reads auth state; if unauthenticated and `canPrompt(context)` is true it launches the full interactive OAuth login; otherwise throws `authRequiredError()`.
- `authRequiredError` (`shell/errors.ts:101-115`):
  ```
  code: "AUTH_REQUIRED", domain: "auth", summary: "Authentication required",
  why: "This command needs an authenticated session.",
  fix: "Run prisma-cli auth login, or rerun the command in a TTY to sign in interactively.",
  exitCode: 1, nextSteps default ["prisma-cli auth login"]
  ```
- `workspaceRequiredError` (`shell/errors.ts:141-149`) = `usageError(...)`:
  ```
  code: "USAGE_ERROR", domain: "auth", exitCode: 2,
  summary: "Workspace required",
  why: "This command needs an active workspace, but the authenticated session does not have one.",
  fix: "Run prisma-cli auth login and choose a workspace.",
  nextSteps: ["prisma-cli auth login"]
  ```
- `canPrompt(context)` (`shell/runtime.ts:93-108`): false if `flags.json`; false if `flags.interactive === false`; false if `env.CI` set and `flags.interactive !== true`; else `Boolean(stdin.isTTY && stderr.isTTY)`.

### S4. Real mode vs fixture mode

`isRealMode(context)` is duplicated per controller (`controllers/bucket.ts:57-62`, `controllers/branch.ts:25-30`, project.ts): real mode = `!context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH`.

### S5. Bucket provider construction

- Real mode: `authenticatedManagementApiClient(context.runtime.env, context.runtime.signal)` (from `../auth`); `null` client → `throw authRequiredError()`. Then `createManagementBucketProvider(client)` (`lib/bucket/provider.ts:83-268`), which takes a `ManagementApiClient` from `@prisma/management-api-sdk`.
- Fixture mode: `createFixtureBucketProvider(context)` (`controllers/bucket.ts:349-410`) backed by `context.api` (mock API) — throws `BUCKET_NOT_FOUND` / `BUCKET_KEY_NOT_FOUND` / `BRANCH_NOT_FOUND` when mock lookups fail.
- `BucketProvider` interface (`lib/bucket/provider.ts:29-50`):
  ```ts
  listBuckets(options: { projectId: string; branchName?: string; signal?: AbortSignal }): Promise<BucketSummary[]>;
  createBucket(options: BucketCreateInput): Promise<BucketSummary>;       // { projectId, name?, branchGitName?, signal? }
  deleteBucket(bucketId: string, options?: { signal? }): Promise<void>;
  listKeys(bucketId: string, options?: { signal? }): Promise<BucketKeySummary[]>;
  createKey(options: BucketKeyCreateInput): Promise<BucketKeyCreateRecord>; // { bucketId, name?, role: "read" | "read_write", signal? }
  deleteKey(bucketId: string, keyId: string, options?: { signal? }): Promise<void>;
  ```
  `BucketKeyCreateRecord = { key: BucketKeySummary; secretAccessKey: string; accessKeyId: string; endpoint: string; bucketName: string }`.
- Management provider endpoints: `GET /v1/buckets` (query `projectId`, `branchGitName`, `cursor`; cursor-paginated to exhaustion, loop breaks when `!pagination.hasMore || !pagination.nextCursor`), `POST /v1/buckets` (body `{ projectId, name?, branchGitName? }`), `DELETE /v1/buckets/{bucketId}`, `GET /v1/buckets/{bucketId}/keys` (cursor-paginated), `POST /v1/buckets/{bucketId}/keys` (body `{ role, name? }`), `DELETE /v1/buckets/{bucketId}/keys/{keyId}`.
- `normalizeBucket` (`provider.ts:270-278`) → `{ id, name, status, branchId, createdAt }`; `normalizeKey` (`provider.ts:280-288`) → `{ id, name, role, valueHint, createdAt }`.
- `bucketApiError(summary, response, error)` (`provider.ts:290-309`): API error passthrough —
  ```
  code: error?.error?.code ?? "BUCKET_API_ERROR", domain: "bucket", summary: <caller string>,
  why: error?.error?.message ?? `The Management API returned status ${status || "unknown"}.`,
  fix: error?.error?.hint ?? "Re-run with --trace for the underlying API response details.",
  exitCode: 1, nextSteps: []
  ```
  Caller summaries: `"Failed to list buckets"`, `"Failed to create bucket"`, `"Failed to delete bucket"`, `"Failed to list bucket keys"`, `"Failed to create bucket key"`, `"Failed to delete bucket key"`.

### S6. --project/--branch resolution for bucket list/create

`requireBucketContext(context, flags, commandName)` (`controllers/bucket.ts:287-340`), commandName is `"bucket list"` / `"bucket create"`:
1. `requireAuthenticatedAuthState(context)`; missing `authState.workspace` → `workspaceRequiredError()`.
2. Real mode: `authenticatedManagementApiClient(...)`; null → `authRequiredError()`.
3. `resolveProjectTarget({ context, workspace, explicitProject: flags.projectRef, listProjects, commandName })` (`lib/project/resolution.ts:155-183`). `listProjects` = `listRealWorkspaceProjects(client, workspace, signal)` (`controllers/project.ts:1438-1466`, does `GET /v1/projects` and filters by `workspace.id`) or `listFixtureWorkspaceProjects(context, workspace)` (`project.ts:1468-1481`).
4. Errors converted via `projectResolutionErrorToCliError` (`resolution.ts:352-375`).

Resolution order inside `resolveProjectTarget` (`resolution.ts:590-676`): explicit `--project` (match by exact `id` or `name`; 1 match ok, >1 → `PROJECT_AMBIGUOUS`, 0 → `PROJECT_NOT_FOUND`) → `envProjectId` (NOT passed by any of these commands, so inert) → local pin `.prisma/local.json` (workspace mismatch → `LOCAL_PROJECT_WORKSPACE_MISMATCH`; pinned project missing → `LOCAL_STATE_STALE`) → durable platform mapping (`resolveDurablePlatformMapping()` currently returns `null`, `resolution.ts:586-588`) → `PROJECT_SETUP_REQUIRED`.

Resolution-family CliErrors (`resolution.ts`), all `domain: "project"`, exit 1:
- `PROJECT_NOT_FOUND`: summary `"Project not found"`, why `` `The project "${projectRef}" does not exist in workspace "${workspace.name}" or is not accessible.` ``, fix `"Pass a project id or name from prisma-cli project list."`, nextSteps `["prisma-cli project list"]`.
- `PROJECT_AMBIGUOUS`: summary `"Project resolution is ambiguous"`, why `` `Multiple projects matched "${projectRef}".` `` (or `"Multiple projects matched the current directory context."`), fix `"Pass --project <id-or-name> to choose the project explicitly."`, meta `{ matches: [{id,name},...] }`, nextSteps `["prisma-cli project list", "prisma-cli app deploy --project <firstMatch.id>"]` (note: the second next step hardcodes `app deploy`, resolution.ts:265).
- `PROJECT_SETUP_REQUIRED`: summary `"Choose a Project before running this command"`, why = `` `This directory is not linked to a Prisma Project, and ${commandLabel} will not choose one from package or directory names.` `` where commandLabel is `` `prisma-cli ${commandName}` `` or `"this command"` when commandName omitted; fix `"Link the directory to an existing Project, or pass --project <id-or-name> for this command."`; meta = spread of `ProjectSetupSuggestion` (`suggestedProjectName`, `suggestedProjectNameSource` (`"package-name"` from package.json name if it matches `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, else `"directory-name"`), `candidates`, `recoveryCommands`); nextSteps `["prisma-cli project list", "prisma-cli project link <id-or-name>", "prisma-cli <commandName> --project <id-or-name>"]` (last only when commandName present); plus `nextActions` from `buildProjectSetupNextActions` (`resolution.ts:431-494`): user-choice "Ask the user whether to link an existing Project or create a new one", run-command "Link the chosen Project", optional run-command "Create and link a new Project" (`prisma-cli project create <suggestedName>`), and run-command "Retry with an explicit Project" when commandName present.
- `LOCAL_STATE_STALE`: summary `"Local project binding is stale"`, why `` `The target recorded in ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} is no longer available in the selected workspace.` ``, fix `` `Delete ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH}, then choose a Project explicitly.` ``, meta `{ pinPath }`, nextSteps `["prisma-cli project list", "prisma-cli project link <id-or-name>"]`.
- `LOCAL_PROJECT_WORKSPACE_MISMATCH`: summary `"Project link uses another workspace"`, why `` `${pin path} links this directory to project ${pinnedProjectId} in workspace ${pinnedWorkspaceId}, but your current CLI session is workspace "${activeWorkspace.name}" (${activeWorkspace.id}).` ``, fix `"Switch to the linked workspace, or relink this directory to a project in the current workspace."`, meta `{ pinPath, pinnedWorkspaceId, pinnedProjectId, activeWorkspaceId, activeWorkspaceName }`, nextSteps `["prisma-cli auth workspace use <pinnedWorkspaceId>", "prisma-cli project list", "prisma-cli project link <id-or-name>"]`.

### S7. requireBucketProviderOnly (bucket delete, all bucket key commands)

`controllers/bucket.ts:342-347`: `await requireAuthenticatedAuthState(context); return resolveBucketProvider(context);` — **no workspace check, no project resolution**. These commands operate purely by bucket id. (`resolveBucketProvider`, bucket.ts:271-285, is the client/provider construction of S5.)

### S8. Result types

`types/bucket.ts`: `BucketSummary { id, name, status, branchId: string | null, createdAt }`; `BucketKeySummary { id, name, role: "read"|"read_write", valueHint, createdAt }`; `BucketListResult { projectId, projectName, branchName: string | null, verboseContext?, buckets }`; `BucketCreateResult { projectId, projectName, verboseContext?, bucket }`; `BucketDeleteResult { bucket: { id } }`; `BucketKeyListResult { bucketId, keys }`; `BucketKeyCreateResult { bucketId, key, secretAccessKey, accessKeyId, endpoint, bucketName }`; `BucketKeyDeleteResult { key: { id } }`.

`types/branch.ts`: `BranchRole = "preview" | "production"`; `BranchSummary { id, name, role: BranchRole, envMap: BranchRole }`; `BranchListResult { projectId, projectName, verboseContext?: { workspace, project, resolution }, branches }`.

`types/project.ts:108-137`: `GitRepositoryConnection { id: string|null, provider: "github", repoId: number|null, repository: { owner, name, fullName, url }, defaultBranch: string|null, isPrivate: boolean|null, status: "pending"|"active"|"archived", installation: { id: string|null, status: "pending"|"connected" }, automation: { branches: boolean, pullRequests: boolean, comments: boolean }, connectedAt: string|null, updatedAt: string|null }`; `ProjectRepositoryConnectionResult extends BoundProjectShowResult { repositoryConnection }` where `BoundProjectShowResult = { workspace: AuthWorkspace, project: ProjectSummary, resolution: ProjectResolution }`.

### S9. nextSteps on success

Every one of the 9 commands returns `warnings: []` and `nextSteps: []` on success (controllers/bucket.ts:88-90, 116-118, 160-162, 191-193, 233-235, 265-267; controllers/branch.ts:45-47, 55-57; controllers/project.ts:1156-1158, 1197-1199, 1246-1248, 1313-1315, 1340-1342). No `nextActions` on any success path.

---

## bucket (group)

- Registration: `createBucketCommand` (`commands/bucket/index.ts:42-56`), descriptor id `"bucket"`, compact global flags, subcommands `list`, `create`, `delete`, `key`.
- Descriptor (`shell/command-meta.ts:228-237`): path `["prisma","bucket"]`, description `"Manage object-store buckets for a project"`, examples `["prisma-cli bucket list", "prisma-cli bucket create", "prisma-cli bucket key create bkt_123"]`.
- `bucket key` group descriptor (`command-meta.ts:264-273`): description `"Manage access keys for an object-store bucket"`, examples `["prisma-cli bucket key list bkt_123", "prisma-cli bucket key create bkt_123", "prisma-cli bucket key delete bkt_123 bkey_456"]`.

## bucket list

1. **Registration** (`commands/bucket/index.ts:64-91`): `prisma bucket list`. No positionals. Flags via `addProjectAndBranchOptions` (index.ts:58-62): `--project <id-or-name>` "Project id or name", `--branch <git-name>` "Branch git name"; plus full globals. No defaults, no choices.
2. **Descriptor** (`command-meta.ts:238-247`): description `"List object-store buckets for the resolved project"`, examples `["prisma-cli bucket list", "prisma-cli bucket list --branch preview", "prisma-cli bucket list --json"]`.
3. **Controller** `runBucketList(context, { projectRef, branchName })` (`controllers/bucket.ts:64-91`): `requireBucketContext(context, flags, "bucket list")` (S6) → `provider.listBuckets({ projectId: target.project.id, branchName: flags.branchName, signal })`. Note `--branch` is passed straight through as API query `branchGitName`; no client-side branch validation for list.
4. **Errors**: AUTH_REQUIRED / USAGE_ERROR(workspace) / resolution family (S6) / `BUCKET_API_ERROR`-or-API-code with summary `"Failed to list buckets"` (S5).
5. **Output**: `renderBucketList` (`presenters/bucket.ts:19-70`): header `<label> → "Listing object-store buckets for the resolved project."`, rail rows `project:` and (if set) `branch:`, then a column table `Name  Id  Status  Branch  Created` (Branch cell = `bucket.branchId ?? "unscoped"`), empty state `"No buckets found."`, then verbose "Resolved context" block (only under `--verbose`; `renderResolvedProjectContextBlock`, `presenters/verbose-context.ts:18-32`, rows: workspace, workspace id, project, project id, project source, target name). `serializeBucketList` (`presenters/bucket.ts:72-88`):
   ```ts
   { context: { project, branch? }, items: [{name,id,status}...], count, projectId, branchName, buckets: BucketSummary[] }
   ```

## bucket create

1. **Registration** (`commands/bucket/index.ts:93-127`): `prisma bucket create`. No positionals. Flags: `--name <name>` "Bucket display name (auto-generated if omitted)", `--project <id-or-name>`, `--branch <git-name>`, full globals.
2. **Descriptor** (`command-meta.ts:248-257`): `"Create an object-store bucket"`, examples `["prisma-cli bucket create", "prisma-cli bucket create --name my-store", "prisma-cli bucket create --branch preview --json"]`.
3. **Controller** `runBucketCreate(context, { projectRef, branchName, name })` (`controllers/bucket.ts:93-120`): `requireBucketContext(..., "bucket create")` → `provider.createBucket({ projectId, name: flags.name?.trim() || undefined, branchGitName: flags.branchName, signal })`. Empty/whitespace `--name` collapses to undefined (server auto-generates).
4. **Errors**: shared (S5/S6); fixture mode throws `BRANCH_NOT_FOUND` when the mock create returns nothing (`bucket.ts:357-366, 416-426`):
   ```
   code: "BRANCH_NOT_FOUND", domain: "bucket", summary: "Branch not found",
   why: `No branch matched "${branchGitName}" in the resolved project.`,
   fix: "Pass a branch git name from prisma-cli branch list.",
   exitCode: 1, nextSteps: ["prisma-cli branch list"]
   ```
   (Real mode relies on API error passthrough with summary `"Failed to create bucket"`.)
5. **Output**: `renderBucketCreate` (`presenters/bucket.ts:90-104`): lines `"Creating bucket..."` then success summary `` `Created bucket "${bucket.name}" in ${projectName}` `` or `` `${projectName} / ${branchId}` `` when branch-scoped (`formatBucketTarget`, bucket.ts:249-254). `serializeBucketCreate` = `stripVerboseContext(result)` → `{ projectId, projectName, bucket }`.

## bucket delete

1. **Registration** (`commands/bucket/index.ts:129-158`): `prisma bucket delete <bucketId>`; positional `<bucketId>` "Bucket id"; flag `--confirm <bucket-id>` "Exact bucket id to confirm deletion"; full globals. Note: `--yes` does NOT bypass — only exact `--confirm <id>` works (controller compares strictly).
2. **Descriptor** (`command-meta.ts:258-263`): `"Delete a bucket and all its access keys"`, examples `["prisma-cli bucket delete bkt_123"]`.
3. **Controller** `runBucketDelete(context, bucketId, { confirm })` (`controllers/bucket.ts:122-164`): trims id; blank →
   ```
   code: "USAGE_ERROR", domain: "bucket", summary: "Bucket id required",
   why: "Bucket deletion needs a bucket id.", fix: "Pass the bucket id to delete.",
   exitCode: 2, nextSteps: ["prisma-cli bucket list"]
   ```
   `flags.confirm !== id` (including missing) →
   ```
   code: "CONFIRMATION_REQUIRED", domain: "bucket", exitCode: 2,
   summary: "Confirm bucket deletion",
   why: "Deleting this bucket permanently removes all objects and access keys.",
   fix: `Rerun with --confirm ${id}.`,
   nextSteps: [`prisma-cli bucket delete ${id} --confirm ${id}`],
   meta: { expectedConfirm: id, receivedConfirm: flags.confirm ?? null }
   ```
   Then `requireBucketProviderOnly(context)` (S7 — no project resolution) → `provider.deleteBucket(id, { signal })`.
4. **Errors**: fixture `BUCKET_NOT_FOUND` (`bucket.ts:428-438`):
   ```
   code: "BUCKET_NOT_FOUND", domain: "bucket", summary: "Bucket not found",
   why: `No bucket matched "${bucketId}".`,
   fix: "Pass a bucket id from prisma-cli bucket list.",
   exitCode: 1, nextSteps: ["prisma-cli bucket list"]
   ```
   Real mode: API passthrough summary `"Failed to delete bucket"`.
5. **Output**: `renderBucketDelete` (`presenters/bucket.ts:110-126`) via `renderMutate` (`output/patterns.ts`): title `"Deleting object-store bucket."`, context row `bucket: <id>` (dim), operation `"Deleting bucket"` count 1, detail `"Bucket and all its access keys were removed."`. `serializeBucketDelete` → `{ bucket: { id } }`.

## bucket key list

1. **Registration** (`commands/bucket/index.ts:175-199`): `prisma bucket key list <bucketId>`; positional `<bucketId>` "Bucket id"; full globals only.
2. **Descriptor** (`command-meta.ts:274-282`): `"List access keys for a bucket"`, examples `["prisma-cli bucket key list bkt_123", "prisma-cli bucket key list bkt_123 --json"]`.
3. **Controller** `runBucketKeyList(context, bucketId)` (`controllers/bucket.ts:166-195`): trim; blank →
   ```
   code: "USAGE_ERROR", domain: "bucket", summary: "Bucket id required",
   why: "Bucket key listing needs a bucket id.", fix: "Pass the bucket id.",
   exitCode: 2, nextSteps: ["prisma-cli bucket list"]
   ```
   `requireBucketProviderOnly` → `provider.listKeys(id, { signal })` (cursor-paginated in real mode).
4. **Errors**: fixture `BUCKET_NOT_FOUND` when bucket missing; real API passthrough `"Failed to list bucket keys"`.
5. **Output**: `renderBucketKeyList` (`presenters/bucket.ts:132-174`): header `"Listing access keys for bucket."`, rail row `bucket: <id>`, table `Name  Id  Role  Hint  Created` (Hint = `valueHint`), empty state `"No keys found."`. `serializeBucketKeyList` (`bucket.ts:176-190`):
   ```ts
   { context: { bucket: bucketId }, items: [{name: key.name, id, status: null}...], count, bucketId, keys: BucketKeySummary[] }
   ```
   (items via `serializeList`, `output/patterns.ts:92-105`, with `noun: "key"` — noun is dropped in serialization.)

## bucket key create

1. **Registration** (`commands/bucket/index.ts:201-243`): `prisma bucket key create <bucketId>`; positional `<bucketId>` "Bucket id". Flags: `--role <role>` "Access role (default: read_write)" with commander `.choices(["read", "read_write"])` (invalid values rejected at parse); `--name <name>` "Key display name (auto-generated if omitted)"; full globals.
2. **Descriptor** (`command-meta.ts:283-293`): `"Create a bucket access key and print its one-time credentials"`, examples `["prisma-cli bucket key create bkt_123", "prisma-cli bucket key create bkt_123 --role read", "prisma-cli bucket key create bkt_123 --name ci-key --role read_write"]`.
3. **Controller** `runBucketKeyCreate(context, bucketId, { role, name })` (`controllers/bucket.ts:197-237`): blank id →
   ```
   code: "USAGE_ERROR", domain: "bucket", summary: "Bucket id required",
   why: "Bucket key creation needs a bucket id.", fix: "Pass the bucket id.",
   exitCode: 2, nextSteps: ["prisma-cli bucket list"]
   ```
   Role semantics: `resolveKeyRole` (`bucket.ts:412-414`):
   ```ts
   function resolveKeyRole(role: string | undefined): "read" | "read_write" {
     return role === "read" ? "read" : "read_write";
   }
   ```
   i.e. anything not exactly `"read"` (including undefined) becomes `read_write` — the controller-level defaulting; commander's `.choices()` already limits CLI input to the two values. Then `requireBucketProviderOnly` → `provider.createKey({ bucketId: id, name: flags.name?.trim() || undefined, role, signal })`.
4. **Errors**: fixture `BUCKET_NOT_FOUND`; real API passthrough `"Failed to create bucket key"`; and when the create response omits any of the four credential fields (`lib/bucket/provider.ts:228-238`):
   ```
   code: "BUCKET_KEY_SECRET_MISSING", domain: "bucket", exitCode: 1,
   summary: "Created bucket key did not return credentials",
   why: "Bucket key credentials are one-time-view secrets, but the Management API did not include them in this create response.",
   fix: "Create another bucket key and store the returned credentials immediately.",
   nextSteps: [`prisma-cli bucket key create ${options.bucketId}`]
   ```
5. **Output**: this is the only bucket command with `renderStdout`. `renderBucketKeyCreateStdout` (`presenters/bucket.ts:192-203`) — EXACT stdout lines:
   ```
   S3_ENDPOINT=${result.endpoint}
   S3_ACCESS_KEY_ID=${result.accessKeyId}
   S3_SECRET_ACCESS_KEY=${result.secretAccessKey}
   S3_BUCKET=${result.bucketName}
   ```
   `renderBucketKeyCreate` (human/stderr, `bucket.ts:205-221`): `"Creating bucket key..."`, success summary `` `Created key "${key.name}" for bucket "${bucketName}".` ``, then literal lines `"  The credentials below are shown once — copy them now."` and `"  Set these environment variables to use this bucket:"`. `serializeBucketKeyCreate(result)` returns `result` unchanged — JSON `result` = `{ bucketId, key, secretAccessKey, accessKeyId, endpoint, bucketName }` (secret included in JSON).

## bucket key delete

1. **Registration** (`commands/bucket/index.ts:245-269`): `prisma bucket key delete <bucketId> <keyId>`; positionals `<bucketId>` "Bucket id", `<keyId>` "Key id"; full globals. **No `--confirm`** (inconsistent with bucket delete; inventory line 547 flags this too).
2. **Descriptor** (`command-meta.ts:294-299`): `"Revoke and delete a bucket access key"`, examples `["prisma-cli bucket key delete bkt_123 bkey_456"]`.
3. **Controller** `runBucketKeyDelete(context, bucketId, keyId)` (`controllers/bucket.ts:239-269`): either trimmed id blank →
   ```
   code: "USAGE_ERROR", domain: "bucket", summary: "Bucket id and key id required",
   why: "Bucket key deletion needs both a bucket id and a key id.",
   fix: "Pass the bucket id and key id.",
   exitCode: 2, nextSteps: ["prisma-cli bucket key list <bucketId>"]
   ```
   `requireBucketProviderOnly` → `provider.deleteKey(bktId, kId, { signal })`.
4. **Errors**: fixture `BUCKET_KEY_NOT_FOUND` (`bucket.ts:440-450`):
   ```
   code: "BUCKET_KEY_NOT_FOUND", domain: "bucket", summary: "Bucket key not found",
   why: `No key matched "${keyId}" for bucket "${bucketId}".`,
   fix: "Pass a key id from prisma-cli bucket key list <bucketId>.",
   exitCode: 1, nextSteps: [`prisma-cli bucket key list ${bucketId}`]
   ```
   Real API passthrough `"Failed to delete bucket key"`.
5. **Output**: `renderBucketKeyDelete` (`presenters/bucket.ts:227-243`) via `renderMutate`: title `"Deleting bucket access key."`, context `key: <id>` (dim), operation `"Deleting bucket key"` count 1, detail `"The access key was revoked and removed."`. `serializeBucketKeyDelete` → `{ key: { id } }`.

---

## branch (group) and branch list

- Group (`commands/branch/index.ts:14-25`): descriptor `"branch"` (`command-meta.ts:197-202`): description `"View your Platform branches"`, examples `["prisma-cli branch list"]`. Compact globals. Only subcommand: `list`.

1. **Registration** (`commands/branch/index.ts:27-50`): `prisma branch list`. **No positionals, no command-specific flags — full globals only. Confirmed: NO `--project` flag**; resolution is local-pin/durable-mapping only (explicitProject is never passed: `runBranchList(context)` takes no flags).
2. **Descriptor** (`command-meta.ts:384-389`): `"List Platform branches for the resolved project"`, examples `["prisma-cli branch list", "prisma-cli branch list --json"]`.
3. **Controller** `runBranchList(context)` (`controllers/branch.ts:38-59`):
   - Real mode → `listRealBranches(context)` (branch.ts:61-105): `requireAuthenticatedAuthState`; `authenticatedManagementApiClient` (null → `authRequiredError(["prisma-cli auth login"])`); missing workspace → `workspaceRequiredError()`; `resolveProjectTarget({ context, workspace, listProjects: listRealWorkspaceProjects(...) })` — note **no `commandName` and no `explicitProject`** are passed, so a PROJECT_SETUP_REQUIRED message reads "…and this command will not choose one…" and the retry-with-`--project` next step is omitted. Then `listBranches(client, target.project.id, signal)`.
   - Fixture mode → `createBranchUseCases(createCliUseCaseGateways(context)).list()` (`use-cases/branch.ts:16-47`): reads remembered project id from the project-state gateway; if none, returns `{ projectId: "", projectName: "not resolved", branches: [] }` (no error). Project name fallback `"not resolved"`.
4. **Pagination** (`branch.ts:124-159`): `while (true)` loop over `client.GET("/v1/projects/{projectId}/branches", { params: { path: { projectId }, query }, signal })` with `query.cursor` set from `data.pagination.nextCursor`; breaks when `!data.pagination.hasMore || !data.pagination.nextCursor`; collects `data.data as RawBranchRecord[]` (`{ id, gitName, role }`). Runs to exhaustion; no page-size/limit parameter, no repeated-cursor detection (unlike scm pagination).
5. **envMap computation** (`branch.ts:161-168` and `use-cases/branch.ts:71-82`): `toBranchSummary` → `{ id, name: branch.gitName, role: branch.role, envMap: branch.role }` — **envMap is literally a copy of role** (type `BranchRole = "preview" | "production"`).
6. **Ordering** (`branch.ts:107-122`, duplicated in use-cases): sort by `branchOrder` (production → 0, everything else → 1) then `left.name.localeCompare(right.name)` — production branches first, then alphabetical by name within each rank.
7. **Errors**: `branchApiError(summary, response, error)` (`branch.ts:178-197`), called with summary `"Failed to list branches"`:
   ```
   code: error?.error?.code ?? "BRANCH_API_ERROR", domain: "branch",
   summary: "Failed to list branches",
   why: error?.error?.message ?? `The Management API returned status ${status || "unknown"}.`,
   fix: error?.error?.hint ?? "Re-run with --trace for the underlying API response details.",
   exitCode: 1, nextSteps: []
   ```
   API-code passthrough mechanism: if the API error body has `error.code`, it REPLACES `BRANCH_API_ERROR` as the CliError code; `error.message` replaces the why; `error.hint` replaces the fix. Plus AUTH_REQUIRED / workspace / resolution family.
8. **Output**: `renderBranchList` (`presenters/branch.ts:8-53`): header `<label> → "Listing branches for the resolved project."`, rail row `project: <projectName>`, table columns `Name  Role  Env map`, empty state `"No branches found."`, verbose resolved-context block. `serializeBranchList` (branch.ts:55-62) → `{ projectId, projectName, branches: BranchSummary[] }` (verboseContext stripped).

---

## git (group)

- `createGitCommand` (`commands/git/index.ts:17-29`), compact globals, subcommands `connect`, `disconnect`.
- Descriptor (`command-meta.ts:300-305`): `"Manage Git repository connections for a project"`, examples `["prisma-cli git connect", "prisma-cli git disconnect"]`.

## git connect

1. **Registration** (`commands/git/index.ts:31-59`): `prisma git connect [git-url]`; optional positional `[git-url]` "GitHub repository URL"; flag `--project <id-or-name>` "Project id or name"; full globals. Presenter passes **only `renderHuman`** — no `renderStdout`, no `renderJson`.
2. **Descriptor** (`command-meta.ts:365-374`): `"Connect the resolved project to a GitHub repository"`, examples `["prisma-cli git connect", "prisma-cli git connect git@github.com:prisma/prisma-cli.git", "prisma-cli git connect --project proj_123"]`.
3. **Controller** `runGitConnect(context, gitUrl, { project })` (`controllers/project.ts:1109-1250`):
   - `requireAuthenticatedAuthState`; no workspace → `workspaceRequiredError()`.
   - Real mode: client (null → `authRequiredError()`); `resolveRequiredProjectInRealMode(context, workspace, options.project, "git connect")` (project.ts:1373-1399 — wraps `resolveProjectTarget` with `commandName: "git connect"`); `resolveRepositoryForConnect(context, gitUrl)`; `readFirstSourceRepository(api, projectId, signal)` (project.ts:2082-2106 — `GET /v1/source-repositories?projectId&limit=1`, first record or null).
   - **Already-connected short-circuit**: if an existing connection's `repository.fullName` matches the requested repo case-insensitively (`repositoryFullNamesMatch`, project.ts:2248-2250) → return success with the existing connection (idempotent; no API mutation). If it's a *different* repo → `repoAlreadyConnectedError`.
   - Otherwise `resolveInstalledRepository(...)` (see #6) then `POST /v1/source-repositories` with body `{ projectId, provider: "github", providerRepositoryId: resolvedRepository.repository.id, installationId: resolvedRepository.installation.id }`; error → `repoConnectionApiError("Failed to connect GitHub repository", ...)`.
   - Fixture mode: same already-connected/different-repo logic against `context.stateStore.readRepositoryConnection(projectId)`; otherwise writes `createPendingRepositoryConnection(repository)` (project.ts:2108-2131: `status: "pending"`, `installation: { id: null, status: "pending" }`, `automation: { branches: false, pullRequests: false, comments: false }`, `connectedAt: new Date().toISOString()`) into the local state store.
4. **git-url fallback / URL parsing**:
   - `resolveRepositoryForConnect` (project.ts:1654-1678): `const remoteUrl = gitUrl ?? (await readGitOriginRemote(context.runtime.cwd, context.runtime.signal));` — only consulted when the positional is absent.
   - `readGitOriginRemote(cwd, signal)` (`adapters/git.ts:15-35`): runs `git config --get remote.origin.url` via execFile with `timeout: 5_000` in cwd; returns trimmed stdout or `null` when empty; **any error (git missing, not a repo, no origin) returns null** except abort errors which rethrow.
   - No URL at all → `usageError` (exit 2, domain `"project"`):
     ```
     summary: "Repository connection requires a GitHub repository URL"
     why: "No git-url was provided and the local repo does not have an origin remote."
     fix: "Pass a GitHub repository URL, or add a GitHub origin remote and rerun prisma-cli git connect."
     nextSteps: ["prisma-cli git connect git@github.com:prisma/prisma-cli.git"]
     ```
   - `parseGitHubRepositoryUrl(value)` (`adapters/git.ts:41-98`): trims; accepts SSH shorthand `` /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/ ``; else `new URL(input)` — hostname must be exactly `github.com`, protocol one of `https:`, `http:`, `ssh:`, pathname must split into exactly 2 segments; trailing `.git` stripped from the name; owner/name must be non-empty and contain no `/`. Returns `{ provider: "github", owner, name, fullName: "owner/name", url: "https://github.com/owner/name" }` or `null`. `null` → `REPO_PROVIDER_UNSUPPORTED`.
5. **Errors** (all `domain: "project"`):
   - `REPO_PROVIDER_UNSUPPORTED` (project.ts:2165-2175): exit **2**, summary `"Repository provider is not supported"`, why `"Repository connection supports GitHub repository URLs only."`, fix `"Pass a GitHub repository URL such as git@github.com:prisma/prisma-cli.git."`, nextSteps `["prisma-cli git connect git@github.com:owner/repo.git"]`.
   - `REPO_ALREADY_CONNECTED` (2233-2246): exit 1, summary `"Project already has a GitHub repository connected"`, why `` `The resolved project is already connected to ${repositoryFullName}.` ``, fix `"Disconnect the existing repository before connecting a different one."`, meta `{ repository: repositoryFullName }`, nextSteps `["prisma-cli git disconnect"]`.
   - `REPO_INSTALLATION_REQUIRED` (2189-2210): exit 1, summary `"GitHub App installation required"`, why `` `The selected workspace does not have a GitHub App installation that can be used to link ${repository.fullName}.` ``, fix depends on `opened`: opened=true → `"Finish installing the GitHub App in the browser, then rerun prisma-cli git connect."`; opened=false → `"Open the GitHub App installation URL, approve access, then rerun prisma-cli git connect."`; meta `{ repository: fullName, installUrl, opened }`; nextSteps `` [installUrl, `prisma-cli git connect ${repository.url}`] ``.
   - `REPO_NOT_ACCESSIBLE` (2212-2231): exit 1, summary `"GitHub repository is not accessible"`, why `` `The GitHub App installations connected to this workspace do not expose ${repository.fullName}.` ``, fix `"Open the GitHub App installation URL, grant access to this repository, then rerun prisma-cli git connect."`, meta `{ repository, installUrl, opened }`, nextSteps `` [installUrl, `prisma-cli git connect ${repository.url}`] ``.
   - `REPO_CONNECTION_FAILED` (`repoConnectionApiError`, 2252-2281): **status 401 or 403 → returns `authRequiredError(["prisma-cli auth login"])` instead** (AUTH_REQUIRED mapping). Otherwise exit 1, summary = caller string (`"Failed to connect GitHub repository"`, `"Failed to inspect GitHub repository connection"`, `"Failed to inspect GitHub App installations"`, `"Failed to inspect GitHub repositories"`, `"Failed to create GitHub App installation link"`, `"Failed to disconnect GitHub repository"`), why = `apiMessage ?? \`The Management API returned status ${status || "unknown"}.\``, fix = `apiHint ?? repoConnectionFixForStatus(status)`, meta `{ status, apiCode? }`, nextSteps `["prisma-cli project show"]`. Status-aware fix text (`repoConnectionFixForStatus`, 2283-2297):
     - 404 → `"Install the GitHub App for this workspace, then rerun prisma-cli git connect."`
     - 409 → `"This project or repository is already linked. Disconnect the old link first, then try again."`
     - 422 → `"Make sure the GitHub App installation has access to this repository."`
     - else → `"Re-run with --trace for the underlying API response details."`
   - Plus AUTH_REQUIRED / workspace USAGE_ERROR / project-resolution family with `commandName: "git connect"`.
6. **Install-intent + poll loop** (`resolveInstalledRepository`, project.ts:1680-1734):
   - `listScmInstallations` (1882-1922): `GET /v1/scm-installations?workspaceId&limit=100` cursor-paginated (do/while, tracks `seenCursors`; a repeated cursor throws `REPO_CONNECTION_FAILED` with message `"Pagination cursor did not advance."`).
   - `findRepositoryInInstallations` (1736-1776): skips installations with `provider !== "github"` or `suspended`; per installation `GET /v1/scm-installations/{installationId}/repositories?limit=100` paginated, matching `fullName.toLowerCase()`; 404/422 REPO_CONNECTION_FAILED from an installation counts as "unavailable" and is skipped (`isUnavailableScmInstallationError`, 2027-2033); counts `inspectableInstallationCount`.
   - If a match exists → use it (no browser, no intent). Otherwise `createGitHubInstallIntent` (2035-2060): `POST /v1/scm-installations/install-intents` body `{ provider: "github", workspaceId }` → `data.data.installUrl`; error summary `"Failed to create GitHub App installation link"`.
   - **Browser opening condition**: `openInstallUrlIfInteractive` (2062-2080) — opens only when `canPrompt(context)` (see S3); uses `open(installUrl)` (npm `open` package); returns `opened` boolean (false on open failure).
   - **Non-interactive (`!canPrompt`)**: no waiting — immediately throws `REPO_NOT_ACCESSIBLE` if `inspectableInstallationCount > 0`, else `REPO_INSTALLATION_REQUIRED`.
   - Interactive: `writeInstallWaitStatus` (1841-1865) writes to **stderr** (skipped under `--quiet`) an info summary line:
     - opened=true: `"Waiting for GitHub App installation or repository access approval..."`
     - opened=false: `"Waiting for GitHub App installation or repository access approval. Open the install URL in your browser."` followed by the raw `installUrl` on its own line.
   - `waitForInstalledRepository` (1778-1827): env `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` (default `GITHUB_INSTALL_POLL_TIMEOUT_MS = 120_000`, project.ts:97) and `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS` (default `GITHUB_INSTALL_POLL_INTERVAL_MS = 2_000`, project.ts:96); values parsed by `readPositiveIntegerEnv` (must be positive integer, else fallback). Loop while `Date.now() <= deadline`: re-list installations, re-scan; on match return; else sleep `Math.min(intervalMs, remainingMs)` (abort-aware `sleep`, 1867-1880). No status re-print during polling — the wait line is printed once before the loop.
   - **Terminal states**: match found → proceed to POST; timeout with `inspectableInstallationCount > 0` → `REPO_NOT_ACCESSIBLE`; timeout with 0 → `REPO_INSTALLATION_REQUIRED` (both carry `meta.installUrl` + `meta.opened`).
7. **Success result / JSON**: `toRepositoryConnection(record)` (project.ts:2133-2163) maps `SourceRepositoryResponse` → `GitRepositoryConnection`, deriving `repository.url = https://github.com/${repoFullName}`, `installation.status: "connected"`, `automation.branches = (record.status === "active")`, `pullRequests: false`, `comments: false`. **Confirmed: no `renderJson` serializer** — `--json` emits the raw `ProjectRepositoryConnectionResult`:
   ```ts
   { workspace: AuthWorkspace, project: ProjectSummary, resolution: ProjectResolution,
     repositoryConnection: GitRepositoryConnection }
   ```
8. **Human output**: `renderGitConnect` (`presenters/project.ts:294-316`) via `renderMutate`: title `"Connecting Git to the resolved project."`, context rows `project`, `workspace`, `repository` (fullName), `status`; operation `"Applying repository connection"` count 1; detail from `formatGitConnectionDetail(status)` (project.ts:387-399):
   - active → `"GitHub branch automation is active for this project."`
   - pending → `"GitHub branch automation is pending GitHub App installation."`
   - archived → `"GitHub branch automation has been archived for this project."`
   - default → `"GitHub repository is connected, but branch automation is not active."`

## git disconnect

1. **Registration** (`commands/git/index.ts:61-88`): `prisma git disconnect`; no positionals; flag `--project <id-or-name>` "Project id or name"; full globals. Presenter: `renderHuman` only — **no renderJson** (raw result in `--json`, same shape as git connect).
2. **Descriptor** (`command-meta.ts:375-383`): `"Disconnect the GitHub repository from the resolved project"`, examples `["prisma-cli git disconnect", "prisma-cli git disconnect --project proj_123"]`.
3. **Controller** `runGitDisconnect(context, { project })` (`controllers/project.ts:1252-1344`): auth + workspace; project resolved with `commandName: "git disconnect"`. Real mode: `readFirstSourceRepository`; none → `repoNotConnectedError()`; else `DELETE /v1/source-repositories/{id}` (id = existing.id); error → `repoConnectionApiError("Failed to disconnect GitHub repository", ...)` (same 401/403 → AUTH_REQUIRED and status-aware fixes as above). Result carries the connection that was removed (`toRepositoryConnection(existing)`). Fixture mode: `readRepositoryConnection` from state store; none → `repoNotConnectedError()`; else `clearRepositoryConnection` and return the previous connection. No confirmation of any kind.
4. **Error** `REPO_NOT_CONNECTED` (project.ts:2177-2187): exit 1, summary `"No GitHub repository connected"`, why `"The resolved project does not have an active GitHub repository connection."`, fix `"Run prisma-cli git connect before disconnecting."`, nextSteps `["prisma-cli git connect"]`.
5. **Human output**: `renderGitDisconnect` (`presenters/project.ts:318-343`) via `renderMutate`: title `"Disconnecting Git from the resolved project."`, context rows `project`, `workspace`, `repository` (fullName); operation `"Applying repository disconnection"` count 1; detail `"GitHub branch automation is no longer active for this project."`.

---

## Discrepancies and notes vs the inventory

1. Inventory line 544 lists bucket key create stdout as "(accessKeyId/secretAccessKey/endpoint/bucketName)"; the actual stdout variable names are `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` in that order (presenters/bucket.ts:197-202). Order and env-var names above are the implementer-binding facts.
2. `branch list` real mode calls `resolveProjectTarget` WITHOUT `commandName` (controllers/branch.ts:78-83), unlike bucket ("bucket list"/"bucket create") and git ("git connect"/"git disconnect"). Consequence: its PROJECT_SETUP_REQUIRED why-text says "this command" and lacks the retry-with---project next step/action. Inventory says "resolution is pin/durable only" — confirmed (no --project flag, no explicitProject).
3. `PROJECT_AMBIGUOUS` nextSteps hardcode `prisma-cli app deploy --project <id>` regardless of which command failed (resolution.ts:265) — a pre-existing quirk to decide on in the port.
4. `bucket delete` and all `bucket key` commands skip workspace/project resolution entirely (`requireBucketProviderOnly` — auth only). Bucket ids are global to the authenticated client. `bucket delete`'s CONFIRMATION_REQUIRED is exit 2 (matches inventory §3 note that project/database/bucket confirms are exit 2).
5. `--yes` never satisfies bucket delete's confirmation — only exact `--confirm <id>`.
6. git connect/disconnect JSON: no serializer confirmed; the full `verboseContext`-free but resolution-bearing result (workspace/project/resolution/repositoryConnection) is emitted raw, unlike bucket/branch which strip or reshape.
7. Branch pagination has no repeated-cursor stall protection; scm-installation pagination does (throws "Pagination cursor did not advance."). Bucket pagination also lacks stall protection.
8. Fixture-mode `branch list` bypasses auth/resolution entirely via use-cases and returns `projectName: "not resolved"` with empty branches instead of erroring when no project is remembered.
