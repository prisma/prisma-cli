# D1 verbatim facts — `project` + `project env` commands (legacy commander CLI)

Extracted from code on branch `claude/prisma-cli-v8-onboarding-30e694` worktree
`/Users/will/Projects/prisma/prisma-cli/.claude/worktrees/prisma-cli-v8-onboarding-30e694`.
All paths below are relative to `packages/cli/src/` unless absolute. Line numbers are from that worktree.
Cross-checked against `.drive/projects/prisma-cli-v8/assets/s2/command-inventory.md`; discrepancies flagged inline and at the end.

---

## 0. Group registrations

### `project` group — `commands/project/index.ts:43-61`
- `createProjectCommand(runtime)`: `new Command("project")` → `configureRuntimeCommand` → `attachCommandDescriptor(cmd, "project")`.
- Gets **compact** global flags: `addCompactGlobalFlags(project)` (line 49).
- Subcommands added in order: list, show, create, link, rename, remove, transfer, then `createEnvCommand(runtime)` (line 58).
- Registered on the root program in `cli.ts:112` (`program.addCommand(createProjectCommand(runtime))`). Root program name is `"prisma"` (`cli.ts:105`).
- Group descriptor (`shell/command-meta.ts:178-187`):
  ```
  id: "project"
  path: ["prisma", "project"]
  description: "Manage and inspect your Prisma projects"
  examples: ["prisma-cli project list", "prisma-cli project link proj_123", "prisma-cli project create my-app"]
  ```
- Bare `prisma project` prints help via `resolveBareHelpCommand` (`cli.ts:174-200`: a single-token argv naming a command that has subcommands prints `helpInformation()` to stderr, exit 0).

### `project env` group — `commands/env.ts:30-43`
- `createEnvCommand(runtime)`: `new Command("env")`, descriptor id `"project.env"`.
- `env.description("Manage environment variables for the active project")` (line 36).
- **No global flags added to the env group node itself** (neither compact nor full) — unlike the `project` group node. Subcommands added in order: add, update, list, remove.
- Group descriptor (`shell/command-meta.ts:649-660`):
  ```
  id: "project.env"
  path: ["prisma", "project", "env"]
  description: "Manage environment variables for the active project"
  examples: [
    "prisma-cli project env list",
    "prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production",
    "prisma-cli project env add --file .env --role preview",
    "prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo",
    "prisma-cli project env remove STRIPE_KEY --role preview",
  ]
  ```

All 11 leaf commands get the **full** global flag set via `addGlobalFlags(command)` and dispatch through `runCommand(runtime, "<dotted-id>", options, handler, {renderHuman, renderJson})` (`shell/command-runner.ts:68-100`). None of these commands defines `renderStdout` — human rendering goes to stderr; `--json` writes the envelope `{ok:true, nextActions:[], ...success}` pretty-printed (2-space) to stdout (`shell/output.ts:22-29`).

---

## 1. `project list`

**Registration** (`commands/project/index.ts:242-265`): `new Command("list")`, descriptor `"project.list"`. No positionals, no command-specific flags. Full global flags.

**Descriptor** (`command-meta.ts:306-311`):
```
description: "List all projects in your workspace"
examples: ["prisma-cli project list", "prisma-cli project list --json"]
```

**Controller** `runProjectList(context)` — `controllers/project.ts:143-210`:
1. `requireAuthenticatedAuthState(context)` (`controllers/auth.ts:205`) — real mode: `readAuthState(env, signal)`; if not authenticated and `canPrompt(context)` is false → throw `authRequiredError()`; else `performLogin(...)` (interactive browser login) then re-read.
2. `if (!workspace) throw workspaceRequiredError()`.
3. Real mode (`isRealMode` = no `context.runtime.fixturePath` and no `env.PRISMA_CLI_MOCK_FIXTURE_PATH`, project.ts:99-104):
   - `client = await authenticatedManagementApiClient(context.runtime.env, context.runtime.signal)` (`auth/guard.ts:19-60`); `if (!client) throw authRequiredError()`.
   - `projects = sortProjects(await listRealWorkspaceProjects(client, workspace, signal))`.
   - `localBinding = await readProjectListLocalBinding(cwd, workspace, projects, signal)` (project.ts:106-125): reads `.prisma/local.json`; `"linked"` iff pin.workspaceId === workspace.id AND pin.projectId is in the project list; `"invalid"` otherwise if pin present or unparseable; `"not-linked"` if missing.
   - `nextActions = buildProjectListNextActions(localBinding)`.
4. Fixture mode: `createProjectUseCases(createCliUseCaseGateways(context)).list(authState)` then same localBinding/nextActions.

**Success envelope**: `command: "project.list"`, `result: { workspace, projects: ProjectSummary[], localBinding }`, `warnings: []`, `nextSteps: []`, `nextActions` as below.

**nextActions on success** (project.ts:212-224): empty when `localBinding.status === "linked"`; otherwise `buildProjectSetupNextActions({ createCommand: "prisma-cli project create <name>", reason })` with reason:
- invalid: `"This directory has an invalid local Project binding. Ask the user which Prisma Project to link before running Project-scoped commands."`
- not-linked: `"This directory is not linked to a Prisma Project. Project list shows available Projects, but none is selected for this directory."`

**Errors**: `AUTH_REQUIRED`, `WORKSPACE_REQUIRED` (see §14.3). No command-specific errors.

**Human output** `renderProjectList` (`presenters/project.ts:27-90`):
- Title line: `{strong(descriptor label)} → {dim("Listing projects for the authenticated workspace.")}` then blank line.
- `│  workspace:  {workspace.name}` (rail `│` dimmed, key accented).
- Empty: `│  No projects found.` (dim).
- Table: header row `│  name  id  region` (accent, columns padded to max width via `stringWidth`); one row per project: `│  {name}  {id}  {defaultRegion || dim("none")}`.
- When localBinding is `not-linked`/`invalid`, appends `renderNextSteps([...])` → `"" / "Next steps:" / "- Link an existing Project you choose: prisma-cli project link <id-or-name>" / "- Create a new Project: prisma-cli project create <name>"` (`shell/ui.ts:161-171` renders `"Next step:"` singular for one item).

**JSON serializer** `serializeProjectList` (`presenters/project.ts:92-107`):
```js
{
  context: { workspace: result.workspace.name },
  items: result.projects.map(p => ({ name: p.name, id: p.id, status: null })),  // via serializeList: label→name
  count: items.length,
  localBinding: result.localBinding ?? null   // { status: "linked"|"not-linked"|"invalid" } or null
}
```
(`serializeList` is `output/patterns.ts:93-106`.)

**Side effects**: none (read-only pin read).

---

## 2. `project show`

**Registration** (`commands/project/index.ts:267-293`): `new Command("show")`, descriptor `"project.show"`. Flag: `.option("--project <id-or-name>", "Project id or name")`. No positional.

**Descriptor** (`command-meta.ts:312-320`):
```
description: "Show this directory's Project binding"
examples: ["prisma-cli project show", "prisma-cli project show --project proj_123 --json"]
```

**Controller** `runProjectShow(context, explicitProject)` — project.ts:226-259:
1. `requireAuthenticatedAuthState`; `workspaceRequiredError()` if no workspace.
2. Real mode → `resolveProjectShowInRealMode` (project.ts:1346-1371): `authenticatedManagementApiClient` (null → `authRequiredError()`), then `inspectProjectBinding({context, workspace, explicitProject, listProjects: () => listRealWorkspaceProjects(client, workspace, signal), commandName: "project show"})`; errors mapped via `projectResolutionErrorToCliError`.
3. `inspectProjectBinding` (`lib/project/resolution.ts:185-221`) differs from `resolveProjectTarget` in that `allowEnvProjectId: false` and an unbound directory is a **success** with `project: null` plus `buildProjectSetupSuggestion` fields, not an error.
4. Success: `command: "project.show"`, `result: ProjectShowResult`, `warnings: []`, `nextSteps: []`; `nextActions` when `result.project === null`: `buildProjectSetupNextActions({ commandName: "project show", suggestedProjectName: result.suggestedProjectName, reason: "This directory is not linked to a Prisma Project. Package and directory names can suggest setup defaults, but they do not select a Project." })`.

**Result shape** (`types/project.ts:49-68`): bound → `{ workspace, project: ProjectSummary, resolution: { projectSource, targetName?, targetNameSource? } }`; unbound → `{ workspace, project: null, localBinding: { status: "not-linked" }, resolution: { projectSource: "unbound" }, suggestedProjectName, suggestedProjectNameSource: "package-name"|"directory-name", candidates: ProjectSummary[], recoveryCommands: string[] }`.

**Errors**: resolution family (§14.1): `PROJECT_NOT_FOUND` (bad `--project`), `PROJECT_AMBIGUOUS`, `LOCAL_STATE_STALE`, `LOCAL_PROJECT_WORKSPACE_MISMATCH`. **Note: unbound is not an error for show.** *Inventory discrepancy*: inventory §`project show` writes "`PROJECT_AMBIGUOUS` 2" — the code sets `exitCode: 1` (`resolution.ts:268-285`).

