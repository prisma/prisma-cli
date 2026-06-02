# CLI I/O Timeouts Plan

## Assumptions

**A1** The first implementation should use generous fixed defaults in code rather than public flags or user-facing environment variables. This satisfies FR9, FR13, and A7 from the spec without adding configuration surface.

**A2** Timeout protection should target Prisma-controlled boundaries first: Management API calls, Compute SDK calls, OAuth callback/token exchange boundaries, GitHub installation polling, domain polling API calls, and remote log-stream inactivity. Local filesystem and credentials-store calls remain cancellation-aware but do not receive new timeout policy unless implementation reveals a clear CLI-controlled stall.

**A3** Dedicated timeout behavior tests are not required for the first slice. Existing tests should be updated only when signatures or error contracts change, and the project should still build and pass the existing test suite.

**A4** Node.js `>=22.12.0` is available, so the implementation can rely on modern AbortSignal primitives when they keep the code smaller. If a primitive produces ambiguous abort reasons, prefer a tiny local helper that preserves timeout-vs-cancel meaning.

**A5** Existing SDK operation deadlines such as deploy/promote/update/remove `timeoutSeconds: 120` are remote operation deadlines, not the generic stalled-I/O timeout contract. Keep them unless they directly conflict with OPERATION_TIMEOUT conversion.

## Open Questions

None.

## Phases

### Phase 1: Shared Timeout Contract

**Status**: ☐ Not started

**Goal**: Add one small, reusable timeout/error boundary that preserves the distinction between user cancellation and timeout-caused aborts.

**Requirements**: FR5, FR6, FR7, FR8, FR10, FR11, FR15, NFR2, NFR4, NFR5, NFR6, NFR7, NFR8

**Changes**:

- Add an `OPERATION_TIMEOUT` error constructor to `packages/cli/src/shell/errors.ts` with stable metadata for operation label, duration, timeout kind, and optional command/domain context.
- Teach `packages/cli/src/shell/command-runner.ts` to translate timeout-specific errors into the new `CliError` while continuing to translate root-signal cancellation into `COMMAND_CANCELED`.
- Add a small timeout utility under `packages/cli/src/shell` or `packages/cli/src/lib` that can derive a child signal from the root command signal without aborting the root signal and without losing the timeout reason.
- Keep the helper API narrow: operation label, duration, timeout kind, parent signal, and optional domain are enough for this slice.
- Avoid adding global command timeouts, public flags, or test-only configuration hooks.

**Acceptance Criteria**:

- Timeout-caused aborts render as `OPERATION_TIMEOUT` with exit code `1` in both normal and streaming command runners.
- User cancellation still renders as `COMMAND_CANCELED` with exit code `130`.
- JSON error envelopes include non-sensitive timeout metadata.
- `pnpm --filter @prisma/cli build` passes.

### Phase 2: Prisma API And SDK Request Boundaries

**Status**: ☐ Not started

**Goal**: Apply generous stalled-I/O deadlines to Prisma-controlled request and SDK call sites without changing command-level behavior.

**Requirements**: FR1, FR2, FR5, FR6, FR8, FR9, FR10, FR11, FR15, FR16, NFR1, NFR2, NFR3, NFR5, NFR7, NFR8

**Changes**:

- Route Management API calls in `packages/cli/src/lib/app/preview-provider.ts` through the shared timeout boundary, including domain, branch, compute-service, and project/service discovery calls.
- Route Compute SDK calls in `packages/cli/src/lib/app/preview-provider.ts` through the shared timeout boundary where the SDK accepts a signal, while preserving existing SDK operation deadlines for deploy/promote/update/remove.
- Route direct Management API calls in `packages/cli/src/controllers/project.ts` and `packages/cli/src/controllers/app-env.ts` through the same boundary for project, SCM installation, source repository, environment variable, and branch lookup/mutation calls.
- Route auth-related Management API calls in `packages/cli/src/lib/auth/auth-ops.ts` and `packages/cli/src/lib/auth/login.ts` through the same boundary for `/v1/me`, workspace lookup, login URL/token exchange-adjacent calls where the SDK accepts cancellation, and callback success-page workspace lookup.
- Preserve command-specific catches that convert platform states into domain-specific errors. Timeout errors should pass through unchanged or be converted only at the command boundary.
- Do not add timeouts to local package discovery, framework build execution, credentials-store calls, or arbitrary filesystem reads in this phase.

**Acceptance Criteria**:

