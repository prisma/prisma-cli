# Engine spec — the package-manager capability

Status: ruled 2026-08-11 (the operator approved building the affordance; this document is the implementation spec), **amended 2026-08-11** after a second round of operator rulings — see the amendment log at the end. Deliverable: one PR (PR #140's own branch), touching `packages/cli-engine` and the bin's Runtime assembly in `packages/cli`. The consumer is the ORM family's `init` command (ported in prisma/prisma), so the surface here is a contract between repos — treat every name in §2 as frozen unless the operator re-rules.

## 1. What this is and why

A command like `prisma init` scaffolds a project and installs the dependencies it just wrote into `package.json`. Today (in the ORM CLI being ported) the command spawns `pnpm add` / `npm install` / `npx skills add …` itself: it detects the manager, spells the argv, parses stderr, and phrases the failure prose.

Engine requirement R13 said, before this change, that the CLI never touches a package manager. Its intent was that the CLI must not become a second, worse package manager — installing command submodules into hidden `node_modules`, guessing at lockfiles, hiding what it runs. Running the user's own package manager, in the user's own project, at the user's explicit request, with the command visible and the failure structured, is not that. The operator has ruled the engine gains a first-class affordance for it, and that R13's text is amended to name the exception (§7).

The shape follows the engine's existing capability pattern (`managesCredentials`): a **capability, not a need** — declaring it never fails a run; it only adds a surface to the command's context.

## 2. The surface

### 2.1 Declaration

```ts
defineCommand({
  installsPackages: true,   // capability flag, same pattern as managesCredentials
  // …
})
```

Declaring `installsPackages: true` intersects `packages: PackageOperations` onto the handler's `CommandContext`. Commands without the declaration have no `ctx.packages` (a compile error, exactly as `ctx.credentialManager` behaves).

**`defineCommand` has no overloads** (operator ruling, 2026-08-11). The v8 draft carried two, with a note that a single signature had been tried and inference collapsed. A second capability flag would have made that four, and every further flag doubles it again. The claim was retested against the real API: one generic signature with both flags optional, each constrained `extends boolean`, infers correctly in all four combinations — the handler is context-sensitive, so TypeScript fixes both booleans from the object literal before checking the handler body, and a primitive-constrained parameter does not widen its literal. The overloads are deleted. Two consequences: an explicit `managesCredentials: false` now compiles where the overloads rejected it as an excess property, and `defineCommand`'s body carries one cast that only an explicit type-argument call could defeat.

The ruling came with a condition: **the type tests must use vitest's type matchers** (`expectTypeOf`) rather than the `export const x: true = …` style the existing tests use, so the inference claim is asserted by a suite that runs rather than by a file that merely compiles. Coverage: all four flag combinations, the `CommandHandler<typeof def>` annotation path, and explicit `false` behaving as omission.

**The setup is copied from Composer and the ORM, not invented** (operator ruling, 2026-08-11) — this repo has no vitest type-checking today. The shape that fits is the ORM's, because vitest here also runs the runtime suite: `typecheck: { enabled: true, include: ['tests/**/*.test-d.ts'] }`, which makes a plain `vitest run` execute the type tests with no change to the `test` script. `enabled: true` is the part that matters. The ORM's own `contract` package writes the same block WITHOUT it and its type tests consequently never run — the trap to avoid, and the reason this slice verifies the harness by breaking an assertion on purpose and watching the suite go red. Both repos use `*.test-d.ts` and both mix `expectTypeOf` for positive assertions with `@ts-expect-error` for "this must not compile"; that mixture is the house idiom, not a compromise.

### 2.2 `ctx.packages`

```ts
interface PackageOperations {
  install(request: {
    readonly packages: readonly string[];   // specifiers as the user would type them, e.g. "prisma-next@latest"
    readonly dev?: boolean;                 // dev dependency; default false
    readonly cwd?: string;                  // default ctx.cwd
    readonly manager?: PackageManagerId;    // explicit override; default = detection (§3.1)
  }): Promise<Result<void, CliStructuredError>>;

  run(request: {
    readonly package: string;               // the package whose bin to execute, e.g. "skills"
    readonly args: readonly string[];
    readonly cwd?: string;                  // default ctx.cwd
    readonly manager?: PackageManagerId;    // explicit override; default = detection (§3.1)
  }): Promise<Result<void, CliStructuredError>>;
}

type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno';
```

`deno` is in the set because the ORM's `init` supports it today: `formatAddArgs` spells `deno add npm:<pkg>` (`.../commands/init/detect-package-manager.ts`) and the one-off runner table spells `deno run -A npm:<pkg>` (`.../commands/init/skill-install.ts`, `formatPackageManagerCommand`). A four-member type would silently drop deno support at the port, which the project spec's parity bar (FR6) forbids as an undiscovered divergence. This widens the frozen §2 type by one member and needs operator confirmation.

Note which ORM function the runner table comes from: `skill-install.ts`'s `formatPackageManagerCommand` (`pnpm dlx` / `yarn dlx` / `bunx` / `npx` / `deno run -A npm:`), NOT `detect-package-manager.ts`'s `formatRunCommand`, which spells how to run a binary the project has already installed and is a different thing.

- `install` adds dependencies to the project at `cwd` (the manager's own add/install verb, with the manager's dev flag when `dev` is true).
- `run` is the one-off runner form — `npx` / `pnpm dlx` / `yarn dlx` / `bunx` — for executing a package's bin without adding a dependency. (The ORM `init`'s agent-skill install is this form.)
- Success resolves `okVoid()`. The caller gets NO command line back (operator ruling, 2026-08-11): the whole point of the capability is to hold the command away from the package manager, so returning a rendered command line on success hands back exactly what was abstracted away — and under R5 a product cannot print it anyway. The engine announces the command in the step label before it runs, streams the manager's output while it runs, and carries the runnable line on the failure's next action. Nothing is left for the caller to do with the string.
- Failure resolves `notOk(CliStructuredError)` — never a throw for an install that failed; a throw remains what it always is (a bug). The single exception is cancellation, which throws (§3.6).
- The `manager` override exists so a caller can retry with a different manager (§5). It is an override of the *choice*, not a bypass of the machinery.
- Neither operation can be called while another is still running (§3.7).