**Human output** `renderProjectShow` (`presenters/project.ts:109-154`):
- Unbound: `renderShow` card, title `"This directory is not linked to a Prisma Project."`, fields `workspace: {name}` and `project: Not linked` (tone warning); then always-appended verbose block (`renderVerboseBlock` only prints with `-v`) titled `"Resolved context"` with rows `workspace`, `workspace id` (dim), `project source: unbound`, `suggested name: {name} ({source})`; then next steps:
  ```
  Link an existing Project you choose: prisma-cli project link <id-or-name>
  Create a new Project: prisma-cli project create {formatCommandArgument(suggestedProjectName)}
  ```
- Bound `renderBoundProjectShow` (presenters/project.ts:345-381): title line `{strong(label)} → {dim("This directory is linked to the following platform project.")}`, blank, `│  local repo  {shortenHomePath(cwd)}`, `│  platform  {strong(workspace.name + " / " + project.name)}` (keys padded to width of "local repo"); if `project.url`: `│` then `│  → {link(url)}`; if `defaultRegion`: `│  region  {dim(region)}`; then `renderResolvedProjectContextBlock` (verbose-only "Resolved context": workspace, workspace id, project, project id, project source — formatted `explicit→"--project"`, `env→"environment"`, `local-pin→".prisma/local.json"`, `platform-mapping→"platform mapping"`, plus target name row `"{targetName} ({targetNameSource})"`; `presenters/verbose-context.ts:34-101`).

**JSON serializer** `serializeProjectShow(result)` → returns `result` unchanged (presenters/project.ts:156-158). Keys exactly as in the result shape above.

**Side effects**: none.

---

## 3. `project create <name>`

**Registration** (`commands/project/index.ts:183-210`): `new Command("create")`, descriptor `"project.create"`. Positional `.argument("<name>", "Project name")` (required). Flag `new Option("--region <region>", "Prisma Compute region id")`.

**Descriptor** (`command-meta.ts:321-329`):
```
description: "Create a Project and link this directory"
examples: ["prisma-cli project create my-app", "prisma-cli project create my-app --json"]
```

**Controller** `runProjectCreate(context, projectName, options?: {region?})` — project.ts:261-337:
1. Auth + workspace guard as above.
2. `if (!isValidProjectSetupName(projectName))` (trimmed non-empty, `lib/project/setup.ts:27-29`) → `projectSetupNameRequiredError("project create")` = `usageError("Project create requires a name", "The project name must be a non-empty value.", "Pass a Project name explicitly.", ["prisma-cli project create my-app"], "project")` (setup.ts:160-168; exit 2, code USAGE_ERROR).
3. Fixture mode → `featureUnavailableError("Project create is not available in fixture mode", "Creating Projects requires live platform integration.", "Rerun without fixture mode enabled to create a Project.", ["prisma-cli auth login"], "project")` (code FEATURE_UNAVAILABLE, exit 1).
4. `client = authenticatedManagementApiClient(...)`; null → `authRequiredError()`.
5. `provider = createAppProvider(client)` (`lib/app/app-provider.ts:271`); `created = await provider.createProject({ name: projectName.trim(), region: options?.region, signal })`. Internally `new ComputeClient(client)` then `sdk.createProject({name, region, signal})`; a Result-err becomes `throw new Error(result.error.message)`.
6. `.catch` → `projectCreateFailedError(error, name, workspace, { nextSteps: ["prisma-cli project list", "prisma-cli project link <id-or-name>"], permissionFix: "Grant the token permission to create Projects in this workspace, or link an existing Project.", fallbackFix: "Retry the command, or choose an existing Project with prisma-cli project link <id-or-name>." })`.
7. `bindProjectToDirectory(context, workspace, {id, name, defaultRegion?}, "created")` (§14.6). Err → `projectDirectoryBindingErrorToCliError` (`LOCAL_STATE_WRITE_FAILED`).
8. Success: `command: "project.create"`, `result: ProjectSetupResult`, `warnings: []`, `nextSteps: ["prisma-cli app deploy"]`.

**`PROJECT_CREATE_FAILED`** (`lib/project/setup.ts:170-205`), exit 1, domain project:
- HTTP 401/403 (from `statusCode`/`status` prop or `"(HTTP \d{3})"` in message): summary `Could not create Project "{projectName}"`, why `The platform rejected the Project create in workspace "{workspace.name}" (HTTP {status}).`, fix = permissionFix, debug = stack/message.
- else: same summary, why = `error.message`, fix = fallbackFix.

**Human output** `renderProjectSetup` (presenters/project.ts:160-186), action `"created"`:
```
✔ Created Project "{project.name}"
✔ Linked "{directory}" to Project "{project.name}"
Saved .prisma/local.json
```
(`✔` via `renderSummaryLine(ui, "success", ...)`; directory is `./{basename(cwd)}` or shortened home path when binding an ancestor dir, setup.ts:207-219.)

**JSON serializer** `serializeProjectSetup(result)` → result unchanged: `{ workspace: {id,name,...}, project: {id,name,url?,defaultRegion?}, directory: string, localPin: { path: ".prisma/local.json", written: true }, action: "created" }`.

**Side effects**: writes `.prisma/local.json`, appends `.prisma/` to `.gitignore` (§14.6).

---

## 4. `project link [id-or-name]`

**Registration** (`commands/project/index.ts:212-240`): `new Command("link")`, descriptor `"project.link"`. Positional `.argument("[id-or-name]", "Project id or name")` (optional). No command-specific flags.

**Descriptor** (`command-meta.ts:330-339`):
```
description: "Link this directory to a Project"
examples: ["prisma-cli project link", "prisma-cli project link proj_123", 'prisma-cli project link "Acme Dashboard" --json']
```

**Controller** `runProjectLink(context, projectRef)` — project.ts:339-399:
1. Auth + workspace guard.
2. Real mode: client (null → `authRequiredError()`), `provider = createAppProvider(client)`, `projects = await listRealWorkspaceProjects(client, workspace, signal)`. Fixture: `provider = null`, `projects = listFixtureWorkspaceProjects(context, workspace)`.
3. Branch:
   - `projectRef?.trim()` truthy → `resolveProjectForSetup(projectRef.trim(), projects, workspace)` (`lib/project/setup.ts:42-57`: matches `project.id === ref || project.name === ref`; >1 → throws `projectAmbiguousError`, 0 → `projectNotFoundError`) → `requireProjectDirectoryBinding(context, workspace, toProjectSummary(project), "linked")`.
   - else if `canPrompt(context) && !context.flags.yes` → `resolveInteractiveProjectLinkSetup` (project.ts:401-443) using `promptForProjectSetupChoice` (§ prompt below), then bind with the chosen action.
   - else → `throw await projectLinkTargetRequiredError(context, projects)`.
4. Success: `command: "project.link"`, `result: ProjectSetupResult`, `warnings: []`, `nextSteps: ["prisma-cli app deploy"]`.

**Prompt** `promptForProjectSetupChoice` (`lib/project/interactive-setup.ts:29-105`):
- `selectPrompt` on `runtime.stdin`/`runtime.stderr`, message: `"Which Project should this directory use?"`.
- Choice labels in order: `"+ Create a new Project"` first; then sorted projects (name asc, id asc), label = `project.name`, or `"{name} ({id})"` when the name is duplicated in the list; last: `"Cancel"`.
- Cancel → `usageError("Project setup canceled", cancel.why, cancel.fix, cancel.nextSteps, "project")`; for link the cancel object is: why `"Project link needs a Project before it can continue."`, fix `"Choose an existing Project or create a new one, then rerun project link."`, nextSteps `["prisma-cli project link <id-or-name>", "prisma-cli project create <name>"]` (project.ts:427-434).
- "Create" → `textPrompt` message `"Project name"`, placeholder = `inferTargetName(cwd).name`, validate `validateProjectSetupNameText` (error text `"Enter a Project name."`, setup.ts:31-40). Empty input falls back to the suggested name. Then `createProject(projectName)`:
  - fixture: `featureUnavailableError(...)` (same strings as project create).
  - real: `provider.createProject({name, signal})`, `.catch` → `projectCreateFailedError(error, projectName, workspace, { nextSteps: ["prisma-cli project list", "prisma-cli project link <id-or-name>", "prisma-cli project create {formatCommandArgument(projectName)}"], permissionFix/fallbackFix same as create })` (project.ts:464-491).
- Returns `{project, action: "linked"|"created", targetName, targetNameSource}`.

**Non-interactive fallback error** `PROJECT_LINK_TARGET_REQUIRED` (project.ts:493-528), domain project, exit **2**:
```
summary: "Choose a Project to link this directory"
why: "This directory is not linked to a Prisma Project. Existing Projects are candidates until the user chooses one, and package or directory names are suggestions only."
fix: "Run prisma-cli project link in a TTY to choose from the setup list, pass a Project id or name, or create a new Project."
meta: { suggestedProjectName, suggestedProjectNameSource, candidates: ProjectSummary[], recoveryCommands: ["prisma-cli project link <id-or-name>", "prisma-cli project create {formatCommandArgument(suggestedName)}"] }
nextSteps: ["prisma-cli project list", ...recoveryCommands]
nextActions: buildProjectSetupNextActions({ suggestedProjectName, createCommand, reason: "Project link needs the user to choose an existing Project or create a new one. Existing Projects, package names, and directory names are candidates only, not selections." })
```