- Every Prisma-controlled API/SDK call identified in the touched files either uses the shared timeout boundary or has a documented reason in code for not using it.
- Existing domain-specific errors such as `PROJECT_NOT_FOUND`, `DOMAIN_VERIFICATION_TIMEOUT`, and deploy failures remain reachable and are not masked by generic timeout conversion.
- Commands can still run longer than one request timeout while making progress across multiple bounded calls.
- `pnpm --filter @prisma/cli build` passes.
- `pnpm --filter @prisma/cli test` passes, unless existing unrelated tests are already failing; any unrelated failure must be documented before continuing.

### Phase 3: Long-Lived Workflow Inactivity Boundaries

**Status**: ☐ Not started

**Goal**: Protect long-lived Prisma-controlled waits from silent stalls without imposing total command deadlines.

**Requirements**: FR2, FR3, FR4, FR5, FR6, FR8, FR9, FR10, FR12, FR15, FR16, NFR1, NFR2, NFR3, NFR5, NFR6, NFR8

**Changes**:

- Keep `app domain wait --timeout` as the explicit total wait budget in `packages/cli/src/controllers/app.ts`, and apply request-scoped deadlines only to each status refresh inside the polling loop.
- Keep GitHub installation/repository approval polling in `packages/cli/src/controllers/project.ts` under its existing total wait semantics, and apply request-scoped deadlines to each SCM/source repository refresh.
- Add remote log-stream inactivity protection around `streamDeploymentLogs` in `packages/cli/src/lib/app/preview-provider.ts` or the `app logs` controller path, without treating a long but active stream as timed out.
- Leave local `app run` and local build processes without total deadlines. If implementation shows a bounded startup wait controlled by the CLI, use an inactivity deadline only around that startup boundary.
- Ensure timeout metadata identifies whether the failure came from a request boundary or inactivity boundary.

**Acceptance Criteria**:

- `app domain wait --timeout 0` keeps poll-once behavior and does not get reinterpreted as a network timeout setting.
- Long-lived workflows remain allowed to run indefinitely when they keep making observable progress or are designed to stream.
- Silent remote log-stream stalls fail with `OPERATION_TIMEOUT`, while user interruption remains `COMMAND_CANCELED`.
- `pnpm --filter @prisma/cli build` passes.
- `pnpm --filter @prisma/cli test` passes, unless existing unrelated tests are already failing; any unrelated failure must be documented before continuing.

### Phase 4: Product Documentation And Error Surface Alignment

**Status**: ☐ Not started

**Goal**: Make the timeout behavior part of the documented CLI contract without adding new public configuration surface.

**Requirements**: FR6, FR7, FR8, FR10, FR11, FR12, FR13, FR14, NFR2, NFR4, NFR5, NFR6, NFR7

**Changes**:

- Update `docs/product/error-conventions.md` to include `OPERATION_TIMEOUT`, its meaning, exit code behavior, and distinction from `COMMAND_CANCELED` and `DOMAIN_VERIFICATION_TIMEOUT`.
- Update `docs/product/command-spec.md` only where existing command-specific wait semantics need clarification, especially `app domain wait --timeout` and any long-lived streaming/wait command text.
- Keep output stream conventions unchanged in `docs/product/output-conventions.md`; update only if the implementation exposes a new structured timeout metadata convention that needs central documentation.
- Avoid documenting global timeout flags, public timeout environment variables, or retry behavior.

**Acceptance Criteria**:

- Product docs describe the timeout error contract clearly enough for users, CI, and agents to distinguish timeout from cancellation.
- Docs preserve existing command behavior and do not introduce out-of-scope configuration promises.
- `pnpm --filter @prisma/cli build` passes.

## Supplement: Command Timeout Callstacks

These callstacks describe the intended timeout placement, not exact implementation shape. Durations are proposed generous defaults for planning. They should remain fixed internal defaults in the first slice, not public command flags.

Timeout constants:

- `API_REQUEST_TIMEOUT = 60s`: one Prisma Management API HTTP request.
- `SDK_REQUEST_TIMEOUT = 60s`: one Compute SDK request-style operation such as list/show/create.
- `SDK_LONG_OPERATION_TIMEOUT = 120s`: existing Compute SDK remote operation deadline for deploy/promote/update/remove polling operations.
- `DOMAIN_WAIT_TOTAL_TIMEOUT = --timeout, default 15m`: existing user-facing `app domain wait` total wait budget.
- `GITHUB_INSTALL_TOTAL_TIMEOUT = 120s`: existing GitHub App installation/repository approval polling budget.
- `LOG_STREAM_INACTIVITY_TIMEOUT = 10m`: remote log stream may run forever while active, but fails after this much silence from the remote stream.
- `UPDATE_CHECK_REGISTRY_TIMEOUT = 3s`: existing advisory registry lookup timeout; this is not part of command execution and must not change the command result.
- `NO_TIMEOUT`: no new timeout because the command is local-only, user-driven, or a plausible long-running user-controlled path.

