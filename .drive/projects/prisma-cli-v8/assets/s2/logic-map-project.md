# Logic map: the `project` command group

Where the business logic of the 11 `project` commands actually lives today, what each command calls, and which external services it depends on. This is evidence for a decision about the Clean Architecture split (command handlers parse input and present output; use cases hold business logic with their external services injected; adapters implement the ports). It is not a proposal.

All paths are relative to the repository root of `prisma-cli`. Source files are under `packages/cli/src/`.

## Terms used in this document

- **v8 handler** — the new command implementation, written against `@prisma/cli-engine`. Lives under `packages/cli/src/v8/`.
- **Legacy controller** — the older commander-based implementation under `packages/cli/src/controllers/`. Some of it is dead in v8; some of it is still called by the v8 handlers.
- **Local pin** — the file `.prisma/local.json` in the user's working directory. It holds `{ workspaceId, projectId }` and is how a directory remembers which Prisma project it belongs to. Written by `project create` and `project link`; read by almost everything else.
- **Management API** — the Prisma platform's HTTP API, reached through `ctx.api` (a `ManagementApiClient` the engine builds from the signed-in credential).
- **Scope**, for environment variables — either a role (`production` or `preview`, which are project-level) or a specific preview branch (an override that applies only to that branch).
- **Fixture mode** — the legacy CLI's offline mode, where a JSON file (`packages/cli/fixtures/mock-api.json`) stands in for the platform. Reached only when `--fixture` or `PRISMA_CLI_MOCK_FIXTURE_PATH` is set. The v8 handlers never enter it.

## The 11 commands and their handler files

| Command | v8 handler |
| --- | --- |
| `project list` | `packages/cli/src/v8/project/list.ts` |
| `project show` | `packages/cli/src/v8/project/show.ts` |
| `project create` | `packages/cli/src/v8/project/create.ts` |
| `project link` | `packages/cli/src/v8/project/link.ts` |
| `project rename` | `packages/cli/src/v8/project/rename.ts` |
| `project remove` | `packages/cli/src/v8/project/remove.ts` |
| `project transfer` | `packages/cli/src/v8/project/transfer.ts` |
| `project env add` | `packages/cli/src/v8/project/env-add.ts` |
| `project env update` | `packages/cli/src/v8/project/env-update.ts` |
| `project env list` | `packages/cli/src/v8/project/env-list.ts` |
| `project env remove` | `packages/cli/src/v8/project/env-remove.ts` |

All 11 are registered in `packages/cli/src/v8/cli.ts` and all declare `needs: { credentials: true }`, so the engine refuses an unauthenticated run before the handler starts.

Two files in the same directory are shared rather than being commands: `packages/cli/src/v8/project/context.ts` (glue to the legacy layer, plus project resolution and pin writing) and `packages/cli/src/v8/project/env-shared.ts` (flag definitions, scope resolution and presentation shared by the four `env` commands). `packages/cli/src/v8/project/errors.ts` and `packages/cli/src/v8/project/presentation.ts` are error mapping and rendering helpers.

## Shared machinery

Every command in the group is built from the same handful of calls. Reading these once makes the per-command sections short.

### Resolving the active workspace

`resolveActiveWorkspace(ctx)` in `packages/cli/src/v8/resources-shared/workspace.ts`. Calls the engine's `ctx.activeCredential()`, and if the credential has no `workspaceId` throws a structured `AUTH.USAGE_ERROR` titled "Workspace required". Otherwise returns `{ id: credential.workspaceId, name: credential.workspaceName ?? credential.workspaceId }`. Every one of the 11 commands calls this, directly or through `resolveEnvTarget`.

External service: the engine's credential store (local disk, read through the engine).

### Listing the workspace's projects

`listWorkspaceProjects(ctx, workspace)` in `packages/cli/src/v8/project/context.ts` is a one-line wrapper over `listRealWorkspaceProjects(ctx.api, workspace, ctx.signal)` in `packages/cli/src/controllers/project.ts` (line 1438). That function:

1. Issues `GET /v1/projects`.
2. **Throws** `projectApiError("Failed to list projects", …)` when the request returns an error or no data. The comment above it records why: without the check, a refused request and an empty workspace both arrived as an empty array, so `project list` printed "No projects found." and exited 0 while the API was refusing it.
3. Filters the returned rows to `project.workspace.id === workspace.id`. The API returns everything the credential can see; the workspace filter is applied in the CLI.
4. Maps each row to a `ProjectCandidate`: `id`, `name`, `url` (only when the field is a string), `defaultRegion` (only when the field is present), `slug` (or `null`), and the nested `workspace` object.
5. Sorts with `sortProjects` — by `name.localeCompare`, ties broken by `id.localeCompare`.

External service: the Management API.

### Resolving which project a command acts on

Two entry points, both in `packages/cli/src/lib/project/resolution.ts`:

- `resolveProjectTarget(options)` (line 155) — used when the command *must* have a project. Reached from `resolvePinnedProject` in `packages/cli/src/v8/project/context.ts`.
- `inspectProjectBinding(options)` (line 185) — used by `project show`, which treats "no project" as a successful answer rather than an error.

Both follow the same order, in `resolveBoundProjectTarget` (line 590):

1. If `--project` was supplied, match it against the project list by exact `id` **or** exact `name`. Exactly one match is required: more than one raises `ProjectAmbiguousError`, none raises `ProjectNotFoundError`.
2. Otherwise, if an environment-supplied project id is allowed and present, match it by id. `resolveProjectTarget` allows this; `inspectProjectBinding` does not. No `project` command actually passes `envProjectId`, so this branch is currently unreachable from this group.
3. Otherwise read the local pin. A pin whose `workspaceId` differs from the active workspace raises `LocalProjectWorkspaceMismatchError`. A pin whose `projectId` is not in the listed projects raises `LocalStateStaleError`.
4. Otherwise there is no binding. `resolveProjectTarget` turns that into `ProjectSetupRequiredError`; `inspectProjectBinding` returns an "unbound" result instead.

The unbound result and the setup-required error both carry a `ProjectSetupSuggestion`, built by `buildProjectSetupSuggestion` (line 377):

- `inferTargetName(cwd, signal)` (line 525) reads `package.json`'s `name` field and uses it if it matches `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`; otherwise it falls back to `path.basename(cwd)`. The result records which of the two it used.
- `candidates` are the existing projects whose `id`, `name` or `slug` equals that inferred name.
- `recoveryCommands` are literal command strings: `prisma-cli project link <id-or-name>`, plus `prisma-cli <command> --project <id-or-name>` when a command name was supplied.

`projectResolutionErrorToCliError` (line 352) converts each tagged error into a legacy `CliError` with a code, a "why", a "fix" and next steps. Two variants deliberately keep throwing rather than converting: an aborted pin read and an unhandled exception.

External services: the Management API (via the injected `listProjects` callback), the local pin file, `package.json`, and the directory name.