### 2.3 The Runtime seam (bin-owned execution)

```ts
interface Runtime {
  // …existing members…
  runPackageManager?: (spec: {
    readonly file: string;                  // executable, e.g. "pnpm"
    readonly args: readonly string[];
    readonly cwd: string;
    readonly signal: AbortSignal;
    /** Called with each chunk as the child writes it, so the engine can
     *  emit `output` events while the operation runs. */
    readonly onOutput: (
      channel: 'data' | 'diagnostic',
      chunk: string,
    ) => void;
  }) => Promise<{ exitCode: number; stderr: string }>;
}
```

The engine composes `file` + `args` and calls this; the bin spawns. The engine never imports `child_process`. When `runPackageManager` is absent and a command calls `ctx.packages.*`, the engine resolves `notOk` with the structured failure below (`meta.reason: 'runner-unavailable'`) — it does not throw, so a harness without the seam still exercises the failure path deterministically.

The child's output is streamed to `onOutput` as it arrives and surfaced as `output` events (§3.8). Stderr is ALSO accumulated, bounded (last 64 KiB), and carried on the failure for the caller's predicate (§5) after redaction (§3.4) — streaming it and buffering it are not alternatives.

Two cases the return type has to answer even though no child produced them, settled during implementation:

- **`exitCode` when the child never ran or was killed by a signal.** Both leave the spawner with no exit code of its own, and the field is a plain `number`. It reports `1`. (127 was the alternative, but "command not found" is a lie for the signal case, and the two are not distinguishable without a second field nobody needs — the consumer only branches zero versus non-zero.)
- **`stderr` when the child never started.** A process that failed to spawn wrote nothing, so the failure would carry no account of why the manager did not run. The adapter substitutes the spawn error's own short message, and ONLY when the child wrote nothing itself — so it can never displace real manager output, and it cannot accidentally satisfy §5's pnpm predicate, which matches `ERR_PNPM_*` and catalog/workspace text.