Shared prelude for normal command execution:

```text
runCli()
  maybeWriteCachedUpdateNotification()
    read cached state only
    optionally spawn update worker; original command does not wait

update worker, when spawned
  fetch npm registry [UPDATE_CHECK_REGISTRY_TIMEOUT]
```

Version and help commands:

```text
prisma-cli --version
  read bundled package metadata [NO_TIMEOUT]

prisma-cli version
  buildVersionResult() [NO_TIMEOUT]

prisma-cli --help / group help
  commander help rendering [NO_TIMEOUT]
```

Auth commands:

```text
prisma-cli auth login
  performLogin()
    create localhost callback server [NO_TIMEOUT]
    sdk.getLoginUrl() [API_REQUEST_TIMEOUT]
    open browser [NO_TIMEOUT]
    wait for browser callback or pasted callback URL [NO_TIMEOUT]
    sdk.handleCallback() / token exchange [API_REQUEST_TIMEOUT]
    resolveWorkspaceName()
      GET /v1/workspaces/{id} [API_REQUEST_TIMEOUT]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
    GET /v1/workspaces/{id} fallback [API_REQUEST_TIMEOUT]

prisma-cli auth logout
  performLogout() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
    GET /v1/workspaces/{id} fallback [API_REQUEST_TIMEOUT]

prisma-cli auth whoami
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
    GET /v1/workspaces/{id} fallback [API_REQUEST_TIMEOUT]
```

Project commands:

```text
prisma-cli project list
  requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
  listRealWorkspaceProjects()
    GET /v1/projects [API_REQUEST_TIMEOUT]
  read local binding [NO_TIMEOUT]

prisma-cli project show [--project]
  requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
  inspectProjectBinding()
    GET /v1/projects [API_REQUEST_TIMEOUT]
  read local binding [NO_TIMEOUT]

prisma-cli project create <name>
  requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
  provider.createProject()
    Compute SDK createProject [SDK_REQUEST_TIMEOUT]
  write local binding [NO_TIMEOUT]

prisma-cli project link [id-or-name]
  requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
  listRealWorkspaceProjects()
    GET /v1/projects [API_REQUEST_TIMEOUT]
  optional provider.createProject()
    Compute SDK createProject [SDK_REQUEST_TIMEOUT]
  write local binding [NO_TIMEOUT]
```

Project environment commands:

```text
prisma-cli project env add <assignment> --role/--branch [--project]
  requireClientAndProject()
    requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
    readAuthState() -> GET /v1/me [API_REQUEST_TIMEOUT]
    resolveProjectTarget() -> GET /v1/projects [API_REQUEST_TIMEOUT]
  resolveScopeToApi()
    GET /v1/projects/{projectId}/branches or equivalent [API_REQUEST_TIMEOUT]
    optional branch creation endpoint [API_REQUEST_TIMEOUT]
  findVariableByNaturalKey()
    GET /v1/environment-variables [API_REQUEST_TIMEOUT]
  POST /v1/environment-variables [API_REQUEST_TIMEOUT]

prisma-cli project env update <assignment> --role/--branch [--project]
  requireClientAndProject() [same as env add]
  resolveScopeToApi() [same as env add]
  findVariableByNaturalKey()
    GET /v1/environment-variables [API_REQUEST_TIMEOUT]
  PATCH /v1/environment-variables/{id} [API_REQUEST_TIMEOUT]

prisma-cli project env list [--role/--branch] [--project]
  requireClientAndProject() [same as env add]
  resolveScopeToApi() [same as env add]
  GET /v1/environment-variables [API_REQUEST_TIMEOUT]

prisma-cli project env remove <key> --role/--branch [--project]
prisma-cli project env rm <key> --role/--branch [--project]
  requireClientAndProject() [same as env add]
  resolveScopeToApi() [same as env add]
  findVariableByNaturalKey()
    GET /v1/environment-variables [API_REQUEST_TIMEOUT]
  DELETE /v1/environment-variables/{id} [API_REQUEST_TIMEOUT]
```

