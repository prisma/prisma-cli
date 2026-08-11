# S2 Command Inventory — @prisma/cli commander shell (grounding for v8 port specs)

Source of truth read on branch `claude/prisma-cli-s1-d6-013cea` of the
`prisma/prisma-cli` repository. All paths below are relative to
`packages/cli/` unless prefixed.

Registration lives in `src/cli.ts` (root program) + `src/commands/*/index.ts` +
`src/commands/env.ts`. Descriptions/examples live centrally in
`src/shell/command-meta.ts` (the `DESCRIPTORS` array). Cross-checked against
`docs/product/command-spec.md`; discrepancies are recorded inline and in the
"Spec discrepancies" list at the end of section 3.

---

## 1. Command index

Behavior classes: sync = single result envelope; poll = loops on remote status; stream = emits records until the remote side ends; interactive = can prompt. "auth" column: none / local (credential store only) / platform (fails unauthenticated with AUTH_REQUIRED; "platform+login" means an interactive login is triggered on a TTY instead of failing).

| path | group | behavior | auth | API surface (real mode) | proposed engine kind |
|---|---|---|---|---|---|
| `version` | top | sync | none | none | result |
| `init` | top | sync + interactive, file-writing | none (auth only if link step runs) | none directly; link → GET /v1/projects, POST /v1/projects | session (prompts) or result with needs.consent |
| `feedback` | top | sync | none | external feedback service (not Management API) | result |
| `agent install` | agent | sync, spawns child proc | none | none (runs skills CLI) | result |
| `agent update` | agent | sync, spawns child proc | none | none | result |
| `agent status` | agent | sync, spawns child proc | none | none | result |
| `auth login` | auth | interactive, browser-opening, server-hosting | n/a (creates auth) | OAuth (sdk.getLoginUrl/handleCallback), GET /v1/workspaces/{id} | session |
| `auth logout` | auth | sync | local | GET /v1/me (state readback) | result |
| `auth whoami` | auth | sync | none (reports state) | GET /v1/me, GET /v1/workspaces/{id} | result |
| `auth workspace list` | auth | sync | local | GET /v1/workspaces/{id} (best-effort hydration) | result |
| `auth workspace use` | auth | sync + interactive picker | local | GET /v1/workspaces/{id} (hydration) | result / session |
| `auth workspace logout` | auth | sync | local | GET /v1/workspaces/{id} (hydration) | result |
| `project list` | project | sync | platform+login | GET /v1/projects | result |
| `project show` | project | sync | platform+login | GET /v1/projects | result |
| `project create` | project | sync, file-writing | platform+login | POST /v1/projects (ComputeClient.createProject) | result |
| `project link` | project | sync + interactive picker, file-writing | platform+login | GET /v1/projects (+ POST /v1/projects if "create new" chosen) | session / result |
| `project rename` | project | sync | platform+login | PATCH /v1/projects/{id} | result |
| `project remove` | project | sync, file-deleting | platform+login | DELETE /v1/projects/{id} | result (needs --confirm) |
| `project transfer` | project | sync, file-writing | platform+login | POST /v1/projects/{id}/transfer, GET /v1/workspaces (recipient probe) | result (needs --confirm) |
| `project env add` | project.env | sync | platform+login | GET/POST /v1/environment-variables, branches endpoints | result |
| `project env update` | project.env | sync | platform+login | GET /v1/environment-variables, PATCH /v1/environment-variables/{id} | result |
| `project env list` | project.env | sync | platform+login | GET /v1/environment-variables, GET /v1/projects/{id}/branches | result |
| `project env remove` (alias `rm`) | project.env | sync | platform+login | GET /v1/environment-variables, DELETE /v1/environment-variables/{id} | result |
| `git connect` | git | sync or poll (waits for GitHub App install), browser-opening | platform+login | GET/POST /v1/source-repositories, GET /v1/scm-installations(+/repositories), POST /v1/scm-installations/install-intents | session (poll + browser) |
| `git disconnect` | git | sync | platform+login | GET /v1/source-repositories, DELETE /v1/source-repositories/{id} | result |
| `branch list` | branch | sync | platform+login | GET /v1/projects/{projectId}/branches (paginated) | result |
| `build logs` | build | stream | platform (no login fallback) | GET /v1/builds/{buildId}/logs (NDJSON stream) | stream |
| `database list` | database | sync | platform+login | GET /v1/databases | result |
| `database show` | database | sync | platform+login | GET /v1/databases, GET /v1/databases/{id}, GET /v1/databases/{id}/connections | result |
| `database create` | database | sync | platform+login | POST /v1/databases | result (secret on stdout) |
| `database usage` | database | sync | platform+login | GET /v1/databases/{id}/usage | result |
| `database restore` | database | sync | platform+login | POST (restore endpoint at provider.ts:473) | result (needs --confirm) |
| `database remove` | database | sync | platform+login | DELETE /v1/databases/{id} | result (needs --confirm) |
| `database backup list` | database.backup | sync | platform+login | GET /v1/databases/{id}/backups | result |
| `database connection list` | database.connection | sync | platform+login | GET /v1/databases/{id}/connections | result |
| `database connection create` | database.connection | sync | platform+login | POST /v1/databases/{id}/connections | result (secret on stdout) |
| `database connection rotate` | database.connection | sync | platform+login | POST /v1/connections/{id}/rotate | result (needs --confirm, secret on stdout) |
| `database connection remove` | database.connection | sync | platform+login | DELETE /v1/connections/{id} | result (needs --confirm) |
| `bucket list` | bucket | sync | platform+login | GET /v1/buckets | result |
| `bucket create` | bucket | sync | platform+login | POST /v1/buckets | result |
| `bucket delete` | bucket | sync | platform+login | DELETE /v1/buckets/{bucketId} | result (needs --confirm) |
| `bucket key list` | bucket.key | sync | platform+login | GET /v1/buckets/{bucketId}/keys | result |
| `bucket key create` | bucket.key | sync | platform+login | POST /v1/buckets/{bucketId}/keys | result (secret on stdout) |
| `bucket key delete` | bucket.key | sync | platform+login | DELETE /v1/buckets/{bucketId}/keys/{keyId} | result |
| `app build` | app | sync, local build, file-writing (build artifact) | none | none | result (long-running → progress events) |
| `app run` | app | long-running local process, pass-through output | none | none | server-ish (local dev); rejects --json |
| `app deploy` | app | long-running + progress + interactive, file-writing | platform (no login fallback) | ComputeClient.deployApp, POST /v1/projects, branches, env vars, POST /v1/databases (--db) | session (steps/progress) |
| `app show` | app | sync (+ picker) | platform | GET /v1/apps, listDeployments | result |
| `app open` | app | sync, browser-opening | platform | GET /v1/apps, listDeployments | result + local browser action |
| `app domain add` | app.domain | sync | platform | POST /v1/apps/{appId}/domains | result |
| `app domain show` | app.domain | sync | platform | GET /v1/apps/{appId}/domains, GET /v1/domains/{id} | result |
| `app domain remove` | app.domain | sync + confirm prompt | platform | DELETE /v1/domains/{id} | result (consent) |
| `app domain retry` | app.domain | sync | platform | POST /v1/domains/{id}/retry | result |
| `app domain wait` | app.domain | poll (status until active/failed/timeout) | platform | GET /v1/domains/{id} loop | stream/status events |
| `app logs` | app | stream | platform | ComputeClient.streamDeploymentLogs | stream |
| `app list-deploys` | app | sync (+ picker) | platform | GET /v1/apps, listDeployments | result |
| `app show-deploy` | app | sync | platform | ComputeClient.showDeployment | result |
| `app promote` | app | remote operation w/ progress | platform | ComputeClient.promoteDeployment | session (progress) |
| `app rollback` | app | remote operation w/ progress | platform | ComputeClient.promoteDeployment (promote of older deploy) | session (progress) |
| `app remove` | app | remote destroy (SDK polls), type-to-confirm prompt | platform | ComputeClient.showApp + destroyApp (poll 2s / 120s) | session (consent + progress) |

Group nodes (print help when invoked bare; no action of their own): root `prisma`, `agent`, `auth`, `auth workspace`, `project`, `project env`, `git`, `branch`, `build`, `database`, `database backup`, `database connection`, `bucket`, `bucket key`, `app`, `app domain`.

## 2. Group census

| group | leaf commands |
|---|---|
| top-level (version, init, feedback) | 3 |
| agent | 3 |
| auth (incl. workspace) | 6 (login, logout, whoami, workspace list/use/logout) |
| project (incl. env) | 11 (list, show, create, link, rename, remove, transfer, env add/update/list/remove) |
| git | 2 |
| branch | 1 |
| build | 1 |
| database (incl. backup, connection) | 11 (list, show, create, usage, restore, remove, backup list, connection list/create/rotate/remove) |
| bucket (incl. key) | 6 (list, create, delete, key list/create/delete) |
| app (incl. domain) | 16 (build, run, deploy, show, open, logs, list-deploys, show-deploy, promote, rollback, remove, domain add/show/remove/retry/wait) |
| **Total leaf commands** | **60** |

Plus 16 group/help nodes and two program-level utilities: `--version` (handled before parse in `src/cli.ts:51`) and `--help` (commander).

## 3. Shared shell machinery

### 3.1 Global flags

Two sets (`src/shell/global-flags.ts`):