**Human/JSON output**: same presenters as create (`renderProjectSetup` / `serializeProjectSetup`); action `"linked"` prints only the Linked + Saved lines (no "Created" line).

**Side effects**: `.prisma/local.json` + `.gitignore` (§14.6).

---

## 5. `project rename <name>`

**Registration** (`commands/project/index.ts:63-91`): `new Command("rename")`, descriptor `"project.rename"`. Positional `.argument("<name>", "New project name")`. Flag `new Option("--project <id-or-name>", "Project id or name")`.

**Descriptor** (`command-meta.ts:340-348`):
```
description: "Rename the resolved Project"
examples: ['prisma-cli project rename "Acme Dashboard v2"', "prisma-cli project rename billing-api --project proj_123"]
```

**Controller** `runProjectRename(context, newName, {project?})` — project.ts:544-584:
1. Auth + workspace guard.
2. `name = newName.trim()`; invalid → `projectSetupNameRequiredError("project rename")` — **note the copy still says "Project create requires a name"** with example `prisma-cli project rename my-app`.
3. `requireProjectCommandContext(context, workspace, options.project, "project rename")` (project.ts:862-891): real mode builds client (`requireProjectClient`, null → `authRequiredError()`), then `resolveProjectTarget({context, workspace, explicitProject, listProjects, commandName})` (§14.1 — this one **does** error `PROJECT_SETUP_REQUIRED` when unbound); provider = `createManagementProjectProvider(client)` (real) or fixture provider.
4. `renamed = await provider.renameProject({ projectId: target.project.id, name, signal })`.
5. Success: `command: "project.rename"`, `result: { workspace, project: renamed, previousName }`, `warnings: []`, `nextSteps: []`.

**Provider** `createManagementProjectProvider(client).renameProject` (`lib/project/provider.ts:42-70`): `client.PATCH("/v1/projects/{id}", { params: {path:{id}}, body: {name}, signal })`. Status 400/422 → `projectRenameFailedError(name, result.error)`; other error → `projectApiError("Failed to rename project", response, error)`.

**Errors**:
- `PROJECT_RENAME_FAILED` (provider.ts:115-130), exit 1: summary `"Project rename failed"`, why `error?.error?.message ?? 'The platform rejected the name "{name}".'`, fix `error?.error?.hint ?? "Pass a different project name and retry the rename."`, nextSteps `[]`.
- `PROJECT_API_ERROR` fallback (provider.ts:166-185): code = api error code or `"PROJECT_API_ERROR"`, why `The Management API returned status {status || "unknown"}.`, fix `"Re-run with --trace for the underlying API response details."`, exit 1.
- Resolution family (§14.1).

**Human output** `renderProjectRename` (presenters/project.ts:192-214) via `renderMutate`: title `"Renaming project."`, context rows `workspace`, `project: {previousName}`, `id` (dim); operation `"Renaming project"` count 1; details: `The project is now named "{project.name}". Directory bindings pin the project id, so they stay valid.`

**JSON serializer** `serializeProjectRename(result)` → unchanged: `{ workspace, project: {id,name,url?}, previousName }`.

**Side effects**: none.

---

## 6. `project remove <project>`

**Registration** (`commands/project/index.ts:93-126`): `new Command("remove")`, descriptor `"project.remove"`. Positional `.argument("<project>", "Project id or name")`. Flag `new Option("--confirm <project-id>", "Exact project id required to remove")`. **No `rm` alias.** No interactive confirm; `--yes` does not bypass.

**Descriptor** (`command-meta.ts:349-354`):
```
description: "Remove a Project permanently after exact id confirmation"
examples: ["prisma-cli project remove proj_123 --confirm proj_123"]
```

**Controller** `runProjectRemove(context, projectRef, {confirm?})` — project.ts:586-642:
1. `formatCommand = resolvePrismaCliPackageCommandFormatterSync(cwd)` (formats as `npx -y @prisma/cli@latest …` or the detected package runner; `lib/agent/cli-command.ts` + `shell/cli-command.ts`).
2. Auth + workspace guard.
3. `requireProjectMutationContext(context, workspace)` (project.ts:840-860): real → `{ provider: createManagementProjectProvider(client), projects: listRealWorkspaceProjects(...) }`. **No local-pin resolution — positional only**, resolved via `resolveProjectForSetup(projectRef.trim(), projects, workspace)` (throws PROJECT_AMBIGUOUS/PROJECT_NOT_FOUND).
4. `requireProjectExactConfirmation({ id: project.id, confirm, summary: "Confirm project removal", why: "Removing a project is permanent, deletes its databases, and stops its apps, so it requires the exact project id.", nextStep: formatCommand(["project","remove",project.id,"--confirm",project.id]) })`.
5. `provider.removeProject({ projectId, signal })` → `client.DELETE("/v1/projects/{id}", { params:{path:{id}}, signal })`; status 400 → `projectRemoveBlockedError(projectId, result.error)`; other error → `projectApiError("Failed to remove project", ...)`.
6. `cleanupLocalPinForProject(context, project.id, hooks)` (project.ts:1033-1061): if pin present and `pin.projectId === projectId`, `unlink(cwd + "/.prisma/local.json")`; delete failure pushes warning `"The local pin .prisma/local.json points at the removed project but could not be deleted."` and cleared=false.
7. Success: `command: "project.remove"`, `result: { workspace, project, localPin: { cleared } }`, `warnings`, `nextSteps: []`.

**CONFIRMATION_REQUIRED** (project.ts:958-982), domain project, exit **2**:
```
code: "CONFIRMATION_REQUIRED"
summary: "Confirm project removal"
why: "Removing a project is permanent, deletes its databases, and stops its apps, so it requires the exact project id."
fix: "Rerun with --confirm {project.id}."
nextSteps: ["{formatCommand(["project","remove",id,"--confirm",id])}"]
meta: { expectedConfirm: project.id, receivedConfirm: confirm ?? null }
```
Check passes only when `options.confirm === options.id` (strict equality).

**PROJECT_REMOVE_BLOCKED** (provider.ts:132-147), exit 1: summary `"Project cannot be removed yet"`, why `error?.error?.message ?? 'Project "{projectId}" still has active deployments.'`, fix `"Remove the project's apps first, then retry the removal."`, nextSteps `["npx -y @prisma/cli@latest app remove --app <name>"]` (via `formatPrismaCliCommand`).

Fixture provider also has a bespoke `PROJECT_NOT_FOUND` (project.ts:933-943): why `No project matched "{projectId}".`, fix `Pass a project id or name from {formatCommand(["project","list"])}.`, exit 1.

**Human output** `renderProjectRemove` (presenters/project.ts:220-245) via `renderMutate`: title `"Removing project."`, context `workspace`/`project`/`id`(dim), operation `"Removing project"` ×1, details: `"The project, its databases, and its apps were removed."` plus, when `localPin.cleared`, `"This directory's local project binding was cleared."`

**JSON serializer** `serializeProjectRemove(result)` → unchanged: `{ workspace, project, localPin: { cleared: boolean } }`.

**Side effects**: may delete `.prisma/local.json`.

---

## 7. `project transfer <project>`

**Registration** (`commands/project/index.ts:128-181`): `new Command("transfer")`, descriptor `"project.transfer"`. Positional `.argument("<project>", "Project id or name")`. Flags:
- `new Option("--to-workspace <id-or-name>", "Locally authenticated workspace to receive the project")`
- `new Option("--recipient-token <token>", "Access token for the receiving workspace")`
- `new Option("--confirm <project-id>", "Exact project id required to transfer")`

**Descriptor** (`command-meta.ts:355-364`):
```
description: "Transfer a Project to another workspace after exact id confirmation"
examples: ['prisma-cli project transfer proj_123 --to-workspace "Prisma Labs" --confirm proj_123',
           "prisma-cli project transfer proj_123 --recipient-token <token> --confirm proj_123"]
```