**The bin implements this seam in the same change.** It is optional on the interface so the harness can exercise the absent-runner path, not so the shipped binary can omit it: with no bin implementation every `ctx.packages` call in the ORM and Composer ports fails `runner-unavailable`, which is the whole capability dead on arrival. `packages/cli` already depends on execa (`^9.6.1`); the implementation is a thin adapter, and it is the only place on the v8 engine that spawns a package manager. It is not yet the only place in the repo: the legacy commander shell spawns its own, with its own detection, in `packages/cli/src/controllers/init.ts` and `packages/cli/src/lib/agent/package-manager.ts`. That becomes true when S2d ports `init` and retires the shell.

## 3. What the engine owns

1. **Manager choice — the engine detects.** `request.manager` if present, else `Runtime.packageManager` if the host supplied one, else detection from the project at `cwd`. Detection always yields a concrete manager, so `ctx.packages` can never fail for want of one (operator ruling, 2026-08-11: the engine either finds a way to perform the action or fails with a structured error — "we couldn't tell what you use" is neither).

   **The mechanism is the ORM's, copied** (operator ruling, 2026-08-11): the `package-manager-detector` package, exact-pinned at `1.8.0` — the version the ORM resolves today, zero runtime dependencies, which is the same bar `@stricli/core` was held to. `detect({ cwd })` with the library's default strategies, then the user agent, then `'npm'`. Using the same library rather than a re-implementation is the point: the ORM's `init` must behave identically before and after the port, and a hand-rolled lookalike would diverge the first time the library changed a precedence rule.

   **One exception: the engine reads the user agent from `Runtime.env`, not from the library.** The library's `getUserAgent()` reads `process.env.npm_config_user_agent` directly, which R4 forbids — the engine takes the environment through `Runtime`, never off the process. Reading a file under `cwd` is not an R4 violation (R4 bans process globals, and the engine already resolves modules from `cwd` in `dependencyResolvable` and reads files in the config loader), but reading `process.env` plainly is. So `detect({ cwd })` is used as-is and only the user-agent step is done by the engine: take `Runtime.env['npm_config_user_agent']`, split on `/`, accept the leading token if it names a known manager. That parse is four lines and is exactly what the library does. The practical payoff is that `createTestCli`'s `env` seed decides that step instead of the ambient process, so the test is deterministic.

   Two consequences of the library's behavior, inherited deliberately and documented here so they are not rediscovered as bugs: it walks parent directories all the way to the filesystem root with no project boundary, so a stray lockfile above the project is picked up; and within one directory a `package.json` `packageManager` field beats a lockfile.

   **`Runtime.packageManager` is deleted.** It exists today only to spell the install command inside `missingDependencyError` (`src/execution/needs.ts`, reached from `needs.dependencies` and `ctx.requireDependency`), it is populated from `npm_config_user_agent` alone (`packages/cli/src/v8/runtime.ts`), and that variable is unset whenever the CLI is not invoked through a package-manager script — which is the common case. Its `'unknown'` member is what forces that error into a next action with no runnable command. Detection replaces it at both call sites, and `'unknown'` leaves the codebase. What remains on `Runtime` is an OPTIONAL `packageManager?: PackageManagerId` override for hosts that know better; `createTestCli`'s existing seed becomes that override unchanged. Reading the project from disk is not an R4 violation — R4 bans process globals, and the engine already resolves modules from `cwd` in `dependencyResolvable` and reads files in the config loader.
2. **Argv spelling** per manager for both forms. The table is the ORM's current spelling, so the port is behavior-identical (install: `<pm> add [-D]` for npm/pnpm/yarn/bun — note the ORM uses npm's `add` alias, not `install` — and `deno add [--dev] npm:<pkg>`; run: `npx` / `pnpm dlx` / `yarn dlx` / `bunx` / `deno run -A npm:`). One module owns the table; nothing else in the engine or in any command spells a manager command, and `missingDependencyError` reads the same table instead of its own private copy.
3. **Events.** One `step-started` / `step-finished` pair per operation, the step label carrying the human-readable command (`pnpm add -D prisma-next`). In json mode these frame like every other step event.
4. **Redaction.** Captured stderr is redacted before it is stored on the failure or surfaced anywhere: URL userinfo (`https://user:token@host` → `https://…@host`) and values of environment-variable-looking assignments containing `TOKEN`/`KEY`/`SECRET`/`PASSWORD`. The redaction helper is engine-internal and unit-tested on its own.
5. **The structured failure.** Code `CLI.PACKAGE_MANAGER_FAILED` — one code for both forms, named for what it covers rather than for the install form alone, because machine consumers branch on `code` and a failed `run` reporting an install code is a lie (operator ruling, 2026-08-11, superseding the `CLI.INSTALL_FAILED` name this document first carried). Shape:
   - `summary`: "Installing packages with <manager> failed" / "Running <package> with <manager> failed". The manager name is interpolated from the resolved manager; no manager name is ever hardcoded in a message, here or anywhere else in the engine.
   - `meta`: `{ form: 'install' | 'run', manager, command, exitCode, stderrTail, reason?: 'runner-unavailable' }` (`stderrTail` redacted, bounded).
   - `nextActions`: one `run-command` action whose `command` is the exact command line, labeled "Run the install yourself" (install form) / "Run the command yourself" (run form).
   - Exit code: the command's own documented code decides what the *command* exits with; `CLI.PACKAGE_MANAGER_FAILED` itself is an ordinary expected failure (2) when returned as the command's primary error.
