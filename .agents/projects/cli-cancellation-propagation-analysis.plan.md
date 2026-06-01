# CLI Cancellation Propagation Plan

## Assumptions

- **A1 Spec source:** This plan implements `.agents/projects/cli-cancellation-propagation-analysis.spec.md` and uses `docs/architecture/cancellation-propagation-analysis.md` as implementation source material.
- **A2 Dependency baseline:** The current package versions already satisfy the SDK baseline: `@prisma/management-api-sdk@^1.35.0` and `@prisma/compute-sdk@^0.20.0`.
- **A3 Error model:** Cancellation uses `COMMAND_CANCELED`, domain `cli`, and exit code `130`.
- **A4 Runtime boundary:** `bin.ts` owns OS signal listeners and `runCli` accepts a runtime signal for tests and embedded invocation.
- **A5 Verification surface:** Vitest tests under `packages/cli/tests` are the primary regression suite, with targeted tests added near the affected shell, provider, adapter, and controller behavior.
- **A6 Implementation discipline:** The plan does not add fake `Promise.race` cancellation around non-cancelable external APIs. Unsupported boundaries get immediate `signal.throwIfAborted()` checks and a short boundary comment.

## Open Questions

None.

## Phases

### Phase 1: Runtime Root And Central Cancellation Error

**Status:** ✓ Complete

**Goal:** Establish a thin end-to-end cancellation path from CLI entry to command-runner error output before changing deeper I/O code.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR18, FR19, NFR2, NFR3, NFR4, NFR5, NFR6

**Changes:**

- **C1 Entrypoint:** Update `packages/cli/src/bin.ts` to create one `AbortController`, map `SIGINT` and `SIGTERM` to controller abort, and pass the signal into `runCli`.
- **C2 Runtime type:** Update `packages/cli/src/cli.ts` and `packages/cli/src/shell/runtime.ts` so `CliRuntime` always has a signal, while tests and embedded callers can pass their own signal.
- **C3 Context type:** Ensure `CommandContext` exposes the same signal through `runtime.signal` without creating per-command controllers.
- **C4 Error helper:** Add a `COMMAND_CANCELED` `CliError` helper in `packages/cli/src/shell/errors.ts` with domain `cli`, exit code `130`, concise human summary, and no misleading recovery instructions.
- **C5 Error conversion:** Update `packages/cli/src/shell/command-runner.ts` so both `runCommand` and `runStreamingCommand` convert DOM abort errors, aborted runtime signals, and known cancellation exceptions into the centralized cancellation error.
- **C6 Product docs:** Update `docs/product/error-conventions.md` with `COMMAND_CANCELED` and the exit-code exception for cancellation.
- **C7 Tests:** Add shell/runner tests covering human JSON output, streaming JSON error events, exit code `130`, and preservation of prompt usage-error behavior.

**Acceptance Criteria:**

- [x] **AC1:** A handler that aborts through `runtime.signal` returns a formatted `COMMAND_CANCELED` error for regular commands.
- [x] **AC2:** A streaming handler that aborts through `runtime.signal` emits a streaming error event instead of raw exception output.
- [x] **AC3:** Cancellation exits with code `130` and does not alter success output shapes.
- [x] **AC4:** Existing CLI shell tests pass with no command surface changes.
- [x] **AC5:** `pnpm --filter @prisma/cli test -- shell.test.ts command-runner-auth.test.ts prompt.test.ts` passes, or equivalent targeted Vitest filters if filenames change.

### Phase 2: Command And Controller Signal Plumbing

**Status:** ✓ Complete

**Goal:** Thread the command signal through controller and command-handler boundaries so deeper I/O phases can consume it without broad follow-up signature churn.

**Requirements:** FR3, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR18, FR19, NFR2, NFR4, NFR5

**Changes:**

- **C1 Controller contracts:** Update affected controllers in `packages/cli/src/controllers` to read cancellation from `context.runtime.signal` and pass it into async dependencies that perform I/O.
- **C2 App command path:** Prepare `runAppDeploy`, `runAppLogs`, `runAppRun`, domain wait, app environment, and app state flows to pass `{ signal }` into provider, local-dev, state, and helper calls.
- **C3 Project command path:** Prepare project setup, repository installation polling, project listing, and local resolution calls to pass `{ signal }` into API, local state, and helper calls.
- **C4 Auth command path:** Prepare auth operations, login helpers, workspace lookup, and token storage calls to pass `{ signal }` into SDK/client and adapter calls where the boundary is under CLI control.
- **C5 Adapter and lib options:** Introduce small options objects only where existing APIs already need multiple optional controls; otherwise pass the signal directly when that keeps signatures clearer.
- **C6 Tests:** Update existing controller and command tests to construct runtimes with signals and add one representative controller propagation assertion for each command group touched.

