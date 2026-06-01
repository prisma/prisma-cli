# CLI Cancellation Propagation Analysis

## Scope

This analysis maps where to thread `AbortController`/`AbortSignal` from CLI entrypoint to underlying I/O.

Current state: cancellation is not modeled as a first-class runtime concern. Most flows rely on natural process termination or library-specific behavior.

SDK baseline after targeted update:

- `@prisma/management-api-sdk@1.35.0` uses `openapi-fetch@0.14.0`; per-call options extend `RequestInit`, so `client.GET/POST/PATCH/DELETE(..., { signal })` is available.
- `@prisma/compute-sdk@0.20.0` exposes `signal?: AbortSignal` on `ComputeClient` operation options, build strategy methods, archive/build helpers, polling, and log streaming.

## Design Target

- Create one `AbortController` at app entry (`runCli`/`bin.ts` boundary).
- Map keyboard cancellation (`SIGINT`, optional `SIGTERM`) to `controller.abort(...)` only at that boundary.
- Propagate `AbortSignal` through runtime/context -> command runner -> controllers -> libs/adapters/providers -> network/fs/process I/O.
- Standardize cancellation handling into one CLI error shape (e.g. `command canceled`) instead of ad-hoc exits.

## Primary Augmentation Path

1. Runtime/context surface:
   - `packages/cli/src/shell/runtime.ts`
   - Add `signal: AbortSignal` to `CliRuntime` and `CommandContext`.
2. Entrypoint wiring:
   - `packages/cli/src/bin.ts`
   - `packages/cli/src/cli.ts`
   - Create controller, attach signal listeners, pass signal into `runCli` runtime.
3. Command execution wrappers:
   - `packages/cli/src/shell/command-runner.ts`
   - Ensure cancellation exceptions map to a dedicated `CliError` path for both `runCommand` and `runStreamingCommand`.
4. Controller and dependency signatures:
   - `packages/cli/src/controllers/*.ts`
   - `packages/cli/src/lib/**/*.ts`
   - `packages/cli/src/adapters/**/*.ts`
   - Thread optional `{ signal?: AbortSignal }` into async boundaries.

## Pseudocode Call Stacks To Update

### 1) Common command execution path (all commands)

```ts
bin.ts
  -> create AbortController
  -> on SIGINT/SIGTERM: controller.abort(reason)
  -> runCli({ ..., signal: controller.signal })

cli.ts runCli(runtime)
  -> createProgram(runtime)
  -> program.parseAsync(...)
  -> command.action(...)
  -> runCommand/runStreamingCommand(runtime, ...)

command-runner.ts
  -> createCommandContext(runtime, flags) // context includes signal
  -> handler(context)
  -> map AbortError/canceled to CliError(CANCELED)
```

### 2) App deploy path (long-running + network-heavy)

```ts
commands/app/index.ts createDeployCommand
  -> runCommand(..., (ctx) => runAppDeploy(ctx, ...))

controllers/app.ts runAppDeploy
  -> requireProviderAndDeployProjectContext(ctx, ...)
  -> provider.listApps(..., { signal })
  -> provider.deployApp(..., { signal, progress })
  -> stateStore.setSelectedApp(..., { signal? optional if store supports })

lib/app/preview-provider.ts deployApp
  -> sdk.deploy({ ..., signal })
  -> PreviewBuildStrategy.canBuild(signal) / execute(signal)
  -> underlying build, archive, upload, HTTP, and polling calls honor signal
```

### 3) App logs path (streaming)

```ts
commands/app/index.ts createLogsCommand
  -> runStreamingCommand(..., (ctx) => runAppLogs(ctx, ...))

controllers/app.ts runAppLogs
  -> provider.streamDeploymentLogs({ deploymentId, signal: ctx.runtime.signal, onRecord })

lib/app/preview-provider.ts streamDeploymentLogs
  -> streamLogs({ ..., signal })
  -> CancelledError => map to standard cancellation result/error boundary
```

### 4) Polling loops (must become signal-aware sleeps)

```ts
controllers/app.ts runAppDomainWait
  while (...) {
    await provider.showDomain(..., { signal })
    await sleep(interval, signal) // reject on abort
  }

controllers/project.ts waitForInstalledRepository
  while (...) {
    await listScmInstallations(..., { signal })
    await sleep(interval, signal)
  }

adapters/token-storage.ts acquireRefreshLock
  while (...) {
    signal.throwIfAborted()
    await fs.open(...)
    await sleep(100, signal)
  }
```