### The local pin

`packages/cli/src/lib/project/local-pin.ts` owns the file format and all its errors.

- `readLocalResolutionPin(cwd, signal)` reads `.prisma/local.json`, returns `{ kind: "missing" }` on `ENOENT`, and otherwise parses the JSON and validates the shape. `isLocalResolutionPin` (line 419) requires **exactly two** keys, `workspaceId` and `projectId`, both non-empty strings — an extra key makes the file invalid.
- `writeLocalResolutionPin(cwd, pin, signal)` writes atomically: `mkdir .prisma`, write `local.<process.pid>.<Date.now()>.tmp`, then rename over `.prisma/local.json`. Each step has its own tagged error.
- `ensureLocalResolutionPinGitignore(cwd, signal)` reads `.gitignore`; creates it containing `.prisma/\n` when absent; otherwise appends `.prisma/\n` unless a trimmed line already equals `.prisma/` or `.prisma/local.json`.

Deleting the pin is not in this file. `cleanupLocalPinForProject` and `rewriteOrClearLocalPinForProject` in `packages/cli/src/controllers/project.ts` (lines 1033 and 1063) call `node:fs/promises`' `unlink` directly.

External services: the filesystem under the working directory, plus the clock and the process id (used only to name the temporary file).

### Error mapping and presentation helpers

`packages/cli/src/v8/project/errors.ts` maps the legacy `CliError` codes onto dotted v8 codes (`PROJECT_NOT_FOUND` becomes `PROJECT.NOT_FOUND`, and so on), with unmapped codes falling through as `PROJECT.<RAW_CODE>`. It also rewrites command text on the way out: `portCommandString` normalises `prisma …` and package-runner prefixes to `${CLI_NAME} …`, and `portFixText` replaces `--trace` with `--log-level verbose` and deletes the stale offer to "rerun the command in a TTY to sign in interactively".

`packages/cli/src/v8/project/presentation.ts` holds `toNextActions` (drops the legacy `journey` field and ports command strings), `localPinDiagnostics` (turns local-pin warning strings into `warn` diagnostics under `PROJECT.LOCAL_STATE_WRITE_FAILED`), and `setupPresentations` (the shared rendering for `project create` and `project link`).

### The legacy-context adapter

Several functions the v8 handlers still call take the old shell's `CommandContext`. `legacyOperationContext(ctx)` in `packages/cli/src/v8/project/context.ts` builds a fake one holding only `runtime.cwd`, `runtime.env` and `runtime.signal`, wrapped in a `Proxy` that **throws** if anything else is read. This is a deliberate tripwire: it names the missing field at the moment a legacy edit starts reading a fourth one, instead of failing later with `Cannot read properties of undefined`. Symbols and the `then` key pass through so promise resolution does not trip it.

The functions reached through this adapter are: `resolveProjectTarget`, `inspectProjectBinding`, `cleanupLocalPinForProject`, `rewriteOrClearLocalPinForProject`, `resolveEnvWriteInput`, `runEnvAddFile` and `runEnvUpdateFile`.

---

## Per-command detail

### `project list`

**Handler:** `packages/cli/src/v8/project/list.ts`.

**What the handler itself does**

1. *Business logic* — `resolveActiveWorkspace(ctx)`.
2. *Business logic* — lists the workspace's projects, then sorts them with `sortProjects`. They arrive already sorted from `listRealWorkspaceProjects`, so this second sort has no effect.
3. *Business logic* — classifies the directory's binding through `readProjectListLocalBinding`.
4. *Business logic* — maps candidates to `ProjectSummary` with `toProjectSummary`, dropping `slug` and the nested workspace.
5. *Presentation* — builds four output lanes: human blocks (a summary line, a workspace field row, then either an empty-state list or a table with columns `name`, `id`, `region`), tab-separated stdout rows, a json envelope, and next actions.
6. *Presentation* — the human table prints `none` for a project with no default region; the stdout lane prints an empty cell instead. This is the only difference between the two row builders.
7. *Presentation* — next actions are empty when the directory is linked; otherwise `buildProjectSetupNextActions` is called with a reason that differs for an invalid pin versus no pin at all.

**What it calls, in order**

| Call | File |
| --- | --- |
| `resolveActiveWorkspace` | `packages/cli/src/v8/resources-shared/workspace.ts` |
| `listWorkspaceProjects` → `listRealWorkspaceProjects` | `packages/cli/src/v8/project/context.ts` → `packages/cli/src/controllers/project.ts:1438` |
| `sortProjects` | `packages/cli/src/lib/project/resolution.ts:547` |
| `readProjectListLocalBinding` → `readLocalResolutionPin` | `packages/cli/src/controllers/project.ts:106` → `packages/cli/src/lib/project/local-pin.ts:166` |
| `toProjectSummary` | `packages/cli/src/lib/project/setup.ts:147` |
| `serializeProjectList` | `packages/cli/src/presenters/project.ts:92` |
| `buildProjectSetupNextActions`, `toNextActions` | `packages/cli/src/lib/project/resolution.ts:431`, `packages/cli/src/v8/project/presentation.ts` |
| `mapProjectOperationError` (on failure) | `packages/cli/src/v8/project/errors.ts` |

`readProjectListLocalBinding` is worth stating precisely, because it is the only place this classification exists. A pin that reads cleanly and is `present` is `linked` when **both** its `workspaceId` equals the active workspace and its `projectId` appears in the listed projects; otherwise it is `invalid`. A missing pin is `not-linked`. Invalid JSON or an invalid shape is `invalid`. An aborted read is rethrown.

**Where the business logic sits** — almost none in the handler. The API call, the workspace filter and the failure check are in `controllers/project.ts`; the sort and the setup suggestion are in `lib/project/resolution.ts`; the binding classification is in `controllers/project.ts`. The handler contributes the ordering of those four calls and the whole of the presentation.

**External services** — Management API; credential store; local pin file.

### `project show`

**Handler:** `packages/cli/src/v8/project/show.ts`.

**What the handler itself does**

1. *Input parsing* — reads one optional flag, `--project`.
2. *Business logic* — `resolveActiveWorkspace(ctx)`.
3. *Business logic* — one call to `inspectProjectBinding`, which does everything described in "Resolving which project a command acts on" above, including listing the projects, reading the pin, and building the setup suggestion when nothing is bound.
4. *Presentation* — two field-row builders. The human one shortens the working directory to `~/…` with `shortenHomePath(cwd, env)`, glues workspace and project into a single `platform` row formatted `workspace / project`, and prints the words `Not linked` when there is no project. The stdout one prints the raw path and one fact per line under the labels `local repo`, `workspace`, `project`, `url`, `region`. The comment in the file records this as a deliberate choice: three human affordances stay on the human side.
5. *Presentation* — when unbound, next actions come from `buildProjectSetupNextActions` seeded with the suggested project name.