**Acceptance Criteria:**

- [x] **AC1:** TypeScript requires new async I/O call sites in controllers/libs/adapters to consciously accept or ignore a signal.
- [x] **AC2:** Existing controller tests pass after runtime construction updates.
- [x] **AC3:** No command handler installs OS signal listeners or creates a command-lifetime controller.
- [x] **AC4:** `pnpm --filter @prisma/cli test -- auth.test.ts project.test.ts app.test.ts branch.test.ts` passes, or equivalent targeted filters if filenames change.

### Phase 3: SDK And Provider Cancellation

**Status:** ☐ Not started

**Goal:** Propagate cancellation through Management API and Compute SDK boundaries, especially app deploy and logs.

**Requirements:** FR8, FR9, FR10, FR17, FR19, NFR1, NFR2, NFR3, NFR6

**Changes:**

- **C1 Management API calls:** Add `{ signal }` to supported `client.GET`, `client.POST`, `client.PATCH`, and `client.DELETE` calls in `packages/cli/src/controllers/app-env.ts`, `packages/cli/src/controllers/project.ts`, `packages/cli/src/lib/auth/auth-ops.ts`, `packages/cli/src/lib/auth/login.ts`, and `packages/cli/src/lib/app/preview-provider.ts`.
- **C2 Compute operations:** Add signal propagation to Compute SDK operations in `packages/cli/src/lib/app/preview-provider.ts`, including project, service, version, deploy, promote, env update, destroy, list, start/stop, and related operations.
- **C3 Deploy build strategy:** Update `packages/cli/src/lib/app/preview-build.ts` so `PreviewBuildStrategy.canBuild` and `PreviewBuildStrategy.execute` forward the signal into concrete SDK build strategies and preview build helpers.
- **C4 Log streaming:** Ensure `streamLogs` receives the command signal and `CancelledError` maps to the central `COMMAND_CANCELED` path rather than provider-local error handling.
- **C5 Provider tests:** Extend `packages/cli/tests/app-provider.test.ts`, `packages/cli/tests/app-build.test.ts`, `packages/cli/tests/auth-ops.test.ts`, and app-env/project API tests to assert signal forwarding at representative SDK/client boundaries.

**Acceptance Criteria:**

- **AC1:** Representative Management API calls receive the same `AbortSignal` from command context.
- **AC2:** Representative Compute SDK calls receive the same `AbortSignal` from command context.
- **AC3:** App log stream cancellation produces `COMMAND_CANCELED` through command-runner mapping.
- **AC4:** Preview build strategy methods accept and forward the signal without changing build selection behavior.
- **AC5:** `pnpm --filter @prisma/cli test -- app-provider.test.ts app-build.test.ts auth-ops.test.ts app-env.test.ts project.test.ts` passes, or equivalent targeted filters if filenames change.

### Phase 4: Polling, Sleeps, And Local Processes

**Status:** ☐ Not started

**Goal:** Make CLI-owned waiting and subprocess execution responsive to cancellation.

**Requirements:** FR11, FR12, FR13, FR15, FR17, FR19, NFR1, NFR6, NFR7

**Changes:**

- **C1 Shared sleep behavior:** Convert internal sleeps in `packages/cli/src/controllers/app.ts`, `packages/cli/src/controllers/project.ts`, and `packages/cli/src/adapters/token-storage.ts` to accept `AbortSignal` and reject promptly on abort.
- **C2 Polling loops:** Update app domain wait and project repository-installation polling to check cancellation before each poll and use signal-aware sleeps between polls.
- **C3 Local app process:** Update `packages/cli/src/lib/app/local-dev.ts` and `runAppRun` so spawned local app processes receive cancellation and abort-related exits normalize into `COMMAND_CANCELED` instead of `RUN_FAILED` or ad-hoc exit-code handling.
- **C4 Git process:** Update `packages/cli/src/adapters/git.ts` so `execFile` operations observe cancellation at the supported child-process boundary.
- **C5 Tests:** Add or update tests in `packages/cli/tests/app-local-dev.test.ts`, `packages/cli/tests/git-adapter.test.ts`, `packages/cli/tests/project-controller.test.ts`, and `packages/cli/tests/app-controller.test.ts` to cover cancellation during sleep, polling, and subprocess execution.

**Acceptance Criteria:**