- **Full set** (`addGlobalFlags`, attached to every leaf command):
  - `--json` — structured JSON envelope on stdout. Success: `{ok:true, command, result, warnings, nextSteps, nextActions}` (pretty-printed, `src/shell/output.ts:22`). Error: `{ok:false, command, error:{code,domain,severity,summary,why,fix,where,meta,docsUrl}, warnings, nextSteps, nextActions}`. Streaming commands emit one JSON event per line (`writeJsonEvent`) plus a wrapper success event unless opted out (`build logs` opts out, `src/commands/build/index.ts:54`).
  - `-q, --quiet` — suppress human stderr rendering; stdout payloads (renderStdout) still print.
  - `-v, --verbose` — appends a "Local context" diagnostics block (duration, cwd, state file, git ref/sha/dirty; `src/shell/diagnostics-output.ts`).
  - `--trace` — include debug/stack in human error output.
  - `-y, --yes` — accept supported confirmation prompts.
  - `--interactive` / `--no-interactive` — force/disable prompting.
  - `--color` / `--no-color` — force/disable color.
- **Compact set** (`addCompactGlobalFlags`, attached to the root program and every group node): `--json`, `-q/--quiet`, `-v/--verbose`, `--trace`, `--no-interactive`, `-y/--yes`. **`--interactive`, `--color`, `--no-color` are missing from the compact set** even though `docs/product/command-spec.md:55-66` lists them as shared global flags — a flag placed before the subcommand can be rejected by commander. Mitigation: `resolveGlobalFlags` (`global-flags.ts:81`) also scans raw argv, because commander v12 can swallow duplicate parent/child options.
- Program-level `--version` (exits 0, honors `--json`; `src/cli.ts:51,103`).

**There is no `--fixture` flag.** Fixture mode is enabled only by the `PRISMA_CLI_MOCK_FIXTURE_PATH` env var or the programmatic `runtime.fixturePath` option (`src/shell/runtime.ts:61-68`). Every controller has an `isRealMode()` check on exactly those two inputs.

Prompting rule `canPrompt` (`src/shell/runtime.ts:105`): false when `--json`, `--no-interactive`, `CI` env without `--interactive`, or stdin/stderr not TTYs.

### 3.2 Command runner

`src/shell/command-runner.ts`: `runCommand` (result commands: build context → run handler → render human/stdout/json; maps thrown `CliError`, SDK `AuthError` → `AUTH_REQUIRED`, empty-service-token → `AUTH_CONFIG_INVALID`, aborts → `COMMAND_CANCELED` exit 130) and `runStreamingCommand` (app logs, build logs, domain wait; same error mapping, optional trailing JSON success event). Success human output goes to **stderr**; only `renderStdout` payloads and JSON go to **stdout**.

### 3.3 Error taxonomy

`src/shell/errors.ts`: `CliError {code, domain, summary, why, fix, debug, where, meta, docsUrl, exitCode, nextSteps, nextActions, humanLines}`. Domains: `cli | auth | project | branch | app | database | bucket`. Codes are FLAT_UPPER_SNAKE (no dots). Exit codes in use:

- 0 success — and one deliberate oddity: canceling the production-deploy confirmation throws `CONFIRMATION_REQUIRED` with **exitCode 0** (`src/lib/app/production-deploy-gate.ts:209-219`).
- 1 default error.
- 2 usage errors (`USAGE_ERROR`), commander parse errors (`src/cli.ts:66`), exact-id confirmation failures in project/database/bucket (`CONFIRMATION_REQUIRED` exit 2), `PROJECT_LINK_TARGET_REQUIRED`, `PROJECT_AMBIGUOUS`-family, `APP_AMBIGUOUS`, `WORKSPACE_AMBIGUOUS`, `PROD_DEPLOY_REQUIRES_FLAG`, `BRANCH_NOT_DEPLOYABLE`, `DOMAIN_HOSTNAME_INVALID`.
- 130 `COMMAND_CANCELED` (SIGINT/abort).
- Inconsistency to note for the port: `CONFIRMATION_REQUIRED` is exit **2** for project/database/bucket exact-id confirms but exit **1** for app remove / domain remove / prod-deploy non-interactive confirms (`src/controllers/app.ts:3053-3062, 2368-2381`; `production-deploy-gate.ts:189-207`).

Full code census (grep `code: "` over src): USAGE_ERROR, AUTH_REQUIRED, AUTH_CONFIG_INVALID, COMMAND_CANCELED, WORKSPACE_SWITCH_UNAVAILABLE, WORKSPACE_NOT_AUTHENTICATED, WORKSPACE_AMBIGUOUS, FEATURE_UNAVAILABLE, UNEXPECTED_ERROR, VERSION_UNAVAILABLE, FEEDBACK_SEND_FAILED, AGENT_SKILLS_INSTALL_FAILED, INIT_CONVERT_INCOMPLETE, INIT_CONVERT_UNSUPPORTED, INIT_CONFIG_EXISTS, INIT_DETECTION_FAILED, COMPUTE_CONFIG_INVALID, COMPUTE_CONFIG_TARGET_REQUIRED, COMPUTE_CONFIG_TARGET_UNKNOWN, PROJECT_NOT_FOUND, PROJECT_AMBIGUOUS, PROJECT_SETUP_REQUIRED, PROJECT_LINK_TARGET_REQUIRED, PROJECT_CREATE_FAILED, PROJECT_RENAME_FAILED, PROJECT_REMOVE_BLOCKED, PROJECT_TRANSFER_REJECTED, TRANSFER_RECIPIENT_REQUIRED, TRANSFER_RECIPIENT_UNAVAILABLE, CONFIRMATION_REQUIRED, LOCAL_STATE_STALE, LOCAL_STATE_WRITE_FAILED, LOCAL_PROJECT_WORKSPACE_MISMATCH, REPO_PROVIDER_UNSUPPORTED, REPO_NOT_CONNECTED, REPO_INSTALLATION_REQUIRED, REPO_NOT_ACCESSIBLE, REPO_ALREADY_CONNECTED, REPO_CONNECTION_FAILED, BRANCH_API_ERROR (or API-provided code), BRANCH_NOT_FOUND, BRANCH_NOT_DEPLOYABLE, BRANCH_DATABASE_SETUP_FAILED, DATABASE_NOT_FOUND, DATABASE_AMBIGUOUS, DATABASE_BACKUP_NOT_FOUND, DATABASE_CONNECTION_NOT_FOUND, DATABASE_CONNECTION_MISSING, DATABASE_CONNECTION_STRING_MISSING, DATABASE_API_ERROR (or API code), DATABASE_BACKUPS_UNSUPPORTED, DATABASE_RESTORE_CONFLICT, PLAN_LIMIT_REACHED, BUCKET_NOT_FOUND, BUCKET_KEY_NOT_FOUND, BUCKET_KEY_SECRET_MISSING, ENV_VARIABLE_ALREADY_EXISTS, ENV_VARIABLE_NOT_FOUND, ENV_BRANCH_SCOPE_IS_PRODUCTION, ENV_BRANCH_NOT_FOUND, ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH, ENV_FILE_APPLY_FAILED, DEPLOY_FAILED, BUILD_FAILED, RUN_FAILED, REMOVE_FAILED, NO_DEPLOYMENTS, NO_PREVIOUS_DEPLOYMENT, DEPLOYMENT_NOT_FOUND, APP_AMBIGUOUS, BUILD_SETTINGS_MIGRATION_REQUIRED, BUILD_SETTINGS_UNSUPPORTED, FRAMEWORK_NOT_DETECTED, PROD_DEPLOY_REQUIRES_FLAG, DOMAIN_HOSTNAME_INVALID, DOMAIN_QUOTA_EXCEEDED, DOMAIN_ALREADY_REGISTERED, DOMAIN_DNS_NOT_CONFIGURED, DOMAIN_NOT_FOUND, DOMAIN_RETRY_NOT_ELIGIBLE, DOMAIN_VERIFICATION_FAILED, DOMAIN_VERIFICATION_TIMEOUT, BUILD_NOT_FOUND, BUILD_LOGS_FAILED.

`nextActions` (`src/shell/next-actions.ts`): kinds `run-command | user-choice | edit-file | done`, journeys `project-setup | deploy-app | inspect | recover`. Crashes always produce a structured `UNEXPECTED_ERROR` JSON envelope under `--json` with a pre-filled `prisma-cli feedback "..."` recover action (`src/shell/output.ts:120`).

### 3.4 Auth machinery

- Precedence: `PRISMA_SERVICE_TOKEN` env var (empty → `AUTH_CONFIG_INVALID`) then stored OAuth via `FileTokenStorage` (`src/adapters/token-storage.ts`, built on `@prisma/credentials-store`; multi-workspace grants + one active-workspace pointer; file lock for refresh coordination).
- `requireComputeAuth` (`src/lib/auth/guard.ts`) returns a `ManagementApiClient` or null.
- `requireAuthenticatedAuthState` (`src/controllers/auth.ts:206`): used by project/database/bucket/branch/env/git — if unauthenticated **and a TTY is available it launches the full interactive OAuth login** before proceeding; otherwise throws `AUTH_REQUIRED`. The app group and `build logs` instead use `requireComputeAuth` directly and never auto-login.
- Real login (`src/lib/auth/login.ts`): local HTTP callback server on `localhost:<random>`, PKCE via `@prisma/management-api-sdk`, opens browser (`open`), TTY paste-the-callback-URL fallback, HTML success page, `GET /v1/workspaces/{id}` for the workspace name.
- API base URL override: `getApiBaseUrl(env)` in `src/lib/auth/client.ts` (env-driven).

### 3.5 Fixture-mode machinery (dies with the mock)