**Controller** `runProjectTransfer(context, projectRef, {toWorkspace?, recipientToken?, confirm?})` — project.ts:644-735:
1. Auth + workspace guard.
2. Both flags set → `usageError("Choose one transfer recipient source", "--to-workspace and --recipient-token are mutually exclusive.", "Pass either --to-workspace <id-or-name> or --recipient-token <token>.", [formatCommand(["project","transfer","<project>","--to-workspace","<id-or-name>","--confirm","<project-id>"])], "project")` (exit 2).
3. Neither (after trim) → `transferRecipientRequiredError(formatCommand)` (below).
4. `requireProjectMutationContext` + `resolveProjectForSetup` (positional only, like remove).
5. `requireProjectExactConfirmation({ id, confirm, summary: "Confirm project transfer", why: "Transferring moves the project to another workspace and this workspace loses access, so it requires the exact project id.", nextStep: "{formatCommand(["project","transfer",id])} {--to-workspace {arg} | --recipient-token <token>} --confirm {id}" })` — exact nextStep expression project.ts:694-698.
6. `recipient = await resolveTransferRecipient(context, options)` (§14.4).
7. `provider.transferProject({ projectId, recipientAccessToken: recipient.accessToken, signal })` → `client.POST("/v1/projects/{id}/transfer", { params:{path:{id}}, body:{recipientAccessToken}, signal })`; status 400 → `projectTransferRejectedError`; other error → `projectApiError("Failed to transfer project", ...)`.
8. `rewriteOrClearLocalPinForProject(context, project.id, recipient.workspaceId, hooks)` (project.ts:1063-1107): pin present + matching projectId → if recipient.workspaceId known, `writeLocalResolutionPin(cwd, {workspaceId: recipientWorkspaceId, projectId})` → `"rewritten"` (failure warning `"The local pin .prisma/local.json points at the transferred project but could not be rewritten."`, action `"none"`); if recipient workspace unknown (recipient-token in real mode), `unlink` → `"cleared"` (failure warning `"...could not be cleared."`); else `"none"`.
9. Success: `command: "project.transfer"`, `result: { workspace, project, recipient: { workspaceId, workspaceName, source }, localPin: { action } }`, `warnings`, `nextSteps: options.toWorkspace ? ["{formatCommand(["auth","workspace","use"])} {formatCommandArgument(options.toWorkspace)}"] : []`.

**Errors** (see also §14.4):
- `TRANSFER_RECIPIENT_REQUIRED` (project.ts:984-1007), exit 2: summary `"Transfer recipient required"`, why `"Project transfer needs the receiving workspace."`, fix `"Pass --to-workspace <id-or-name> for a locally authenticated workspace, or --recipient-token <token> for a cross-account transfer."`, nextSteps `[formatCommand(["auth","workspace","list"]), formatCommand(["project","transfer","<project>","--to-workspace","<id-or-name>","--confirm","<project-id>"])]`.
- `TRANSFER_RECIPIENT_UNAVAILABLE` (project.ts:1009-1031), exit 1 — raised when `env.PRISMA_SERVICE_TOKEN !== undefined` and `--to-workspace` used: summary `"Local workspace sessions are unavailable"`, why `"--to-workspace resolves locally stored OAuth sessions, but PRISMA_SERVICE_TOKEN is set and service-token mode does not read them."`, fix `"Pass --recipient-token <token> with an access token for the receiving workspace, or unset the service token."`, nextSteps `[formatCommand(["project","transfer","<project>","--recipient-token","<token>","--confirm","<project-id>"])]`.
- `PROJECT_TRANSFER_REJECTED` (provider.ts:149-164), exit 1: summary `"Project transfer was rejected"`, why `error?.error?.message ?? 'The platform rejected the transfer of project "{projectId}", for example because the recipient token is invalid or expired.'`, fix `"Check the recipient workspace session or token and retry the transfer."`, nextSteps `[]`.
- `WORKSPACE_NOT_AUTHENTICATED` / `WORKSPACE_AMBIGUOUS` (§14.4), `CONFIRMATION_REQUIRED` (exit 2, meta as in remove but summary/why per step 5).

**Human output** `renderProjectTransfer` (presenters/project.ts:251-288) via `renderMutate`: title `"Transferring project."`; context rows `workspace`, `project`, `id`(dim), `recipient: {workspaceName ?? workspaceId ?? "workspace of the provided recipient token"}`; operation `"Transferring project"` ×1; details: `"The project now belongs to the recipient workspace; this workspace no longer has access."` plus `"This directory's local project binding now points at the recipient workspace."` (rewritten) or `"This directory's local project binding was cleared."` (cleared).

**JSON serializer** `serializeProjectTransfer(result)` → unchanged: `{ workspace, project, recipient: { workspaceId: string|null, workspaceName: string|null, source: "workspace-session"|"recipient-token" }, localPin: { action: "rewritten"|"cleared"|"none" } }`.

**Side effects**: rewrites or deletes `.prisma/local.json`.

---

## 8. `project env add [assignment]`

**Registration** (`commands/env.ts:45-100`): `new Command("add")`, descriptor `"project.env.add"`. Positional `.argument("[assignment]", "Variable assignment as KEY=VALUE or KEY from the current environment")`. Flags:
- `new Option("--file <path>", "Read KEY=VALUE assignments from a dotenv file")`
- `new Option("--role <role>", "Project template scope (production or preview)").choices(["production","preview"])` (commander enforces choices → its own invalid-argument error before the controller runs)
- `new Option("--branch <git-name>", "Preview branch override scope")`
- `new Option("--project <id-or-name>", "Project id or name")`

**Descriptor** (`command-meta.ts:661-673`): description `"Create a new environment variable."`, examples:
```
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role preview
prisma-cli project env add --file .env --role preview
prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo
prisma-cli project env add --file .env.local --branch feature/foo
API_URL=https://api.example prisma-cli project env add API_URL --project proj_123 --role preview
```

**Controller** `runEnvAdd(context, rawAssignment, {roleName, branchName, projectRef, filePath})` — `controllers/app-env.ts:89-204`. Order of operations:
1. `resolveEnvWriteSource(rawAssignment, filePath, "add")` (app-env.ts:303-348) — usage errors §14.2.d.
2. `resolveEnvScope(flags, { requireExplicit: true, command: "add" })` (§14.2.a). Null (unreachable given requireExplicit throws, but defensively) → `usageError("prisma-cli project env add requires --role or --branch", "Writing without an explicit scope is rejected.", "Pass --role production, --role preview, or --branch <git-name>.", ["prisma-cli project env add KEY=value --role production"], "app")`.
3. `resolveEnvWriteInput` — file: `readEnvFileAssignments(cwd, filePath, "add")` (§14.2.e); single: `parseKeyValuePositional(rawAssignment, "add", context.runtime.env)` (§14.2.c).
4. `requireClientAndProject(context, projectRef, "project env add")` (§14.2.f — auth, client, full project resolution incl. local pin).
5. `resolveScopeToApi(client, projectId, scope, { createBranchIfMissing: true, signal })` (§14.2.b).
6. File mode → `runEnvAddFile` (§ below). Single mode:
   - `findVariableByNaturalKey(client, projectId, key, resolved, signal)` (`controllers/app-env-api.ts:29-61`): `GET /v1/environment-variables` with query `{projectId, class, key, branchId?}` then exact-scope filter (`row.class === class && row.branchId === branchId`).
   - Exists → `ENV_VARIABLE_ALREADY_EXISTS` (app-env.ts:140-152), domain app, exit 1: summary `Variable "{key}" already exists in {formatScopeLabel(scope)}` (scope label = role name or `branch:{name}`), why `"A variable with this key already exists in the targeted scope."`, fix `` "Use `prisma-cli project env update` to change an existing variable's value." ``, nextSteps `["prisma-cli project env update {key}=<new-value> {--role r|--branch b}"]`.
   - Branch scope + key absent from preview role → warning `Variable "{key}" does not exist in preview. It will only exist on branch:{name}.` (app-env.ts:154-169).
   - `client.POST("/v1/environment-variables", { body: { projectId, class, branchId?, key, value }, signal })`; error → `apiCallError("Failed to add {key}", response, error)` (§14.2.g).
7. Success: `command: "project.env.add"`, `result: { projectId, verboseContext, scope: resolved.descriptor, variable: toMetadata(row, descriptor) }`, `warnings`, `nextSteps: []`.

**File mode** `runEnvAddFile` (`controllers/app-env-file.ts:28-123`):
- Per-key lookup of all assignment keys; any existing → `ENV_VARIABLE_ALREADY_EXISTS`, summary `{n} environment variable(s) already exist in {scopeLabel}`, why `Existing keys: "{K1}", "{K2}".`, fix `"Split the input file by key state: update existing keys and add new keys separately."`, meta `{ keys: existingKeys }`, nextSteps (`splitFileNextSteps`, file.ts:343-369):
  ```
  # existing keys: "K1", "K2"
  prisma-cli project env update --file {filePath}.existing {scopeFlag}
  # new keys only
  prisma-cli project env add --file {filePath}.new {scopeFlag}
  ```
- Branch scope: warning for keys missing from preview — single `Variable "{K}" does not exist in preview. It will only exist on branch:{b}.` / plural `Variables "{K1}", "{K2}" do not exist in preview. They will only exist on branch:{b}.`
- Sequential POST per assignment; mid-loop failure → `ENV_FILE_APPLY_FAILED` (file.ts:288-324), exit 1: summary `Failed to add "{failedKey}" from "{filePath}"`, why `No variables were written before {failedKey} failed. Cause: {cause}` or `Written keys before failure: "{K}". Cause: {cause}`, fix `"Inspect the target scope, then retry the remaining keys once the API issue is resolved."`, nextSteps `["prisma-cli project env list {scopeFlag}", retryStep]` where retryStep is `prisma-cli project env add --file {filePath} {scopeFlag}` (nothing written) or `prisma-cli project env add --file <remaining.env> {scopeFlag}` (partial), meta `{ file, failedKey, writtenKeys }`.
- Success result: `{ projectId, verboseContext, scope, variables: EnvVariableMetadata[], file: { path, count } }`.

