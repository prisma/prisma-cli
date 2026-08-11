# Engine spec — the package-manager capability

Status: ruled 2026-08-11 (the operator approved building the affordance; this document is the implementation spec). Deliverable: one PR to `packages/cli-engine`. The consumer is the ORM family's `init` command (ported in prisma/prisma), so the surface here is a contract between repos — treat every name in §2 as frozen unless the operator re-rules.

## 1. What this is and why

A command like `prisma init` scaffolds a project and installs the dependencies it just wrote into `package.json`. Today (in the ORM CLI being ported) the command spawns `pnpm add` / `npm install` / `npx skills add …` itself: it detects the manager, spells the argv, parses stderr, and phrases the failure prose.

Engine requirement R13 says the CLI never touches a package manager. Its intent is that the CLI must not become a second, worse package manager — installing command submodules into hidden `node_modules`, guessing at lockfiles, hiding what it runs. Running the user's own package manager, in the user's own project, at the user's explicit request, with the command visible and the failure structured, is not that. The operator has ruled the engine gains a first-class affordance for it, and that R13's text is amended to name the exception (§7).

The shape follows the engine's existing capability pattern (`managesCredentials`): a **capability, not a need** — declaring it never fails a run; it only adds a surface to the command's context.

## 2. The surface

### 2.1 Declaration

```ts
defineCommand({
  installsPackages: true,   // capability flag, same pattern as managesCredentials
  // …
})
```

Declaring `installsPackages: true` intersects `packages: PackageOperations` onto the handler's `CommandContext`. Commands without the declaration have no `ctx.packages` (a compile error, exactly as `ctx.credentialManager` behaves). Like `managesCredentials`, this needs its own `defineCommand` overload if inference collapses — check how the credentials overload solved it and mirror the mechanism.

### 2.2 `ctx.packages`

```ts
interface PackageOperations {
  install(request: {
    readonly packages: readonly string[];   // specifiers as the user would type them, e.g. "prisma-next@latest"
    readonly dev?: boolean;                 // dev dependency; default false
    readonly cwd?: string;                  // default ctx.cwd
    readonly manager?: PackageManagerId;    // explicit override; default Runtime.packageManager
  }): Promise<Result<{ command: string }, CliStructuredError>>;

  run(request: {
    readonly package: string;               // the package whose bin to execute, e.g. "skills"
    readonly args: readonly string[];
    readonly cwd?: string;                  // default ctx.cwd
    readonly manager?: PackageManagerId;    // explicit override; default Runtime.packageManager
  }): Promise<Result<{ command: string }, CliStructuredError>>;
}

type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun';
```

- `install` adds dependencies to the project at `cwd` (the manager's own add/install verb, with the manager's dev flag when `dev` is true).
- `run` is the one-off runner form — `npx` / `pnpm dlx` / `yarn dlx` / `bunx` — for executing a package's bin without adding a dependency. (The ORM `init`'s agent-skill install is this form.)
- Success resolves `ok({ command })` where `command` is the exact human-readable command line the engine ran (for presentation and telemetry-free logging by the caller).
- Failure resolves `notOk(CliStructuredError)` — never a throw for an install that failed; a throw remains what it always is (a bug).
- The `manager` override exists so a caller can retry with a different manager (§5). It is an override of the *choice*, not a bypass of the machinery.

### 2.3 The Runtime seam (bin-owned execution)

```ts
interface Runtime {
  // …existing members…
  runPackageManager?: (spec: {
    readonly file: string;                  // executable, e.g. "pnpm"
    readonly args: readonly string[];
    readonly cwd: string;
    readonly signal: AbortSignal;
  }) => Promise<{ exitCode: number; stderr: string }>;
}
```

The engine composes `file` + `args` and calls this; the bin spawns. The engine never imports `child_process`. When `runPackageManager` is absent and a command calls `ctx.packages.*`, the engine resolves `notOk` with the structured failure below (`meta.reason: 'runner-unavailable'`) — it does not throw, so a harness without the seam still exercises the failure path deterministically.