6. **Cancellation.** `ctx.signal` aborts the child through the seam's `signal`. An aborted operation THROWS the signal's abort reason rather than resolving `notOk` (operator ruling, 2026-08-11): the engine's existing cancellation path keys off a thrown abort cause (`settleThrown` → `settleAborted`, `src/execution/settlement.ts`), and only that path settles 130/143. A returned structured error settles 2 like any other expected failure, so resolving `notOk` on abort would make Ctrl-C during an install exit differently from Ctrl-C anywhere else. This is the one exception to §2.2's "never a throw": an abort is not an install that failed.
7. **Serialization.** Concurrent `ctx.packages.*` calls are NOT permitted (operator ruling, 2026-08-11) — two package managers writing one project's lockfile corrupt it. A second call made while one is in flight is caller error, not a race the engine papers over: the engine rejects it as a bug (`CLI.INTERNAL_ERROR`, exit 1), the same treatment any other contract violation gets.
8. **Progress output.** The package manager's own stdout/stderr reaches the user as `output` events (`source: <manager>`, `channel: 'data' | 'diagnostic'`) while the operation runs, so a slow install is not silence under a static step label. This is why the seam takes an `onOutput` callback (§2.3) rather than only returning a final buffer: the seam's shape is a published cross-repo contract, and adding streaming to it after the ORM and Composer compile against it would cost a coordinated release across three repos. Rendering policy is the engine's under R5 — commands hand the operation over and say nothing about how it is displayed.

### 3a. Details settled during implementation

Answers to questions the sections above left open. Recorded so they are contract, not folklore.

- **Redaction covers the streamed output too**, both channels, not only the captured stderr tail. §3.4's wording named stderr, but the `--json` event stream is precisely where a token must not land, and a manager prints to stdout at least as readily. Test-pinned.
- **The engine assembles lines from chunks.** The seam delivers whatever the pipe gives it; the `output` event's field is a line. The engine holds a partial line across chunks, flushes any remainder when the child exits, and strips a trailing `\r`.
- **The engine does not re-bound the stderr tail.** The 64 KiB bound is the seam's contract and the adapter enforces it in bytes; re-bounding in the engine would apply a different unit to the same value for no gain.
- **Runner-unavailable still fills the whole `meta` shape** — `exitCode: 1` (the same sentinel §2.3 sets for a child that never ran) and `stderrTail: ''` — so no consumer has to branch on whether a field is present.
- **An operation that never ran emits no step events.** §3.3 says one pair per operation; a call that failed because there is no runner never became one, and announcing `step-started` for a command nothing spawned would tell the user we tried.
- **Summaries are sentences** and end with a period, matching every other engine summary; the fragments quoted in §3.5 are the wording, not the punctuation.

## 4. What the engine explicitly does NOT do

- No version resolution, no lockfile awareness, no workspace/catalog logic.
- No parsing of any manager's error output. The engine reports; interpretation belongs to the caller.
- No retries. Retry policy is caller logic (§5).
- No network probes, no registry configuration, no proxy handling — the child inherits the user's environment.
- No global installs; there is deliberately no `global` option.

## 5. The caller-side retry precedent (context, not engine work)