**`toMetadata`** (`app-env-api.ts:63-80`): `{ id, key, scope, source, isManagedBySystem, updatedAt }`; `scope` = `{kind:"role",role:row.class}` when `row.branchId === null` else the requested descriptor; `source` = `role` / `"overview"` / `branch:{branchName}` label.

**Human output** `renderEnvAdd` (`presenters/app-env.ts:153-201`):
- Single: `renderShow` title `"Setting a new environment variable."`, fields `project: {projectId}`, `scope: {scopeLabel}`, `key`, `id` (dim), `last updated: {updatedAt}` (dim).
- File: `renderList` title `"Setting new environment variables from file."`, parent row `target: {scopeLabel} from {file.path}`, items `⚬ variable: {key} ({source})` + id, status `"default"` when `isManagedBySystem`; empty message `"No environment variables imported."`.
- Both append verbose-only blocks: "Resolved context" (workspace/project/resolution) and "Env target" (`project id` dim, `scope`, optional target/file rows, `keys: {sorted keys or "none"}`) (app-env.ts presenter lines 48-151).

**JSON serializer** `serializeEnvAdd(result)` = `stripVerboseContext(result)` → drops `verboseContext`, everything else unchanged: single `{ projectId, scope, variable }`; file `{ projectId, scope, variables, file: {path, count} }`. `scope` is the `EnvScopeDescriptor` union; `variable(s)` entries are the `toMetadata` shape.

**Side effects**: none local.

---

## 9. `project env update [assignment]`

**Registration** (`commands/env.ts:102-157`): identical positional/flags/descriptions to `add` (same strings), descriptor `"project.env.update"`.

**Descriptor** (`command-meta.ts:674-684`): description `"Replace an existing environment variable's value."`, examples:
```
prisma-cli project env update STRIPE_KEY=sk_new_xxx --role production
prisma-cli project env update STRIPE_KEY=sk_new_xxx --role preview
prisma-cli project env update --file .env --role production
prisma-cli project env update DATABASE_URL=postgresql://branch --branch feature/foo
```

**Controller** `runEnvUpdate` — app-env.ts:206-301. Same pipeline as add with differences:
- `resolveScopeToApi(..., { createBranchIfMissing: false })` → nonexistent branch → `ENV_BRANCH_NOT_FOUND` (§14.2.b).
- Missing var → `ENV_VARIABLE_NOT_FOUND` (app-env.ts:257-269), exit 1: summary `Variable "{key}" not found in {scopeLabel}`, why `"No variable with this key exists in the targeted scope."`, fix `` "Use `prisma-cli project env add` to create a new variable." ``, nextSteps `["prisma-cli project env add {key}=<value> {scopeFlag}"]`.
- Mutation: `client.PATCH("/v1/environment-variables/{envVarId}", { params: {path:{envVarId: existing.id}}, body: {value}, signal })`; error → `apiCallError("Failed to update value for {key}", ...)`.
- No preview-default warning; `warnings: []`.
- File mode `runEnvUpdateFile` (file.ts:125-214): missing keys → `ENV_VARIABLE_NOT_FOUND` summary `{n} environment variable(s) not found in {scopeLabel}`, why `Missing keys: "{K}".`, fix `"Split the input file by key state: add missing keys and update existing keys separately."`, meta `{keys: missingKeys}`, nextSteps (`splitFileNextSteps` add-missing variant):
  ```
  # missing keys: "K1"
  prisma-cli project env add --file {filePath}.new {scopeFlag}
  # existing keys only
  prisma-cli project env update --file {filePath}.existing {scopeFlag}
  ```
  Mid-loop failure → `ENV_FILE_APPLY_FAILED` with retry step `prisma-cli project env update --file {filePath} {scopeFlag}` (always the same file for update).
- Success: `command: "project.env.update"`, result shapes identical to add (single `variable` / file `variables`+`file`).

**Human output** `renderEnvUpdate`: single title `"Replacing the environment variable's value."`; file title `"Replacing environment variable values from file."`, empty message `"No environment variables updated."`; same fields as add. **JSON**: `serializeEnvUpdate` = `stripVerboseContext`.

---

## 10. `project env list`

**Registration** (`commands/env.ts:159-197`): `new Command("list")`, descriptor `"project.env.list"`. No positional. Flags:
- `new Option("--role <role>", "Project template scope").choices(["production","preview"])` (note: no "(production or preview)" suffix here)
- `new Option("--branch <git-name>", "Preview branch resolved scope")`
- `new Option("--project <id-or-name>", "Project id or name")`

**Descriptor** (`command-meta.ts:685-695`): description `"List environment variable metadata for a scope (no values)."`, examples:
```
prisma-cli project env list
prisma-cli project env list --role production
prisma-cli project env list --role preview
prisma-cli project env list --branch feature/foo
```

**Controller** `runEnvList(context, {roleName, branchName, projectRef})` — app-env.ts:377-431:
1. `resolveEnvScope(flags, { requireExplicit: false, command: "list" })` — returns null when neither flag given (still throws on both flags / invalid role).
2. `requireClientAndProject(context, projectRef, "project env list")`.
3. `resolveListScopeToApi(client, projectId, explicit ?? undefined, {cwd, signal})` (app-env.ts:611-697):
   - Explicit scope → `resolveScopeToApi(..., createBranchIfMissing: false)` → kind "scoped"; target `{source:"explicit", envMap: role}` for role or `{source:"explicit", branchName, branchId, branchRole:"preview", branchExists:true, envMap:"preview"}` for branch.
   - No scope: `readLocalGitBranch(cwd, signal)` (`lib/git/local-branch.ts:10-30`; walks up to nearest `.git`, reads `HEAD`, returns branch name or null for detached/no repo):
     - branch found remotely via `GET /v1/projects/{projectId}/branches?gitName=` → if `role === "production"`: descriptor `{kind:"role",role:"production"}`, target `{source:"local-git", branchName, branchId, branchRole, branchExists:true, envMap:"production"}`; else branch descriptor + envMap `"preview"`.
     - branch not on platform → descriptor `{kind:"role",role:"preview"}`, target `{source:"local-git", branchName, branchExists:false, envMap:"preview"}`, addScope `{kind:"branch",branchName}`.
     - no git branch → kind "overview": descriptor `{kind:"overview"}`, target `{source:"overview", envMap:"overview"}`, addScope `{kind:"role",role:"preview"}`.
4. Variables: scoped → `listVariables` (paginated `GET /v1/environment-variables?projectId&class[&cursor]`, filter `rowMatchesScope` — for branch scope keeps branch rows **and** class-level rows, then `materializeEffectiveRows` overlays branch rows over role defaults per key, sorted by key); overview → `listOverviewVariables` (no class filter; keeps `branchId===null` rows of both classes; sort production-first then key asc).
5. Success: `command: "project.env.list"`, `result: { projectId, verboseContext, scope: descriptor, target, variables: toMetadata[] }`, `warnings: []`, `nextSteps`: empty-list case → `["prisma-cli project env add KEY=value {formatScopeFlag(addScope)}"]`, else `[]`.

**Human output** `renderEnvList` (presenter:261-286): `renderList`, title `"Listing environment variables for the selected scope."`, parent row `target: {listTargetLabel}` where label = `"overview"`, or `branch:{name} -> {envMap}` with suffix `" (not created yet)"` when `branchExists === false`, or plain scope label; items `⚬ variable: {key} ({source})` + id + status `"default"` if managed; empty message `"No environment variables defined in this scope."`; then verbose blocks.

**JSON serializer** `serializeEnvList` (presenter:288-308):
```js
{
  projectId,
  scope,                          // EnvScopeDescriptor
  target,                         // EnvListTarget
  context: { target: listTargetLabel },
  items: variables.map(v => ({ name: `${v.key} (${v.source})`, id: v.id, status: v.isManagedBySystem ? "default" : null })),
  count,
  variables                       // full EnvVariableMetadata[]
}
```

---

## 11. `project env remove <key>` (alias `rm`)

**Registration** (`commands/env.ts:199-240`): `new Command("remove")`, `.alias("rm")`, descriptor `"project.env.remove"`. Positional `.argument("<key>", "Variable key to remove")`. Flags identical to add (`--role` with "(production or preview)" suffix, `--branch <git-name>` "Preview branch override scope", `--project`). No `--confirm`/`--yes` requirement.

**Descriptor** (`command-meta.ts:696-705`): description `"Remove an environment variable from a scope."`, examples:
```
prisma-cli project env remove STRIPE_KEY --role production
prisma-cli project env remove STRIPE_KEY --role preview
prisma-cli project env remove DATABASE_URL --branch feature/foo
```