Stdout of the child is discarded by contract (managers write progress there; the engine's own step events are the progress surface). Stderr is captured, bounded (last 64 KiB), and carried on the failure for the caller's predicate (§5) after redaction (§3).

## 3. What the engine owns

1. **Manager choice.** `request.manager` if present, else `Runtime.packageManager`. No detection logic in the engine beyond that — detection already produced `Runtime.packageManager` at bin startup.
2. **Argv spelling** per manager for both forms (install: `npm install [-D]` / `pnpm add [-D]` / `yarn add [-D]` / `bun add [-d]`; run: `npx --yes` / `pnpm dlx` / `yarn dlx` / `bunx`). One module owns the spelling table; nothing else in the engine or in any command spells a manager command.
3. **Events.** One `step-started` / `step-finished` pair per operation, the step label carrying the human-readable command (`pnpm add -D prisma-next`). In json mode these frame like every other step event.
4. **Redaction.** Captured stderr is redacted before it is stored on the failure or surfaced anywhere: URL userinfo (`https://user:token@host` → `https://…@host`) and values of environment-variable-looking assignments containing `TOKEN`/`KEY`/`SECRET`/`PASSWORD`. The redaction helper is engine-internal and unit-tested on its own.
5. **The structured failure.** Code `CLI.INSTALL_FAILED` (both forms; the form is in meta). Shape:
   - `summary`: "Installing packages with pnpm failed" / "Running <package> with pnpm failed".
   - `meta`: `{ form: 'install' | 'run', manager, command, exitCode, stderrTail, reason?: 'runner-unavailable' }` (`stderrTail` redacted, bounded).
   - `nextActions`: one `run-command` action whose `command` is the exact command line, labeled "Run the install yourself".
   - Exit code: the command's own documented code decides what the *command* exits with; `CLI.INSTALL_FAILED` itself is an ordinary expected failure (2) when returned as the command's primary error.
6. **Cancellation.** `ctx.signal` aborts the child through the seam's `signal`; an aborted operation resolves `notOk` with the engine's standard cancellation semantics (the run then settles 130/143 as usual).

## 4. What the engine explicitly does NOT do

- No version resolution, no lockfile awareness, no workspace/catalog logic.
- No parsing of any manager's error output. The engine reports; interpretation belongs to the caller.
- No retries. Retry policy is caller logic (§5).
- No network probes, no registry configuration, no proxy handling — the child inherits the user's environment.
- No global installs; there is deliberately no `global` option.

## 5. The caller-side retry precedent (context, not engine work)

The ORM's `init` falls back from pnpm to npm when pnpm fails with a recognized workspace/catalog-resolution error. That policy stays in `init`'s handler: a documented predicate over `meta.stderrTail`, then a second `ctx.packages.install({ …, manager: 'npm' })`. The engine's `manager` override exists for exactly this call shape. The engine must not learn pnpm's error strings.

## 6. Testing

- `createTestCli` gains a `packageManagerRunner` seed (same shape as `Runtime.runPackageManager`). Absent → the runner-unavailable failure path. Present → a spy/scripted fake; tests can assert the composed `file`/`args`/`cwd` per manager and script exit codes and stderr, so a consumer command's full install matrix (success, failure, fallback retry, cancellation) runs with no network and no real manager.
- Engine unit coverage: the spelling table (every manager × both forms × dev flag), redaction, event framing, the absent-runner failure, abort propagation.
- Type tests: `ctx.packages` present iff `installsPackages: true`, mirroring the `managesCredentials` type tests.

## 7. The R13 amendment

R13's text (PR #128's requirements record) gains the exception in its own words, in the same change: the CLI never installs or manages packages *on its own initiative or into its own hidden state*; a command may run the user's package manager in the user's project through the engine's package operations, which make the command visible, the failure structured, and the execution bin-owned. The prohibition on the CLI acquiring command submodules or maintaining private package state stands.

## 8. Coordination and sequencing

- Lands in `packages/cli-engine` (one PR), then ships in a published `@prisma/cli-engine` version — the ORM port consumes it only from the published package.
- The S3/Composer stream is editing the same package; sequence the PR with the operator to avoid overlapping edits in `commands.ts` / `context.ts` / `runtime.ts` / `testing.ts`.
- The shipped engine source is normative where this document and the code disagree on existing mechanisms (overload shape, event kinds, settlement) — follow the code's established patterns.

## 9. Acceptance

- [ ] `installsPackages: true` adds typed `ctx.packages`; absent declaration means no such property (type test).
- [ ] Both operations compose correct argv for npm, pnpm, yarn, bun (unit-tested table), execute only through `Runtime.runPackageManager`, and never import `child_process` in the engine (import-purity check).
- [ ] Step events frame both operations in human and json modes.
- [ ] Failures are `CLI.INSTALL_FAILED` with the documented meta shape, redacted bounded stderr, and a `run-command` next action carrying the exact command; absent runner yields the same code with `reason: 'runner-unavailable'`.
- [ ] Abort via `ctx.signal` cancels the child and settles normally.
- [ ] `createTestCli` seeds `packageManagerRunner`; a sample command's install matrix is testable offline.
- [ ] R13's text amended in the same PR.
- [ ] `CLI.INSTALL_FAILED` documented wherever the engine catalogues its own codes.