- `src/adapters/mock-api.ts` (696 lines, `MockApi.load(fixturePath)`) — the whole in-memory platform.
- `context.api` getter in `src/shell/runtime.ts:71-80` (throws if touched in real mode).
- `isRealMode()` duplicated in `src/controllers/{auth,project,database,bucket,branch,app,app-env}.ts` and each `else` branch below it.
- `src/use-cases/` (auth.ts, branch.ts, project.ts, contracts.ts, create-cli-gateways.ts) — only reachable from fixture branches.
- Fixture providers: `createFixtureProjectProvider` (`project.ts:908`), `createFixtureDatabaseProvider` (`database.ts:790`), `createFixtureBucketProvider` (`bucket.ts:349`).
- Fixture-only flags: `auth login --provider/--user/--workspace` (hidden via `.hideHelp()`, `src/commands/auth/index.ts:59-61`; real mode ignores them entirely — `runAuthLogin` does not read options when `isRealMode`).
- Fixture-only refusals: `project create` (`FEATURE_UNAVAILABLE` in fixture mode), all `app` commands (`ensurePreviewAppMode`, app.ts:4678: fixture mode → `FEATURE_UNAVAILABLE`).
- Fixture conventions: transfer recipient token = workspace id (`project.ts:757-797`); git connect/disconnect persist a pending connection in the local state store instead of the API.
- Env var: `PRISMA_CLI_MOCK_FIXTURE_PATH`.
- Tests passing `fixturePath` (see §5 census): auth.test.ts, project.test.ts, project-mutations.test.ts, project-controller.test.ts, branch.test.ts, database.test.ts, bucket.test.ts, app.test.ts (for refusal paths), init.test.ts, shell.test.ts, version.test.ts, update-check.test.ts, auth-real-mode.test.ts (asserting the boundary), auth-controller.test.ts.

### 3.6 Update-check integration

`src/shell/update-check.ts`, wired in `runCli` before parsing (`src/cli.ts:49`) and in `src/bin.ts` as a detached worker process:

- Cache file `update-check.json` in a cache dir; stderr-only notification "Update available: prisma-cli X -> Y" at most every 24h.
- Skipped when `NO_UPDATE_NOTIFIER` set, CI/GITHUB_ACTIONS, non-TTY stderr, `--json`, `--quiet`/`-q`, `--version`, or test runtime (unless `PRISMA_CLI_TEST_ENABLE_UPDATE_CHECK=1`).
- Remote discovery runs in a **spawned detached child process** re-invoking the CLI binary with `PRISMA_CLI_RUN_UPDATE_CHECK_WORKER=1` (+ `PRISMA_CLI_UPDATE_CHECK_DIR`, `_INSTALLED_VERSION`, `_REGISTRY_URL`); fetches `https://registry.npmjs.org/@prisma%2fcli` with 3s timeout.
- Install instruction is invocation-aware (pnpm/bun/npm dev-dep, npm global, or docs URL for npx/bunx).

### 3.7 Agent-setup tip machinery

Two pieces, both driven by `src/lib/agent/setup-status.ts` state kept in the local state store:

- `resolveAgentSetupTipCommand` (`src/controllers/auth.ts:707`): after `auth login` (human TTY mode only) appends a one-line tip suggesting the skills install command; suppressed by `--json`, `--quiet`, CI, non-TTY.
- `maybePromptForAgentSetup` (`src/controllers/agent-setup.ts`): one-time confirm prompt "Install the Prisma Compute skill for this project?" run by `init` and `app deploy`; a "no" is remembered via `stateStore.setAgentSetupPromptDismissedAt`; an install failure downgrades to a warning.
- Command strings are rendered through `resolvePrismaCliPackageCommand(FormatterSync)` (`src/lib/agent/cli-command.ts`), which picks `pnpm dlx | bunx | npx -y @prisma/cli@latest ...` per project package manager (overridable via `PRISMA_CLI_PACKAGE_RUNNER`, `PRISMA_CLI_PACKAGE_NAME`, `PRISMA_CLI_PACKAGE_SPEC`, `PRISMA_CLI_BINARY`).

### 3.8 Local files & env vars (shared)

- `.prisma/local.json` — project pin `{workspaceId, projectId}` (`src/lib/project/local-pin.ts`); writer also appends `.prisma/` to `.gitignore`.
- `<projectDir>/.prisma/cli/state.json` — local state store (`src/adapters/local-state.ts`; dir override `PRISMA_CLI_STATE_DIR` or runtime.stateDir; project dir located by walking up to the compute config, `src/shell/runtime.ts:92-103`): selected app per project, known live deployment per app, agent-setup status, fixture git connections.
- OAuth tokens — OS credentials store via `@prisma/credentials-store` (token-storage.ts).
- Compute config: `prisma.compute.ts` / `prisma.compute.json` (read by init/app group via `@prisma/compute-sdk/config`).
- Env var census: `PRISMA_SERVICE_TOKEN`, `PRISMA_PROJECT_ID`, `PRISMA_APP_ID`, `PRISMA_CLI_MOCK_FIXTURE_PATH`, `PRISMA_CLI_STATE_DIR`, `PRISMA_CLI_FEEDBACK_URL`, `PRISMA_CLI_DOMAIN_WAIT_POLL_MS`, `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS`, `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS`, `PRISMA_CLI_INIT_INSTALL_COMMAND`, `PRISMA_CLI_PACKAGE_{RUNNER,NAME,SPEC}`, `PRISMA_CLI_BINARY`, `PRISMA_CLI_RUN_UPDATE_CHECK_WORKER`, `PRISMA_CLI_UPDATE_CHECK_{DIR,INSTALLED_VERSION,REGISTRY_URL}`, `PRISMA_CLI_TEST_ENABLE_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`, `CI`, `INIT_CWD`.

### 3.9 Spec discrepancies (code vs docs/product/command-spec.md)

1. Spec documents `build list` (line 2074) and `build show` (line 2105); neither exists in code. Spec marks both "blocked on Management API rollout" — planned, not drift, but the shell registers only `build logs` (`src/commands/build/index.ts`).
2. Spec Global Rules (lines 55-66) list `--interactive`, `--color`, `--no-color` as shared flags; the compact flag set on the root and group nodes omits them (`src/shell/global-flags.ts:48-61`), so their acceptance depends on flag position.
3. `auth login --provider/--user/--workspace` exist in code (hidden, fixture-only) but not in the spec's `auth login` section (line 547). Real mode silently ignores them (`src/controllers/auth.ts:73-75`) rather than erroring.
4. `project env remove` has an undocumented alias `rm` (`src/commands/env.ts:206`); the spec section (line 1849) names only `remove`.
5. Spec's `app remove` heading (line 2232) lists `-y --yes` as if command-specific; in code it is the shared global flag.
6. The env group descriptor description strings end with periods (`project.env.*` in command-meta.ts) while every other descriptor has none — cosmetic inconsistency in help output.

---

## 4. Per-command inventory

Legend for flag tables: "global" flags (§3.1) are not repeated per command; every leaf command has the full global set. `[F]` = fixture-mode-only.

### `prisma version`
- **Summary**: "Show CLI build and environment" (command-meta.ts:44).
- **Flags**: globals only.
- **Positionals**: none.
- **Auth**: none.
- **API calls**: none.
- **Behavior**: sync.
- **Output**: human lines with CLI name/version, node version, os platform/arch, invocation kind (`dev|npx|bunx|global|unknown`); no separate `renderJson` serializer (raw result used in JSON). No distinct stdout payload. Errors: `VERSION_UNAVAILABLE` (exit 1) if package.json version missing.
- **Prompts**: none. **Side effects**: none. 
- **Tests**: `tests/version.test.ts` (some fixture refs for shell wiring).
- **Engine notes**: pure result kind; also duplicated as the program-level `--version` fast path (`src/cli.ts:123-160`) which bypasses the command runner — the port should unify these.

### `prisma init`
- **Summary**: "Write a committed compute config for this app".
- **Flags**:

| name | alias | type | default | required | description |
|---|---|---|---|---|---|
| `--framework <framework>` | — | string (alias-resolved to nextjs/nuxt/astro/hono/nestjs/tanstack-start/bun/custom) | detected | no | Framework override; detected when omitted |
| `--entry <path>` | — | string | derived (bun/hono: src/index.ts style) | no | Source entrypoint for entrypoint frameworks |
| `--http-port <port>` | — | string→int | framework default | no | HTTP port the app listens on |
| `--region <region>` | — | string (COMPUTE_REGIONS) | none | no | Region used when deploy creates the app |
| `--name <app-name>` | — | string | inferred (package.json / directory) | no | App name |
| `--link` / `--no-link` | — | boolean | prompt (TTY) / skip | no | Link this directory to a Project / skip |
| `--project <id-or-name>` | — | string | — | no | Project to link to |
| `--install` / `--no-install` | — | boolean | prompt (TTY) / skip | no | Install @prisma/compute-sdk dev dep for types |
| `--format <ts\|json>` | — | enum | ts | no | Config format; explicit `--format ts` over an existing prisma.compute.json performs a conversion |

- **Positionals**: none.
- **Auth**: none for the write itself; the link step (when taken) goes through `runProjectLink` → `requireAuthenticatedAuthState` (interactive login possible).
- **API calls**: only via link step (GET /v1/projects, optional POST /v1/projects).
- **Behavior**: sync + interactive; file-writing.
- **Output**: settings preview + written path + types/link status; `serializeInit` JSON serializer. Errors: `INIT_CONFIG_EXISTS`, `INIT_CONVERT_INCOMPLETE`, `INIT_CONVERT_UNSUPPORTED`, `INIT_DETECTION_FAILED`, `COMPUTE_CONFIG_INVALID`, USAGE_ERROR variants (exit 2), custom-framework-JSON refusal.
- **Prompts** (TTY, not --yes/--json): "Customize settings?" (framework select + port text), install-types confirm, link confirm (→ project picker via `runProjectLink`), agent-setup skill confirm.
- **Side effects**: writes `prisma.compute.ts` or `prisma.compute.json` (flag `wx`, never clobbers); conversion also deletes the old JSON config; optional `npm/pnpm/bun add -D @prisma/compute-sdk` child process (override `PRISMA_CLI_INIT_INSTALL_COMMAND`); link writes `.prisma/local.json` (+ `.gitignore`); skills installer child process.
- **Tests**: `tests/init.test.ts`, `tests/init-agent-setup.test.ts`.
- **Engine notes**: multi-step with prompts and child processes — session kind with step events; the conversion path is a distinct sub-behavior selected by flag+filesystem state.

