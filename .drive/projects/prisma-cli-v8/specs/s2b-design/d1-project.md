# D1 design — the project group (11 commands) + slice template

Binding design for dispatch D1. Parent: `conventions.md`. Grounding
fact sheet: `facts/facts-d1-project.md` (verbatim legacy extraction
with file:line references — the implementer treats it as part of this
doc). Corrections it makes to the inventory, all binding:
`PROJECT_AMBIGUOUS` is legacy exit 1 (not 2); `PRISMA_PROJECT_ID` is
never read by these commands; "WORKSPACE_REQUIRED" is a `USAGE_ERROR`
with summary "Workspace required".

## 0. Template work (this dispatch only)

1. **`v8/cli.ts` refactor**: extract module-level exported constants
   `platformCommandFamily` (the existing `defineCommandFamily` call,
   now including the auth entries + this dispatch's project entries),
   `mountedCommands`, `cliGroups`; `buildCli()` consumes them
   unchanged. No behavior change.
2. **`tests/v8-mount-coverage.test.ts`**: per conventions §10 —
   identity-based family↔mount coverage with the telemetry allowlist.
3. **`v8/resources-shared/workspace.ts`**:
   `resolveActiveWorkspace(ctx)` per conventions §3a (OPERATOR
   DECISION 1). Returns the legacy `AuthWorkspace` shape; throws the
   mapped `AUTH.USAGE_ERROR` "Workspace required" (copy per fact
   sheet §14.3) when absent.
4. **Legacy helper exports**: where a named legacy helper below is
   not currently exported from its file, add `export` to it — no
   body changes, no moves. Every such edit is listed in the PR
   description.

## 1. Group mounting

| group | brief (verbatim legacy description) |
| --- | --- |
| `project` | Manage and inspect your Prisma projects |
| `project env` | Manage environment variables for the active project |

Mount paths `project list|show|create|link|rename|remove|transfer`,
`project env add|update|list|remove`. Family keys `projectList`,
`projectShow`, `projectCreate`, `projectLink`, `projectRename`,
`projectRemove`, `projectTransfer`, `projectEnvAdd`,
`projectEnvUpdate`, `projectEnvList`, `projectEnvRemove`.
`project env remove` mounts WITHOUT the legacy `rm` alias
(R-S2b-8; divergence entry).

## 2. Shared machinery

### 2.1 Error mapper `v8/project/errors.ts`

Shape per conventions §4. Complete map:

| legacy code (exit) | v8 code |
| --- | --- |
| `USAGE_ERROR` domain project/app (2) | `PROJECT.USAGE_ERROR` |
| `USAGE_ERROR` domain auth "Workspace required" (2) | `AUTH.USAGE_ERROR` |
| `PROJECT_NOT_FOUND` (1) | `PROJECT.NOT_FOUND` |
| `PROJECT_AMBIGUOUS` (1) | `PROJECT.AMBIGUOUS` |
| `PROJECT_SETUP_REQUIRED` (1) | `PROJECT.SETUP_REQUIRED` |
| `LOCAL_STATE_STALE` (1) | `PROJECT.LOCAL_STATE_STALE` |
| `LOCAL_PROJECT_WORKSPACE_MISMATCH` (1) | `PROJECT.LOCAL_WORKSPACE_MISMATCH` |
| `LOCAL_STATE_WRITE_FAILED` (1) | `PROJECT.LOCAL_STATE_WRITE_FAILED` |
| `PROJECT_CREATE_FAILED` (1) | `PROJECT.CREATE_FAILED` |
| `PROJECT_RENAME_FAILED` (1) | `PROJECT.RENAME_FAILED` |
| `PROJECT_REMOVE_BLOCKED` (1) | `PROJECT.REMOVE_BLOCKED` |
| `PROJECT_TRANSFER_REJECTED` (1) | `PROJECT.TRANSFER_REJECTED` |
| `TRANSFER_RECIPIENT_REQUIRED` (2) | `PROJECT.TRANSFER_RECIPIENT_REQUIRED` |
| `TRANSFER_RECIPIENT_UNAVAILABLE` (1) | `PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE` |
| `CONFIRMATION_REQUIRED` domain project (2) | `PROJECT.CONFIRMATION_REQUIRED` |
| `PROJECT_LINK_TARGET_REQUIRED` (2) | `PROJECT.LINK_TARGET_REQUIRED` (only reachable via `--yes`-suppressed picker; see 3.4) |
| `WORKSPACE_NOT_AUTHENTICATED` (1) / `WORKSPACE_AMBIGUOUS` (2) | `AUTH.WORKSPACE_NOT_AUTHENTICATED` / `AUTH.WORKSPACE_AMBIGUOUS` (S2a codes; copy from the recipient machinery ports verbatim) |
| `ENV_VARIABLE_ALREADY_EXISTS` (1) | `PROJECT.ENV_VARIABLE_ALREADY_EXISTS` |
| `ENV_VARIABLE_NOT_FOUND` (1) | `PROJECT.ENV_VARIABLE_NOT_FOUND` |
| `ENV_BRANCH_NOT_FOUND` (1) | `PROJECT.ENV_BRANCH_NOT_FOUND` |
| `ENV_BRANCH_SCOPE_IS_PRODUCTION` (1) | `PROJECT.ENV_BRANCH_SCOPE_IS_PRODUCTION` |
| `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` (1) | `PROJECT.ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` |
| `ENV_FILE_APPLY_FAILED` (1) | `PROJECT.ENV_FILE_APPLY_FAILED` |
| `ENV_API_ERROR` or API-passthrough code X (1) | `PROJECT.ENV_API_ERROR` / `PROJECT.X` |
| `PROJECT_API_ERROR` or passthrough (1) | `PROJECT.API_ERROR` / `PROJECT.X` |
| legacy 401/403 → `AUTH_REQUIRED` (`apiCallError`) | `PROJECT.AUTH_REQUIRED`, legacy summary/why/nextSteps verbatim, exit 2 — the plain mechanical prefix rule, no special case. Re-amended 2026-08-10 (operator): the ENGINE already owns every real credentials failure — a stored session's 401 is intercepted by the SDK's refresh middleware and settles as `CLI.CREDENTIALS_REQUIRED` (expired / session-ended) or `CLI.AUTH_SERVICE_ERROR`; an env session's returned 401 settles as `AUTH.SERVICE_TOKEN_REJECTED` (engine `api-client.ts`). What still reaches `apiCallError` is the residue the engine deliberately does not claim — chiefly a returned **403** (authenticated but not permitted), which is NOT a sign-in problem. Handlers therefore never hand-build engine credential errors (duplicating engine copy and mislabelling a permission failure), and never rethrow (that would settle `CLI.INTERNAL_ERROR`, exit 1, a bug class). |
| `FEATURE_UNAVAILABLE` (fixture-only) | unreachable in v8 — no entry |

All copy/meta/fix/nextSteps per conventions §4 and the fact sheet's
verbatim strings, with §0-of-d2-style substitutions: package-runner
`formatCommand` strings become `${CLI_NAME} …`; `prisma auth login`
copy bug normalizes to `${CLI_NAME} auth login` (divergence entry);
`--trace` fix text substitutes per conventions. The legacy
`buildProjectSetupNextActions` list ports verbatim minus its
`journey` fields (v8 NextAction has none; divergence entry).

### 2.2 Consent

`project remove` and `project transfer` per conventions §5.
Confirmation copy verbatim (fact sheet §6/§7):

- remove: summary `Confirm project removal`, why `Removing a project
  is permanent, deletes its databases, and stops its apps, so it
  requires the exact project id.`, rerun action `${CLI_NAME} project
  remove ${id} --confirm ${id}`.
- transfer: summary `Confirm project transfer`, why `Transferring
  moves the project to another workspace and this workspace loses
  access, so it requires the exact project id.`, rerun action
  `${CLI_NAME} project transfer ${id} <--to-workspace <id-or-name> |
  --recipient-token <token>> --confirm ${id}`.
- Drafted consent questions (OPERATOR DECISION 2): remove — `Remove
  project ${id}? This permanently deletes the project, its
  databases, and stops its apps.`; transfer — `Transfer project
  ${id} to the recipient workspace? This workspace loses access.`

### 2.3 Operation calls

Handlers call exactly the functions in fact sheet §14.7, passing
`ctx.api` wherever the table marks a client argument
(`listRealWorkspaceProjects(ctx.api, workspace, ctx.signal)`,
`createAppProvider(ctx.api)`,
`createManagementProjectProvider(ctx.api)`, inline
`ctx.api.POST/PATCH/DELETE` for env writes,
`findVariableByNaturalKey(ctx.api, …)`). `resolveTransferRecipient`
machinery: call `resolveRecipientWorkspaceSession(workspaceRef,
ctx.env, ctx.signal)` directly (it builds its own SDK from stored
tokens by design — recipient credentials are a second identity, not
`ctx.api`'s). Local pin: `writeLocalResolutionPin`,
`ensureLocalResolutionPinGitignore`, read/unlink per fact sheet
§14.6; failures map through the legacy `LOCAL_STATE_WRITE_FAILED`
constructors. Env helpers: `resolveEnvScope`,
`parseKeyValuePositional`, `readEnvFileAssignments`,
`resolveEnvWriteSource`, `resolveScopeToApi`,
`resolveListScopeToApi`, `findVariableByNaturalKey`, `toMetadata`,
`collectEnvironmentVariables` — imported (adding `export` where
needed per §0.4), never reimplemented.

### 2.4 Project resolution modes (pinned per command, fact sheet §14.1/§15.8)

- Pin-based resolution (`resolveProjectTarget`; explicit `--project`
  → local pin → setup-required error): `rename`, all four `env`
  commands.
- Positional-only against the workspace list
  (`resolveProjectForSetup`): `remove`, `transfer`, `link` (when arg
  given).
- Binding inspection (unbound = success): `show`.
- None: `list`, `create`.
- No command reads `PRISMA_PROJECT_ID`.

## 3. Per-command design

Common: `needs: { credentials: true }`; no events; no exitCodes.
data = legacy result minus `verboseContext` (class divergence per
d2 §3 intro). Presentation title lines are pinned per command below
as the `summary` block text.

### 3.1 `project list` — `v8/project/list.ts`

- help.summary `List all projects in your workspace`; examples
  `project list`, `project list --json`. No args.
- Handler: workspace → `listRealWorkspaceProjects(ctx.api,
  workspace, ctx.signal)` → `sortProjects` (name→id) →
  `readProjectListLocalBinding(ctx.cwd, workspace, projects,
  ctx.signal)`.
- data `{ workspace, projects, localBinding }`.
- human: summary info `Listing projects for the authenticated
  workspace.`; fields `workspace: name`; empty → list `["No projects
  found."]`; else table `name | id | region` (region cell `none`
  when absent).
- stdout: table data rows tab-joined `name\tid\tregion`.
- json: legacy `serializeProjectList`: `{ context: { workspace },
  items: [{name,id,status:null}], count, localBinding }`.
- next: empty when linked; else the two setup actions from
  `buildProjectSetupNextActions` with the exact per-state `reason`
  strings (fact sheet §1).
- Tests: linked success; not-linked (nextActions asserted); invalid
  binding; empty list; json; unauth.

### 3.2 `project show` — `v8/project/show.ts`

- help.summary `Show this directory's Project binding`; examples
  `project show`, `project show --project proj_123 --json`; flag
  `project: flag.string({ brief: "Project id or name", placeholder:
  "id-or-name" })`.
- Handler: workspace → `inspectProjectBinding` (unbound = success
  with suggestion fields) via `ctx.api`-backed `listProjects`.
- data: the `ProjectShowResult` union verbatim (fact sheet §2).
- human bound: summary info `This directory is linked to the
  following platform project.`; fields `local repo:
  <shortenHomePath(cwd)>`, `platform: <workspace / project>`, url
  row when present, `region` when present. Unbound: summary warn
  `This directory is not linked to a Prisma Project.`; fields
  `workspace`, `project: Not linked`.
- stdout: `label: value` mirror of the fields block.
- json: result unchanged. next: unbound → the setup actions with the
  §2 reason string; bound → none.
- Tests: bound; unbound (success + nextActions); `--project` miss →
  `PROJECT.NOT_FOUND` exit 2; ambiguous → `PROJECT.AMBIGUOUS`
  (legacy exit 1 → 2, meta.matches verbatim); stale pin; workspace
  mismatch; json; unauth.

### 3.3 `project create <name>` — `v8/project/create.ts`

- help.summary `Create a Project and link this directory`; examples
  `project create my-app`, `project create my-app --json`;
  positional `name` (brief `Project name`); flag `region:
  flag.string({ brief: "Prisma Compute region id", placeholder:
  "region" })`.
- Handler: workspace → name trim/validate
  (`isValidProjectSetupName`; invalid → mapped
  `projectSetupNameRequiredError("project create")` →
  `PROJECT.USAGE_ERROR`) → `createAppProvider(ctx.api)
  .createProject({ name, region, signal })` (failure →
  `projectCreateFailedError` with the exact option strings from fact
  sheet §3) → local pin write + gitignore (`"created"` action).
- data: `ProjectSetupResult` (fact sheet §3).
- human: three ok summary lines as list-of-blocks: summary ok
  `Created Project "${project.name}"`; summary ok `Linked
  "${directory}" to Project "${project.name}"`; summary info `Saved
  .prisma/local.json`.
- stdout: none. json: result unchanged.
- next: run-command `${CLI_NAME} app deploy` (legacy nextSteps).
- Tests: success (pin written — temp cwd, gitignore appended);
  whitespace name; create rejected 403 (permission why/fix
  verbatim); pin write failure → `PROJECT.LOCAL_STATE_WRITE_FAILED`;
  json; unauth.

### 3.4 `project link [id-or-name]` — `v8/project/link.ts` (picker, R-S2b-6)

- help.summary `Link this directory to a Project`; examples
  `project link`, `project link proj_123`,
  `project link "Acme Dashboard" --json`; positional
  `project: positional.optionalString({ brief: "Project id or
  name", placeholder: "id-or-name" })`.
- Handler: workspace → `listRealWorkspaceProjects` →
  - arg given: `resolveProjectForSetup(ref, projects, workspace)`
    (ambiguous/not-found map per §2.1) → bind (`"linked"`).
  - no arg: `ctx.prompt.select("Which Project should this directory
    use?", options)` where options are pinned: first `{ value:
    "__create__", label: "+ Create a new Project" }`; then projects
    sorted name→id, `value: project.id`, `label: project.name` or
    `` `${name} (${id})` `` on duplicate names; last `{ value:
    "__cancel__", label: "Cancel" }`. Non-interactive/`--yes` → the
    engine's structural prompt failure (`CLI.PROMPT_REQUIRED`, exit
    2) — the legacy `PROJECT_LINK_TARGET_REQUIRED` rich error does
    NOT port on this path (R-S2b-6 + S2a workspace-use precedent;
    divergence entry + operator-review flag, candidates meta is
    lost).
  - `__cancel__` → mapped legacy cancel usage error →
    `PROJECT.USAGE_ERROR` (`Project setup canceled` + link cancel
    why/fix/nextSteps verbatim, fact sheet §4).
  - `__create__` → `ctx.prompt.text("Project name", { placeholder:
    inferTargetName(ctx.cwd).name, default: <same> })` (empty input
    falls back to the suggestion — engine default semantics) →
    `createAppProvider(ctx.api).createProject` (failure copy per
    fact sheet §4) → bind (`"created"`).
- data/human/json/next: as 3.3 (`"linked"` renders only the
  Linked + Saved lines).
- Tests: explicit arg success; explicit ambiguous/not-found; picker
  select existing (scripted answers); picker create-new (text
  answer + default fallback); picker cancel; non-interactive →
  `CLI.PROMPT_REQUIRED` exit 2; json; unauth.

### 3.5 `project rename <name>` — `v8/project/rename.ts`

- help.summary `Rename the resolved Project`; examples
  `project rename "Acme Dashboard v2"`,
  `project rename billing-api --project proj_123`; positional
  `name` (brief `New project name`); flag `project` (as 3.2).
- Handler: workspace → validate name (legacy helper — its "Project
  create requires a name" copy bug ports verbatim; divergence-list
  note, not a fix) → pin-based resolution →
  `createManagementProjectProvider(ctx.api).renameProject({
  projectId, name, signal })`.
- data `{ workspace, project: renamed, previousName }`.
- human: summary ok `Renaming project.`; fields `workspace`,
  `project: ${previousName}`, `id`; list `["The project is now named
  "${project.name}". Directory bindings pin the project id, so they
  stay valid."]`.
- stdout: none. json: result unchanged. next: none.
- Tests: success; 422 → `PROJECT.RENAME_FAILED` (API message/hint
  passthrough); unbound dir → `PROJECT.SETUP_REQUIRED`; json;
  unauth.

### 3.6 `project remove <project>` — `v8/project/remove.ts` (consent)

> HOLD LIFTED (merge-down 2026-08-10): build per conventions §5 —
> `ctx.prompt.consent(<pinned why sentence>, { token: project.id })`,
> no confirm flag declaration, engine `--confirm` grants
> non-interactively. Ignore this section's references to a declared
> `confirm` flag and to `PROJECT.CONFIRMATION_REQUIRED` (both
> superseded by conventions §5).

- help.summary `Remove a Project permanently after exact id
  confirmation`; example
  `project remove proj_123 --confirm proj_123`; positional
  `project` (brief `Project id or name`); flag `confirm:
  flag.string({ brief: "Exact project id required to remove",
  placeholder: "project-id" })`.
- Handler: workspace → positional-only resolve → consent (§2.2) →
  `createManagementProjectProvider(ctx.api).removeProject` →
  `cleanupLocalPinForProject` semantics (pin delete when matching;
  delete failure → warning diagnostic severity `warn` with the
  legacy warning text, NOT an error).
- data `{ workspace, project, localPin: { cleared } }`.
- human: summary ok `Removing project.`; fields `workspace`,
  `project`, `id`; list `["The project, its databases, and its apps
  were removed."` + when cleared `"This directory's local project
  binding was cleared."]`.
- stdout: none. json: result unchanged. next: none.
- Tests: success + pin cleared; success pin-delete-failure (warning
  diagnostic asserted); consent matrix; 400 →
  `PROJECT.REMOVE_BLOCKED`; not-found/ambiguous; json; unauth.

### 3.7 `project transfer <project>` — `v8/project/transfer.ts` (consent)

> HOLD LIFTED with 3.6 — same conventions §5 mechanism, token =
> project.id. Completing 3.6 + 3.7 (and their legacy fixture-test
> deletion) is round-2+ work for this dispatch.

- help.summary `Transfer a Project to another workspace after exact
  id confirmation`; examples per fact sheet §7; positional
  `project`; flags `toWorkspace: flag.string({ brief: "Locally
  authenticated workspace to receive the project", placeholder:
  "id-or-name" })`, `recipientToken: flag.string({ brief: "Access
  token for the receiving workspace", placeholder: "token" })`,
  `confirm` (brief `Exact project id required to transfer`).
- Handler order (fact sheet §7): both recipient flags →
  `PROJECT.USAGE_ERROR` (mutual-exclusion copy verbatim); neither →
  `PROJECT.TRANSFER_RECIPIENT_REQUIRED`; resolve positional-only;
  consent (§2.2); `resolveTransferRecipient` (service-token guard →
  `PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE`; recipient errors →
  AUTH.* per §2.1); `transferProject({ projectId,
  recipientAccessToken, signal })`; pin rewrite/clear/none semantics
  + failure warnings verbatim.
- data `{ workspace, project, recipient, localPin: { action } }`.
- human: summary ok `Transferring project.`; fields `workspace`,
  `project`, `id`, `recipient` (name ?? id ?? `workspace of the
  provided recipient token`); list with the two detail sentences per
  state (fact sheet §7).
- stdout: none. json: result unchanged.
- next: `--to-workspace` runs → run-command `${CLI_NAME} auth
  workspace use <the-flag-value>`; else none.
- Tests: to-workspace success (+ nextAction + pin rewritten);
  recipient-token success (+ pin cleared); both-flags; neither;
  service-token guard; recipient ambiguous/not-authenticated;
  consent matrix; 400 → `PROJECT.TRANSFER_REJECTED`; json; unauth.

### 3.8–3.11 `project env add|update|list|remove` — `v8/project/env-*.ts`

Shared: flags `role: flag.enum({ brief: "Project template scope
(production or preview)", values: ["production", "preview"] })`
(engine enum parse failure replaces commander's choices error;
divergence entry), `branch: flag.string({ brief: "Preview branch
override scope", placeholder: "git-name" })` (list uses brief
`Preview branch resolved scope`), `project` flag as 3.2. All scope /
input parsing via the legacy helpers (§2.3) — every usage-error copy
verbatim (fact sheet §14.2), mapped `PROJECT.USAGE_ERROR`. Pin-based
project resolution. API writes inline on `ctx.api`.

**add** (`env-add.ts`): positional `assignment:
positional.optionalString({ brief: "Variable assignment as
KEY=VALUE or KEY from the current environment", placeholder:
"assignment" })`; flag `file: flag.string({ brief: "Read KEY=VALUE
assignments from a dotenv file", placeholder: "path" })`.
help.summary `Create a new environment variable.`; examples: the six
descriptor examples verbatim (fact sheet §8). Flow: write-source →
scope (requireExplicit) → parse input → resolve scope
(createBranchIfMissing true; default-branch guard) → duplicate check
(→ `PROJECT.ENV_VARIABLE_ALREADY_EXISTS`) → POST; branch-scope
preview-missing warning ports as a `warn` diagnostic with the legacy
text. File mode: per-key precheck, sequential writes, mid-loop
failure → `PROJECT.ENV_FILE_APPLY_FAILED` with meta
`{file, failedKey, writtenKeys}` and the split-file nextSteps
verbatim as run-command actions — a `#`-comment line is NOT its own
action: it becomes the `reason` of the immediately following
run-command action (amended 2026-08-10 after D1 round 1). data: single `{ projectId, scope, variable }`; file
`{ projectId, scope, variables, file: {path, count} }`. human:
single — summary info `Setting a new environment variable.`, fields
`project`, `scope`, `key`, `id`, `last updated`; file — summary info
`Setting new environment variables from file.`, fields `target:
<scopeLabel> from <path>`, table `variable | id | status` rows
`` `${key} (${source})` ``/id/`default`-when-managed, empty → list
`["No environment variables imported."]`. stdout: none (metadata
only, no values — legacy). json: `stripVerboseContext` shape. next:
none.

**update** (`env-update.ts`): identical surface; help.summary
`Replace an existing environment variable's value.`; examples
verbatim. Differences: `createBranchIfMissing: false` (→
`PROJECT.ENV_BRANCH_NOT_FOUND`); missing var →
`PROJECT.ENV_VARIABLE_NOT_FOUND` (update copy); PATCH; no preview
warning; file-mode missing-keys error + retry steps verbatim.
Titles: `Replacing the environment variable's value.` / file
`Replacing environment variable values from file.`, empty `["No
environment variables updated."]`.

**list** (`env-list.ts`): no positional, no `--file`. help.summary
`List environment variable metadata for a scope (no values).`;
examples verbatim. Flow: optional scope → `resolveListScopeToApi`
(explicit / local-git-branch / overview modes with the exact target
computation, fact sheet §10) → variables via the legacy list
functions (effective-row overlay + ordering preserved). data
`{ projectId, scope, target, variables }`. human: summary info
`Listing environment variables for the selected scope.`; fields
`target: <listTargetLabel>` (label rules verbatim incl. `" (not
created yet)"`); table `variable | id | status` as add's file mode;
empty → list `["No environment variables defined in this scope."]`.
stdout: table data rows tab-joined. json: legacy `serializeEnvList`
shape verbatim (context/items/count/variables + scope + target).
next: empty-list → run-command `${CLI_NAME} project env add
KEY=value <scope flag>`; else none.

**remove** (`env-remove.ts`): positional `key:
positional.string({ brief: "Variable key to remove", placeholder:
"key" })`; flags role/branch/project; NO file flag; NO rm alias.
help.summary `Remove an environment variable from a scope.`;
examples verbatim. Flow: scope (requireExplicit) → resolve
(createBranchIfMissing false) → find (missing →
`PROJECT.ENV_VARIABLE_NOT_FOUND`, remove copy) → DELETE. data
`{ projectId, scope, key }`. human: summary info `Removing the
environment variable from the scope.`; fields `project`, `scope`,
`key`. stdout: none. json: strip shape. next: none.

Env tests (each command): success role scope; success branch scope
(incl. branch-create path for add, default-branch guard error);
scope usage errors (both flags / neither / — for add/update — both
input sources / bad assignment / env-key fallback); duplicate /
missing variable errors; file mode success + partial-failure
(`meta.writtenKeys`); list overview + local-git + not-created-yet
target labels + empty nextAction; remove success + missing; json
envelope each; unauth each.

## 4. Divergence entries this dispatch adds

The d2 §4 classes 2/3(with this doc's map)/4/7/8/9/10/11 apply
identically, plus:
1. `rm` alias dropped (R-S2b-8).
2. Picker non-interactive path: `CLI.PROMPT_REQUIRED` replaces
   `PROJECT_LINK_TARGET_REQUIRED` (candidates meta lost) — flagged
   for operator review.
3. `PROJECT_AMBIGUOUS` legacy exit 1 → 2.
4. Env `--role` invalid values: engine enum error replaces
   commander choices error.
5. Legacy `AUTH_REQUIRED` residue from `apiCallError` (403/permission
   class) maps mechanically to `PROJECT.AUTH_REQUIRED`, exit 2 (§2.1
   final pin); real credential failures are engine-settled. The
   `prisma auth login` copy bug does not port.
6. NextAction `journey` fields dropped.
7. Rename's "Project create requires a name" copy bug ports
   verbatim (recorded, not fixed).
8. Warn-diagnostic code for the env preview-default warning is
   `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` (pinned 2026-08-10 after D1
   round 1; operator ratifies via the divergence list).
9a. The remove/transfer local-pin cleanup warnings carry the
   already-pinned `PROJECT.LOCAL_STATE_WRITE_FAILED` code at `warn`
   severity (no new code invented; pinned 2026-08-10 after D1 round
   2; operator ratifies via the divergence list).
9. Legacy resolution/env functions taking the shell CommandContext
   are called through the `v8/project/context.ts` runtime-slice
   adapter (cwd/env/signal only, read-surface verified) — accepted
   for this slice; the structural-signature cleanup belongs to S2d
   when the legacy shell dies.

## 5. Legacy test deletion (this dispatch)

Delete fixture-mode cases covering the 11 ported commands from:
`project.test.ts`, `project-mutations.test.ts`,
`project-controller.test.ts` (whole files if nothing else remains),
and the env-command cases in `app-env.test.ts`-family files that are
fixture-driven. Keep: `project-real-mode.test.ts`,
`project-resolution.test.ts`, `project-usecases.test.ts` (use-case
files die in S2d with the fixture machinery), env unit tests of the
helpers (still production code).

## 6. Conformance rows

One row per command in `assets/s2/parity-divergences-s2b.md`, per
conventions §11.