The ORM's `init` falls back from pnpm to npm when pnpm fails with a recognized workspace/catalog-resolution error. That policy stays in `init`'s handler: a documented predicate over `meta.stderrTail`, then a second `ctx.packages.install({ …, manager: 'npm' })`. The engine's `manager` override exists for exactly this call shape. The engine must not learn pnpm's error strings.

The predicate already exists — `isRecognisedPnpmResolutionError` in the ORM's `init.ts` matches `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`, `ERR_PNPM_NO_MATCHING_VERSION`, and three regexes over catalog/workspace specifier text. It moves to the ported handler unchanged. Confirming the engine's side of the contract is enough here: `meta.stderrTail` must carry enough of stderr for those matches to still fire, which the 64 KiB bound covers, and redaction must not eat the `ERR_PNPM_*` tokens (it targets URL userinfo and secret-looking assignments, so it does not).

## 5a. Who actually consumes this

Verified against both product repos (2026-08-11):

- **The ORM** is the consumer. Its `init` installs two dependency sets through `execFile` and runs the agent-skills installer through the one-off runner form, with the pnpm→npm fallback above.
- **Composer does not install anything, by explicit design.** It never invokes a package manager in any shipped code path; it resolves already-installed bins and modules itself (walking up `node_modules/.bin`, `createRequire`) and, when something is missing, raises a structured error naming the fix. That rule is stated in three separate file headers. Composer therefore needs no part of this capability, and its port should not acquire one.
- **This repo's own `init`** is the second real consumer: today it installs `@prisma/compute` via execa (`packages/cli/src/controllers/init.ts`), and S2d ports it. S2d's contract does not currently mention that install; it should be amended to route it through `ctx.packages` once this lands.

## 6. Testing

- `createTestCli` gains a `packageManagerRunner` seed (same shape as `Runtime.runPackageManager`). Absent → the runner-unavailable failure path. Present → a spy/scripted fake; tests can assert the composed `file`/`args`/`cwd` per manager and script exit codes and stderr, so a consumer command's full install matrix (success, failure, fallback retry, cancellation) runs with no network and no real manager.
- Engine unit coverage: the spelling table (every manager × both forms × dev flag), redaction, event framing, the absent-runner failure, abort propagation, the concurrent-call rejection.
- Detection coverage on real temp directories, one case per precedence step, mirroring the ORM's own suite (`test/commands/init/detect-package-manager.test.ts`) so a behavior change in the library is caught here rather than in the port: lockfile in `cwd`; lockfile in an ancestor; `packageManager` field beating a lockfile in the same directory; user agent used when no manifest or lockfile exists anywhere; the `npm` default when nothing at all matches.
- Type tests: `ctx.packages` present iff `installsPackages: true`, mirroring the `managesCredentials` type tests.

## 7. The R13 amendment

R13's text (PR #128's requirements record) gains the exception in its own words, in the same change: the CLI never installs or manages packages *on its own initiative or into its own hidden state*; a command may run the user's package manager in the user's project through the engine's package operations, which make the command visible, the failure structured, and the execution bin-owned. The prohibition on the CLI acquiring command submodules or maintaining private package state stands.

## 8. Coordination and sequencing

- Lands on PR #140's own branch (`spec/package-manager-capability`) — the implementation joins the spec on the open PR rather than stacking behind it (operator, 2026-08-11). Touches `packages/cli-engine` and the bin's Runtime assembly in `packages/cli`, then ships in a published `@prisma/cli-engine` version; the ORM port consumes it only from the published package.
- The S3/Composer stream is editing the same package; sequence the PR with the operator to avoid overlapping edits in `commands.ts` / `context.ts` / `runtime.ts` / `testing.ts`.
- The shipped engine source is normative where this document and the code disagree on existing mechanisms (overload shape, event kinds, settlement) — follow the code's established patterns.

## 9. Acceptance