**What it calls, in order**: `resolveActiveWorkspace`; `legacyOperationContext`; `inspectProjectBinding` (`packages/cli/src/lib/project/resolution.ts:185`), which itself calls `readImplicitLocalPin` → `readLocalResolutionPin`, then `listWorkspaceProjects` → `listRealWorkspaceProjects`, then `resolveBoundProjectTarget`, and on the unbound path `buildProjectSetupSuggestion` → `inferTargetName` → `readPackageName`; `projectResolutionErrorToCliError`; `shortenHomePath` (`packages/cli/src/lib/fs/home-path.ts`); `mapProjectOperationError`.

**Where the business logic sits** — effectively all of it is in `lib/project/resolution.ts`. The handler is one flag, one call, and rendering.

**External services** — Management API; credential store; local pin file; `package.json`; the directory name; environment variables (`HOME`, `USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, read for the `~` shortening).

### `project create`

**Handler:** `packages/cli/src/v8/project/create.ts`.

**What the handler itself does**

1. *Input parsing* — one required positional `name` and one optional `--region`.
2. *Business logic* — `resolveActiveWorkspace(ctx)`.
3. *Input validation* — `isValidProjectSetupName(name)` (non-empty after trimming). Failure raises `projectSetupNameRequiredError("project create")`, a usage error.
4. *Input parsing* — `name.trim()`.
5. *Business logic* — `createAppProvider(ctx.api).createProject({ name, region, signal })`.
6. *Business logic* — the failure handler around that call. If `ctx.signal.aborted`, it rethrows `ctx.signal.reason` so the engine settles the run as cancelled. The comment explains why: the provider flattens the underlying `AbortError` into a plain `Error`, which the engine would otherwise report as a bug. Otherwise it raises `projectCreateFailedError`, which extracts an HTTP status from the error (a numeric `statusCode` or `status` field, or a `(HTTP ###)` substring in the message) and chooses the permission-flavoured fix for 401 and 403.
7. *Business logic* — `bindDirectoryToProject(ctx, workspace, summary, "created")`: writes the pin, then makes sure `.gitignore` covers it, then returns a result describing what happened.
8. *Presentation* — `setupPresentations`: a "Created Project …" line, a "Linked … to Project …" line, a "Saved .prisma/local.json" line, the json body (an identity function over the result), and one next action, `prisma-cli app deploy`.

**What it calls, in order**: `resolveActiveWorkspace`; `isValidProjectSetupName` and `projectSetupNameRequiredError` (`packages/cli/src/lib/project/setup.ts`); `createAppProvider` (`packages/cli/src/lib/app/app-provider.ts:281`, which calls the compute SDK's `createProject` and unwraps its `Result`); `projectCreateFailedError` (`packages/cli/src/lib/project/setup.ts:170`); `bindDirectoryToProject` (`packages/cli/src/v8/project/context.ts:98`) → `writeLocalResolutionPin` and `ensureLocalResolutionPinGitignore` (`packages/cli/src/lib/project/local-pin.ts`), with failures passed to `projectDirectoryBindingErrorToCliError`; `serializeProjectSetup`; `mapProjectOperationError`.

**Where the business logic sits** — split. The handler holds the cancellation rule and the ordering. Creation is in `lib/app/app-provider.ts`, error classification is in `lib/project/setup.ts`, and the pin write is in `v8/project/context.ts` plus `lib/project/local-pin.ts`. Note that `bindDirectoryToProject` in `v8/project/context.ts` is a near-copy of `bindProjectToDirectory` in `lib/project/setup.ts:59`; the differences are that the v8 one always uses `ctx.cwd` and always formats the directory as `./<basename>`, while the legacy one can bind an ancestor directory and shortens a home-relative path.

**External services** — Management API (through the compute SDK); credential store; local pin file; `.gitignore`; the clock and process id (temporary file name); the abort signal.

### `project link`

**Handler:** `packages/cli/src/v8/project/link.ts`.

**What the handler itself does**

1. *Input parsing* — one optional positional, the project id or name; trimmed.
2. *Business logic* — `resolveActiveWorkspace(ctx)`, then lists the workspace's projects. The list is fetched unconditionally, even when a positional was supplied, because the positional has to be resolved against it.
3. *Business logic, with a positional* — `resolveProjectForSetup(ref, projects, workspace)` (`packages/cli/src/lib/project/setup.ts:42`): exact match on id or name; more than one match raises the ambiguous error; none raises the not-found error. Then bind with action `linked`.
4. *Presentation and business logic mixed, without a positional* — `pickProject`. It builds the choice list itself (`choiceOptions`): sorts the projects, finds names that appear more than once, and labels those `name (id)` so they can be told apart; puts `+ Create a new Project` first and `Cancel` last; uses the sentinel values `__create__` and `__cancel__`. It then calls `ctx.prompt.select("Which Project should this directory use?", …)`.
5. *Business logic* — `Cancel` raises `setupCanceledError()`, a usage error. A returned value matching no project also raises it.
6. *Business logic* — `+ Create a new Project` calls `inferTargetName(ctx.cwd, ctx.signal)` for a default, prompts with `ctx.prompt.text("Project name", { placeholder, default })`, applies the same `isValidProjectSetupName` rule the `create` command applies to its positional, then calls `createProjectForLink` (the same provider call and the same cancellation handling as `project create`, with one extra next step naming the project), then binds with action `created`.
7. *Presentation* — `setupPresentations`, as for `create`.

**Where the business logic sits** — the largest share of any command in the group sits in the handler: the picker's shape, the create-versus-link branch, the cancellation rules and the sentinel handling are all in `v8/project/link.ts`. Project matching is in `lib/project/setup.ts`; project creation is in `lib/app/app-provider.ts`; binding is in `v8/project/context.ts`.

**Note on duplication** — `packages/cli/src/lib/project/interactive-setup.ts` already implements this picker for the legacy shell, and the two now differ. The legacy one falls back to the suggested name when the typed name is blank (`rawName.trim() || suggestedName.name`) and validates through `validateProjectSetupNameText`; the v8 one rejects a blank name outright. The legacy one records `targetName` and `targetNameSource` (`prompt` versus the inferred source) on its result; the v8 one drops both. The legacy one has a dedicated non-interactive error, `PROJECT_LINK_TARGET_REQUIRED` (`packages/cli/src/controllers/project.ts:493`), carrying candidates and a suggested name in its metadata; the v8 one relies on the engine's prompt surface failing when it cannot prompt.

**External services** — Management API; credential store; prompts (select and text); local pin file; `.gitignore`; `package.json`; the directory name; the clock and process id; the abort signal.

### `project rename`

**Handler:** `packages/cli/src/v8/project/rename.ts`.

**What the handler itself does**

1. *Input parsing* — a required positional `name` and an optional `--project`; the name is trimmed.
2. *Input validation* — `isValidProjectSetupName(name)`, else `projectSetupNameRequiredError("project rename")`.
3. *Business logic* — `resolvePinnedProject(ctx, workspace, args.flags.project, "project rename")` (`packages/cli/src/v8/project/context.ts:77`), which wraps `resolveProjectTarget` and converts its tagged errors. This is the `--project`, then pin, then setup-required order described above.
4. *Business logic* — `createManagementProjectProvider(ctx.api).renameProject({ projectId, name, signal })` (`packages/cli/src/lib/project/provider.ts:42`): `PATCH /v1/projects/{id}`. A 400 or 422 becomes `projectRenameFailedError`, which prefers the API's own message and hint; anything else that fails becomes `projectApiError`.
5. *Business logic* — assembles `{ workspace, project: renamed, previousName: target.project.name }`. The previous name is captured before the rename so the output can report it.
6. *Presentation* — a human-only presentation: a summary line, three field rows, and a sentence explaining that directory bindings pin the project id so they stay valid. There is no `stdout` or `json` lane declared.

**Where the business logic sits** — resolution in `lib/project/resolution.ts`, the API call and its error classification in `lib/project/provider.ts`. The handler holds the name check and the "remember the previous name" step.

**External services** — Management API; credential store; local pin file; `package.json` and the directory name (only when resolution fails and the setup suggestion is built).

### `project remove`

**Handler:** `packages/cli/src/v8/project/remove.ts`.

**What the handler itself does**

1. *Input parsing* — a required positional, trimmed.
2. *Business logic* — `resolveActiveWorkspace`, then lists projects, then `resolveProjectForSetup`. Note that `remove` deliberately does **not** use the pin: it always requires an explicit id or name.
3. *Business logic* — `ctx.prompt.consent(CONSENT_QUESTION, { token: project.id })`. The engine's consent surface makes the user type the project id interactively, and accepts `--confirm <id>` non-interactively. This replaces the legacy `requireProjectExactConfirmation` (`packages/cli/src/controllers/project.ts:958`), which compared the `--confirm` string to the id itself and raised `CONFIRMATION_REQUIRED` with exit code 2.
4. *Business logic* — `createManagementProjectProvider(ctx.api).removeProject({ projectId, signal })`: `DELETE /v1/projects/{id}`. A 400 becomes `projectRemoveBlockedError` ("the project still has active deployments"); anything else that fails becomes `projectApiError`.
5. *Business logic* — `cleanupLocalPinForProject(legacyOperationContext(ctx), project.id, { onError })` (`packages/cli/src/controllers/project.ts:1033`). It reads the pin; if the pin is absent, unreadable, or names a different project it returns `false` and does nothing. Otherwise it unlinks `.prisma/local.json`; a failed unlink pushes a warning string through `onError` and returns `false`.
6. *Presentation* — human-only blocks; the "This directory's local project binding was cleared." line appears only when the pin was actually removed. Warnings become warn diagnostics through `localPinDiagnostics`.

**Where the business logic sits** — the API call in `lib/project/provider.ts`, the pin cleanup in `controllers/project.ts`, project matching in `lib/project/setup.ts`. The handler owns the consent step, the order, and the warnings-to-diagnostics conversion.

**External services** — Management API; credential store; prompts (consent); local pin file.

### `project transfer`

**Handler:** `packages/cli/src/v8/project/transfer.ts`. The most involved command in the group.

**What the handler itself does**

1. *Input parsing* — a required positional plus `--to-workspace` and `--recipient-token`. Both flags are normalised once with `?.trim() || undefined`, with a comment explaining why: an all-whitespace value must not read as supplied to one check and absent to the next.
2. *Input validation* — both flags together raise a usage error; neither raises `transferRecipientRequiredError` (`packages/cli/src/controllers/project.ts:984`).
3. *Business logic* — `resolveActiveWorkspace`, list projects, `resolveProjectForSetup`. Like `remove`, this never uses the pin.
4. *Business logic* — `ctx.prompt.consent(…, { token: project.id })`.
5. *Business logic* — `resolveRecipient`. With `--recipient-token`, the token is used as-is and the recipient's workspace id and name stay `null`. Otherwise, if `ctx.env.PRISMA_SERVICE_TOKEN` is set, it raises `transferRecipientUnavailableError`, because `--to-workspace` resolves locally stored OAuth sessions and service-token mode does not read them. Otherwise it calls `resolveRecipientWorkspaceSession(workspaceRef, ctx.env, ctx.signal)`.
6. *Business logic* — `createManagementProjectProvider(ctx.api).transferProject({ projectId, recipientAccessToken, signal })`: `POST /v1/projects/{id}/transfer`. A 400 becomes `projectTransferRejectedError`.
7. *Business logic* — `rewriteOrClearLocalPinForProject(legacyOperationContext(ctx), project.id, recipient.workspaceId, { onError })` (`packages/cli/src/controllers/project.ts:1063`). If the pin names the transferred project and the recipient workspace id is known, the pin is rewritten to point at the recipient workspace and the outcome is `rewritten`. If the recipient workspace id is unknown (the `--recipient-token` path), the pin is unlinked and the outcome is `cleared`. Anything else, including a failed write or unlink, is `none`, with a warning pushed through `onError`.
8. *Presentation* — human-only blocks. The recipient row falls back through workspace name, then workspace id, then the literal text "workspace of the provided recipient token". The next action offers `auth workspace use <to-workspace>` only when `--to-workspace` was used.

`resolveRecipientWorkspaceSession` (`packages/cli/src/auth/recipient.ts:29`) deserves its own note because it is a **second credential path**, independent of `ctx.api`. It opens `FileTokenStorage` over the on-disk credential file, resolves the workspace reference to exactly one stored session, builds a second Management API SDK client pinned to that workspace (with `activateOnSetTokens: false` so the active workspace pointer is never moved), makes a cheap `GET /v1/workspaces` call to prove the session works and to trigger a token refresh if needed, and returns the refreshed access token. Its failures are translated in `recipientSourceError`: a `WorkspaceSelectionError` with reason `ambiguous` becomes `workspaceAmbiguousError` carrying the matches; any other `WorkspaceSelectionError` or a `RecipientSessionInvalidError` becomes `workspaceNotAuthenticatedError`.

**Where the business logic sits** — spread across four places. Flag exclusivity and the recipient-source choice are in the handler; the two recipient errors are in `controllers/project.ts`; the recipient session resolution is in `auth/recipient.ts`; the transfer call is in `lib/project/provider.ts`; the pin rewrite is in `controllers/project.ts`.

**External services** — Management API (twice: the signed-in client and the recipient-scoped client); the credential store, read twice — once through `ctx.activeCredential()` and once directly through `FileTokenStorage`; environment variables (`PRISMA_SERVICE_TOKEN`, and whatever `FileTokenStorage` and `getApiBaseUrl` read); prompts (consent); local pin file.

### `project env add`

**Handler:** `packages/cli/src/v8/project/env-add.ts`.

**What the handler itself does**

1. *Input parsing* — `resolveEnvWriteSource(assignment, file, "add")` (`packages/cli/src/controllers/app-env.ts:303`): rejects supplying both a positional and `--file`, rejects an empty `--file` value, rejects supplying neither, and otherwise returns either `{ kind: "file", filePath }` or `{ kind: "single", rawAssignment }`.
2. *Input parsing* — `requireEnvScope(args.flags, "add")` (`packages/cli/src/v8/project/env-shared.ts:44`) → `resolveEnvScope(…, { requireExplicit: true })` (`packages/cli/src/lib/app/env-config.ts:27`): rejects `--role` and `--branch` together, rejects an unknown role, and — because `requireExplicit` is true — throws its own usage error when neither is given. Writing without an explicit scope is refused so the command never silently targets production.
3. *Input parsing* — `resolveEnvWriteInput(legacyOperationContext(ctx), source, "add")` (`packages/cli/src/controllers/app-env.ts:350`). For a file it calls `readEnvFileAssignments(cwd, path, "add")` (`packages/cli/src/lib/app/env-file.ts:23`), which reads the file and rejects: an unreadable file, a file with no assignments, an invalid key, a duplicate key (naming both line numbers), and an empty value. It tracks multi-line quoted values so a value spanning several lines is not mistaken for more assignments. For a single assignment it calls `parseKeyValuePositional(raw, "add", ctx.env)`, which splits on the first `=`, validates the key against `^[A-Z_][A-Z0-9_]*$` and a 256-character cap, rejects an empty value, and — for a bare `KEY` with no `=` — **reads the value out of the process environment**, erroring when it is unset or empty.
4. *Business logic* — `resolveEnvTarget(ctx, flags, scope, "project env add", true)` (`packages/cli/src/v8/project/env-shared.ts:71`): resolve the workspace, resolve the pinned project, then `resolveScopeToApi(ctx.api, projectId, scope, { createBranchIfMissing: true, signal })`.
5. *Business logic, file path* — `runEnvAddFile(legacyCtx, ctx.api, projectId, resolved, filePath, assignments, verboseContext)` (`packages/cli/src/controllers/app-env-file.ts:28`).
6. *Business logic, single path, written in the handler itself* — `findVariableByNaturalKey` to check the key does not already exist, raising an `ENV_VARIABLE_ALREADY_EXISTS` `CliError` constructed inline if it does; then, only for a branch scope, a second `findVariableByNaturalKey` against preview-with-no-branch to decide whether to warn that the key has no preview default; then `ctx.api.POST("/v1/environment-variables", …)` **called directly from the handler**, with `apiCallError` on failure; then `toMetadata`.
7. *Presentation* — `fileWritePresentations` for the file path, `singlePresentations` for the single path, and `previewDefaultDiagnostics` turning the warnings into `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` warn diagnostics.

`resolveScopeToApi` (`packages/cli/src/controllers/app-env.ts:560`) is where the branch rules live. A role scope maps straight to `{ class: role, branchId: null }`. A branch scope calls `resolveOrCreateBranch`, which looks the branch up by git name and, if it is missing, first checks that the project already has a default branch — refusing with `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` if not, because creating the first branch would make it the default and branch overrides are preview-only — then creates it, handling a 409 by re-reading the branch (another process created it first). A resolved branch whose role is `production` is rejected with `ENV_BRANCH_SCOPE_IS_PRODUCTION`.

`runEnvAddFile` looks up every key first, refuses the whole import if **any** key already exists (with next steps telling the user to split the file into `.existing` and `.new` halves), computes the missing-preview-default warnings for a branch scope, then POSTs each assignment one at a time in file order. A failure part-way through raises `ENV_FILE_APPLY_FAILED`, whose message names the keys that were already written — the import is not transactional and the error says so.

**Where the business logic sits** — split roughly in half. Input parsing is entirely in `controllers/app-env.ts` and `lib/app/env-file.ts`. Scope-to-API resolution and branch creation are in `controllers/app-env.ts`. The file path is entirely in `controllers/app-env-file.ts`. But the single-assignment path — the existence check, the preview-default warning and the actual `POST` — is written in the handler.

**External services** — Management API; credential store; local pin file; the dotenv file; the process environment (for a bare `KEY`).

### `project env update`

**Handler:** `packages/cli/src/v8/project/env-update.ts`. The same shape as `env add`, with four differences:

1. `resolveEnvTarget(…, false)` — `createBranchIfMissing` is false, so a branch that does not exist raises `ENV_BRANCH_NOT_FOUND` from `resolveExistingBranch` rather than being created.
2. The single path requires the variable to exist and raises `ENV_VARIABLE_NOT_FOUND` when it does not, with a next step pointing at `project env add`.
3. The write is `ctx.api.PATCH("/v1/environment-variables/{envVarId}", { body: { value } })`, again called directly from the handler.
4. There are no preview-default warnings on either path: `runEnvUpdateFile` returns `warnings: []`, and the handler's single path does not compute any.

`runEnvUpdateFile` (`packages/cli/src/controllers/app-env-file.ts:125`) mirrors `runEnvAddFile`: it looks every key up first and refuses the whole file if **any** key is missing, then PATCHes each one in order, reporting the keys written before a mid-file failure.

**Where the business logic sits** — the same division as `env add`.

**External services** — the same as `env add`.

### `project env list`

**Handler:** `packages/cli/src/v8/project/env-list.ts`.

**What the handler itself does**

1. *Input parsing* — `resolveEnvScope({ role, branch }, { requireExplicit: false, command: "list" })`. Because reading is allowed without a scope, this may return `null`.
2. *Business logic* — `resolveActiveWorkspace`, then `resolvePinnedProject(ctx, workspace, args.flags.project, "project env list")`.
3. *Business logic* — `resolveListScopeToApi(ctx.api, projectId, explicit ?? undefined, { cwd, signal })` (`packages/cli/src/controllers/app-env.ts:611`).
4. *Business logic* — either `listVariables` (a resolved scope) or `listOverviewVariables` (no scope at all).
5. *Business logic* — `toMetadata` per row.
6. *Presentation* — human blocks (a summary, a `target` field row built by `listTargetLabel`, then either an empty-state list or a table with columns `variable`, `id`, `status`), tab-separated stdout rows, a json envelope from `serializeEnvList`, and — when the scope is empty — one next action suggesting `project env add KEY=value <scope flag>`.
7. *Presentation* — the human table's first cell is `KEY (source)`; the stdout lane prints the bare key. The comment records the reason: a consumer piping the output should not have to split on `" ("` to recover the key, and the source is available in the json record.

`resolveListScopeToApi` is the interesting part, and it is entirely outside the handler. With an explicit scope it delegates to `resolveScopeToApi` without branch creation. Without one it reads the checked-out git branch through `readLocalGitBranch(cwd, signal)` (`packages/cli/src/lib/git/local-branch.ts:10`), which walks up from the working directory to the nearest `.git` — handling both a real directory and a worktree file containing `gitdir:` — and parses `HEAD`, returning `null` for a detached head. It then picks one of four outcomes:

- A git branch that the platform does not know about — report the `preview` role, but label the target `branch:<name> -> preview (not created yet)` and make the suggested add-scope the branch.
- A git branch that is the project's production branch — report the `production` role.
- Any other known git branch — report that branch's own override scope.
- No git branch at all — report the `overview` scope.

`listVariables` (line 878) pages through `GET /v1/environment-variables` with a cursor, filters to the scope, and then calls `materializeEffectiveRows`, which computes what a branch would actually see: the role-level rows keyed by name, with the branch's own rows overlaid on top, sorted by key. `listOverviewVariables` (line 897) keeps only project-level rows (`branchId === null`) of either class and sorts production before preview, then by key.

**Where the business logic sits** — all of it outside the handler, in `controllers/app-env.ts` and `lib/git/local-branch.ts`. The handler is the scope flag, the ordering of three calls, and the rendering.

**External services** — Management API; credential store; local pin file; the git checkout (`.git/HEAD`, read as a file — the git binary is never run).

### `project env remove`

**Handler:** `packages/cli/src/v8/project/env-remove.ts`.

**What the handler itself does**

1. *Input parsing* — a required positional `key`. It is **not** trimmed, and `validateKey` is never called on this path, so the key-shape rule that `add` and `update` enforce does not apply here. An invalid key simply fails to match and produces "not found".
2. *Input parsing* — `requireEnvScope(args.flags, "remove")`, so a scope is required for removal too.
3. *Business logic* — `resolveEnvTarget(ctx, flags, scope, "project env remove", false)`.
4. *Business logic* — `findVariableByNaturalKey`; a missing variable raises an `ENV_VARIABLE_NOT_FOUND` `CliError` constructed inline in the handler, with a next step pointing at `project env list` in the same scope.
5. *Business logic* — `ctx.api.DELETE("/v1/environment-variables/{envVarId}")`, called directly from the handler, with `apiCallError` on failure.
6. *Presentation* — human-only blocks: a summary line and three field rows (project, scope, key).

**Where the business logic sits** — scope resolution is in `controllers/app-env.ts`; the lookup is in `controllers/app-env-api.ts`; the delete call and the not-found error are in the handler.

**External services** — Management API; credential store; local pin file.

---

## Where the business logic actually sits: the summary

| Command | Handler | `controllers/` | `lib/` | Provider or SDK |
| --- | --- | --- | --- | --- |
| `project list` | ordering, presentation | project listing, pin classification | sorting, next actions | — |
| `project show` | presentation | — | all resolution and the setup suggestion | — |
| `project create` | cancellation rule, ordering | — | name check, error classification, pin write | project creation |
| `project link` | picker, create-versus-link branch, cancellation | — | project matching, name inference | project creation |
| `project rename` | name check, previous-name capture | — | resolution | rename call and its errors |
| `project remove` | consent, ordering, diagnostics | pin cleanup | project matching | remove call and its errors |
| `project transfer` | flag exclusivity, recipient-source choice | recipient errors, pin rewrite | project matching | transfer call; recipient session in `auth/recipient.ts` |
| `project env add` | existence check, preview warning, the `POST` | input parsing, scope and branch resolution, the whole file path | dotenv parsing, key validation | — |
| `project env update` | existence check, the `PATCH` | input parsing, scope resolution, the whole file path | dotenv parsing, key validation | — |
| `project env list` | presentation | scope resolution, listing, effective-row overlay | git branch reading | — |
| `project env remove` | not-found error, the `DELETE` | scope resolution, lookup | — | — |

In proportion: for seven of the eleven commands (`list`, `show`, `rename`, `remove`, `transfer`, `env list`, and most of `env add`/`env update`) the great majority of the business logic already sits outside the handler, in `controllers/project.ts`, `controllers/app-env*.ts`, `lib/project/*` and `lib/app/*`. The handlers contribute call ordering, error mapping and presentation. The exceptions, where real decisions are written in the handler, are:

- `project link` — the whole interactive picker and the branch between creating and linking.
- `project env add` and `project env update` — the single-assignment path's existence check and the API write itself.
- `project env remove` — the not-found error and the API write.
- `project create` and `project link` — the cancellation rule around the provider call.
- `project transfer` — the recipient-source choice.
- `project remove` and `project transfer` — the consent step.

None of the existing logic is organised as a use case with injected services. It is organised as free functions that each take whatever they need — a `ManagementApiClient`, a `cwd`, an `AbortSignal`, or a whole legacy `CommandContext`.

---

## The existing use case: `packages/cli/src/use-cases/project.ts`

### What it does

`createProjectUseCases({ projectGateway })` returns two methods:

- `list(authState)` — checks `authState.authenticated` and `authState.workspace`, then returns `{ workspace, projects }`, where the projects come from `projectGateway.listProjectsForWorkspace(workspace.id)`, sorted by name then id, and mapped through a private `toProjectSummary`.
- `listProjectsForWorkspace(workspaceId)` — the same list for an arbitrary workspace id. **Nothing calls it.** A search of `packages/cli` finds no caller anywhere, including tests.

The file also exports `projectNotFoundError`, which is **also uncalled** — every `projectNotFoundError` import in the codebase resolves to the identically named function in `packages/cli/src/lib/project/resolution.ts`.

The single gateway, `ProjectGateway` (`packages/cli/src/use-cases/contracts.ts:66`), has three synchronous methods that return plain records: `listProjectsForWorkspace`, `getProject`, `getProjectForWorkspace`. It is implemented in exactly one place for production use, `createCliUseCaseGateways` (`packages/cli/src/use-cases/create-cli-gateways.ts`), which forwards each method straight to `context.api` — and in that legacy code path `context.api` is the `MockApi` fixture reader (`packages/cli/src/adapters/mock-api.ts`), not an HTTP client.

The only production caller is `runProjectList` in `packages/cli/src/controllers/project.ts:188`, inside the `else` branch of `if (isRealMode(context))`. `isRealMode` is false only when `--fixture` or `PRISMA_CLI_MOCK_FIXTURE_PATH` is set. **The use case therefore only ever runs in fixture mode**, and no v8 handler reaches it at all: `packages/cli/src/v8/project/context.ts` always calls `listRealWorkspaceProjects(ctx.api, …)`.

### How its behaviour differs from what `project list` ships

| # | Difference | Verdict |
| --- | --- | --- |
| 1 | **No failure mode.** The gateway is synchronous and cannot fail. `listRealWorkspaceProjects` throws `projectApiError` when the request errors or returns no data; the comment above that check records that without it a refused request and an empty workspace both printed "No projects found." and exited 0. The use case cannot express the difference, and there is nowhere in `ProjectGateway` for it to appear. | **Genuine disagreement.** This is the sharpest one. A use case built on this gateway shape cannot ship the behaviour the CLI has today, and there is a v8 test pinning that behaviour ("surfaces a rejected projects request instead of an empty list", `packages/cli/tests/v8-project.test.ts:266`). |
| 2 | **Different error when there is no workspace.** The use case's `requireWorkspace` throws `authRequiredError()` — code `AUTH_REQUIRED`, summary "Authentication required", why "This command needs an authenticated session." The shipped v8 path throws `AUTH.USAGE_ERROR` with summary "Workspace required" and why "This command needs an active workspace, but the authenticated session does not have one." The legacy real-mode path throws `workspaceRequiredError()`, a usage error with the same wording. | **Genuine disagreement.** The use case tells a signed-in user with no workspace selected that they are not signed in. |
| 3 | **Different source for the workspace.** The use case takes an `AuthStateResult` argument, assembled by the auth controller. The v8 handler reads `ctx.activeCredential()` and falls back to the workspace id when the credential carries no workspace name. | **Genuine difference**, though a mild one: the use case cannot see the engine's credential, so it has to be handed a workspace by someone who can. |
| 4 | **Where the workspace filter happens.** The shipped path asks for every project the credential can see and filters in the CLI on `project.workspace.id === workspace.id`. The gateway is asked for one workspace's projects and the fixture filters on `project.workspaceId`. | **Fixture artifact.** Same intent, different placement. Worth noting because a real gateway would have to decide which side owns the filter. |
| 5 | **`defaultRegion` is never present.** The use case's private `toProjectSummary` copies `defaultRegion` when it is not null, but the fixture's project records (`packages/cli/src/adapters/mock-api.ts:28` and `packages/cli/fixtures/mock-api.json`) have no such field, so the region column would always read "none". The real path carries it whenever the API returns it. | **Fixture artifact** in the data. But note the use case has its own private copy of `toProjectSummary` instead of importing the one in `lib/project/setup.ts`, so the two can drift. |
| 6 | **`slug` is dropped.** `listRealWorkspaceProjects` carries `slug` on each candidate, and `projectMatchesSuggestedName` in `lib/project/resolution.ts` matches on it when building the setup suggestion. `ProjectSummary`, which is what the use case returns, has no `slug`. | **Genuine limitation** for anything beyond `list`. It does not affect `project list` itself, which only shows name, id and region, but it means this use case's return type cannot feed `project show`'s suggestion logic. |
| 7 | **Sorting is duplicated, not shared.** Both sort by `name.localeCompare` then `id.localeCompare`. The shipped path calls `sortProjects` from `lib/project/resolution.ts`; the use case inlines the same comparator in `listSortedWorkspaceProjects`. | **No behavioural difference**, but duplicated code that can drift. |
| 8 | **`localBinding` is missing.** The use case returns a `ProjectListResult` and never fills in its optional `localBinding` field; the caller computes it afterwards with `readProjectListLocalBinding` and merges it in. The v8 handler does exactly the same thing. | **Consistent with what ships**, but it means the use case's declared return type promises something it never delivers, and the directory-binding decision — genuinely business logic — sits outside the use case in both paths. |
| 9 | **Next actions are absent.** Both the legacy controller and the v8 handler build the setup next actions from `localBinding`, with slightly different reason strings for an invalid pin versus no pin. The use case has none of this. | **Consistent with what ships.** See "What resists the split" below for why this is not simply an oversight. |

Summary: of the nine differences, three are genuine behavioural disagreements (no failure mode, the wrong error for a missing workspace, and the missing `slug`), two are fixture artifacts (the filter placement and the absent `defaultRegion`), and four are code-organisation observations rather than behaviour.

The one that matters most for a decision is the first. `ProjectGateway` is shaped as a synchronous in-memory reader. That shape is not a stylistic choice that can be adjusted later — it is what makes the use case unable to represent a failed request, which is the exact defect the shipped code carries a comment about having fixed.

---

## Candidate port list

The smallest set of injected interfaces that covers every external service the 11 commands touch. Each entry names what would be behind it.

1. **`ProjectCatalog`** — the platform's project surface.
   - `list(workspaceId)` → the project records, including `slug`, `url` and `defaultRegion`; **fails loudly** when the request is refused.
   - `create({ name, region })`
   - `rename(projectId, name)`
   - `remove(projectId)`
   - `transfer(projectId, recipientAccessToken)`
   - Today: `listRealWorkspaceProjects` in `controllers/project.ts`, `createAppProvider(...).createProject` in `lib/app/app-provider.ts`, and `createManagementProjectProvider` in `lib/project/provider.ts`. Note that creation currently goes through a different client (the compute SDK) than the other four.

2. **`BranchCatalog`** — needed only by the env commands, but genuinely separate from projects.
   - `findByGitName(projectId, gitName)`
   - `hasDefaultBranch(projectId)` (paged)
   - `create(projectId, gitName)` (must surface a 409 so the caller can re-read)
   - Today: `listBranchesByName`, `projectHasDefaultBranch`, `resolveOrCreateBranch` in `controllers/app-env.ts`.

3. **`EnvironmentVariableStore`**
   - `findByKey({ projectId, class, branchId, key })`
   - `listAll({ projectId, class? })` — paged; the caller filters
   - `create({ projectId, class, branchId, key, value })`
   - `updateValue(id, value)`
   - `delete(id)`
   - Today: `findVariableByNaturalKey` and `toMetadata` in `controllers/app-env-api.ts`, `collectEnvironmentVariables` in `controllers/app-env.ts`, and raw `ctx.api` calls written inside four handlers.

4. **`WorkspaceSession`** — everything about who this run is, and who it can act on behalf of.
   - `active()` → `{ id, name } | null`
   - `usingServiceToken()` → boolean (transfer needs this to explain why `--to-workspace` is unavailable)
   - `resolveRecipient(workspaceRef)` → `{ workspace, accessToken }`, or an ambiguous / not-authenticated failure
   - Today: `ctx.activeCredential()` in the engine, `ctx.env.PRISMA_SERVICE_TOKEN`, and `resolveRecipientWorkspaceSession` in `auth/recipient.ts`.

5. **`ProjectDirectory`** — every fact about, and edit to, the directory the user ran the command in. All of it is filesystem access rooted at `cwd`.
   - `readPin()` → missing, present, or invalid (invalid JSON and invalid shape distinguished, because `project list` maps both to `invalid` while resolution maps both to "stale")
   - `writePin(pin)`, `deletePin()`, `ensurePinIgnoredByGit()`
   - `inferredProjectName()` → the `package.json` name when it is usable, else the directory name, with the source recorded
   - `currentGitBranch()` → the checked-out branch name, or null
   - `readDotenv(path)` → the validated assignments
   - `displayName()` → the `./<basename>` or `~/…` forms the output uses
   - This could reasonably be split into three (`LocalProjectPin`, `DirectoryHints`, `DotenvFile`). One port is defensible because every method is a read or write of the same directory, and every command in the group needs at least one of them. The clock and the process id, used only to name the pin's temporary file, stay inside the adapter and do not need ports of their own.

6. **`Prompts`** — `select`, `text`, `consent`. Already provided by the engine as `ctx.prompt`; a use case would need it injected as a narrow interface rather than as the whole context.

That is six ports. The abort signal is not one of them: it is a parameter every method already takes.

Two things the list deliberately does **not** include. There is no port for "the Management API client", because a raw `ManagementApiClient` is a transport, not a service the domain understands — passing it through would make every use case know about HTTP paths and response envelopes. And there is no port for the process environment as a whole; the three things actually read from it (a bare `KEY`'s value, `PRISMA_SERVICE_TOKEN`'s presence, and the home directory) each belong to one of the ports above.

---

## What resists the split

### Command strings inside domain errors

`buildProjectSetupNextActions` (`lib/project/resolution.ts:431`) and `ProjectSetupSuggestion.recoveryCommands` embed literal command lines — `prisma-cli project link <id-or-name>`, `prisma-cli project list`, `prisma-cli <command> --project <id-or-name>`. They are built deep inside error construction, and then `v8/project/errors.ts` rewrites them on the way out (`portCommandString` normalises the program name, `portFixText` swaps `--trace` for `--log-level verbose` and deletes an offer to sign in interactively that v8 cannot honour).

A use case that returns command strings is naming the shell it runs in, and the rewriting on the way out is evidence that the strings are already wrong for the current shell. The clean version has the use case return a reason plus a symbolic action ("link an existing project", "retry with an explicit project"), with the handler rendering the text. That means rewriting `buildProjectSetupNextActions` and everything that reaches it, including `projectSetupRequiredCliError`, which builds both `nextSteps` and `nextActions` inside the error object.

### The interactive picker in `project link`

`pickProject` is a use case with a question in the middle of it. The sentinel values `__create__` and `__cancel__`, the `+ Create a new Project` ordering, and the `name (id)` disambiguation for duplicate names are all presentation — but the answer decides whether the command creates a project or links an existing one, which is squarely business logic.

There is no clean way to move this without deciding one of two things: either the use case takes a "choose one of these" port (the abandoned `SelectPromptPort` in `use-cases/contracts.ts:105` was the first attempt at exactly this), or `project link` becomes two use cases — link-an-existing-project and create-and-link — with the handler asking the question and choosing between them. The second is simpler and keeps prompting in the shell, at the cost of the handler holding the branch.

Note also that the picker exists twice today, in `v8/project/link.ts` and `lib/project/interactive-setup.ts`, and the two have already drifted (see the `project link` section above).

### Consent

`ctx.prompt.consent(question, { token: project.id })` is what makes `--confirm <project-id>` work non-interactively — the engine reads the flag and matches it against the token. A use case cannot own that without owning argv. But the *wording* is domain knowledge: "Removing a project is permanent, deletes its databases, and stops its apps." The natural split is for the use case to declare that a consent is required and supply the sentence and the token, and for the handler to perform it — which means the use case's return type has to be able to say "I need consent before I can continue", or the handler has to know to ask before calling.

### The two output lanes

`project list`, `project show` and `project env list` each build two different renderings of the same data, and the differences are deliberate and documented in the code: `none` versus an empty cell for a missing region; `workspace / project` glued into one `platform` row versus two separate rows; a home directory shortened to `~` versus the raw path; `KEY (source)` versus the bare key. This is genuinely presentation and should stay in the handler. It is listed here only because it is the largest single body of code in several of these handlers, so moving the business logic out will not make the handlers small.

### Cancellation

`project create` and `project link` both inspect `ctx.signal.aborted` and rethrow `ctx.signal.reason`, because the compute SDK's provider flattens an `AbortError` into a plain `Error` that the engine would otherwise report as a bug. A use case would have to carry the same workaround, or the adapter must stop flattening. The second is the right fix, and it belongs to the `ProjectCatalog` adapter.

### The legacy-context adapter

Seven functions the handlers call still take the old shell's `CommandContext`, reached through the `legacyOperationContext` proxy. Anything left behind that adapter cannot become a clean use case without first being rewritten to take explicit arguments. In practical terms this is the migration cost: `resolveProjectTarget`, `inspectProjectBinding`, `cleanupLocalPinForProject`, `rewriteOrClearLocalPinForProject`, `resolveEnvWriteInput`, `runEnvAddFile` and `runEnvUpdateFile` all need new signatures.

### Input parsing that reads the world

`parseKeyValuePositional` (`lib/app/env-config.ts:83`) is an input parser, and it is correctly outside the handler — but for a bare `KEY` with no `=` it reads the value out of the process environment. It is therefore an input parser with an external dependency, and it cannot be classified as purely input-shaped. The same is true of `readEnvFileAssignments`, which is validation plus a file read.

---

## Smaller findings noticed along the way

These are observations, not defects the operator asked about. None of them changes the shape of the decision.

1. **Two unreachable error branches in scope handling.** `requireEnvScope` in `packages/cli/src/v8/project/env-shared.ts:44` calls `resolveEnvScope` with `requireExplicit: true`, which throws its own usage error when neither `--role` nor `--branch` is given, so the handler's own `if (!scope)` usage error at lines 53 to 61 can never run. Separately, `resolveEnvScope`'s "unknown role" usage error cannot be reached from v8 either, because `roleFlag` is declared as `flag.enum({ values: ["production", "preview"] })` and the engine rejects any other value before the handler starts.
2. **`project list` sorts twice.** `listRealWorkspaceProjects` returns an already-sorted list, and `packages/cli/src/v8/project/list.ts:88` sorts it again.
3. **`verboseContext` is computed and then discarded.** `resolveEnvTarget` builds a `verboseContext` (workspace, project, resolution) for every env write. The v8 handlers pass it to `runEnvAddFile` / `runEnvUpdateFile` because the legacy signature requires it, then rebuild their result without it. `project env remove` never uses it at all.
4. **`project env remove` does not validate the key.** The positional is used untrimmed and never passed through `validateKey`, unlike `add` and `update`. An invalid key produces "not found" rather than a usage error.
5. **Two dead exports in the use-case file.** `ProjectUseCases.listProjectsForWorkspace` and `projectNotFoundError`, both in `packages/cli/src/use-cases/project.ts`, have no callers.
6. **Presentation lanes are uneven.** `project list`, `project show` and `project env list` declare `human`, `stdout` and (for two of them) `json`. `project rename`, `remove`, `transfer`, `env add`, `env update` and `env remove` declare only `human`.
7. **Two near-duplicate binding functions.** `bindDirectoryToProject` (`v8/project/context.ts:98`) and `bindProjectToDirectory` (`lib/project/setup.ts:59`) do the same job with different directory handling.