- **AC1:** Signal-aware sleeps reject immediately when already aborted and reject without waiting for the full interval when aborted during sleep.
- **AC2:** Polling loops do not perform an extra API call after cancellation is observed.
- **AC3:** Local app process cancellation does not produce `RUN_FAILED` for `SIGINT` or `SIGTERM` cancellation paths.
- **AC4:** Git adapter cancellation is test-covered at the process boundary.
- **AC5:** `pnpm --filter @prisma/cli test -- app-local-dev.test.ts git-adapter.test.ts project-controller.test.ts app-controller.test.ts` passes, or equivalent targeted filters if filenames change.

### Phase 5: Filesystem And Token Storage Boundaries

**Status:** ☐ Not started

**Goal:** Push cancellation through local filesystem and credential-storage helpers while documenting unsupported external boundaries.

**Requirements:** FR14, FR15, FR16, FR17, FR19, NFR1, NFR4, NFR5

**Changes:**

- **C1 Native signal filesystem calls:** Convert `readFile` and `writeFile` string-encoding calls to object-form calls with `{ encoding: "utf8", signal }` in `packages/cli/src/adapters/local-state.ts`, `packages/cli/src/adapters/mock-api.ts`, `packages/cli/src/lib/project/local-pin.ts`, `packages/cli/src/lib/project/resolution.ts`, `packages/cli/src/lib/app/bun-project.ts`, `packages/cli/src/lib/app/preview-build.ts`, and `packages/cli/src/controllers/app.ts` where those helpers are in scope.
- **C2 Unsupported filesystem calls:** Add immediate cancellation checks and boundary comments around unsupported Node filesystem promise calls such as `access`, `copyFile`, `cp`, `lstat`, `mkdir`, `open`, `readdir`, `readlink`, `rm`, and `stat`.
- **C3 Read-only post-checks:** Add post-I/O cancellation checks for unsupported read-only operations before returning their result.
- **C4 Token storage:** Update `packages/cli/src/adapters/token-storage.ts` so public adapter methods accept and propagate the signal, lock acquisition uses signal-aware sleep, and `CredentialsStore` calls are guarded with boundary comments because the store cannot consume `AbortSignal`.
- **C5 OAuth/browser helpers:** Guard `open` and any OAuth SDK/browser/listener boundary that cannot consume `AbortSignal` with the unsupported boundary rule.
- **C6 Tests:** Extend `packages/cli/tests/token-storage.test.ts`, `packages/cli/tests/app-state.test.ts`, `packages/cli/tests/app-bun-compat.test.ts`, and relevant project/app tests for aborted filesystem and token-storage paths.

**Acceptance Criteria:**

- **AC1:** Supported `readFile` and `writeFile` calls receive the command signal where reachable from command execution.
- **AC2:** Unsupported filesystem and credential-store boundaries have immediate abort checks and short comments at the boundary.
- **AC3:** Token refresh-lock wait exits promptly on abort.
- **AC4:** No local race-based cancellation wrappers are introduced.
- **AC5:** `pnpm --filter @prisma/cli test -- token-storage.test.ts app-state.test.ts app-bun-compat.test.ts project-controller.test.ts app-controller.test.ts` passes, or equivalent targeted filters if filenames change.

### Phase 6: End-To-End Verification And Cleanup

**Status:** ☐ Not started

**Goal:** Prove cancellation behavior across the CLI surface and remove inconsistencies left by incremental propagation.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18, FR19, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6, NFR7

**Changes:**

- **C1 Full audit:** Search for remaining async I/O boundaries without a propagated signal or deliberate unsupported-boundary guard.
- **C2 Error audit:** Ensure no controller maps cancellation into `RUN_FAILED`, `DEPLOY_FAILED`, auth errors, usage errors, or raw thrown errors.
- **C3 Stream audit:** Verify regular and streaming command output both use the documented cancellation envelopes.
- **C4 Type cleanup:** Remove redundant optional signal plumbing where the signal is always available from `CliRuntime`, keeping only options objects that carry real optional behavior.
- **C5 Documentation cleanup:** Ensure `docs/product/error-conventions.md` and architecture notes do not conflict with the resolved spec decisions.
- **C6 Full verification:** Run the CLI test suite and build.

**Acceptance Criteria:**

- **AC1:** No remaining CLI-owned polling loop uses a non-signal-aware sleep.
- **AC2:** No supported SDK, child-process, or filesystem boundary lacks the propagated command signal where the upstream API accepts it.
- **AC3:** Unsupported boundaries are guarded and documented locally without fake cancellation wrappers.
- **AC4:** Human and JSON cancellation output are stable for regular and streaming commands.
- **AC5:** `pnpm --filter @prisma/cli test` passes.
- **AC6:** `pnpm --filter @prisma/cli build` passes.

## Revision Log