- [ ] `installsPackages: true` adds typed `ctx.packages`; absent declaration means no such property (type test).
- [ ] Both operations compose correct argv for npm, pnpm, yarn, bun (unit-tested table), execute only through `Runtime.runPackageManager`, and never import `child_process` in the engine (a test asserting the engine's import graph — the project's conformance checker does not exist yet and this slice does not build it).
- [ ] Detection resolves a concrete manager from the project (§3.1), with unit coverage per signal and per precedence step; `Runtime.packageManager` is gone from the interface and its two former call sites read the detected value.
- [ ] The bin implements `runPackageManager`; a real `prisma` invocation installs a package end to end.
- [ ] Step events frame both operations in human and json modes; the manager's own output surfaces as `output` events.
- [ ] Failures are `CLI.PACKAGE_MANAGER_FAILED` with the documented meta shape, redacted bounded stderr, and a `run-command` next action carrying the exact command; absent runner yields the same code with `reason: 'runner-unavailable'`. No message hardcodes a manager name.
- [ ] Abort via `ctx.signal` cancels the child and settles 130/143.
- [ ] A second concurrent `ctx.packages.*` call fails as a bug (`CLI.INTERNAL_ERROR`, exit 1).
- [ ] `createTestCli` seeds `packageManagerRunner`; a sample command's install matrix is testable offline.
- [ ] R13's text amended in the same PR.
- [ ] Cataloguing the code is explicitly NOT in this slice: the engine catalogues its codes nowhere, and building that catalogue is project slice S9, ruled to land after the ports and the commander shell's retirement (operator, 2026-08-11).

## 10. Amendment log — operator rulings, 2026-08-11

Each entry names what the first draft said, what it says now, and why.

1. **Detection replaces `Runtime.packageManager`** (§3.1). Was: the bin detects and hands in a manager, engine has no detection. Now: the engine detects with the ORM's own library, `Runtime.packageManager` is deleted and reappears only as an optional host override. Why: the field was fed by `npm_config_user_agent` alone, which is unset for a directly-invoked CLI, so the spec's motivating example resolved `'unknown'` on the common path.
2. **An undetectable manager is not a failure mode** (§3.1). Detection ends at `'npm'`, so the operation is always attempted. Why: offering an operation and then refusing it for want of detection is the worst of both.
3. **`deno` joins `PackageManagerId`** (§2.2). Why: the ORM supports it today; omitting it is a silent parity regression. **Needs operator confirmation — this widens a frozen §2 name.**
4. **`CLI.INSTALL_FAILED` → `CLI.PACKAGE_MANAGER_FAILED`** (§3.5), and no message hardcodes a manager name.
5. **Cancellation throws instead of resolving `notOk`** (§3.6). Why: only a thrown abort reaches `settleAborted`; a returned error settles 2, so Ctrl-C during an install would have exited differently from Ctrl-C anywhere else.
6. **Concurrent calls are rejected as a caller bug** (§3.7). Why: two managers on one lockfile corrupt it, and silently serializing hides the caller's mistake.
7. **The manager's output is streamed** (§3.8, §2.3). The seam gains `onOutput`. Why: the seam is a published cross-repo contract, so adding streaming after the ports compile against it costs a coordinated release.
8. **The bin implements the seam in this change** (§2.3). Why: optional on the interface is for the test harness, not for the shipped binary; without it every `ctx.packages` call fails at runtime.
9. **Consumers verified** (§5a). Composer never invokes a package manager by design and needs none of this; this repo's own `init` is a second consumer via S2d.
10. **Documenting the code moves out of this slice** (§9) into project slice S9.
11. **Success returns nothing** (§2.2). Was: `ok({ command })`. Why: the capability exists to keep the command away from the package manager, and returning a rendered command line on success hands back precisely what was abstracted away. R5 forbids a product printing it regardless.
12. **`defineCommand`'s overloads are deleted** in favour of one generic signature (§2.1), with vitest type matchers required to prove the inference holds.

## 11. Open — needs a ruling before the ORM port

**How a command offers a package-manager command it did NOT run.** The ORM's `init --no-install` prints the commands it would have run as manual steps. Ported, that becomes a `run-command` next action — and building one needs a spelled command line while nothing executes. Amendment 11 removed the only way a handler could obtain one, correctly, but this case is real and R5 forbids the product spelling it itself. Two candidate shapes, neither built:

- **A spelling-only call** on `ctx.packages` that returns the line and runs nothing. Small; matches how the failure's next action already works; the string exists only where it is meant to be runnable.
- **A next-action shape the engine fills in** — the handler names the operation, the engine renders the whole action. Tighter, but it adds to the shared next-action vocabulary and only earns that if other engine surfaces want the same thing.

This does not block the current PR: nothing in this repo needs it until `init` ports.