### 5) Local process execution (`app run`)

```ts
controllers/app.ts runAppRun
  -> runLocalApp({ ..., signal: ctx.runtime.signal })

lib/app/local-dev.ts runLocalApp
  -> spawnCommand(..., { signal }) // kill child on abort
  -> normalize AbortError vs child exit signal behavior
```

## I/O Boundaries Requiring Signal Propagation

- Management API client calls (`client.GET/POST/PATCH/DELETE`) can now receive `{ signal }` in:
  - `packages/cli/src/controllers/app-env.ts`
  - `packages/cli/src/controllers/project.ts`
  - `packages/cli/src/lib/auth/auth-ops.ts`
  - `packages/cli/src/lib/app/preview-provider.ts`
- Compute SDK operations can now receive `signal` in `packages/cli/src/lib/app/preview-provider.ts`:
  - `sdk.deploy`, `sdk.promote`, `sdk.updateEnv`, `sdk.destroyService`, `sdk.createProject`, `sdk.showService`, `sdk.showVersion`, and related list/delete/start/stop operations.
  - `streamLogs({ ..., signal })` already has a signal option and returns `CancelledError` on abort.
  - SDK `BuildStrategy` methods now accept `canBuild(signal)` and `execute(signal)`; this repo's `PreviewBuildStrategy` and `executePreviewBuild` should forward the signal to concrete SDK build strategies.
- Child processes:
  - `spawn` path in `packages/cli/src/lib/app/local-dev.ts`
  - `execFile` path in `packages/cli/src/adapters/git.ts`
- Poll/sleep loops:
  - `packages/cli/src/controllers/app.ts`
  - `packages/cli/src/controllers/project.ts`
  - `packages/cli/src/adapters/token-storage.ts`
- File system ops:
  - Push `signal` through local helper signatures even when the final external operation cannot consume it.
  - `readFile` and `writeFile` support `AbortSignal` through an options object. Current string-encoding calls must become object-form calls, e.g. `readFile(path, { encoding: "utf8", signal })`.
  - Current usage appears in `packages/cli/src/adapters/local-state.ts`, `packages/cli/src/lib/project/local-pin.ts`, `packages/cli/src/lib/project/resolution.ts`, `packages/cli/src/lib/app/bun-project.ts`, `packages/cli/src/lib/app/preview-build.ts`, `packages/cli/src/controllers/app.ts`, `packages/cli/src/adapters/mock-api.ts`, and `packages/cli/src/adapters/token-storage.ts`.
  - For external filesystem calls that do not support `signal`, call `signal.throwIfAborted()` immediately before the operation and add a short comment at that boundary explaining that the external API does not accept `AbortSignal`.
  - For unsupported read-only operations with no dangerous cancellation side effects, also check `signal.throwIfAborted()` after the awaited operation before returning the result.

## Unsupported I/O Boundary Rule

Thread `AbortSignal` through internal APIs until the exact external I/O boundary. If that external API does not support `signal`, stop propagation there deliberately:

```ts
async function readSomething(path: string, signal: AbortSignal) {
  // External API does not accept AbortSignal; check immediately before I/O.
  signal.throwIfAborted();
  const result = await unsupportedExternalRead(path);
  signal.throwIfAborted();
  return result;
}
```

Apply this to:

- `CredentialsStore` methods in `packages/cli/src/adapters/token-storage.ts`; the adapter should accept/propagate `signal`, check before store calls, use signal-aware local sleeps, and document that `CredentialsStore` itself cannot consume `AbortSignal`.
- Node filesystem promise calls without native `signal` support, such as `access`, `copyFile`, `cp`, `lstat`, `mkdir`, `open`, `readdir`, `readlink`, `rm`, and `stat`.
- OAuth/login helper calls if their external SDK/browser/listener boundaries cannot consume `signal`.

## Execution Notes (Important)

- Do not add local `Promise.race` cancellation shims to fake abort behavior around non-cancelable upstream APIs.
- Push `AbortSignal` as deep as possible; ignore it only at the external I/O function that does not support it, with a comment and `signal.throwIfAborted()` guard.
- Convert all internal `sleep` helpers to `sleep(ms, signal)` and reject immediately on abort.
- Keep cancellation mapping centralized in `command-runner.ts`; controllers should mostly propagate, not reinterpret.
- `@clack/prompts` cancellations already raise usage errors; keep keyboard signal cancellation separate and higher priority at runtime boundary.