**Controller** `runEnvRemove(context, key, flags)` — app-env.ts:433-512:
1. `!key` → `usageError("prisma-cli project env remove requires KEY", "No KEY positional argument was supplied.", "Pass the variable name to remove, e.g. STRIPE_KEY.", ["prisma-cli project env remove STRIPE_KEY --role production"], "app")` (defensive; commander enforces the required arg first).
2. `resolveEnvScope({requireExplicit: true, command: "remove"})`; null fallback → `usageError("prisma-cli project env remove requires --role or --branch", "Writing without an explicit scope is rejected.", "Pass --role production, --role preview, or --branch <git-name>.", ["prisma-cli project env remove {key} --role production"], "app")`.
3. `requireClientAndProject(context, projectRef, "project env remove")`; `resolveScopeToApi(..., createBranchIfMissing: false)`.
4. `findVariableByNaturalKey`; missing → `ENV_VARIABLE_NOT_FOUND` (app-env.ts:478-488): summary `Variable "{key}" not found in {scopeLabel}`, why `"No variable with this key exists in the targeted scope, so there is nothing to remove."`, fix `"Run prisma-cli project env list with the same scope to see the available variables."`, nextSteps `["prisma-cli project env list {scopeFlag}"]`, exit 1.
5. `client.DELETE("/v1/environment-variables/{envVarId}", { params:{path:{envVarId: existing.id}}, signal })`; error → `apiCallError("Failed to remove {key}", ...)`.
6. Success: `command: "project.env.remove"`, `result: { projectId, verboseContext, scope: descriptor, key }`, `warnings: []`, `nextSteps: []`.

Note: `validateKey` (256-char / POSIX-shape checks) is **not** run on the remove positional — only add/update parse paths validate.

**Human output** `renderEnvRm`: `renderShow` title `"Removing the environment variable from the scope."`, fields `project`, `scope`, `key`; plus verbose blocks. **JSON** `serializeEnvRm` = `stripVerboseContext` → `{ projectId, scope, key }`.

---

## 14. Shared machinery

### 14.1 Project resolution (`lib/project/resolution.ts`)

Used by: rename (via `requireProjectCommandContext`), all four env commands (via `requireClientAndProject`), show (via `inspectProjectBinding`). **Not** used by remove/transfer/link/create (positional-or-picker only) or list.

