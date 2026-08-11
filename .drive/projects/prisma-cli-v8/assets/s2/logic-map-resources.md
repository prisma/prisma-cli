# Logic map: the bucket, branch and git commands

This document records where the code for nine commands actually lives today, so that a decision about adopting a Clean Architecture split (command handlers parse input and present output; use cases hold business logic with external services injected; adapters implement the ports) can rest on evidence rather than assumption.

The nine commands are `bucket list`, `bucket create`, `bucket delete`, `bucket key list`, `bucket key create`, `bucket key delete`, `branch list`, `git connect` and `git disconnect`.

Everything below was read from the branch `s2b2-domain-extraction` in the worktree at `/Users/wmadden/Projects/prisma/prisma-cli/.claude/worktrees/s2b-resources-handover-5be347`. All paths are absolute.

## How to read this document

You do not need to have opened the code. Section 1 explains the layers and the vocabulary. Section 2 describes the work that all nine commands share before they do anything specific. Section 3 has one block per command. Sections 4 to 8 answer the specific questions that prompted this map.

Three terms are used throughout and are worth pinning down now.

**Business logic** means a decision or a transformation that would still have to happen if the command were driven by something other than a terminal — for example, an HTTP server or a test. Choosing which project to act on, deciding that an already-connected repository with a matching name is a success rather than an error, and sorting production branches to the top are all business logic.

**Input parsing** means turning the raw command line into values — reading a flag, trimming a positional argument, and rejecting an empty one.

**Presentation** means turning a result into something a person or a program reads — the human-readable blocks, the tab-separated stdout lines, and the JSON envelope.

**Port** is the name for an interface that a use case depends on and an adapter implements. If a use case needs to read the git origin remote, it declares a small interface with a `readOriginRemote` method; the adapter that shells out to `git` implements it. The use case never imports the adapter.

## 1. The layers, and which of them ship

There are five relevant directories under `/Users/wmadden/Projects/prisma/prisma-cli/.claude/worktrees/s2b-resources-handover-5be347/packages/cli/src/`.

**`v8/`** holds the new command handlers written against `@prisma/cli-engine`. Each file exports one command built with `defineCommand`. These are the nine handlers in scope.

**`controllers/`** holds the older command bodies from the commander-based shell. Each one contains a check called `isRealMode(context)`, which is true when neither the `--fixture` flag nor the `PRISMA_CLI_MOCK_FIXTURE_PATH` environment variable is set. The branch behind that check is the real behaviour; the other branch reads a JSON fixture. The v8 handlers call into these files for helper functions, but never call the `run*` entry points.

**`lib/`** holds shared operations that both shells use — project resolution, the local project pin file, and the bucket provider.