### `prisma feedback <message>`
- **Summary**: "Send feedback to the Prisma CLI team". Anonymous unless `--email`.
- **Flags**: `--email <address>` (string, optional, ≤320 chars, regex-validated) + globals.
- **Positionals**: `<message>` required, ≤4000 chars.
- **Auth**: none.
- **API calls**: none (Management). POSTs to feedback service `https://hiieirp2pwqnjvq9axzyg6d0.fra.prisma.build/feedback` (override `PRISMA_CLI_FEEDBACK_URL`), 3s timeout; payload = message, optional email, meta {cliVersion, nodeVersion, platform, arch}.
- **Behavior**: sync. **Output**: confirmation line; no renderJson serializer. Errors: USAGE_ERROR (empty/too long/bad email, exit 2), `FEEDBACK_SEND_FAILED` (exit 1).
- **Prompts**: none. **Side effects**: outbound HTTP only.
- **Tests**: `tests/feedback.test.ts`.
- **Engine notes**: clean result kind; the crash-recovery flow pre-fills this command (`src/shell/output.ts:104`), so the v8 shell must keep an equivalent.

### `prisma agent install` / `prisma agent update`
- **Summary**: "Install/Refresh Prisma skills for AI coding agents". Same flags, same controller (`runAgentInstall`, operation differs).
- **Flags**:

| name | type | default | description |
|---|---|---|---|
| `--agent <agent>` | repeatable string[] | claude-family defaults (`DEFAULT_PRISMA_AGENT_TARGETS`) | agent target; repeat for multiple |
| `--all-agents` | boolean | false | pass `*` to the skills CLI |
| `--skill <skill>` | repeatable string[] | `DEFAULT_PRISMA_AGENT_SKILLS` | skill to install; repeat |
| `--global` | boolean | false | install into user dir instead of project |
| `--copy` | boolean | false (forced true on win32) | copy instead of symlink |
| `--dry-run` | boolean | false | show the command without running |

- **Positionals**: none. **Auth**: none. **API calls**: none.
- **Behavior**: sync; spawns `pnpm dlx|bunx|npx -y skills-cli add <source> --skill … --agent … [--global] [--copy] --yes` via execa (stdin ignored).
- **Output**: install summary; `serializeAgentInstall`. Error: `AGENT_SKILLS_INSTALL_FAILED` (exit 1, nextStep = the raw installer command).
- **Prompts**: none. **Side effects**: child process writes skill files into the project or user dir.
- **Tests**: `tests/agent.test.ts`.
- **Engine notes**: local child-process command; result kind; `--dry-run` returns `{status:"would-install", command}`.

### `prisma agent status`
- **Summary**: "Show installed Prisma skills".
- **Flags**: `--global` (check user-dir skills instead of project) + globals.
- **Auth**: none. **API**: none. Runs `skills-cli list [-g] --json`, filters names `prisma`/`prisma-*`; falls back to the skills lock file for project scope with a warning when the CLI call fails.
- **Behavior**: sync + child process. **Output**: skills table, statusSource (`skills-cli|skills-lock|unavailable`); `serializeAgentStatus`.
- **Prompts**: none. **Side effects**: child process (read-only).
- **Tests**: `tests/agent.test.ts`.
- **Engine notes**: result kind.

### `prisma auth login`
- **Summary**: "Log in to your Prisma platform account".
- **Flags**: `--provider <provider>`, `--user <id>`, `--workspace <id>` — all hidden (`hideHelp`) and **[F] fixture-only** (real mode never reads them; fixture mode uses them to skip select prompts). Plus globals.
- **Positionals**: none.
- **Auth**: n/a (creates the session). Never fails for being unauthenticated.
- **API calls** (real): OAuth authorize URL via `sdk.getLoginUrl` (scope `workspace:admin offline_access`), token exchange `sdk.handleCallback`, `GET /v1/workspaces/{id}` for the success page/workspace name; then `readAuthState` → `GET /v1/me` + `GET /v1/workspaces/{id}`.
- **Behavior**: interactive + browser-opening + hosts a localhost HTTP callback server; TTY paste-URL fallback loop. Non-TTY real mode still opens/points at the URL but a failed browser launch is fatal without the paste fallback.
- **Output**: auth state lines (user, workspace) + optional agent-setup tip; **no renderJson serializer** (raw AuthStateResult in JSON). nextSteps: whoami, project list, optional skills install.
- **Prompts**: fixture mode: provider/user/workspace select prompts (usage error if non-interactive without the fixture flags). Real mode: browser + paste fallback.
- **Side effects**: writes OAuth tokens to the OS credentials store; opens browser; binds a localhost TCP port; agent-setup tip reads local state.
- **Tests**: `tests/auth.test.ts`, `tests/auth-login.test.ts` (real login flow), `tests/auth-real-mode.test.ts`, `tests/auth-controller.test.ts`, `tests/auth-ops.test.ts`, `tests/auth-usecases.test.ts` (fixture use-cases).
- **Engine notes**: session kind (browser hand-off, long wait, cancellation); the fixture selection flow and its flags die with the mock. The localhost callback server is machinery the engine must own or replace.

### `prisma auth logout`
- **Summary**: "Clear stored authentication credentials".
- **Flags**: `--workspace <id-or-name>` — when present the command internally dispatches to `auth.workspace.logout` (same controller/envelope as that command). Plus globals.
- **Auth**: local store. **API calls**: `readAuthState` (GET /v1/me best-effort) after clearing.
- **Behavior**: sync. Clears **all** local OAuth sessions (`FileTokenStorage.clearTokens`); does not touch `PRISMA_SERVICE_TOKEN`.
- **Output**: signed-out state; no renderJson serializer.
- **Prompts**: none. **Side effects**: credentials store mutation.
- **Tests**: auth.test.ts / auth-real-mode.test.ts / auth-ops.test.ts.
- **Engine notes**: result kind. Note the argv-level dispatch: one registered command produces two command ids (`auth.logout` vs `auth.workspace.logout`) depending on the flag.

### `prisma auth whoami`
- **Summary**: "Show the authenticated user and accessible workspace".
- **Flags**: globals only. **Auth**: none required — reports `authenticated: false` rather than failing (nextSteps suggests login).
- **API calls**: GET /v1/me (principal), fallback JWT-claims + GET /v1/workspaces/{id}; a 401 from either → signed-out state, not an error.
- **Behavior**: sync. **Output**: user/workspace/credential lines; no renderJson serializer. Error path: `AUTH_CONFIG_INVALID` for empty service token.
- **Tests**: auth.test.ts, auth-real-mode.test.ts, v8-whoami.test.ts (v8 parity test, concurrent slice).
- **Engine notes**: result kind; already the S1 v8 pilot command.

### `prisma auth workspace list`
- **Summary**: "List locally authenticated workspaces".
- **Flags**: globals only. **Positionals**: none.
- **Auth**: local store; works while signed out (empty list, nextStep login).
- **API calls**: best-effort `GET /v1/workspaces/{id}` per stale workspace record to hydrate id/name (failures silent).
- **Behavior**: sync. **Output**: table id/name/active/source(`oauth|service_token`)/switchable/lastSeenAt; `serializeAuthWorkspaceList`. With `PRISMA_SERVICE_TOKEN` set, the token workspace is listed active and all OAuth entries as non-switchable.
- **Prompts**: none. **Side effects**: may rewrite hydrated workspace metadata into the credentials store.
- **Tests**: auth.test.ts, auth-real-mode.test.ts.
- **Engine notes**: result kind.

### `prisma auth workspace use [id-or-name]`
- **Summary**: "Switch the local CLI workspace".
- **Positionals**: `[id-or-name]` optional; omitted → single workspace auto-selected, multiple → interactive select, non-interactive multiple → USAGE_ERROR.
- **Flags**: globals only.
- **Auth**: local store. Fails `WORKSPACE_SWITCH_UNAVAILABLE` (exit 1) when `PRISMA_SERVICE_TOKEN` set.
- **API calls**: hydration GETs only. **Behavior**: sync + optional select prompt.
- **Output**: previous/selected workspace; `serializeAuthWorkspaceUse`. Errors: `WORKSPACE_NOT_AUTHENTICATED` (1), `WORKSPACE_AMBIGUOUS` (2), USAGE_ERROR "No authenticated workspaces" (2).
- **Side effects**: active-workspace pointer in credentials store.
- **Tests**: auth.test.ts, auth-real-mode.test.ts.
- **Engine notes**: result kind with an optional selection prompt (session if interactive).

### `prisma auth workspace logout <id-or-name>`
- **Summary**: "Remove one local OAuth workspace session".
- **Positionals**: `<id-or-name>` required (controller-level usage error when blank, exit 2).
- **Flags**: globals only. **Auth**: local store; works even with service token set (cleans local state only).
- **API calls**: hydration GETs. **Behavior**: sync.
- **Output**: removed workspace, wasActive, remaining active workspace (never auto-falls-through — user must `workspace use` next); `serializeAuthWorkspaceLogout`. Errors: `WORKSPACE_NOT_AUTHENTICATED`, `WORKSPACE_AMBIGUOUS`.
- **Side effects**: credentials store mutation.
- **Tests**: auth.test.ts, auth-real-mode.test.ts.
- **Engine notes**: result kind.