Git commands:

```text
prisma-cli git connect [git-url] [--project]
  requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
  resolveProjectTarget()
    GET /v1/projects [API_REQUEST_TIMEOUT]
  inspect existing source repository
    GET source repository endpoint(s) [API_REQUEST_TIMEOUT]
  resolve GitHub App installation/repository access
    GET /v1/scm-installations [API_REQUEST_TIMEOUT]
    GET /v1/scm-installations/{id}/repositories [API_REQUEST_TIMEOUT]
    if installation or access missing:
      POST /v1/scm-installations/install-intents [API_REQUEST_TIMEOUT]
      open browser [NO_TIMEOUT]
      poll for installation/access [GITHUB_INSTALL_TOTAL_TIMEOUT]
        each GET /v1/scm-installations [API_REQUEST_TIMEOUT]
        each GET /v1/scm-installations/{id}/repositories [API_REQUEST_TIMEOUT]
  connect repository endpoint [API_REQUEST_TIMEOUT]

prisma-cli git disconnect [--project]
  requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  readAuthState()
    GET /v1/me [API_REQUEST_TIMEOUT]
  resolveProjectTarget()
    GET /v1/projects [API_REQUEST_TIMEOUT]
  inspect existing source repository
    GET source repository endpoint(s) [API_REQUEST_TIMEOUT]
  disconnect repository endpoint [API_REQUEST_TIMEOUT]
```

Branch commands:

```text
prisma-cli branch list
  current preview real mode returns FEATURE_UNAVAILABLE [NO_TIMEOUT]
  fixture mode reads local/mock state [NO_TIMEOUT]

prisma-cli branch show
  current preview real mode returns FEATURE_UNAVAILABLE [NO_TIMEOUT]
  fixture mode reads local/mock state [NO_TIMEOUT]

prisma-cli branch use [name]
  current preview real mode returns FEATURE_UNAVAILABLE [NO_TIMEOUT]
  fixture mode reads/writes local/mock state and may prompt [NO_TIMEOUT]
```

Local app commands:

```text
prisma-cli app build
  detect framework and build locally [NO_TIMEOUT]
  run local build process [NO_TIMEOUT]

prisma-cli app run
  detect framework locally [NO_TIMEOUT]
  run local dev/runtime process [NO_TIMEOUT]
```

App deployment and app resource commands:

```text
prisma-cli app deploy [options]
  read local project pin and infer local project shape [NO_TIMEOUT]
  requireProviderAndDeployProjectContext()
    requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
    readAuthState() -> GET /v1/me [API_REQUEST_TIMEOUT]
    GET /v1/projects [API_REQUEST_TIMEOUT]
    optional provider.createProject() -> SDK createProject [SDK_REQUEST_TIMEOUT]
  resolve/create branch/app
    GET /v1/projects/{projectId}/branches [API_REQUEST_TIMEOUT]
    optional POST /v1/projects/{projectId}/branches [API_REQUEST_TIMEOUT]
    GET /v1/compute-services [API_REQUEST_TIMEOUT]
    optional POST /v1/compute-services [API_REQUEST_TIMEOUT]
  local framework detection/customization [NO_TIMEOUT]
  provider.deployApp()
    local build strategy [NO_TIMEOUT]
    Compute SDK deploy remote polling [SDK_LONG_OPERATION_TIMEOUT]
  write selected app/local deployment state [NO_TIMEOUT]

prisma-cli app show [--app] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  provider.listApps()
    GET /v1/compute-services [API_REQUEST_TIMEOUT]
  provider.listDeployments()
    SDK showService [SDK_REQUEST_TIMEOUT]
    SDK listVersions [SDK_REQUEST_TIMEOUT]

prisma-cli app open [--app] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  provider.listApps() [API_REQUEST_TIMEOUT]
  provider.listDeployments()
    SDK showService [SDK_REQUEST_TIMEOUT]
    SDK listVersions [SDK_REQUEST_TIMEOUT]
  open browser [NO_TIMEOUT]

prisma-cli app list-deploys [--app] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  provider.listApps() [API_REQUEST_TIMEOUT]
  provider.listDeployments()
    SDK showService [SDK_REQUEST_TIMEOUT]
    SDK listVersions [SDK_REQUEST_TIMEOUT]

prisma-cli app show-deploy <deployment>
  requirePreviewAppProvider()
    requireComputeAuth() [NO_TIMEOUT for credentials-store boundary]
  provider.showDeployment()
    SDK showVersion [SDK_REQUEST_TIMEOUT]
    findAppForDeployment()
      SDK listProjects [SDK_REQUEST_TIMEOUT]
      SDK listServices [SDK_REQUEST_TIMEOUT]
      SDK showService [SDK_REQUEST_TIMEOUT]
      SDK listVersions [SDK_REQUEST_TIMEOUT]
  readCurrentWorkspaceId()
    stateStore.read() [NO_TIMEOUT]
    fallback readAuthState() -> GET /v1/me [API_REQUEST_TIMEOUT]

prisma-cli app promote <deployment> [--app] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  provider.listApps() [API_REQUEST_TIMEOUT]
  provider.listDeployments()
    SDK showService [SDK_REQUEST_TIMEOUT]
    SDK listVersions [SDK_REQUEST_TIMEOUT]
  provider.promoteDeployment()
    Compute SDK promote remote polling [SDK_LONG_OPERATION_TIMEOUT]

prisma-cli app rollback [--to <deployment>] [--app] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  provider.listApps() [API_REQUEST_TIMEOUT]
  provider.listDeployments()
    SDK showService [SDK_REQUEST_TIMEOUT]
    SDK listVersions [SDK_REQUEST_TIMEOUT]
  provider.promoteDeployment()
    Compute SDK promote remote polling [SDK_LONG_OPERATION_TIMEOUT]

prisma-cli app remove [--app] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  provider.listApps() [API_REQUEST_TIMEOUT]
  provider.removeApp()
    SDK showService [SDK_REQUEST_TIMEOUT]
    Compute SDK destroyService remote polling [SDK_LONG_OPERATION_TIMEOUT]
```