**`adapters/`** holds three files: `git.ts` (shells out to the `git` binary and parses GitHub URLs), `local-state.ts` (a JSON state file in the user's home directory), and `mock-api.ts` (the in-memory fixture API).

**`use-cases/`** holds the partial Clean Architecture layer — `auth.ts`, `branch.ts`, `project.ts`, plus `contracts.ts` (the port interfaces) and `create-cli-gateways.ts` (the adapter that implements them). Section 5 examines `branch.ts` in detail.

### Which shell ships

This matters for reading the rest of the document. `packages/cli/package.json` maps the `prisma-cli` binary to `./dist/cli.js`. `packages/cli/tsdown.config.ts` builds two entry points: `dist/cli.js` from `src/bin.ts` (the commander shell, which routes through `controllers/`), and `dist/v8/cli.js` from `src/v8/bin.ts` (the engine shell). So the published binary is still the commander shell, and the v8 shell is a second, parallel binary in the same package.

The practical consequence: for these nine commands there are currently **two** implementations that both work, and they do not agree in every detail. Where they differ, this document says which is which. The v8 handlers are the direction of travel and are pinned by tests (`packages/cli/tests/v8-bucket.test.ts`, `v8-branch.test.ts`, `v8-git.test.ts`), so they are treated here as the behaviour that matters.

### What the engine gives a handler

A v8 handler receives a `CommandContext` defined at `packages/cli-engine/src/context.ts`. It has exactly eleven fields:

| Field | What it is |
| --- | --- |
| `config` | Validated config section, or `undefined` when the command declares no config need |
| `present(outcome, presentations)` | The only way to build a result the engine will accept |
| `activeCredential()` | The signed-in session, including `workspaceId` and `workspaceName` |
| `api` | A `ManagementApiClient` for the Prisma Management API, built lazily by the engine |
| `report(event)` | Emit a progress or status event |
| `prompt` | The prompt surface: `confirm`, `consent`, `select`, `text`, `browserWait` |
| `openUrl(request)` | Announce and open a URL |
| `signal` | The `AbortSignal` for the run |
| `cwd` | The invocation directory |
| `env` | The environment variables |
| `requireDependency(specifier)` | Check that an optional npm package is installed |

There is no logger, no filesystem handle, and **no clock** — a handler cannot read the time or sleep. The engine keeps a clock internally (`Invocation.now` and `Invocation.delay` at `packages/cli-engine/src/execution/engine.ts:104-116`), and it is injectable for tests, but it is not reachable from a handler. The only path from a handler to the engine's clock is `prompt.browserWait`. Section 6 returns to this.

A command also declares `needs`. All nine commands in scope declare `needs: { credentials: true }`, which makes the engine check for a signed-in session before the handler runs and fail with `CLI.CREDENTIALS_REQUIRED` at exit code 2 if there is none. No command in this group declares `needs: { interaction: true }`; `git connect` deliberately does not, for a reason recorded in a comment and explained in section 6.

## 2. The shared preamble

Six of the nine commands (`bucket list`, `bucket create`, `branch list`, `git connect`, `git disconnect`, and by extension anything that addresses a project) begin with the same two steps. This preamble is the single largest piece of shared business logic in the group.

### Step one: resolve the active workspace

`resolveActiveWorkspace(ctx)` at `packages/cli/src/v8/resources-shared/workspace.ts:28-39`. It calls `ctx.activeCredential()`, and if the credential has no `workspaceId` it throws a structured error with code `AUTH.USAGE_ERROR` and summary "Workspace required". Otherwise it returns `{ id, name }`, falling back to the workspace id as the name when the name is absent.

This is business logic: "a resource command needs a workspace" is a rule, not a rendering choice. It reads exactly one external service — the credential store, via `ctx.activeCredential()`.

### Step two: resolve the project

`resolvePinnedProject(ctx, workspace, explicitProject, commandName)` at `packages/cli/src/v8/project/context.ts:77-94`. This is a thin wrapper. It builds a fake legacy context object and calls `resolveProjectTarget` at `packages/cli/src/lib/project/resolution.ts:155-183`, then converts any failure into a `CliError` via `projectResolutionErrorToCliError`.

The wrapper is worth describing because of what it does to make the call possible. `legacyOperationContext(ctx)` (same file, lines 56-64) wraps `{ cwd, env, signal }` in a `Proxy` that throws a descriptive error if the legacy code ever reads a field the adapter does not supply. This exists because `resolveProjectTarget` takes the commander shell's much larger context type, and a plain cast would hide the day someone adds a fourth field read.

`resolveProjectTarget` itself contains real business logic, in this order:

1. If `--project` was passed, match it against the workspace's projects by exact id or exact name. One match wins; several produce `ProjectAmbiguousError`; none produces `ProjectNotFoundError`.
2. Otherwise, read `.prisma/local.json` in the invocation directory (`readLocalResolutionPin` at `packages/cli/src/lib/project/local-pin.ts:166-190`). The file must be a JSON object with exactly two non-empty string fields, `workspaceId` and `projectId`; anything else is treated as stale.
3. If the pin names a different workspace than the active one, fail with `LocalProjectWorkspaceMismatchError`.
4. If the pin names a project that is not in the workspace's project list, fail with `LocalStateStaleError`.
5. If there is no pin at all, build a `ProjectSetupRequiredError`. Building that error reads `package.json` for a name, falls back to the directory basename, and filters the project list for anything matching that name, so it can suggest candidates. That suggestion-building is itself business logic and it touches the filesystem.

Note step 5: producing the "you need to choose a project" error is not a cheap throw. It performs filesystem reads and list filtering to assemble a helpful payload.

The external services this preamble needs are: the credential store, the Management API (to list the workspace's projects), and the filesystem (to read `.prisma/local.json` and `package.json`).

## 3. Command by command

### 3.1 `bucket list`

**Handler:** `packages/cli/src/v8/bucket/list.ts`

**What the handler does.** Input parsing: two string flags, `--project` and `--branch`, declared in `packages/cli/src/v8/bucket/context.ts:12-20`. Business logic: none of its own beyond assembling the result object — it delegates the preamble and the API call. Presentation: the whole of `listPresentations` (lines 16-44), which builds a summary block, a fields block showing project and optionally branch, and either an empty-state list block or a five-column table; a tab-separated stdout form; and a JSON form.

**What it calls, in order.**

1. `resolveBucketContext(ctx, args.flags, "bucket list")` — `packages/cli/src/v8/bucket/context.ts:36-54`. A thin wrapper: `resolveActiveWorkspace`, then `resolvePinnedProject`, then `createManagementBucketProvider(ctx.api)`.
2. `provider.listBuckets({ projectId, branchName, signal })` — `packages/cli/src/lib/bucket/provider.ts:87-124`.
3. `bucketRows` and `bucketStdoutRows` — `packages/cli/src/v8/bucket/presentation.ts:12-34`.
4. `serializeBucketList` — `packages/cli/src/presenters/bucket.ts`.
5. On failure, `mapBucketOperationError` — `packages/cli/src/v8/bucket/errors.ts:55-70`.

**Where the business logic sits.** Almost none in the handler. The project resolution is in `lib/project/resolution.ts`; the API access, cursor pagination and record normalisation are in `lib/bucket/provider.ts`. Roughly: 0% handler, 100% split between `lib/project/` and `lib/bucket/`. The handler is about 60% presentation code by line count.

One detail worth carrying into any redesign: the human table renders an unscoped bucket's branch column as the word `unscoped`, and the stdout form renders it as an empty string. That difference is deliberate and documented in a comment at `presentation.ts:22-24`. It is a presentation decision, and it belongs on the presentation side of any split.

**External services.** Credential store; Management API (project list, then paginated `GET /v1/buckets`); filesystem (the project pin and `package.json`).

### 3.2 `bucket create`

**Handler:** `packages/cli/src/v8/bucket/create.ts`

**What the handler does.** Input parsing: `--name`, `--project`, `--branch`; the name is trimmed and an empty string becomes `undefined` so the server generates a name (`args.flags.name?.trim() || undefined`, line 38). Business logic: only that empty-name-means-server-generated rule. Presentation: an inline single summary block; there is no stdout or JSON presentation, so a `--json` run returns the raw result object.

**What it calls, in order.** `resolveBucketContext(ctx, flags, "bucket create")`, then `provider.createBucket({ projectId, name, branchGitName, signal })` at `packages/cli/src/lib/bucket/provider.ts:126-147`, then `bucketTargetLabel` at `v8/bucket/presentation.ts:5-10` for the summary text, then `mapBucketOperationError` on failure.

**Where the business logic sits.** Same as `bucket list`: the preamble plus the provider. The provider's `createBucket` omits the `name` and `branchGitName` body fields entirely when they are absent rather than sending nulls — that is a rule about the API contract and it lives in the provider.

**External services.** Identical to `bucket list`, with `POST /v1/buckets` instead of the list call.

### 3.3 `bucket delete`

**Handler:** `packages/cli/src/v8/bucket/delete.ts`

**What the handler does.** Input parsing: one positional, trimmed, with an empty value raising a usage error (lines 39-48). Business logic: the consent requirement (line 50) and the delete call. Presentation: `deletePresentations` (lines 17-28), three blocks.

**What it calls, in order.**

1. `args.positionals.bucketId.trim()`, and `usageError(...)` from `packages/cli/src/shell/errors.ts:68-84` if empty.
2. `ctx.prompt.consent(CONSENT_QUESTION, { token: bucketId })`.
3. `resolveBucketProviderOnly(ctx)` — `v8/bucket/context.ts:59-63`, which is one line: `createManagementBucketProvider(ctx.api)`.
4. `.deleteBucket(bucketId, { signal })` — `lib/bucket/provider.ts:149-163`.
5. `mapBucketOperationError` on failure.

**Where the business logic sits.** This command has **no project resolution and no workspace check**. It addresses a bucket id directly. The rule that a delete requires typed consent is expressed in the handler as one call; the enforcement lives entirely in the engine. Section 7 works through what that means for the split.

**External services.** Credential store (through the engine's `needs` check and through `ctx.api`); Management API (`DELETE /v1/buckets/{bucketId}`); the prompt surface.

**Difference from the shipped commander behaviour.** The commander version at `packages/cli/src/controllers/bucket.ts:122-164` does not prompt at all. It requires `--confirm <bucketId>` to be passed on the command line and throws `CONFIRMATION_REQUIRED` otherwise. The v8 version asks interactively and accepts `--confirm` as the non-interactive equivalent. This is a genuine behaviour change made by the port, and the tests pin the new behaviour (`v8-bucket.test.ts:474-534`).

### 3.4 `bucket key list`

**Handler:** `packages/cli/src/v8/bucket/key-list.ts`

**What the handler does.** Input parsing: one positional, trimmed, empty rejected with a usage error. Business logic: none. Presentation: `listPresentations` (lines 17-36) with a summary, a fields block naming the bucket, and either an empty-state list or a five-column table; plus a tab-separated stdout form and `serializeBucketKeyList` for JSON.

**What it calls, in order.** Trim and validate; `resolveBucketProviderOnly(ctx).listKeys(bucketId, { signal })` at `lib/bucket/provider.ts:165-199`; `bucketKeyRows` at `v8/bucket/presentation.ts:36-44`; `serializeBucketKeyList`; `mapBucketOperationError` on failure.

**Where the business logic sits.** Entirely in the provider — the cursor-following pagination loop and the `normalizeKey` field mapping. The handler is input parsing plus presentation and nothing else.

**External services.** Credential store; Management API (paginated `GET /v1/buckets/{bucketId}/keys`).

### 3.5 `bucket key create`

**Handler:** `packages/cli/src/v8/bucket/key-create.ts`

**What the handler does.** Input parsing: a positional bucket id (trimmed, empty rejected), a `--role` enum limited to `read` and `read_write`, and a `--name` string trimmed to `undefined` when blank. Business logic: `resolveKeyRole` at lines 16-18, which is one rule — anything that is not exactly the string `read`, including an omitted flag, becomes `read_write`. Presentation: `createPresentations` (lines 20-60), which prints the four credential values as a fields block with `sensitive: true` on the two secrets, and as bare `KEY=value` lines on stdout.

**What it calls, in order.** Trim and validate the bucket id; `resolveKeyRole(args.flags.role)`; `resolveBucketProviderOnly(ctx).createKey({ bucketId, name, role, signal })` at `lib/bucket/provider.ts:201-247`; `mapBucketOperationError` on failure.

**Where the business logic sits.** Split. The role-defaulting rule is in the handler. Everything else is in the provider, including one rule that matters: after a successful create, the provider checks that the response carried `secretAccessKey`, `accessKeyId`, `endpoint` and `bucketName`, and throws `BUCKET_KEY_SECRET_MISSING` if any is absent (lines 228-238). That check exists because these credentials are shown once and never again, so a create that silently returned no secret would leave the user with an unusable key. That is business logic sitting in what is otherwise an adapter.

**External services.** Credential store; Management API (`POST /v1/buckets/{bucketId}/keys`).

**A presentation constraint.** The `sensitive: true` marking on the two secret fields is how the human renderer knows to mask them, while the stdout form deliberately prints them in full so the output can be piped into a `.env` file. Any split must keep both forms; the secret values themselves have to reach the presentation layer unmasked.

### 3.6 `bucket key delete`

**Handler:** `packages/cli/src/v8/bucket/key-delete.ts`

**What the handler does.** Input parsing: two positionals, both trimmed, with a single combined usage error if either is empty (lines 39-48). Business logic: none. Presentation: three blocks, no stdout or JSON form.

**What it calls, in order.** Trim and validate both ids; `resolveBucketProviderOnly(ctx).deleteKey(bucketId, keyId, { signal })` at `lib/bucket/provider.ts:249-266`; `mapBucketOperationError` on failure.

**Where the business logic sits.** Nowhere in the handler; the provider is a single API call with error mapping. Note that this command takes **no consent**, unlike `bucket delete`.

**External services.** Credential store; Management API (`DELETE /v1/buckets/{bucketId}/keys/{keyId}`).

### 3.7 `branch list`

**Handler:** `packages/cli/src/v8/branch/list.ts`

**What the handler does.** Input parsing: none at all — this command has no flags and no positionals. Business logic: the preamble, then the sort. Presentation: `listPresentations` (lines 20-45), a summary, a fields block naming the project, and either an empty-state list or a three-column table, plus a tab-separated stdout form. There is no JSON presentation function, so `--json` returns the raw result.

**What it calls, in order.**

1. `resolveActiveWorkspace(ctx)`.
2. `resolvePinnedProject(ctx, workspace, undefined, undefined)`. Both trailing arguments are deliberately `undefined`: this command has no `--project` flag, and it passes no command name, which changes the "choose a project" error to read "this command" and drops its retry suggestion. There is a comment recording that this reproduces the commander behaviour (lines 56-58).
3. `listBranches(ctx.api, target.project.id, ctx.signal)` — `packages/cli/src/controllers/branch.ts:124-159`. This is the cursor-following pagination loop against `GET /v1/projects/{projectId}/branches`.
4. `toBranchSummary` — `controllers/branch.ts:161-168`. Maps the API's `gitName` field onto `name`, and copies `role` into a second field called `envMap`.
5. `sortBranches` — `controllers/branch.ts:107-122`. Production branches first, then everything else by `localeCompare` on the name.
6. `mapBranchOperationError` on failure — `v8/branch/errors.ts:53-68`.

**Where the business logic sits.** Split roughly evenly between `lib/project/resolution.ts` (the preamble) and `controllers/branch.ts` (pagination, field mapping, sort). None in the handler. This is the only command in the group whose v8 handler reaches into `controllers/` for its main operation rather than into `lib/`.

**External services.** Credential store; Management API (project list, then paginated branch list); filesystem (project pin and `package.json`).

### 3.8 `git connect`

**Handler:** `packages/cli/src/v8/git/connect.ts`. At 265 lines this is the largest handler in the group, and the only one that contains a substantial amount of business logic in the handler file itself.

**What the handler does, step by step.** The classification column is the answer to "which side of the split does this belong on".

| # | Step | Where in the code | Classification |
| --- | --- | --- | --- |
| 1 | Read the optional `git-url` positional and the `--project` flag | handler lines 149-157 | Input parsing |
| 2 | Resolve workspace and project | `resolveGitContext`, `v8/git/context.ts:21-39` | Business logic (delegated to the preamble) |
| 3 | If no url was passed, read the git origin remote | `readGitOriginRemote(ctx.cwd, ctx.signal)`, `adapters/git.ts:15-35` | External service (git) |
| 4 | If there is still no url, raise a usage error | handler lines 183-191 | Business logic (a rule about what input is sufficient) |
| 5 | Parse the url into owner and repository name | `parseGitHubRepositoryUrl`, `adapters/git.ts:41-98` | Business logic (pure) |
| 6 | If it is not a GitHub url, raise `REPO_PROVIDER_UNSUPPORTED` | `unsupportedRepositoryProviderError`, `controllers/project.ts:2175-2185` | Business logic |
| 7 | Ask the API whether this project already has a source repository | `readFirstSourceRepository`, `controllers/project.ts:2092-2116` | External service (Management API) |
| 8 | If it does and the name matches case-insensitively, return success without changing anything | handler lines 203-223, using `repositoryFullNamesMatch` at `controllers/project.ts:2260-2262` | Business logic — this is the rule that makes the command safe to re-run |
| 9 | If it does and the name does not match, raise `REPO_ALREADY_CONNECTED` | `controllers/project.ts:2243-2258` | Business logic |
| 10 | Find the repository among the workspace's GitHub App installations | `resolveInstalledRepository`, handler lines 52-121 | Mixed — see below |
| 11 | `POST /v1/source-repositories` with the repository and installation ids | handler lines 232-243 | External service |
| 12 | Convert the API record into the result shape | `toRepositoryConnection`, `controllers/project.ts:2143-2173` | Business logic (field mapping and derived flags) |
| 13 | Build the human blocks | `connectPresentations`, handler lines 123-146, using `formatGitConnectionDetail` at `presenters/project.ts:387-399` | Presentation |

**Step 10 in detail.** `resolveInstalledRepository` is the interesting part, and it decomposes as follows.

First it defines an `inspect` function that does two API calls: `listScmInstallations(api, workspaceId, signal)` (`controllers/project.ts:1892-1932`, a cursor-following loop over `GET /v1/scm-installations` that also detects a cursor that fails to advance and raises rather than looping forever), then `findRepositoryInInstallations(api, installations, repository, signal)` (`controllers/project.ts:1746-1786`).

`findRepositoryInInstallations` holds several rules. It skips any installation whose provider is not `github` or which is marked suspended. For each remaining installation it lists that installation's repositories, again with cursor pagination, and compares `fullName` case-insensitively. An installation that returns 404 or 422 is treated as "unavailable" and skipped rather than failing the command (`findRepositoryInInstallationIfAvailable` and `isUnavailableScmInstallationError`, lines 2014-2043). It counts how many installations it was actually able to inspect, and returns that count alongside the match. That count is used later to choose between two different error messages.

Then it calls `inspect` once. If the repository is found, it returns immediately and no browser is involved.

If it is not found, it calls `createGitHubInstallIntent(api, workspaceId, signal)` (`controllers/project.ts:2045-2070`), which posts to `/v1/scm-installations/install-intents` and returns an `installUrl`.

Then it calls `ctx.prompt.browserWait` with four things: the url, a fixed message, a timeout, and an interval. The timeout and interval come from `readPositiveIntegerEnv` (`controllers/project.ts:1839-1849`) reading `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` and `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS`, defaulting to 120000 and 2000 milliseconds. The `poll` callback re-runs `inspect` and returns whether a match was found, storing the match and the inspectable-installation count in variables in the enclosing scope.

Finally, if the wait timed out with `CLI.BROWSER_WAIT_TIMEOUT`, or completed without a match, it calls `installWaitFailedError` (`v8/git/errors.ts:86-105`). That function picks between two messages using the inspectable-installation count: if the CLI could see at least one installation, the repository exists but access was not granted, so it raises `REPO_NOT_ACCESSIBLE`; if it could see none, no app is installed at all, so it raises `REPO_INSTALLATION_REQUIRED`.

**Where the business logic sits.** This is the one command where a large share sits in the handler file. Approximately: 45% in the handler file itself (the already-connected check, the url-required check, the whole of `resolveInstalledRepository` including the poll wiring and the two-way error choice), 45% in `controllers/project.ts` (installation listing, repository matching, install-intent creation, the record-to-result mapping, and every error constructor), and 10% in `adapters/git.ts` (reading and parsing the remote). The preamble is on top of all that.

**External services.** Credential store; Management API (five distinct endpoints: source repositories list, source repositories create, installations list, installation repositories list, install intents create); the git binary; the filesystem (project pin and `package.json`); two environment variables; the browser; and the clock. The last three all arrive through `prompt.browserWait`.

**How the commander version differs.** `runGitConnect` at `controllers/project.ts:1109-1250` performs the same steps, but its waiting logic is its own: `waitForInstalledRepository` (lines 1788-1837) reads `Date.now()` directly, has a private `sleep` function using `setTimeout` (lines 1877-1890), calls `open(installUrl)` itself via `openInstallUrlIfInteractive` (lines 2072-2090), and writes its own "Waiting for..." line to stderr via `writeInstallWaitStatus` (lines 1851-1875). The v8 port handed all four of those — the clock, the sleep, the browser launch and the status line — to the engine. It also folded away the legacy distinction between "the browser opened" and "the browser did not open", because the engine always shows the URL; there is a constant `BROWSER_OPENED = true` at `v8/git/errors.ts:77` recording that decision.

### 3.9 `git disconnect`

**Handler:** `packages/cli/src/v8/git/disconnect.ts`

**What the handler does.** Input parsing: one flag, `--project`. Business logic: the preamble, the not-connected check, and the delete. Presentation: `disconnectPresentations` (lines 18-47), a summary, a three-row fields block, and a one-item list.

**What it calls, in order.** `resolveGitContext(ctx, args.flags.project, "git disconnect")`; `readFirstSourceRepository(api, projectId, signal)`; `repoNotConnectedError()` from `controllers/project.ts:2187-2197` if there is nothing to disconnect; `api.DELETE("/v1/source-repositories/{id}")`; `repoConnectionApiError` on failure; `toRepositoryConnection(existing)` to build the result from the record that was just deleted; `mapGitOperationError` on failure.

**Where the business logic sits.** Split between the handler (the not-connected check, and the decision to report the deleted record as the result) and `controllers/project.ts` (the read, the error constructors, the record mapping). Say 30% handler, 70% controller. Note one detail that is easy to lose in a refactor: the result is built from the record read *before* the delete, because the delete returns nothing.

**External services.** Credential store; Management API (`GET /v1/source-repositories` then `DELETE /v1/source-repositories/{id}`); filesystem (project pin and `package.json`).

## 4. Summary: where the business logic sits

Across the nine commands, very little business logic is in the handlers. The exception is `git connect`.

| Group | Handler | `lib/` | `controllers/` | `adapters/` |
| --- | --- | --- | --- | --- |
| Six bucket commands | Input trimming; two small rules (`resolveKeyRole`, blank-name-means-server-generated) | Nearly all: project resolution and the whole bucket provider | Nothing — v8 does not import `controllers/bucket.ts` at all | Nothing |
| `branch list` | Nothing | Project resolution | Pagination, field mapping, sort | Nothing |
| `git connect` / `git disconnect` | About 45% for connect, 30% for disconnect | Project resolution | Installation search, install intents, record mapping, every error constructor | Git remote read and URL parsing |

Two observations follow from the table.

First, the bucket group has already achieved most of the separation the Clean Architecture split is after. The provider interface at `packages/cli/src/lib/bucket/provider.ts:29-50` is a port in everything but name: six methods, no engine types, no terminal awareness, and a factory function that takes the API client. What it lacks is a use case sitting above it.

Second, `git connect` is where the real work is, and it is the only place where the handler has grown business logic that would have to move.

## 5. `use-cases/branch.ts` compared with what `branch list` ships

The existing use case is at `packages/cli/src/use-cases/branch.ts`. Its `list()` method is 28 lines. Here is what each side actually does.

| | `use-cases/branch.ts` | `v8/branch/list.ts` |
| --- | --- | --- |
| Workspace check | None | `resolveActiveWorkspace` throws `AUTH.USAGE_ERROR` if the credential has no workspace |
| Where the project comes from | `projectStateGateway.readRememberedProjectId()`, which reads `state.project.lastResolved.id` from the JSON state file in the user's home directory (`adapters/local-state.ts:154-157`) | `.prisma/local.json` in the invocation directory, plus a live project list from the API to validate it |
| No project available | Returns success: `{ projectId: "", projectName: "not resolved", branches: [] }` | Throws; the engine settles it as `PROJECT.SETUP_REQUIRED` at exit code 2 |
| Project name unknown | Falls back to the literal string `"not resolved"` | Cannot happen — resolution returns the project record, so the name is always real |
| Listing branches | `branchGateway.listBranchesForProject(projectId)`, a synchronous array from the in-memory fixture | `listBranches(ctx.api, projectId, ctx.signal)`, an async cursor-following loop over the API |
| Name field | `branch.name` | `branch.gitName`, mapped to `name` by `toBranchSummary` |
| `envMap` field | `branch.role` | `branch.role` — identical |
| Sort | Production first, then `localeCompare` | Production first, then `localeCompare` — identical, but duplicated code |

**Which differences are fixture artefacts and which are genuine disagreements.**

*Fixture artefacts — differences that exist only because the gateway is backed by an in-memory object.*

The `name` versus `gitName` difference is one. `RemoteBranchRecord` in `use-cases/contracts.ts:27-33` declares `name`, and `BranchRecord` in `adapters/mock-api.ts:36-42` provides `name`. The real API returns `gitName`. Nothing about the domain requires either spelling; the fixture simply chose a different one. A real gateway would map `gitName` to `name` at the boundary, exactly as `toBranchSummary` does now.

The missing pagination is another. The gateway returns a plain array because the fixture holds every branch in memory. A real gateway would follow cursors inside the adapter, and the use case would not change.

The synchronous `getProject` call is a third. `resolveProjectName` at lines 49-58 calls `projectGateway.getProject(projectId)?.name` with no `await` because the fixture is synchronous. A real implementation would be asynchronous.

*Genuine behavioural disagreements — differences a reader would notice and that a design decision has to settle.*

**The unresolved-project outcome is the big one.** The use case returns a successful empty result with the project name set to the literal string `"not resolved"`. The shipped v8 command raises an error. This is pinned by a test at `packages/cli/tests/v8-branch.test.ts:250-268`, which runs `branch list` in an unlinked directory and asserts exit code 2 with code `PROJECT.SETUP_REQUIRED` and the message "This directory is not linked to a Prisma Project, and this command will not choose one from package or directory names." The use case's behaviour would print a table header, no rows, and the words "not resolved" where the project name goes, and would exit 0. These are not reconcilable; one of them is wrong. The v8 behaviour is the one that ships and the one that is tested.

**The source of the project is the second.** The use case reads a *remembered* project id from a global state file in the user's home directory. The v8 command reads a *pinned* project id from `.prisma/local.json` in the current directory. These are different files holding different concepts: "the last project this CLI touched anywhere" versus "the project this directory is bound to". Worth noting: `setRememberedProject` is the only writer of `state.project.lastResolved`, and outside its own definition at `adapters/local-state.ts:159-167` its only callers are test helpers (`packages/cli/tests/helpers.ts:167` and `:185`, and `packages/cli/tests/app-controller.test.ts:5523`). No production code path writes it. So the field the branch use case reads is never populated during a real run: the use case would find `null` every time and always take its empty-result path.

**The absent workspace check is the third.** The use case never asks whether there is an active workspace. The v8 command does, and fails without one.

**The verdict.** The branch use case cannot be kept as-is. Its sort is correct and worth keeping; its shape — a single method returning a result object with no engine types — is the right shape. Everything else describes a command that does not exist: it reads a state field nothing writes, skips a check the real command makes, and turns a failure into a success. It should be rewritten against the real behaviour rather than corrected in place. The duplication of `sortBranches` in both `use-cases/branch.ts:84-95` and `controllers/branch.ts:107-122` — byte-for-byte the same logic — is the single piece worth carrying across unchanged.

## 6. The browser wait in `git connect`

The question is whether the waiting logic can live in a use case, given that a use case must not know about prompts or terminals.

**What the engine already owns.** `prompt.browserWait` is implemented at `packages/cli-engine/src/execution/prompts.ts:414-435` and does five things: it refuses immediately in a non-interactive session with `CLI.INTERACTION_REQUIRED`; it announces the URL (emitting an `endpoint` event, which renders as a line on stderr in human mode and as a JSON frame in JSON mode) and asks the runtime to open the browser, via `announceUrl` at `packages/cli-engine/src/execution/open-url.ts:14-33`; it computes a deadline from `invocation.now()`; it loops calling the caller's `poll` function; and it sleeps between polls using `invocation.delay`. On expiry it throws `CLI.BROWSER_WAIT_TIMEOUT`. On interruption it throws `CLI.PROMPT_CANCELLED`.

So the terminal, the browser, the clock and the sleep are all already on the engine's side of the line. What the handler supplies is only the address to visit, the two cadence numbers, and the question to ask repeatedly.

**The split this suggests.** The waiting *policy* is business logic and should move into the use case. The waiting *mechanism* is an external service and should be injected as a port. Concretely:

- The `poll` body — list installations, search them for the repository, count how many were inspectable — is business logic. It reads the Management API and makes decisions. It belongs in the use case.
- The choice between `REPO_NOT_ACCESSIBLE` and `REPO_INSTALLATION_REQUIRED` based on the inspectable-installation count is business logic and belongs in the use case.
- Reading the two environment variables and defaulting them is business logic in the weak sense that it is a rule about configuration; it needs an environment port, not the engine.
- Opening a browser, showing a message, sleeping, and reading the clock are external services. They should reach the use case as a single injected port.

**The recommended port.** Rather than giving the use case a browser port, a clock port and a message port separately, give it one port that matches what the operation actually is:

```ts
interface ApprovalWaitPort {
  waitForApproval(request: {
    url: string;
    message: string;
    timeoutMs: number;
    intervalMs: number;
    poll: (signal: AbortSignal) => Promise<boolean>;
  }): Promise<void>;   // throws a timeout error the use case can recognise
}
```

The adapter for this port is four lines calling `ctx.prompt.browserWait`. A test adapter calls `poll` a fixed number of times and then either returns or throws. The use case never learns whether a browser opened, whether anything was printed, or how long a second is.

This keeps the promise that a use case knows nothing about terminals: the use case says "send the user here and keep asking this question until it is answered or you give up", which is a statement about the workflow, not about a terminal. The port's implementation is where the terminal lives.

**One thing the handler must keep.** The comment at `v8/git/connect.ts:166-171` records a real design decision: `git connect` deliberately does not declare `needs: { interaction: true }`, because most runs never reach the wait — the repository may already be connected, or the app may already be installed. Declaring the need would have failed every scripted run up front, including the ones that would have succeeded. `browserWait` refuses a non-interactive session itself, at the moment the wait is actually needed, and names the URL when it does. That decision is about how the command is mounted in the engine, so it stays in the handler; but it means the port's contract must include "this may fail because no person is available", and the use case must let that failure through rather than treating it as a domain error.

## 7. The typed confirmation in `bucket delete`

`bucket delete` is the only command in this group of nine that asks for consent. Across the whole v8 command set there are seven `prompt.consent` calls: `bucket delete`, `project remove`, `project transfer`, `postgres remove`, `postgres restore`, `postgres connection remove` and `postgres connection rotate`. All seven use the same pattern — a fixed question string and a token the user must type back.

**How it works.** `consent` is implemented at `packages/cli-engine/src/execution/prompts.ts:335-351`. Its behaviour is worth stating precisely because it is unusual:

- In an interactive session with a token, it asks the user to type the token back. A mismatch re-prompts under the rich renderer, or fails with `CLI.PROMPT_INVALID` when the answer came from a pipe.
- In a non-interactive session, the only way to grant consent is `--confirm <token>` on the command line, matched exactly. Each `--confirm` value is consumed once.
- `--yes` does **not** grant consent. The implementation puts `state.yes` and `!state.interactive` in the same branch, so a `--yes` run on a real terminal still refuses. There is no `default` option in the type, so consent cannot be defaulted.
- Refusal is `CLI.CONSENT_REQUIRED` at exit code 2; cancellation is `CLI.PROMPT_CANCELLED` at exit code 3.

All five behaviours are pinned by tests at `packages/cli/tests/v8-bucket.test.ts:474-534`.

**Where it sits under the split.** The consent belongs in the handler, and the reason is that consent is an *input*, not an operation.

The rule "deleting a bucket destroys every object and access key in it, so a person must confirm before it happens" is a domain fact. But the mechanism — asking a question, or matching a `--confirm` value from argv — is the same kind of thing as reading a positional argument. It produces one bit of information that the use case needs, and it produces it before the use case runs.

There are three practical reasons not to push it down.

First, the token is derived from input the handler already holds. `bucket delete` passes the bucket id itself as the token; it does not need to call the API to know what to ask. So there is nothing the use case would contribute.

Second, `consent` is structurally undefaultable and the engine enforces that. If a use case took a `ConsentPort`, every test of the delete use case would have to supply a fake that grants consent, and a fake that always grants consent is exactly the defaulting the engine went out of its way to make impossible. The requirement is better enforced where it cannot be faked away.

Third — and this is where `bucket delete` differs from some of the other six consent commands — the token here is available at parse time. `postgres remove` and `project remove` pass `database.id` and `project.id`, values that only exist after a lookup, so those handlers must interleave a lookup with the prompt. `bucket delete` does not. It is the simplest case.

**The recommended shape.** The use case exposes `deleteBucket(bucketId)` and does not mention consent at all. The handler trims the id, calls `ctx.prompt.consent(question, { token: bucketId })`, and only then calls the use case. If the consent requirement itself needs to be expressed in the domain layer, express it as a value the use case demands — for instance, requiring the caller to pass a `ConfirmedDeletion` object that only the handler can construct — rather than as a port the use case calls.

## 8. Candidate port list

This is the smallest set of injected interfaces that covers every external service the nine commands touch. Method names are indicative; the shapes are taken from what the code actually needs.

### 8.1 `SessionPort` — the signed-in session

Needed by: all nine commands.

```ts
interface SessionPort {
  activeWorkspace(): Promise<{ id: string; name: string } | null>;
}
```

Backed by `ctx.activeCredential()`. The name fallback that `resolveActiveWorkspace` performs today (use the id when the name is missing) can live in the adapter or the use case; it is one line either way.

### 8.2 `ProjectDirectoryPort` — the local project pin and the name inference

Needed by: `bucket list`, `bucket create`, `branch list`, `git connect`, `git disconnect`.

```ts
interface ProjectDirectoryPort {
  readPin(): Promise<
    | { kind: "missing" }
    | { kind: "present"; workspaceId: string; projectId: string }
    | { kind: "invalid" }
  >;
  inferProjectName(): Promise<{ name: string; source: "package-name" | "directory-name" }>;
}
```

This covers every filesystem read these nine commands make. `readPin` wraps `readLocalResolutionPin` (`lib/project/local-pin.ts:166-190`), collapsing the invalid-JSON and invalid-shape cases into one `invalid` result, which is what the caller does today anyway. `inferProjectName` wraps `inferTargetName` (`lib/project/resolution.ts:525-541`), which reads `package.json` and falls back to the directory basename.

Note that the invocation directory is baked into the adapter rather than passed as an argument. `ctx.cwd` is a value the shell knows and the use case does not need to reason about.

### 8.3 `ProjectCatalogPort` — the workspace's projects

Needed by: the same five commands.

```ts
interface ProjectCatalogPort {
  listProjects(workspaceId: string): Promise<ProjectSummary[]>;
}
```

Backed by `listRealWorkspaceProjects` (`controllers/project.ts:1438`). This exists separately from the bucket and git ports because project resolution is a shared use case in its own right, and the three resource groups all depend on it.

Given 8.1, 8.2 and 8.3, the whole preamble becomes one shared use case — call it "resolve the target project" — that every project-addressing command composes. That is the single largest consolidation available in this slice.

### 8.4 `BucketPort` — the bucket API

Needed by: all six bucket commands.

This already exists as `BucketProvider` at `packages/cli/src/lib/bucket/provider.ts:29-50` and needs no change beyond moving the interface next to the use cases:

```ts
interface BucketPort {
  listBuckets(o: { projectId: string; branchName?: string }): Promise<BucketSummary[]>;
  createBucket(o: { projectId: string; name?: string; branchGitName?: string }): Promise<BucketSummary>;
  deleteBucket(bucketId: string): Promise<void>;
  listKeys(bucketId: string): Promise<BucketKeySummary[]>;
  createKey(o: { bucketId: string; name?: string; role: "read" | "read_write" }): Promise<BucketKeyCreateRecord>;
  deleteKey(bucketId: string, keyId: string): Promise<void>;
}
```

The `signal` parameter currently threaded through every method can move into the adapter's construction, since it is constant for a run.

The one decision to make: the `BUCKET_KEY_SECRET_MISSING` check (`lib/bucket/provider.ts:228-238`) is domain logic currently in the adapter. It should move up into the `createKey` use case, leaving the adapter to return whatever the API returned.

### 8.5 `BranchPort` — the branch API

Needed by: `branch list`.

```ts
interface BranchPort {
  listBranches(projectId: string): Promise<Array<{ id: string; gitName: string; role: BranchRole }>>;
}
```

Backed by `listBranches` at `controllers/branch.ts:124-159`. Pagination lives in the adapter. The `gitName`-to-`name` mapping and the sort are business logic and belong in the use case.

### 8.6 `SourceRepositoryPort` — the git connection API

Needed by: `git connect`, `git disconnect`.

```ts
interface SourceRepositoryPort {
  readFirstForProject(projectId: string): Promise<SourceRepositoryRecord | null>;
  connect(o: { projectId: string; providerRepositoryId: number; installationId: string }): Promise<SourceRepositoryRecord>;
  disconnect(sourceRepositoryId: string): Promise<void>;
  listInstallations(workspaceId: string): Promise<ScmInstallation[]>;
  listInstallationRepositories(installationId: string): Promise<ScmRepository[] | "unavailable">;
  createInstallIntent(workspaceId: string): Promise<{ installUrl: string }>;
}
```

Six methods, replacing the hand-written `SourceRepositoryApiClient` at `controllers/project.ts:1554-1662`. Two design notes. First, cursor pagination and the "cursor did not advance" check belong in the adapter, not the use case. Second, `listInstallationRepositories` returns the string `"unavailable"` rather than throwing on 404 or 422, because "this installation cannot be inspected, skip it" is currently expressed by catching a specific error and checking `error.meta.status` (`controllers/project.ts:2014-2043`). Making it an explicit return value moves an HTTP status code out of the domain layer.

### 8.7 `GitRepositoryPort` — the local git repository

Needed by: `git connect`.

```ts
interface GitRepositoryPort {
  readOriginRemoteUrl(): Promise<string | null>;
}
```

Backed by `readGitOriginRemote` at `adapters/git.ts:15-35`, which runs `git config --get remote.origin.url` with a five-second timeout and returns `null` on any failure that is not an abort. One method is all these commands need.

`parseGitHubRepositoryUrl` (same file, lines 41-98) is **not** part of this port. It is a pure function over a string with no external dependency, so it is domain logic and should simply be imported by the use case.

### 8.8 `ApprovalWaitPort` — the browser handoff

Needed by: `git connect`.

The shape is given in section 6. One method, backed by `ctx.prompt.browserWait`.

### 8.9 `EnvironmentPort` — the two tuning variables

Needed by: `git connect`.

```ts
interface EnvironmentPort {
  readPositiveInteger(name: string, fallback: number): number;
}
```

`git connect` is the only command in this group that reads environment variables, and it reads exactly two: `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` and `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS`. The parsing rule at `controllers/project.ts:1839-1849` — accept only positive integers, silently fall back otherwise — is worth keeping in one place.

An alternative worth considering: since these two values are pure configuration, the handler could read them and pass them to the use case as plain numbers, removing this port entirely. That is probably the better choice; it is listed here so the decision is made deliberately.

### 8.10 What is not needed

There is no clock port, no browser port and no output port in this list, and that is intentional. The clock and the browser are needed only inside the install wait, and `ApprovalWaitPort` covers them. No command in this group writes progress output — none of the nine calls `ctx.report`. No command in this group needs `select`, `text` or `confirm`; the only prompt used is `consent`, and section 7 argues it stays in the handler.

**Count: eight ports, or seven if the environment values are passed as plain numbers.** Three of them (`SessionPort`, `ProjectDirectoryPort`, `ProjectCatalogPort`) are shared with every other project-addressing command in the CLI, so the marginal cost for this slice is four or five.

## 9. What resists the split

Seven things do not move cleanly. Each is described with what would happen if you tried to force it.

### 9.1 Building the "choose a project" error is expensive and touches the filesystem

`ProjectSetupRequiredError` is not a simple failure. Constructing it reads `package.json`, falls back to the directory name, and filters the project list for near-matches so the message can suggest candidates (`buildProjectSetupSuggestion` at `lib/project/resolution.ts:377-396`). The resulting error carries a structured `meta` payload that the presentation layer renders as suggested next steps.

This is an error that is partly presentation. Under a strict split you would either give the use case a filesystem dependency purely for error construction, or return a plain failure and rebuild the suggestion in the handler. The second is cleaner but duplicates the matching logic. The `ProjectDirectoryPort.inferProjectName` method in section 8.2 exists specifically so that this can stay in the use case without a second filesystem dependency.

### 9.2 The `unscoped` versus empty-string difference in `bucket list`

The human table shows `unscoped` in the branch column for a bucket with no branch; the stdout form shows an empty string (`v8/bucket/presentation.ts:12-34`). This is genuinely presentation-shaped: the same domain value renders two ways depending on the audience. The use case must return `branchId: string | null` and let the presentation layer decide. It resists nothing as long as nobody is tempted to have the use case return a pre-formatted string.

### 9.3 The secret-masking in `bucket key create`

The credential card marks two fields `sensitive: true` so the human renderer masks them, while the stdout form prints them in full so the output can be redirected into a `.env` file (`v8/bucket/key-create.ts:20-59`). The secret values must therefore reach the presentation layer unmasked, and the masking decision must be made there. This is presentation-shaped and should stay in the handler. The only thing to watch is that a future "safe by default" instinct might push masking into the use case, which would break the piping use case that the stdout form exists to serve.

### 9.4 `branch list` has an argument-shaped quirk with no argument

`branch list` calls `resolvePinnedProject` with `commandName` set to `undefined` (`v8/branch/list.ts:57-63`). That single `undefined` changes the error text from "prisma-cli branch list will not choose one" to "this command will not choose one", and removes the "retry with --project" suggestion — because `branch list` has no `--project` flag to retry with. This is recorded in a comment and pinned by a test (`v8-branch.test.ts:250-268`).

It resists the split because it is a presentation detail (the wording of an error) controlled by a parameter to a domain operation (project resolution). Either the use case takes a parameter that exists only to shape an error message, or the handler catches a neutral failure and rewords it. Neither is clean. The first is what the code does now and is probably the lesser evil, but it should be a deliberate choice.

### 9.5 The install wait's error choice depends on a counter mutated by the poll callback

`resolveInstalledRepository` (`v8/git/connect.ts:52-121`) declares `match` and `inspectableInstallationCount` in the enclosing scope, and the `poll` callback assigns to both. After the wait ends, those variables decide which of two errors to raise. This works because `browserWait` calls `poll` synchronously within its own loop, but it is a value escaping through a closure rather than a return.

This resists a naive move because a use case cannot return a value from inside a callback it hands to a port. The fix is available: have the poll return a richer result and have the wait port hand the last poll result back to the caller, or have the use case keep the state explicitly in an object it owns. It is not hard, but it will not survive a mechanical extraction.

### 9.6 `git connect`'s decision not to declare an interaction requirement

Described in section 6. This is a statement about how the command is mounted in the engine, made because most runs never need a person. It cannot move into a use case — the `needs` declaration is part of `defineCommand`. It also means the use case must tolerate a "no person available" failure surfacing from the middle of its workflow rather than being checked up front, which is unusual and should be documented wherever the use case lives.

### 9.7 The `Proxy` that guards the legacy context

`legacyOperationContext` at `v8/project/context.ts:56-64` wraps `{ cwd, env, signal }` in a `Proxy` that throws if legacy code reads any other field. It exists because `resolveProjectTarget` still takes the commander shell's context type, and a straight cast would hide a future field read until it produced a confusing runtime failure — the comment notes the worst case is inside `project transfer`, after the project has already moved.

This is scaffolding for a migration, not architecture. It disappears the moment `resolveProjectTarget` is rewritten to take the three ports in section 8 instead of a context object. It is listed here because it is the clearest single signal of where the boundary currently is: everything behind that `Proxy` is still written against the old shell.

### 9.8 The commander shell is still the published binary

Noted in section 1 and repeated here because it constrains any plan. `dist/cli.js`, built from `src/bin.ts`, is what `prisma-cli` runs today, and it routes through `controllers/`. Every helper the v8 handlers import from `controllers/project.ts` and `controllers/branch.ts` is *also* still called by the commander code paths. Extracting those helpers into use cases means either changing both callers or accepting duplication until the commander shell is removed.

The bucket group is the exception and the easiest first move: `v8/bucket/*` imports nothing from `controllers/bucket.ts`. That group can be lifted into use cases without touching the commander shell at all.