### `prisma project list`
- **Summary**: "List all projects in your workspace".
- **Flags**: globals only. **Positionals**: none.
- **Auth**: platform, via `requireAuthenticatedAuthState` (interactive login on TTY, else AUTH_REQUIRED); `WORKSPACE_REQUIRED` usage error if no workspace.
- **API calls**: `GET /v1/projects` (filtered client-side to the active workspace).
- **Behavior**: sync. **Output**: workspace header + project table + localBinding status (`linked|not-linked|invalid` from `.prisma/local.json`); `serializeProjectList`; nextActions steer setup when unlinked.
- **Prompts**: only the auto-login. **Side effects**: none.
- **Tests**: project.test.ts, project-controller.test.ts, project-real-mode.test.ts, project-usecases.test.ts.
- **Engine notes**: result kind; localBinding is a local-filesystem read blended into a remote result.

### `prisma project show`
- **Summary**: "Show this directory's Project binding".
- **Flags**: `--project <id-or-name>` + globals.
- **Auth**: platform+login. **API**: GET /v1/projects.
- **Behavior**: sync. **Output**: binding status, resolved project or null with `suggestedProjectName` + setup nextActions; `serializeProjectShow`. Errors: resolution family (`PROJECT_NOT_FOUND` 1, `PROJECT_AMBIGUOUS` 2, `LOCAL_STATE_STALE`, `LOCAL_PROJECT_WORKSPACE_MISMATCH`).
- **Tests**: project.test.ts, project-resolution.test.ts, project-real-mode.test.ts.
- **Engine notes**: result kind.

### `prisma project create <name>`
- **Summary**: "Create a Project and link this directory".
- **Flags**: `--region <region>` (Compute region id) + globals. **Positionals**: `<name>` required, validated non-empty (`projectSetupNameRequiredError`).
- **Auth**: platform+login. Fixture mode: refused with `FEATURE_UNAVAILABLE`.
- **API calls**: `ComputeClient.createProject` (POST /v1/projects).
- **Behavior**: sync; file-writing. **Output**: created project + link confirmation; `serializeProjectSetup`. Errors: `PROJECT_CREATE_FAILED` (permission-aware fix text), `LOCAL_STATE_WRITE_FAILED`.
- **Side effects**: writes `.prisma/local.json`, appends `.prisma/` to `.gitignore`.
- **Tests**: project.test.ts, project-real-mode.test.ts, project-mutations.test.ts.
- **Engine notes**: result kind; local pin write is part of the contract.