App domain commands:

```text
prisma-cli app domain add <hostname> [--app] [--project] [--branch]
  resolveAppDomainTarget()
    requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
    provider.listApps() [API_REQUEST_TIMEOUT]
  provider.addDomain()
    POST /v1/compute-services/{id}/domains [API_REQUEST_TIMEOUT]
    on 409: GET /v1/compute-services/{id}/domains [API_REQUEST_TIMEOUT]

prisma-cli app domain show <hostname> [--app] [--project] [--branch]
  resolveAppDomainTarget() [same as domain add]
  resolveDomainByHostname()
    GET /v1/compute-services/{id}/domains [API_REQUEST_TIMEOUT]
  provider.showDomain()
    GET /v1/domains/{id} [API_REQUEST_TIMEOUT]

prisma-cli app domain remove <hostname> [--app] [--project] [--branch]
  resolveAppDomainTarget() [same as domain add]
  resolveDomainByHostname()
    GET /v1/compute-services/{id}/domains [API_REQUEST_TIMEOUT]
  provider.removeDomain()
    DELETE /v1/domains/{id} [API_REQUEST_TIMEOUT]

prisma-cli app domain retry <hostname> [--app] [--project] [--branch]
  resolveAppDomainTarget() [same as domain add]
  resolveDomainByHostname()
    GET /v1/compute-services/{id}/domains [API_REQUEST_TIMEOUT]
  provider.retryDomain()
    POST /v1/domains/{id}/retry [API_REQUEST_TIMEOUT]

prisma-cli app domain wait <hostname> [--timeout 15m] [--app] [--project] [--branch]
  resolveAppDomainTarget() [same as domain add]
  resolveDomainByHostname()
    GET /v1/compute-services/{id}/domains [API_REQUEST_TIMEOUT]
  wait loop [DOMAIN_WAIT_TOTAL_TIMEOUT]
    sleep poll interval [bounded by remaining DOMAIN_WAIT_TOTAL_TIMEOUT]
    provider.showDomain()
      GET /v1/domains/{id} [API_REQUEST_TIMEOUT]
```

App logs command:

```text
prisma-cli app logs [--app] [--deployment] [--project]
  requireProviderAndProjectContext() [API_REQUEST_TIMEOUT on auth/project requests]
  resolve deployment target
    provider.listApps() [API_REQUEST_TIMEOUT]
    provider.listDeployments()
      SDK showService [SDK_REQUEST_TIMEOUT]
      SDK listVersions [SDK_REQUEST_TIMEOUT]
    optional provider.showDeployment()
      SDK showVersion [SDK_REQUEST_TIMEOUT]
  provider.streamDeploymentLogs()
    get log auth token [NO_TIMEOUT for credentials-store boundary]
    stream remote logs [LOG_STREAM_INACTIVITY_TIMEOUT]
```

## Revision Log