`resolveProjectTarget(options)` (resolution.ts:155-183) precedence, given `{context, workspace, explicitProject?, envProjectId?, commandName?, projectDir?, listProjects}`:
1. `explicitProject` (`--project`): `resolveExplicitProject` matches `project.id === ref || project.name === ref` (exact, case-sensitive). 1 match → source `"explicit"`; >1 → `ProjectAmbiguousError`; 0 → `ProjectNotFoundError`.
2. `envProjectId` (matched by id only) — **the 13 commands in scope never pass `envProjectId`**; only `app deploy`/`app run` read `PRISMA_PROJECT_ID` (`controllers/app.ts:168`). So `PRISMA_PROJECT_ID` does NOT affect project/env commands. (Task-brief assumption to correct.)
3. Local pin `.prisma/local.json` (read from `projectDir ?? cwd`): pin.workspaceId ≠ active workspace → `LocalProjectWorkspaceMismatchError`; pin projectId not in workspace list → `LocalStateStaleError`; invalid JSON/shape while reading → `LocalStateStaleError` (via `localPinReadErrorToProjectError`); match → source `"local-pin"`.
4. `resolveDurablePlatformMapping()` — hardcoded `null` (resolution.ts:586-588), source `"platform-mapping"` is dead code today.
5. Nothing → `ProjectSetupRequiredError` carrying `buildProjectSetupSuggestion` (suggested name from `package.json` `name` if matching `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, else `basename(cwd)`; candidates = projects whose id/name/slug equals the suggested name).

CliError mappings (`projectResolutionErrorToCliError`, resolution.ts:352-375):

- **PROJECT_NOT_FOUND** (232-245), domain project, exit 1: summary `"Project not found"`, why `The project "{projectRef}" does not exist in workspace "{workspace.name}" or is not accessible.`, fix `"Pass a project id or name from prisma-cli project list."`, nextSteps `["prisma-cli project list"]`.
- **PROJECT_AMBIGUOUS** (256-285), exit **1** (inventory says 2 for show — code says 1): summary `"Project resolution is ambiguous"`, why `Multiple projects matched "{projectRef}".` (or `"Multiple projects matched the current directory context."` when ref null), fix `"Pass --project <id-or-name> to choose the project explicitly."`, meta `{ matches: [{id,name}] }`, nextSteps `["prisma-cli project list"]` plus, when a first match exists, `"prisma-cli app deploy --project {firstMatch.id}"`.
- **LOCAL_STATE_STALE** (291-307), exit 1: summary `"Local project binding is stale"`, why `The target recorded in .prisma/local.json is no longer available in the selected workspace.`, fix `Delete .prisma/local.json, then choose a Project explicitly.`, meta `{ pinPath: ".prisma/local.json" }`, nextSteps `["prisma-cli project list", "prisma-cli project link <id-or-name>"]`.
- **LOCAL_PROJECT_WORKSPACE_MISMATCH** (319-344), exit 1: summary `"Project link uses another workspace"`, why `.prisma/local.json links this directory to project {pinnedProjectId} in workspace {pinnedWorkspaceId}, but your current CLI session is workspace "{activeWorkspace.name}" ({activeWorkspace.id}).`, fix `"Switch to the linked workspace, or relink this directory to a project in the current workspace."`, meta `{ pinPath, pinnedWorkspaceId, pinnedProjectId, activeWorkspaceId, activeWorkspaceName }`, nextSteps `["prisma-cli auth workspace use {pinnedWorkspaceId}", "prisma-cli project list", "prisma-cli project link <id-or-name>"]`.
- **PROJECT_SETUP_REQUIRED** (411-429), exit 1: summary `"Choose a Project before running this command"`, why = `This directory is not linked to a Prisma Project, and {("prisma-cli " + commandName) | "this command"} will not choose one from package or directory names.`, fix `"Link the directory to an existing Project, or pass --project <id-or-name> for this command."`, meta `{ suggestedProjectName, suggestedProjectNameSource, candidates, recoveryCommands }`, nextSteps `["prisma-cli project list", "prisma-cli project link <id-or-name>", "prisma-cli {commandName} --project <id-or-name>"]`, nextActions `buildProjectSetupNextActions({commandName, suggestedProjectName})`.

**`buildProjectSetupNextActions`** (resolution.ts:431-494) — NextAction objects, `journey: "project-setup"` (retry action `"recover"`):
1. `{ kind: "user-choice", label: "Ask the user whether to link an existing Project or create a new one", commands: ["prisma-cli project list", "prisma-cli project link <id-or-name>"(, "prisma-cli {commandName} --project <id-or-name>")], reason: options.reason ?? "This directory is not linked to a Prisma Project. Package and directory names are suggestions only, not a safe Project selection." }`
2. `{ kind: "run-command", label: "Link the chosen Project", command: "prisma-cli project link <id-or-name>", reason: "Linking writes the durable local Project binding for this directory." }`
3. When createCommand or suggested name present: `{ kind: "run-command", label: "Create and link a new Project", command: createCommand ?? "prisma-cli project create {formatCommandArgument(suggestedProjectName)}", reason: "Use this when the user wants a new Prisma Project instead of an existing one." }`
4. When commandName present: `{ kind: "run-command", journey: "recover", label: "Retry with an explicit Project", command: "prisma-cli {commandName} --project <id-or-name>" }`

`listRealWorkspaceProjects(client, workspace, signal?)` (project.ts:1438-1466): `client.GET("/v1/projects", { signal })` — **single call, NOT paginated, no error branch (`data?.data ?? []` swallows errors as empty)**; filters `project.workspace.id === workspace.id` client-side; maps `{id, name, url?, defaultRegion?, slug, workspace:{id,name}}`; `sortProjects` = name `localeCompare` then id.

### 14.2 Env scope machinery

**(a) `resolveEnvScope(flags, {requireExplicit, command})`** (`lib/app/env-config.ts:27-81`) — all USAGE_ERROR (exit 2), domain `"app"`:
- both flags: summary `prisma-cli project env {command} accepts either --role or --branch`, why `"--role targets a project-level config map; --branch targets a preview branch override."`, fix `"Pass exactly one scope flag."`, nextSteps `["prisma-cli project env {command} {positionalHint}--role preview", "...{positionalHint}--branch feature/foo"]` (positionalHint = `"KEY=value "` for add/update, `"KEY "` for remove, `""` for list).
- invalid role (defensive; commander `.choices` normally rejects first with `error: option '--role <role>' argument 'x' is invalid. Allowed choices are production, preview.`): summary `Unknown role "{roleName}"`, why `"--role accepts production or preview."`, fix `"Pass --role production or --role preview."`.
- neither + requireExplicit: summary `prisma-cli project env {command} requires --role or --branch`, why `"Writing without an explicit scope is rejected so the command never silently targets production."`, fix `"Pass --role production, --role preview, or --branch <git-name>."`, nextSteps 3 hints (`--role production`, `--role preview`, `--branch feature/foo`).

**(b) `resolveScopeToApi(client, projectId, scope, {createBranchIfMissing, signal})`** (app-env.ts:560-609):
- role → `{descriptor: {kind:"role",role}, apiTarget: {class: role, branchId: null}}`.
- branch → `listBranchesByName` = `GET /v1/projects/{projectId}/branches?gitName={branchName}` (first row). Missing:
  - `createBranchIfMissing: false` → **ENV_BRANCH_NOT_FOUND** (app-env.ts:767-780), exit 1: summary `Branch "{branchName}" not found`, why `"Branch update, list, and remove commands only target existing preview branches."`, fix `` "Create the branch by deploying it, or use `project env add --branch` to create its first override." ``, nextSteps `["prisma-cli project env add KEY=value --branch {branchName}"]`.
  - `createBranchIfMissing: true` (`resolveOrCreateBranch`, app-env.ts:783-834): first checks `projectHasDefaultBranch` (paginated `GET /v1/projects/{projectId}/branches` walking `pagination.nextCursor` while `hasMore`); no default branch → **ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH** (796-806), exit 1: summary `Cannot create branch "{branchName}" from project env`, why `"Creating the first branch would make it the project default, but branch overrides are preview-only."`, fix `"Create or deploy the default branch first, then add the branch override."`, nextSteps `["prisma-cli app deploy --branch main"]`. Then `POST /v1/projects/{projectId}/branches` body `{gitName: branchName, isDefault: false}`; 409 → re-list race recovery; else `apiCallError('Failed to create branch "{branchName}"', ...)`.
- resolved branch with `role === "production"` → **ENV_BRANCH_SCOPE_IS_PRODUCTION** (588-597), exit 1: summary `Branch "{branchName}" is the production branch`, why `"Production variables are project-level only; branch overrides apply to preview branches."`, fix `"Use --role production for the production branch."`, nextSteps `["prisma-cli project env list --role production"]`.
- branch success → `{descriptor: {kind:"branch", branchName: branch.gitName, branchId: branch.id}, apiTarget: {class:"preview", branchId: branch.id}}`.

**(c) `parseKeyValuePositional(raw, command, env)`** (env-config.ts:83-148) — all usage errors exit 2 domain app:
- no `=` and matches `KEY_SHAPE = /^[A-Z_][A-Z0-9_]*$/`: reads `env[raw]`; unset/empty → `Value for "{raw}" was not provided` / why `No KEY=VALUE assignment was supplied, and {raw} is not set in the current environment.` / fix `"Pass KEY=VALUE or export the variable before running the command."` / nextSteps `["prisma-cli project env {command} {raw}=value --role production", "{raw}=value prisma-cli project env {command} {raw} --role production"]`.
- no `=`, not key-shaped: `KEY=VALUE argument is missing the = separator`, why `"{raw}" does not contain an = character.`, fix `"Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx."`.
- empty value after `=`: `KEY=VALUE argument has an empty value`, why `"{raw}" has an empty value after the = separator.`, fix `"Pass a non-empty value, or use prisma-cli project env remove to remove a variable."`.
- `validateKey` (env-config.ts:152-189): empty key → `Variable key cannot be empty`; >256 chars → `Variable key "{key}" exceeds the 256-character limit` (why `"Env-var keys are capped at 256 characters by the platform."`, fix `"Use a shorter key."`); shape violation → `Variable key "{key}" must match the POSIX env-var shape`, why `"Keys must start with an uppercase letter or underscore and contain only uppercase letters, digits, and underscores."`, fix `"Rename the key to match [A-Z_][A-Z0-9_]*."`.

**(d) `resolveEnvWriteSource`** usage errors (app-env.ts:303-348), exit 2 domain app:
- both positional+file: `prisma-cli project env {command} accepts either KEY=VALUE or --file`, why `"The command received both a positional assignment and a dotenv file path."`, fix `"Pass one input source."`, nextSteps `["prisma-cli project env {command} KEY=value --role preview", "prisma-cli project env {command} --file .env --role preview"]`.
- `--file` with empty string: `prisma-cli project env {command} --file requires a path`, why `"The --file flag was passed without a file path."`, fix `"Pass a readable dotenv file path."`.
- neither: `prisma-cli project env {command} requires KEY=VALUE or --file`, why `"No environment variable input was supplied."`, fix `"Pass a single KEY=VALUE assignment or a dotenv file path."`, same two nextSteps.

**(e) dotenv parsing `readEnvFileAssignments(cwd, filePath, command)`** (`lib/app/env-file.ts:23-101`): resolves relative to cwd; read failure → usage error `Failed to read env file "{filePath}"` (why = fs error message, fix `"Pass a readable dotenv file path."`, nextSteps `["prisma-cli project env {command} --file .env --role preview"]`). Parsing: custom key extraction regex `/^\s*(?:export\s+)?([^#=\s]+)\s*=/` with multiline-quote tracking, values from `dotenv.parse`. Errors (all usage, exit 2, app): `No environment variables found in "{filePath}"` (why `"The file does not contain any KEY=VALUE assignments."`); per-key validation wrapped as `Invalid environment variable "{key}" in "{filePath}"` (why `Line {n}: {validateKey message}`); `Duplicate environment variable "{key}" in "{filePath}"` (why `Lines {a} and {b} both define {key}.`, fix `"Keep one assignment for each key before importing the file."`); `Environment variable "{key}" in "{filePath}" has an empty value` (why `Line {n} defines {key} with an empty value.`, fix `"Pass a non-empty value, or omit the key from the file."`).

**(f) `requireClientAndProject(context, explicitProject, commandName)`** (app-env.ts:514-558): `requireAuthenticatedAuthState` → `authenticatedManagementApiClient` (null → `authRequiredError(["prisma-cli auth login"])`) → workspace guard → `resolveProjectTarget` (listProjects = `listRealWorkspaceProjects`). Returns `{client, projectId, verboseContext: {workspace, project, resolution}}`. **Env commands are real-mode only in this path** (no fixture branch; fixture behavior for env lives in the mock API elsewhere).

**(g) `apiCallError(summary, response, error)`** (`controllers/app-env-api.ts:92-118`): 401/403 → `authRequiredError(["prisma auth login"])` — note **`"prisma auth login"`, not `"prisma-cli auth login"`** (inconsistency worth preserving-or-fixing consciously). Otherwise `CliError { code: apiCode ?? "ENV_API_ERROR", domain: "app", summary, why: apiMessage ?? 'The Management API returned status {status || "unknown"}.', fix: apiHint ?? "Re-run with --trace for the underlying API response details.", exitCode: 1, nextSteps: [] }`.

### 14.3 Auth / workspace requirement

- `requireAuthenticatedAuthState(context)` (`controllers/auth.ts:205-237`): real mode reads stored auth; unauthenticated + non-TTY → `authRequiredError()`; unauthenticated + TTY → runs interactive `performLogin` then re-reads ("platform+login" behavior).
- `authRequiredError(nextSteps = ["prisma-cli auth login"])` (`shell/errors.ts:101-115`): code `AUTH_REQUIRED`, domain auth, exit 1, summary `"Authentication required"`, why `"This command needs an authenticated session."`, fix `"Run prisma-cli auth login, or rerun the command in a TTY to sign in interactively."`.
- `workspaceRequiredError()` (`shell/errors.ts:141-149`) = `usageError(...)` so the code is **`USAGE_ERROR`** (not a `WORKSPACE_REQUIRED` code), exit 2, domain auth: summary `"Workspace required"`, why `"This command needs an active workspace, but the authenticated session does not have one."`, fix `"Run prisma-cli auth login and choose a workspace."`, nextSteps `["prisma-cli auth login"]`. (*Inventory calls this "`WORKSPACE_REQUIRED` usage error" — the wire code is `USAGE_ERROR`.*)
- `authenticatedManagementApiClient(env, signal)` (`auth/guard.ts:19-60`): `PRISMA_SERVICE_TOKEN` set → `createManagementApiClient({baseUrl: getApiBaseUrl(env), token})` (empty token throws `Error("PRISMA_SERVICE_TOKEN is set but empty. Provide a valid token or unset the variable.")` → mapped to `AUTH_CONFIG_INVALID` by the runner); else `FileTokenStorage` + `createManagementApiSdk({clientId: CLIENT_ID = "cmm3lndn701oo0uefvxzo0ivw", redirectUri: "http://localhost:0/auth/callback", tokenStorage, apiBaseUrl})` → `sdk.client`; no stored tokens → `null`. Base URL: `env.PRISMA_MANAGEMENT_API_URL?.trim() || "https://api.prisma.io"`.
- Command runner also maps SDK `AuthError` → `authRequiredError(["prisma-cli auth login"], {debug})` and abort → `COMMAND_CANCELED` exit 130 (`shell/command-runner.ts:40-66`).

### 14.4 Transfer recipient machinery

`resolveTransferRecipient(context, options)` (project.ts:744-833), real mode:
- `--recipient-token` (trimmed): `{accessToken: token, workspaceId: null, workspaceName: null, source: "recipient-token"}` — no validation call.
- `--to-workspace`: `PRISMA_SERVICE_TOKEN` present → `TRANSFER_RECIPIENT_UNAVAILABLE` (§7). Else `resolveRecipientWorkspaceSession(workspaceRef, env, signal)` (`auth/recipient.ts:29-65`): `FileTokenStorage.resolveWorkspace(ref)` (match rule `workspaceMatchesRef`, token-storage.ts:761-772: credentialWorkspaceId, id, prefix-stripped forms, or case-insensitive name; 0 matches → `WorkspaceSelectionError("not-found")`, >1 → `("ambiguous", ref, matches)`); then a pinned-storage SDK probe `GET /v1/workspaces` (triggers token refresh); probe error or missing tokens → `RecipientSessionInvalidError`. Returns `{workspace, accessToken}` → `{workspaceId: workspace.id, workspaceName: workspace.name, source: "workspace-session"}`.
- Error mapping (project.ts:814-832): `WorkspaceSelectionError` ambiguous → `workspaceAmbiguousError(ref, matches)` (`auth/errors.ts:38-55`): code `WORKSPACE_AMBIGUOUS`, exit 2, summary `"Workspace name is ambiguous"`, why `Multiple authenticated workspaces matched "{ref}".`, fix `"Run prisma-cli auth workspace list and switch by workspace id."`, meta `{workspaceRef, matches: [{id,name,credentialWorkspaceId}]}`, nextSteps `["prisma-cli auth workspace list"]`. Other reasons and `RecipientSessionInvalidError` → `workspaceNotAuthenticatedError(ref)` (auth/errors.ts:23-36): code `WORKSPACE_NOT_AUTHENTICATED`, exit 1, summary `"Workspace is not authenticated"`, why `No stored OAuth session matched "{workspaceRef}".`, fix `"Run prisma-cli auth login and authorize that workspace, then switch to it."`, meta `{workspaceRef}`, nextSteps `["prisma-cli auth workspace list", "prisma-cli auth login"]`.

### 14.5 Pagination

- `GET /v1/projects` (`listRealWorkspaceProjects`): **not paginated** — single request.
- `GET /v1/environment-variables` list paths (`collectEnvironmentVariables`, app-env.ts:919-965) and `projectHasDefaultBranch` (app-env.ts:836-876): cursor loop — repeat while `pagination.hasMore && pagination.nextCursor`, passing `cursor` in query.
- `findVariableByNaturalKey`: single request; relies on server-side `key`+`branchId` filters (comment at app-env-api.ts:36 explains the 100-row page limit rationale).
- Branch lookup by name (`listBranchesByName`): single request with `gitName` query, takes `[0]`.

### 14.6 Local pin write / gitignore (`lib/project/local-pin.ts`)

- Pin path constant: `LOCAL_RESOLUTION_PIN_RELATIVE_PATH = ".prisma/local.json"`.
- Content written (`writeLocalResolutionPin`, 250-291): `JSON.stringify({workspaceId, projectId}, null, 2) + "\n"` — exactly two keys; written atomically via `mkdir .prisma` → temp file `local.{pid}.{Date.now()}.tmp` → `rename`.
- Read validation (`isLocalResolutionPin`, 419-440): object with **exactly** keys `workspaceId` and `projectId`, both non-empty strings; extra keys → invalid shape.
- `ensureLocalResolutionPinGitignore` (293-346): no `.gitignore` → create with content `".prisma/\n"`; existing file → skip if any trimmed line equals `.prisma/` or `.prisma/local.json`; else append `".prisma/\n"` (with a `"\n"` separator first when the file doesn't end in a newline).
- Failure surface: `LOCAL_STATE_WRITE_FAILED` (`lib/project/setup.ts:94-145`), exit 1, domain project: summary `"Could not save local Project binding"`, why `"The CLI could not write .prisma/local.json."` (pin) or `"The CLI could not update .gitignore to keep local Project binding state out of git."` (gitignore), fix `"Check that this directory is writable and that .prisma/local.json and .gitignore are not blocked by directories or permissions, then retry."`, meta `{pinPath, operation}` or `{gitignorePath, operation}`, nextSteps `["prisma-cli project link <id-or-name>", "prisma-cli app deploy --project <id-or-name>"]`.

### 14.7 Provider/operation signatures the port must call

Per the port rule (client built from ctx.api), these are the exact call surfaces:

| operation | exported name / call | file | client arg? | params |
|---|---|---|---|---|
| list projects | `listRealWorkspaceProjects(client, workspace, signal?)` → `client.GET("/v1/projects", {signal})` | controllers/project.ts:1438 | yes, first arg (`ManagementApiClient`) | `(client, workspace: AuthWorkspace, signal?: AbortSignal)` |
| create project | `createAppProvider(client).createProject({name, region?, signal?}): Promise<ProjectRecord {id,name,defaultRegion}>` (wraps `ComputeClient(client).createProject`) | lib/app/app-provider.ts:271,281 | yes (factory takes client) | as shown |
| rename | `createManagementProjectProvider(client).renameProject({projectId, name, signal?}): Promise<ProjectSummary>` → `PATCH /v1/projects/{id}` body `{name}` | lib/project/provider.ts:38-70 | yes (factory) | as shown |
| remove | `.removeProject({projectId, signal?}): Promise<void>` → `DELETE /v1/projects/{id}` | provider.ts:72-89 | yes | as shown |
| transfer | `.transferProject({projectId, recipientAccessToken, signal?}): Promise<void>` → `POST /v1/projects/{id}/transfer` body `{recipientAccessToken}` | provider.ts:91-111 | yes | as shown |
| env find | `findVariableByNaturalKey(client, projectId, key, resolved: ResolvedEnvApiScope, signal)` | controllers/app-env-api.ts:29 | yes, first arg | as shown |
| env create | inline `client.POST("/v1/environment-variables", {body: {projectId, class, branchId?, key, value}, signal})` | app-env.ts:171 / app-env-file.ts:75 | yes | — |
| env update | inline `client.PATCH("/v1/environment-variables/{envVarId}", {params:{path:{envVarId}}, body:{value}, signal})` | app-env.ts:271 / file.ts:169 | yes | — |
| env delete | inline `client.DELETE("/v1/environment-variables/{envVarId}", {params:{path:{envVarId}}, signal})` | app-env.ts:490 | yes | — |
| env list | `collectEnvironmentVariables(client, projectId, signal, {className?, filter})` (internal) | app-env.ts:919 | yes | — |
| branch by name | `listBranchesByName(client, projectId, branchName, signal)` → `GET /v1/projects/{projectId}/branches?gitName=` (internal) | app-env.ts:731 | yes | — |
| branch create | inline `client.POST("/v1/projects/{projectId}/branches", {params:{path:{projectId}}, body:{gitName, isDefault:false}, signal})` | app-env.ts:808 | yes | — |
| recipient session | `resolveRecipientWorkspaceSession(workspaceRef, env, signal?)` | auth/recipient.ts:29 | **no** — builds its own SDK from FileTokenStorage + env | `(workspaceRef: string, env: NodeJS.ProcessEnv, signal?: AbortSignal)` |
| client factory | `authenticatedManagementApiClient(env, signal?): Promise<ManagementApiClient \| null>` | auth/guard.ts:19 | n/a (this IS the factory) | as shown |

Note the AppProvider also exposes `listEnvironmentVariables/createEnvironmentVariable/updateEnvironmentVariable/deleteEnvironmentVariable` (app-provider.ts:164-188) but the env commands do **not** use them — they call the client inline.

---

## 15. Discrepancies / gaps vs the inventory & task brief

1. **`PROJECT_AMBIGUOUS` exit code**: inventory §`project show` says exit 2; code sets `exitCode: 1` (resolution.ts:283). Same code path everywhere.
2. **`PRISMA_PROJECT_ID`**: none of the 13 commands read it. `resolveProjectTarget` accepts `envProjectId` but only `controllers/app.ts` passes it (app deploy/run). The shared resolution section of any design doc should not claim env-var resolution for these commands.
3. **`WORKSPACE_REQUIRED`**: not a distinct code — it is a `USAGE_ERROR` with summary `"Workspace required"` (exit 2). Inventory phrasing is loose here.
4. **`apiCallError` 401/403 nextStep** says `"prisma auth login"` (no `-cli`), unlike everywhere else (`app-env-api.ts:103`). Pre-existing copy inconsistency.
5. **`projectSetupNameRequiredError("project rename")`** produces summary "Project create requires a name" for rename (only the example command varies). Pre-existing copy bug.
6. `GET /v1/projects` is unpaginated and its error result is silently treated as an empty list (`data?.data ?? []`, project.ts:1443) — no error surface on list failure.
7. Two identical `toProjectSummary` implementations exist (resolution.ts:755 private, setup.ts:147 exported).
8. `project remove`/`transfer` resolve the positional against the workspace list only (no local pin, no `--project` flag); rename/env commands use full pin resolution; show uses pin resolution but treats unbound as success. Inventory matches this but does not spell out the remove/transfer non-pin path.
9. Env group node (`commands/env.ts`) gets no compact global flags, unlike other group nodes.
10. `project remove` has no `rm` alias (only `project env remove` has `rm`).