### `prisma project link [id-or-name]`
- **Summary**: "Link this directory to a Project".
- **Positionals**: `[id-or-name]` optional. **Flags**: globals only.
- **Auth**: platform+login. **API**: GET /v1/projects (+ POST /v1/projects when the picker's "create new" is chosen; fixture refuses creation).
- **Behavior**: with arg → sync; without arg on TTY (and not `--yes`) → interactive setup picker (`promptForProjectSetupChoice`: select existing / create new via text prompt / cancel); non-interactive without arg → `PROJECT_LINK_TARGET_REQUIRED` (exit 2, carries candidates + suggested name in meta/nextActions).
- **Output**: `serializeProjectSetup`. **Side effects**: `.prisma/local.json` + `.gitignore`.
- **Tests**: project.test.ts, project-mutations.test.ts, project-resolution.test.ts.
- **Engine notes**: session (picker) or result (explicit arg); the error meta is agent-oriented (candidate list) — preserve.

### `prisma project rename <name>`
- **Summary**: "Rename the resolved Project".
- **Flags**: `--project <id-or-name>` + globals. **Positionals**: `<name>` required non-empty.
- **Auth**: platform+login. **API**: PATCH /v1/projects/{id}.
- **Behavior**: sync. **Output**: renamed project + previousName; `serializeProjectRename`. Errors: `PROJECT_RENAME_FAILED`, resolution family.
- **Tests**: project-mutations.test.ts.
- **Engine notes**: result kind.

### `prisma project remove <project>`
- **Summary**: "Remove a Project permanently after exact id confirmation".
- **Flags**: `--confirm <project-id>` (must equal the resolved project id) + globals. **Positionals**: `<project>` id or name, required.
- **Auth**: platform+login. **API**: DELETE /v1/projects/{id}.
- **Behavior**: sync; no interactive prompt — confirmation is flag-only. `CONFIRMATION_REQUIRED` (exit 2, meta.expectedConfirm/receivedConfirm) when missing/mismatched.
- **Output**: removed project + `localPin.cleared`; `serializeProjectRemove`. Errors: `PROJECT_REMOVE_BLOCKED`, `PROJECT_NOT_FOUND`. Warning (not error) if the stale local pin cannot be deleted.
- **Side effects**: deletes `.prisma/local.json` when it pointed at the removed project.
- **Tests**: project-mutations.test.ts.
- **Engine notes**: consent-grade confirmation via exact-id flag; maps to needs.consent in the engine.

### `prisma project transfer <project>`
- **Summary**: "Transfer a Project to another workspace after exact id confirmation".
- **Flags**: `--to-workspace <id-or-name>` (locally authenticated recipient) XOR `--recipient-token <token>`; `--confirm <project-id>`; globals. Mutual exclusion and at-least-one enforced (USAGE_ERROR 2 / `TRANSFER_RECIPIENT_REQUIRED` 2).
- **Auth**: platform+login; `--to-workspace` additionally resolves a second OAuth session locally (`resolveRecipientWorkspaceSession` probes `GET /v1/workspaces` with the recipient tokens). With `PRISMA_SERVICE_TOKEN` set, `--to-workspace` fails `TRANSFER_RECIPIENT_UNAVAILABLE` (exit 1).
- **API**: POST /v1/projects/{id}/transfer (recipient access token in body).
- **Behavior**: sync. **Output**: project, recipient {workspaceId/name/source}, `localPin.action` (`rewritten|cleared|none`); `serializeProjectTransfer`. Errors: `PROJECT_TRANSFER_REJECTED`, `WORKSPACE_NOT_AUTHENTICATED`, `WORKSPACE_AMBIGUOUS`, `CONFIRMATION_REQUIRED` (2).
- **Side effects**: rewrites `.prisma/local.json` to the recipient workspace or deletes it.
- **Tests**: project-mutations.test.ts.
- **Engine notes**: exact-id consent + dual-credential use — the most complex needs.credentials story in the CLI.

### `prisma project env add`
- **Summary**: "Create a new environment variable."
- **Flags**:

| name | type | required | description |
|---|---|---|---|
| `--file <path>` | string | no | read KEY=VALUE assignments from a dotenv file (bulk mode) |
| `--role <production\|preview>` | enum | one of --role/--branch required | project template scope |
| `--branch <git-name>` | string | ″ | preview branch override scope |
| `--project <id-or-name>` | string | no | project override |

- **Positionals**: `[assignment]` — `KEY=VALUE` or bare `KEY` (value pulled from the caller's environment); mutually exclusive with `--file`.
- **Auth**: platform+login. **API**: GET /v1/environment-variables (dup check), POST /v1/environment-variables; `--branch` may create the branch (POST /v1/projects/{projectId}/branches) — `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` guards that.
- **Behavior**: sync. **Output**: metadata of the created var(s) (no values echoed); `serializeEnvAdd`. Errors: `ENV_VARIABLE_ALREADY_EXISTS`, `ENV_BRANCH_SCOPE_IS_PRODUCTION`, `ENV_BRANCH_NOT_FOUND`, `ENV_FILE_APPLY_FAILED` (partial-failure report for file mode), scope USAGE_ERRORs.
- **Prompts**: none. **Side effects**: none local.
- **Tests**: app-env.test.ts, app-env-vars.test.ts, app-env-presenter.test.ts.
- **Engine notes**: result kind; file mode is a batch with per-key partial failure semantics.

### `prisma project env update`
- Same flags/positional/auth/API family as `add` but replaces an existing value (PATCH /v1/environment-variables/{envVarId}); missing var → `ENV_VARIABLE_NOT_FOUND`; `--branch` never creates a branch here (resolveExistingBranch). Serializer `serializeEnvUpdate`. Tests as above.

### `prisma project env list`
- **Summary**: "List environment variable metadata for a scope (no values)."
- **Flags**: `--role`, `--branch`, `--project` (+ globals). No scope → overview across scopes (production, preview template, current branch overrides via `readLocalGitBranch`).
- **Auth**: platform+login. **API**: GET /v1/environment-variables (paginated), GET /v1/projects/{projectId}/branches.
- **Output**: metadata table (key, scope, updatedAt; never values); `serializeEnvList`. 
- **Tests**: app-env.test.ts. **Engine notes**: result kind.

### `prisma project env remove KEY` (alias: `rm`)
- **Flags**: `--role`, `--branch`, `--project`. **Positionals**: `<key>` required.
- **Auth**: platform+login. **API**: GET /v1/environment-variables (resolve id), DELETE /v1/environment-variables/{envVarId}.
- **Output**: removed key metadata; `serializeEnvRm`. Errors: `ENV_VARIABLE_NOT_FOUND`, scope errors.
- **Tests**: app-env.test.ts. **Engine notes**: result kind. Alias `rm` is undocumented (spec discrepancy #4).

### `prisma git connect [git-url]`
- **Summary**: "Connect the resolved project to a GitHub repository".
- **Flags**: `--project <id-or-name>` + globals. **Positionals**: `[git-url]` optional; falls back to the local `origin` remote (`readGitOriginRemote`); non-GitHub URL → `REPO_PROVIDER_UNSUPPORTED` (2); none at all → USAGE_ERROR (2).
- **Auth**: platform+login.
- **API calls**: GET /v1/source-repositories (existing check), GET /v1/scm-installations + GET /v1/scm-installations/{id}/repositories (paginated, per installation), POST /v1/scm-installations/install-intents (install URL), POST /v1/source-repositories.
- **Behavior**: sync when the repo is already reachable; otherwise browser-opening (install URL via `open` when interactive) + **polling**: re-lists installations every 2s (env `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS`) up to 120s (`PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS`) waiting for the GitHub App installation/repo access; terminal states: match found / `REPO_NOT_ACCESSIBLE` / `REPO_INSTALLATION_REQUIRED` (both exit 1, meta carries installUrl + opened).
- **Output**: repository connection record; **no renderJson serializer** (raw result). Errors also: `REPO_ALREADY_CONNECTED` (1), `REPO_CONNECTION_FAILED` (1, status-aware fix text; 401/403 → AUTH_REQUIRED).
- **Prompts**: none beyond the browser wait status line. **Side effects**: opens browser; fixture mode writes a pending connection into local state instead.
- **Tests**: project.test.ts, project-real-mode.test.ts (plus git-adapter.test.ts for URL parsing).
- **Engine notes**: session kind — browser hand-off + poll loop with progress ("Waiting for GitHub App installation…"), non-interactive short-circuit.

### `prisma git disconnect`
- **Flags**: `--project <id-or-name>` + globals. **Positionals**: none.
- **Auth**: platform+login. **API**: GET /v1/source-repositories, DELETE /v1/source-repositories/{id}.
- **Behavior**: sync. **Output**: the removed connection; no renderJson serializer. Error: `REPO_NOT_CONNECTED` (1), `REPO_CONNECTION_FAILED`.
- **Tests**: project.test.ts, project-real-mode.test.ts. **Engine notes**: result kind.

### `prisma branch list`
- **Summary**: "List Platform branches for the resolved project".
- **Flags**: globals only. **Positionals**: none. (No `--project` flag — resolution is pin/durable only; spec heading agrees.)
- **Auth**: platform+login. **API**: GET /v1/projects/{projectId}/branches, cursor-paginated to exhaustion.
- **Behavior**: sync. **Output**: branch table (name, role production/preview, envMap), production first; `serializeBranchList`. Errors: `BRANCH_API_ERROR` (or API code), resolution family.
- **Tests**: branch.test.ts, branch-controller.test.ts, branch-usecases.test.ts, read-branch.test.ts.
- **Engine notes**: result kind.

### `prisma build logs <buildId>`
- **Summary**: "Stream the logs for a build".
- **Flags**: `--follow` (keep the connection open for a running build), `--cursor <cursor>` (resume from a prior terminal cursor) + globals.
- **Positionals**: `<buildId>` required — a git-push/Console Build id, not a deployment id.
- **Auth**: platform via `requireComputeAuth` only — **no interactive login fallback**; unauthenticated → AUTH_REQUIRED (1).
- **API**: `GET /v1/builds/{buildId}/logs` with `parseAs: "stream"`, NDJSON records `{type:"log"| "terminal"}`.
- **Behavior**: stream. Human mode: log text to stdout (stderr for stderr-source/error-level), terminal non-`end` message to stderr; JSON mode: one event per record, **no wrapper success event** (`emitJsonSuccessEvent: false`). A `terminal error` record sets exit code 1 without throwing.
- **Output**: raw log lines on stdout — the only command whose primary human output is stdout line passthrough. Errors: `BUILD_NOT_FOUND` (404, indistinguishable for foreign builds), `BUILD_LOGS_FAILED`.
- **Prompts/side effects**: none.
- **Tests**: **none** (no test file references runBuildLogs/build.logs).
- **Engine notes**: stream kind with its own terminal-record protocol; the exit-code-via-record pattern must map onto engine stream termination status.

### `prisma database list`
- **Flags**: `--project <id-or-name>`, `--branch <git-name>` + globals.
- **Auth**: platform+login (all database commands: `requireAuthenticatedAuthState` + `requireComputeAuth`).
- **API**: GET /v1/databases (provider `createManagementDatabaseProvider`).
- **Behavior**: sync. **Output**: databases sorted branch→name→id; `serializeDatabaseList`. Plan-limit failures map to `PLAN_LIMIT_REACHED` with plan/upgrade info pulled from GET /v1/workspaces/{id}/subscription.
- **Tests**: database.test.ts, database-plan-limit.test.ts.
- **Engine notes**: result kind.

### `prisma database show <database>`
- **Flags**: `--project`, `--branch` + globals. **Positionals**: `<database>` id or name (resolved via list; `DATABASE_NOT_FOUND` 1 / `DATABASE_AMBIGUOUS` 1).
- **API**: GET /v1/databases (resolve), GET /v1/databases/{id}, GET /v1/databases/{id}/connections.
- **Output**: metadata + connection metadata, **no secret values**; `serializeDatabaseShow`. **Engine notes**: result kind.

### `prisma database create <name>`
- **Flags**: `--region <region>`, `--project`, `--branch` + globals. **Positionals**: `<name>` required non-empty.
- **API**: POST /v1/databases.
- **Behavior**: sync. **Output**: has a **renderStdout** payload — the one-time connection URL is printed to stdout (`renderDatabaseCreateStdout`), separate from the human summary on stderr; `serializeDatabaseCreate` includes connection + connectionString. Errors: `PLAN_LIMIT_REACHED`, `DATABASE_API_ERROR`, USAGE_ERROR.
- **Engine notes**: result kind with a distinct machine-consumable stdout secret — engine needs a "sensitive stdout payload" concept.

### `prisma database usage <database>`
- **Flags**: `--from <iso-date>`, `--to <iso-date>` (date-only expanded to UTC day start/end; invalid calendar dates rejected; from ≤ to enforced), `--project`, `--branch`.
- **API**: GET /v1/databases/{id}/usage. **Output**: period + metrics + generatedAt; `serializeDatabaseUsage`. **Engine notes**: result kind.

### `prisma database restore <database>`
- **Flags**: `--backup <backup-id>` (required — USAGE_ERROR without it), `--source-database <database>` (backup owner, defaults to target), `--confirm <database-id>` (must equal target id), `--project`, `--branch`.
- **API**: restore POST (provider.ts:473). **Behavior**: sync (restore is immediate & irreversible per the confirm copy). Errors: `CONFIRMATION_REQUIRED` (2), `DATABASE_BACKUP_NOT_FOUND`, `DATABASE_RESTORE_CONFLICT`. `serializeDatabaseRestore`.
- **Engine notes**: exact-id consent; destructive.

### `prisma database remove <database>`
- **Flags**: `--confirm <database-id>`, `--project`, `--branch`. **API**: DELETE /v1/databases/{id}. `CONFIRMATION_REQUIRED` exit 2. `serializeDatabaseRemove`. Result kind + consent.

### `prisma database backup list <database>`
- **Flags**: `--limit <n>` (integer 1–100, else USAGE_ERROR), `--project`, `--branch`. **API**: GET /v1/databases/{id}/backups. **Output**: backups + retentionDays + hasMore; `serializeDatabaseBackupList`. Errors: `DATABASE_BACKUPS_UNSUPPORTED`. Result kind.

### `prisma database connection list <database>`
- **Flags**: `--project`, `--branch`. **API**: GET /v1/databases/{id}/connections. Metadata only, no secrets; `serializeDatabaseConnectionList`. Result kind.

### `prisma database connection create <database>`
- **Flags**: `--name <name>` (default `cli-<timestamp>-<hex>`), `--project`, `--branch`. **API**: POST /v1/databases/{id}/connections. **Output**: renderStdout one-time connection URL + `serializeDatabaseConnectionCreate`. Errors: `DATABASE_CONNECTION_STRING_MISSING`. Result kind + sensitive stdout.

### `prisma database connection rotate <connection>`
- **Flags**: `--confirm <connection-id>` (exact id; exit 2 otherwise). **Positionals**: `<connection>` connection **id** (no project/branch flags; provider-only auth path). **API**: POST /v1/connections/{id}/rotate. **Output**: renderStdout new one-time URL; `serializeDatabaseConnectionRotate`. Errors: `DATABASE_CONNECTION_NOT_FOUND`. Result kind + consent + sensitive stdout.

### `prisma database connection remove <connection>`
- **Flags**: `--confirm <connection-id>`. **API**: DELETE /v1/connections/{id}. `serializeDatabaseConnectionRemove`. Result kind + consent.

### `prisma bucket list`
- **Flags**: `--project <id-or-name>`, `--branch <git-name>` + globals.
- **Auth**: platform+login. **API**: GET /v1/buckets.
- **Output**: bucket table; `serializeBucketList`. Tests: bucket.test.ts. Result kind.

### `prisma bucket create`
- **Flags**: `--name <name>` (auto-generated if omitted), `--project`, `--branch`. **API**: POST /v1/buckets. Errors: `BRANCH_NOT_FOUND`. `serializeBucketCreate`. Result kind.

### `prisma bucket delete <bucketId>`
- **Summary**: "Delete a bucket and all its access keys" (cascade documented in the confirm copy: permanently removes all objects and access keys).
- **Flags**: `--confirm <bucket-id>` (exact id; `CONFIRMATION_REQUIRED` exit 2). **Positionals**: `<bucketId>` required (id, not name).
- **API**: DELETE /v1/buckets/{bucketId}. Errors: `BUCKET_NOT_FOUND`. `serializeBucketDelete`.
- **Engine notes**: the canonical consent-grade example named in the S2 brief; exact-id flag, no prompt.

### `prisma bucket key list <bucketId>`
- **Positionals**: `<bucketId>`. **API**: GET /v1/buckets/{bucketId}/keys. Metadata only. `serializeBucketKeyList`. Result kind.

### `prisma bucket key create <bucketId>`
- **Summary**: "Create a bucket access key and print its one-time credentials".
- **Flags**: `--role <read|read_write>` (default read_write — anything not exactly `read` becomes read_write), `--name <name>` (auto-generated if omitted).
- **API**: POST /v1/buckets/{bucketId}/keys. **Output**: renderStdout one-time credentials (accessKeyId/secretAccessKey/endpoint/bucketName) + `serializeBucketKeyCreate`. Errors: `BUCKET_KEY_SECRET_MISSING`. Result kind + sensitive stdout.

### `prisma bucket key delete <bucketId> <keyId>`
- **Positionals**: both required (USAGE_ERROR 2 when blank). **No --confirm** (revocation is not id-confirmed — inconsistent with bucket delete; note for grammar review). **API**: DELETE /v1/buckets/{bucketId}/keys/{keyId}. Errors: `BUCKET_KEY_NOT_FOUND`. `serializeBucketKeyDelete`. Result kind.

### `prisma app build [app]`
- **Summary**: "Build the app locally into a deployable artifact".
- **Flags**: `--entry <path>` (Bun/auto), `--build-type <type>` (choices `APP_BUILD_TYPES` incl. `auto` default; auto+committed build block resolves via deploy's framework detection) + globals.
- **Positionals**: `[app]` — target key in a multi-app `prisma.compute.ts`.
- **Auth**: none (fully local) — but fixture mode refuses (`ensurePreviewAppMode`? No: app build does NOT call ensurePreviewAppMode; it is local-only and works in any mode).
- **API**: none. **Behavior**: sync local build (`executeAppBuild`).
- **Output**: artifact directory/entrypoint/buildType; `serializeAppBuild`. Errors: `BUILD_FAILED` (1), `FRAMEWORK_NOT_DETECTED`, `BUILD_SETTINGS_UNSUPPORTED`, `COMPUTE_CONFIG_*`, USAGE_ERROR for ambiguous auto detection.
- **Side effects**: writes the build artifact directory; runs framework build tooling as child processes.
- **Tests**: app-build.test.ts, app-bun-compat.test.ts, compute-config.test.ts.
- **Engine notes**: long-running local work → progress events; no credentials.

### `prisma app run [app]`
- **Summary**: "Run your app locally".
- **Flags**: `--entry <path>`, `--build-type <auto|…LOCAL_DEV_BUILD_TYPES>` (default auto; currently nextjs/bun have dev servers), `--port <port>` + globals. **Rejects `--json`** with USAGE_ERROR (exit 2) — it streams the framework dev server output directly.
- **Positionals**: `[app]` config target.
- **Auth/API**: none. **Behavior**: long-running local child process until exit/SIGINT; SIGINT → COMMAND_CANCELED (130); non-zero child exit → `RUN_FAILED` **with the child's exit code as the CLI exit code** (app.ts:349-355, runFailedError exitCode param).
- **Output**: pass-through dev-server output; on clean exit a summary (framework, entrypoint, port, command); `serializeAppRun` exists but is unreachable with --json rejected.
- **Tests**: app-local-dev.test.ts.
- **Engine notes**: closest thing to a "server" kind in the current CLI; exit-code passthrough is unique.

### `prisma app deploy [app]`
- **Summary**: "Creates a new deployment for the app".
- **Flags**:

| name | type | notes |
|---|---|---|
| `--app <name>` | string | app selector (create-if-missing semantics) |
| `--project <id-or-name>` | string | explicit project; mutually exclusive with --create-project and PRISMA_PROJECT_ID |
| `--create-project <name>` | string | create+link a Project first |
| `--branch <name>` | string | branch override (default: local git branch, else production) |
| `--framework <FRAMEWORK_KEYS>` | enum | nextjs/nuxt/astro/hono/nestjs/tanstack-start/custom/bun |
| `--entry <path>` | string | Bun deploys |
| `--http-port <port>` | string→int validated | port override |
| `--region <region>` | string | only for newly created apps; mismatch with an existing app's region → USAGE_ERROR |
| `--env <name=value\|file>` | repeatable string[] | assignment or dotenv file path |
| `--db` / `--no-db` | boolean | create+wire a branch database / skip; passing both → USAGE_ERROR (checked against raw argv) |
| `--prod` | boolean | confirm intent to replace the live production deployment |
| `--no-promote` | boolean | build without promoting; skips the production confirmation entirely |

- **Positionals**: `[app]` config target; with a multi-app config and no target, deploys **all** targets sequentially (deploy-all mode) and rejects per-app inputs (`--app/--framework/--entry/--http-port/--region/--env`, `PRISMA_APP_ID`) with USAGE_ERROR.
- **Auth**: platform via `requireComputeAuth` (no interactive login). Env overrides: `PRISMA_PROJECT_ID` (skips/never writes the local pin), `PRISMA_APP_ID`.
- **API calls**: ComputeClient `deployApp` (upload/build/deploy/promote with progress callbacks); POST /v1/projects (--create-project); GET/POST /v1/projects/{id}/branches (branch resolve/create); GET /v1/apps (selection); `--db`: GET/POST /v1/environment-variables + POST /v1/databases (+ DELETE on rollback of a failed setup).
- **Behavior**: long-running with step progress; interactive on first deploy (customize-settings confirm → framework select + port text), ambiguous app name select prompt, `--db` confirm prompt when a Prisma schema signal is found, production-deploy confirmation prompt, agent-setup prompt. Production rules (`enforceProductionDeployGate`): second-and-later production deploys need `--prod` (`PROD_DEPLOY_REQUIRES_FLAG` exit 2), plus `--yes` or an interactive confirm; cancel exits 0.
- **Output**: workspace/project/branch/app/deployment/deploySettings/durationMs; deploy-all wraps per-target results; `serializeAppDeploy` / `serializeAppDeployAll`. Errors: `DEPLOY_FAILED`, `BUILD_FAILED` (build-phase aware, Next standalone-output hint with edit-file nextAction), `APP_AMBIGUOUS` (2), `PROJECT_SETUP_REQUIRED`, `LOCAL_STATE_STALE`, `BRANCH_DATABASE_SETUP_FAILED`, `BUILD_SETTINGS_MIGRATION_REQUIRED`, `COMPUTE_CONFIG_*`, `FRAMEWORK_NOT_DETECTED`; deploy-all failures are re-wrapped with completed/not-attempted context in meta.deployAll.
- **Side effects**: may write `.prisma/local.json` (+ `.gitignore`); writes selected-app + known-live-deployment into state.json; uploads code; may create project/branch/database/env vars; runs local build child processes.
- **Tests**: app.test.ts, app-controller.test.ts, deploy-plan.test.ts, production-deploy-gate.test.ts, app-branch-database.test.ts, app-provider.test.ts, app-state.test.ts, app-env-vars.test.ts.
- **Engine notes**: the flagship session command: step/progress/status events, multiple consent points (--prod, --db, customize), env-var credential injection, and a deploy-all composite. The progress callbacks (`createDeployProgress`) are the natural source of engine progress events.

### `prisma app show [app]`
- **Flags**: `--app <name>`, `--project <id-or-name>` + globals. **Positionals**: `[app]` config target.
- **Auth**: platform. **API**: GET /v1/apps, ComputeClient.listDeployments.
- **Behavior**: sync; may select-prompt when several apps and no saved selection (non-interactive → USAGE_ERROR "App selection required"). Live deployment resolved via provider liveDeploymentId, falling back to the locally cached known-live id (a72f34a fix: never assumes newest is live).
- **Output**: app, liveDeployment, liveUrl, 5 recent deployments; `serializeAppShow`. Null app (none deployed) is a success with nextStep deploy.
- **Side effects**: caches selected app in state.json.
- **Tests**: app.test.ts, app-controller.test.ts, app-presenter.test.ts, app-state.test.ts.
- **Engine notes**: result kind (+ optional picker).

### `prisma app open [app]`
- **Flags**: `--app`, `--project`. **Auth**: platform. **API**: GET /v1/apps + listDeployments.
- **Behavior**: sync + browser-opening: opens the live URL with `open` only when `canPrompt`; otherwise reports `opened: false` and prints the URL.
- **Output**: url + opened flag; `serializeAppOpen`. Errors: `NO_DEPLOYMENTS` (1), `FEATURE_UNAVAILABLE` when no live URL.
- **Engine notes**: result + local browser action; the engine needs a "open URL on the client" effect.

### `prisma app domain add <hostname> [app]`
- **Flags** (shared domain target set): `--app <name>`, `--project <id-or-name>`, `--branch <name>` + globals.
- **Positionals**: `<hostname>` (normalized/validated → `DOMAIN_HOSTNAME_INVALID` 2), `[app]` config target.
- **Auth**: platform. Custom domains restricted to the production branch: non-production `--branch` → `BRANCH_NOT_DEPLOYABLE` (2). Env overrides PRISMA_PROJECT_ID/PRISMA_APP_ID honored.
- **API**: POST /v1/apps/{appId}/domains.
- **Output**: domain summary (status, dns records, certificate) + `existing` flag (idempotent re-add); `serializeAppDomainAdd`; nextSteps wait/show. Errors: `DOMAIN_ALREADY_REGISTERED` (registered to another app), `DOMAIN_QUOTA_EXCEEDED`, `DOMAIN_DNS_NOT_CONFIGURED`, `NO_DEPLOYMENTS`, `DEPLOY_FAILED` fallback.
- **Tests**: app.test.ts / app-controller.test.ts / app-provider.test.ts (domain sections).
- **Engine notes**: result kind.

### `prisma app domain show <hostname> [app]`
- Same target flags. **API**: list domains → GET /v1/domains/{domainId}. Output `serializeAppDomainShow`; `DOMAIN_NOT_FOUND` (1). Result kind.

### `prisma app domain remove <hostname> [app]`
- Same target flags. Confirmation: `--yes` skips; interactive confirm "Detach <hostname> from App …?" (default No); non-interactive without --yes → `CONFIRMATION_REQUIRED` **exit 1**; declining → USAGE_ERROR "Custom domain removal canceled" (2). **API**: DELETE /v1/domains/{domainId}. `serializeAppDomainRemove`. Consent-grade (yes/no, not exact-id).

### `prisma app domain retry <hostname> [app]`
- Same target flags. **API**: POST /v1/domains/{domainId}/retry. Errors: `DOMAIN_RETRY_NOT_ELIGIBLE`. `serializeAppDomainRetry`. Result kind.

### `prisma app domain wait <hostname> [app]`
- **Flags**: target set + `--timeout <duration>` (default "15m"; `0` = single check then timeout error).
- **Behavior**: **polling stream** via `runStreamingCommand`: emits a status line/JSON event on every status change (poll interval `PRISMA_CLI_DOMAIN_WAIT_POLL_MS`), GET /v1/domains/{id} each cycle. Terminal states: `active` (success, prints live URL), `failed` → `DOMAIN_VERIFICATION_FAILED` (1), deadline → `DOMAIN_VERIFICATION_TIMEOUT` (1).
- **Output**: status events; no result envelope beyond the streaming success event.
- **Engine notes**: canonical poll→status-events mapping case for the engine.

### `prisma app logs [app]`
- **Flags**: `--app <name>`, `--project <id-or-name>`, `--deployment <id>` + globals. **Positionals**: `[app]` config target.
- **Auth**: platform (log stream re-authenticates via `createPreviewLogAuthOptions` — service token or stored access token directly).
- **API**: deployment resolution (listApps/listDeployments/showDeployment) then `ComputeClient.streamDeploymentLogs`.
- **Behavior**: stream; without `--deployment` streams the live deployment (NO_DEPLOYMENTS when none). JSON mode: per-record events + wrapper success event.
- **Output**: log text to stdout; header block to stderr. Errors: `DEPLOYMENT_NOT_FOUND` (three variants: unknown id / detached app / foreign project), `NO_DEPLOYMENTS`, `DEPLOY_FAILED`.
- **Tests**: app.test.ts, app-controller.test.ts.
- **Engine notes**: stream kind.

### `prisma app list-deploys [app]`
- **Flags**: `--app`, `--project`. **Auth**: platform. **API**: GET /v1/apps + listDeployments.
- **Output**: deployments newest-first with live hint; null app = success; `serializeAppListDeploys`. Side effect: caches selected app. Result kind (+ optional picker).

### `prisma app show-deploy <deployment>`
- **Positionals**: `<deployment>` id required. **Flags**: globals only.
- **Auth**: platform. **API**: ComputeClient.showDeployment. No project resolution — the id is global.
- **Output**: deployment detail with corrected `live` flag (provider live id > cached known-live > record flag); `serializeAppShowDeploy`. Error: `DEPLOYMENT_NOT_FOUND` (1). Result kind.

### `prisma app promote <deployment> [app]`
- **Summary**: "Promote a deployment to production by rebuilding with production env vars".
- **Flags**: `--app`, `--project`. **Positionals**: `<deployment>` required, `[app]` config target.
- **Auth**: platform. **API**: listApps, listDeployments, ComputeClient.promoteDeployment (with progress rendering).
- **Behavior**: remote operation with progress; already-live target short-circuits with a warning instead of an error.
- **Output**: promoted deployment (status running, live true); `serializeAppPromote`. Errors: `DEPLOYMENT_NOT_FOUND`, USAGE_ERROR "App promote requires an existing app", `DEPLOY_FAILED`.
- **Side effects**: caches selected app + known live deployment. 
- **Engine notes**: session (progress events); note the local known-live cache is part of correctness for later `show`/`rollback`.

### `prisma app rollback [app]`
- **Summary**: "Roll back production to a previous deployment".
- **Flags**: `--app`, `--project`, `--to <deployment>` (explicit target; default = deployment immediately before the current live one).
- **Auth**: platform. **API**: same promote machinery (rollback = promote of an older deployment).
- **Output**: new live deployment + previousLiveDeploymentId; `serializeAppRollback`. Errors: `NO_PREVIOUS_DEPLOYMENT` (1), `DEPLOYMENT_NOT_FOUND`, `DEPLOY_FAILED`.
- **Engine notes**: session (progress); no confirmation prompt at all today (worth flagging: destructive-ish but unconfirmed).

### `prisma app remove [app]`
- **Summary**: "Remove the app from the resolved branch".
- **Flags**: `--app <name>`, `--project <id-or-name>`, `--branch <name>` (scopes teardown; empty string rejected with USAGE_ERROR so it cannot silently fall back to production — commit 484c60a) + globals (`--yes` is the documented confirm).
- **Positionals**: `[app]` config target.
- **Auth**: platform. **API**: ComputeClient.showApp + destroyApp (SDK polls status, 2s interval, 120s timeout).
- **Behavior**: destructive with **type-the-app-name** confirmation prompt on TTY; `--yes` skips; non-interactive without --yes → `CONFIRMATION_REQUIRED` **exit 1**.
- **Output**: removed app; `serializeAppRemove`; warnings if local state cleanup fails. Errors: `REMOVE_FAILED` (1), USAGE_ERROR "App remove requires an existing app".
- **Side effects**: clears selected-app and known-live-deployment from state.json.
- **Engine notes**: consent (typed-name — strongest grade in the CLI) + SDK-internal polling → progress events.

---

## 5. Current tests census

Fixture-mode counts are references to `fixturePath` per file (see command sections for the mapping):

- Heavy fixture users (fixture-mode CLI-level tests): project.test.ts (47), database.test.ts (40), init.test.ts (35), auth.test.ts (26), bucket.test.ts (25), app.test.ts (23), project-mutations.test.ts (16), shell.test.ts (15), update-check.test.ts (12), auth-real-mode.test.ts (6), branch.test.ts (5), project-controller.test.ts (5), version.test.ts (3), auth-controller.test.ts (2).
- Real-mode / unit tests (no fixture): app-controller, app-build, app-bun-compat, app-branch-database, app-local-dev, app-presenter, app-provider, app-state, app-env*, auth-login, auth-ops, auth-usecases, branch-controller, branch-usecases, command-runner(+auth), compute-config, database-plan-limit, deploy-plan, feedback, git-adapter, init-agent-setup, local-branch, output, production-deploy-gate, project-real-mode, project-resolution, project-usecases, prompt, read-branch, resolve-package-version, token-storage, v8-bin, v8-whoami.
- **Commands with no direct test coverage**: `build logs` (nothing references it), `agent update` (only via shared install path in agent.test.ts), `database usage`/`backup list`/`restore` real-mode paths are covered only through database.test.ts fixtures + provider unit tests.

## 6. Renames and grammar (v8)

- **app → service**: per the ruled grammar the deployable unit is **Service**. Affected surface: the entire `app` group (16 leaf commands), the `--app` flag on 9 commands, the `[app]` config-target positional on 14 commands, `PRISMA_APP_ID`, result fields `app{id,name}`, state-store keys (`setSelectedApp`), error copy ("App remove requires an existing app"), and `prisma.compute.ts`'s `app:` block (SDK-owned; rename coordination needed with @prisma/compute-sdk). `app build`/`app run` are local-dev verbs that may belong under the service noun or a dev namespace — flag for the spec author.
- **`project` stays platform-owned** (ruled 2026-08-10). The composer work parks under a separate `composer` root in S3; nothing in the current tree collides with that name.
- **`database` vs `postgres`**: the S2 brief says "database/postgres", but the current shell has **no `postgres` command or alias** — only `database`, described as "Manage Prisma Postgres databases". If the v8 grammar wants `postgres` as the resource noun, that is a pure rename (no alias exists to preserve).
- Grammar conflicts / irregularities in the current tree:
  - `app list-deploys` / `app show-deploy` break the `<group> <verb>` shape with hyphenated compound verbs; a Deployment resource noun (`deployment list/show`) would be regular.
  - `build` is a resource group (git builds) whose only verb is `logs`, while `app build` is a verb — same word, two meanings. The spec already plans `build list`/`build show`; the rename should disambiguate Service build (local) from platform Build (resource).
  - Deletion verbs are split: `remove` (project, database, app, env, connection) vs `delete` (bucket, bucket key). Confirmation styles are also split three ways: exact-id `--confirm` flag (project/database/bucket), `--yes`/interactive confirm (domain remove, prod deploy), typed-name prompt (app remove). The engine's consent grades should normalize these.
  - `auth logout --workspace X` duplicating `auth workspace logout X` is a compat shim worth collapsing.
  - `project env` is the env surface (moved off `app`); the S2 brief's "app (incl. env…)" reflects the old layout — env controllers still live in files named `app-env*.ts` and types in `types/app-env.ts` even though the commands are `project env *`.
  - Group descriptor `branch` says "View your Platform branches" — read-only group with one verb; fine, but the deploy path creates branches implicitly (POST branches), which the grammar should own explicitly.
