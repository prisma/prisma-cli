# Does a use-case layer earn its place in the unported CLI?

Scope: the commands not yet ported to `@prisma/cli-engine` — `app` (deploy, build, run, env, domain, logs, promote, rollback, remove, show, list-deploys, open), `init`, `agent`, `build logs`, `feedback`, `version`, and the shared resolution machinery under `lib/app/`, `lib/project/`, `lib/git/` and `lib/agent/`. About 17,400 lines. There is no `service` command in this repository; the scope note that named one appears to be stale.

Every path below is absolute and rooted at the worktree `/Users/wmadden/Projects/prisma/prisma-cli/.claude/worktrees/s2b-resources-handover-5be347`. Line numbers are from the state of `s2b2-domain-extraction` at the time of reading.

## Verdict

**Yes, but only for about a fifth of one command.** Real domain logic exists in this part of the CLI, it is not evenly spread, and outside `app deploy` there is not enough of it to fill a layer. Roughly 700 to 900 lines out of 17,400 are box 4 — about 4 to 5 percent. Of that, close to 500 lines sit in the `app deploy` family, where the density reaches about 20 percent. Everywhere else the density is 3 percent or less, and the pieces are individually small enough that a plain exported function is already the right home — which is where most of them already live.

The case for building the layer does not rest on the volume of logic. It rests on two things I could measure: the engine port is **already** reaching into the legacy controllers for shared logic in 23 of its 65 files, and the same project-resolution policy is **already** written twice and has **already** drifted. A use-case layer earns its place as the destination for logic that two shells both need, not as a home for decisions that only one command makes.

## What box 4 actually looks like here, per family

| Family | Lines read | Box-4 lines | Density |
|---|---|---|---|
| `app deploy` (controller path plus deploy libs) | ~2,500 | ~500 | ~20% |
| `app env` (add, update, list, remove) | ~2,050 | ~130 | ~6% |
| Shared resolution (`resolution.ts`, `app-provider.ts`, `local-pin.ts`, git) | ~3,209 | ~106 | ~3% |
| `app` non-deploy (show, open, domain, logs, promote, rollback, remove) | ~1,950 | ~65 | ~3% |
| `init` | ~1,065 | ~60 | ~6% |
| `agent`, `feedback`, `version`, `build logs` | ~1,550 | ~38 | ~2% |
| `app build`, `app run` | ~350 | ~25 | ~7% |

Two structural facts frame all of these numbers.

First, **the CLI is already layered, and the layering already works.** Only 7 of the 31 modules under `lib/` take a `CommandContext` at all; the other 24 are context-free and take plain data or a provider port. Presentation is already separated into `presenters/*`. The question is therefore not "should decisions be separated from rendering" — that is largely done — but "should the 7 remaining context-taking modules be narrowed, and should the orchestration in the controllers move".

Second, **a lot of what looks like domain logic here is error copy.** The unported surface builds `CliError` at 58 sites and calls `usageError` at 42 more, and each one carries a summary, a reason, a fix, and a list of suggested commands. In `/packages/cli/src/lib/project/resolution.ts` roughly 417 of 766 lines are error classes and next-action hints. A rule of ten lines routinely sits inside eighty lines of English. Any line count that does not separate these two things will overstate the domain logic by a factor of three or four.

## Where it concentrates: `app deploy`, and inside that, the branch database

`runSingleAppDeploy` at `/packages/cli/src/controllers/app.ts:576-892` is 316 lines and runs about 25 steps in a fixed order. It is genuine multi-service sequencing: load config, merge flags with config, read the local project pin, resolve the branch from git, resolve or create the project, write the pin, detect the framework, resolve the entrypoint, resolve build settings, check the production requirement, provision a branch database and wire its credentials, upload and deploy, then cache what is now live. The order carries real requirements, and the code says so — line 750 revalidates `--entry` a second time because the interactive customisation step at line 723 can change the framework underneath it.

The single densest piece of domain logic in the entire CLI is the branch-database setup at `/packages/cli/src/lib/app/branch-database-deploy.ts`. Three things make it qualitatively different from everything else I read.

**It is a real decision tree.** `maybeSetupBranchDatabase` (lines 39-169) takes five independent inputs — the `--db` flag, the env vars supplied via `--env`, the branch kind, the remote environment-variable state, and a filesystem scan for a Prisma schema — and produces eight distinct outcomes. About 90 of its 130 lines are decisions. The rules are not mechanical: a production branch may only get a database on its first production deploy; a `DATABASE_URL` passed through `--env` conflicts with `--db` and is an error, but silently suppresses the offer when `--db` is absent; the offer is made when either a local schema exists or the branch would inherit a preview-level database URL.

**It is the only compensating sequence in the CLI.** `setupBranchDatabase` (lines 171-241) creates the database, then writes its credentials as environment variables, and on any failure calls `cleanupCreatedBranchDatabaseAfterFailure` (lines 595-632) to delete the database it just created. If that deletion also fails, `branchDatabaseCleanupFailedError` (lines 634-661) merges both failures into one message naming the orphaned database so the user can remove it by hand. This is exactly the "sequences services and undoes on failure" shape that the classification reserves for box 4, and it is the only instance of it.

**It holds invariants across ports.** `upsertBranchDatabaseEnvVars` (lines 243-290) always writes `DATABASE_URL`, writes `DIRECT_URL` only when the created database has one, and deletes a stale `DIRECT_URL` only on preview branches. `inspectBranchDatabaseEnv` (lines 339-372) encodes the scoping rule that production credentials live at project level while preview credentials live at branch level and can inherit from the project level.

The rest of the deploy family's box-4 logic, named:

- `enforceProductionDeployGate`, `/packages/cli/src/lib/app/production-deploy-gate.ts:7-88` — about 55 lines. Six-branch policy: preview branches pass; an app with no live production deployment is a first deploy and is promoted automatically; otherwise `--prod` is required, `--yes` satisfies the confirmation, a non-interactive terminal without `--yes` is refused, and an interactive user is asked. `resolveCurrentProductionDeployment` (67-88) reconciles two competing statements of which deployment is live.
- `resolveDeployAppSelection` and its helpers, `/packages/cli/src/controllers/app.ts:2707-2944` — about 90 lines. Four-level precedence (`--app`, then `PRISMA_APP_ID`, then the config's app name, then a name inferred from `package.json` or the directory), then match-or-create, then an ambiguity prompt. `assertDeployRegionMatchesExistingApp` (2838-2860) holds a real invariant: you cannot point `--region` at an app that already exists in a different region.
- `resolveDeployProjectContext`, `/packages/cli/src/controllers/app.ts:3443-3618` — about 120 decision lines, and a second copy of a policy that already exists (see below).
- `planAppDeploy`, `/packages/cli/src/lib/app/deploy-plan.ts:36-62` — about 20 lines deciding whether one app or all of them deploy. Already a pure function with no I/O.
- `resolveDeployBranch` (3788-3814), `resolveDeployFramework` and `resolveDeployRuntime` (4005-4058), `resolveDeployBuildSettings` (894-931) and `handleLegacyBuildSettings` (3957-4004) — roughly 120 lines of precedence chains, each of which also records where the value came from so the output can annotate it.
- Scattered through `runSingleAppDeploy` itself, about 30 lines: the compute config directory marks the project root (line 616); explicit project inputs suppress the local pin (622-624); config-supplied env file paths resolve from the config directory while `--env` paths resolve from the working directory (689-699); `--no-promote` skips the production confirmation because nothing will replace the live deployment (734-745); and after a `--no-promote` deploy the cached live-deployment id must be the one that is actually live, never the candidate just built (817-828).

### What is *not* domain logic in the deploy path, despite the filenames

The brief flagged several files as likely homes for domain logic. Three of them are not.

- `/packages/cli/src/lib/app/deploy-progress.ts` (170 lines) is entirely presentation. It converts SDK progress events into stderr lines. The `DeployProgressState` it maintains is not a state machine — it is a record of what has been printed, read afterwards only to build a better error message.
- `/packages/cli/src/lib/app/compute-config.ts` (292 lines) is input merging plus error rendering, and its own header comment says so. The config contract, validation, discovery and loading all live in `@prisma/compute-sdk/config`. The merge rule is "an explicit flag wins, otherwise the config value", with one exception at line 126 where `--env` replaces config env inputs rather than merging with them.
- `/packages/cli/src/lib/app/build-settings.ts` (200 lines) delegates the actual inference to `@prisma/compute-sdk`. What remains is a file read, a JSON parse, and a path-safety check. `/packages/cli/src/lib/app/local-dev.ts` (301 lines) is filesystem probing and subprocess spawning with fallbacks; `app run` inherits stdio directly (line 290), so it could not sit behind a use case even if it had logic to hold.

## Is it separable?

Partly, and the dividing line is sharp: **it is separable exactly where it is prompt-free.**

The prompt call sites in the unported surface are few and precisely located: 6 in `/packages/cli/src/controllers/app.ts`, 6 in `/packages/cli/src/controllers/init.ts`, 2 each in `/packages/cli/src/lib/app/app-interaction.ts` and `/packages/cli/src/lib/project/interactive-setup.ts`, and 1 each in `production-deploy-gate.ts` and `branch-database-deploy.ts`. The problem is not their number but their position. They are not at the edges of the logic; they sit in the middle of it.

`app deploy` prompts at four points inside its sequence: agent setup (line 617), interactive project setup (3597), ambiguous app selection (2877-2930), build-settings customisation (4318-4351), and the production confirmation (production-deploy-gate.ts:52). The customisation prompt changes the framework, which changes the entrypoint validation that follows it. So the top-level deploy sequence cannot become a use case that never knows about prompting — the conversation is part of the sequence.

The good news is that the sub-decisions can still be lifted, and the branch-database code shows how cleanly. In `maybeSetupBranchDatabase`, lines 52 to 133 are entirely prompt-free and decide whether a database is wanted and permitted at all. The prompt at line 145 only decides whether to go ahead. Lines 160-168 then act. That splits into three pieces without distorting anything: a decision function returning one of `{skip, refuse, ask-first, proceed}`, a handler that asks when told to, and a use case holding the create-wire-compensate sequence. The same split works for `enforceProductionDeployGate`, whose policy at lines 17-49 is separable from the confirmation at line 52.

Two other things currently block separation, and both are mechanical rather than deep:

- **The return type.** `runEnvAdd`, `runEnvUpdate`, `runEnvList` and `runEnvRemove` return `CommandSuccess<T>` — a Commander envelope carrying `command`, `warnings` and `nextSteps`. This single choice is why the engine port could not reuse them.
- **CLI strings compiled into decisions.** Refusals embed literal command text such as `` `prisma-cli project env update ${input.key}=<new-value> ${formatScopeFlag(scope)}` ``. That is presentation inside a rule, and it is why `formatScopeFlag` is duplicated verbatim in two files.

Neither of these requires new ports. The API client is already passed as a parameter throughout the env family, and `/packages/cli/src/v8/project/context.ts:56-64` proves how little of the context the resolution code really uses: it hands the legacy resolution a Proxy exposing only `cwd`, `env` and `signal`, which throws by name if anything else is read — and it works in production.

## `init` is inherently handler-shaped

`init` is the clearest "no" in the report. `runInit` at `/packages/cli/src/controllers/init.ts:74-250` holds about 60 lines of box 4, and every one of them is interleaved with the conversation.

The wizard runs: parse flags, check for an existing config, resolve the framework (prompting at line 762 when it cannot detect one), resolve the app name, default the port from the framework, **offer to adjust the framework and port** (`maybeAdjustSettings`, 901-974, three prompts), then resolve the entrypoint against the framework the user just chose, write the config file, **offer to install the types package** (`resolveInitTypes`, 274-375, one prompt and a subprocess), **offer to link a project** (`resolveInitLink`, 993-1060, one prompt, delegating to `runProjectLink`), and **offer to set up the agent** (line 220).

Four of those steps are offers, and three of them happen after the config file has been written. That ordering carries the one genuine policy in `init`: the config write is the point of no return, and nothing after it may turn a successful command into a failure. The code implements this as three separate `try`/`catch` blocks that downgrade errors to warnings — at lines 286-298, 362-374 and 1047-1058 — and the comment at 1052 states the reason.

That rule is real, but it is a rule *about the shape of the command*, not about the product. It cannot live in a use case, because a use case that must not know about prompts cannot express "after this write, every remaining prompt is optional and every remaining failure is a warning". Splitting `init` into prompt-free use cases would leave the handler holding the sequence, the offers, and the degradation rule — which is to say, holding all of the logic. The pieces left to extract would be the framework detection (already in `/packages/cli/src/lib/app/`) and the config serialisation (already in the SDK).

`init` should stay a handler. So should `app run`, `build logs`, `feedback`, `version`, `agent install/update`, and the `app domain wait` poll loop.

## The three pieces of evidence that decide it

None of the arguments above would justify building a layer on their own. These three do.

### 1. The engine port is already reaching into the code it is replacing

23 of the 65 files under `/packages/cli/src/v8/` import from `/packages/cli/src/controllers/`, pulling 30 distinct symbols: `resolveScopeToApi`, `resolveListScopeToApi`, `findVariableByNaturalKey`, `listVariables`, `resolveEnvWriteSource`, `resolveEnvWriteInput`, `toMetadata`, `apiCallError`, `formatScopeFlag`, `resolveDatabase`, `parseBackupLimit`, `sortDatabases`, `ensureProjectId`, `listBranches`, `sortBranches`, `toBranchSummary`, and more.

Every one of those is either a domain decision or a port-shaped transport helper. **The shared layer already exists and is already load-bearing for two shells — it simply has no name and lives in the modules scheduled for deletion.**

Worse, what could not be imported was copied. `runEnvAdd`, `runEnvUpdate`, `runEnvRemove` and `runEnvList` were reimplemented verbatim in `/packages/cli/src/v8/project/env-{add,update,remove,list}.ts` — the same sequence, the same error bodies, the same warning rule, roughly 120 lines now maintained twice. Compare `/packages/cli/src/controllers/app-env.ts:132-203` with `/packages/cli/src/v8/project/env-add.ts:145-209`. The only reason for the copy is that the original returns a Commander envelope.

This will repeat for every remaining command unless there is somewhere else to put the logic.

### 2. The same policy is already written twice, and has already drifted

The project precedence chain exists at `/packages/cli/src/lib/project/resolution.ts:590-676` (87 lines) and again at `/packages/cli/src/controllers/app.ts:3443-3618` (176 lines). Both go explicit flag, then environment variable, then local pin, then platform mapping; the deploy copy adds `--create-project` and an interactive arm. Both independently implement the same two invariants — a pin belonging to another workspace is an error rather than a miss, and a pin pointing at a deleted project is stale rather than a miss.

They have already diverged. `localStateStaleCliError` (resolution.ts:291-307) and `localResolutionPinStaleError` (app.ts:4829-4846) build the same `LOCAL_STATE_STALE` error with identical summary, reason, fix and metadata, but different suggested next steps. `projectSetupRequiredError` (app.ts:4872-4909) and `projectSetupRequiredCliError` (resolution.ts:411-429) differ in both their summary text and the shape of their metadata. A third partial copy of the "exactly one match" rule sits in `/packages/cli/src/lib/project/setup.ts:42-57`, using `throw` where the others use `Result`.

Collapsing these into one implementation would delete more code than a use-case layer adds. That is the strongest single argument in this report.

### 3. Testability degrades exactly in proportion to context coupling

The three deploy decisions form a clean gradient, and it is visible in the test suite.

- `planAppDeploy` takes plain data and no context. `/packages/cli/tests/deploy-plan.test.ts` is 171 lines and calls it directly.
- `enforceProductionDeployGate` takes a `CommandContext` and a provider. `/packages/cli/tests/production-deploy-gate.test.ts` is 215 lines, calls it directly, but must mock the prompt module and assert on rendered English — `expect(stderr.buffer).toContain('First deploy of "hello-world" -- promoting to production.')`. A policy test is coupled to a sentence.
- `maybeSetupBranchDatabase` takes a `CommandContext`, a provider, and reads the filesystem. **No test calls it directly.** `/packages/cli/tests/app-branch-database.test.ts` is 1,831 lines and exercises the decision tree by running the entire 316-line `runAppDeploy`, with three magic environment variables and `vi.doMock` on seven modules, resetting the module registry between cases.

The most valuable domain logic in the CLI is reachable only through its heaviest orchestration. That is a concrete, present cost, not a hypothetical one.

## The rule I would apply

Extract a decision into a use case only when **all three** hold:

1. **It is prompt-free from start to finish.** If the answer to a prompt changes what the decision does, the decision belongs in the handler — or must first be split so that the prompt-free part stands alone, as `maybeSetupBranchDatabase` can be.
2. **It spans more than one port call, or holds an invariant across ports.** A single call plus a reshape is a handler line. Reconciling two sources, sequencing several services, or undoing on failure is a use case.
3. **It has more than one caller, or is already duplicated, or will be needed by both shells.** This is what separates the branch-database sequence and the project chain from the roughly forty other small rules that are correctly served by a plain exported function today.

And one constraint on the layer itself, drawn from what went wrong with the existing one: **a use case may not import `CliError`, may not import `shell/prompt`, and may not receive a `CommandContext`.** `/packages/cli/src/use-cases/project.ts` imports `CliError` today and `/packages/cli/src/use-cases/branch.ts` sorts records for display. Without that constraint the new layer becomes the old one.

Applying the rule to my scope:

**Extract** — the branch-database decision and its compensating sequence; one merged project resolution replacing the two copies; the live-deployment reconciliation (`resolveCurrentLiveDeploymentId`, app.ts:3129-3159); the env scope resolution and effective-row merge (`resolveListScopeToApi` and `materializeEffectiveRows`, app-env.ts:611-697 and 986-1009); the production-deploy policy minus its confirmation. That is on the order of 250 to 350 lines, and collapsing the duplicates means it removes more than it adds.

**Leave in handlers** — all of `init`; the top-level `app deploy` sequence; build-settings customisation; ambiguous app selection; `app domain wait`; `build logs`; `app run`; `agent`; `feedback`; `version`.

**Push to adapters** — `/packages/cli/src/lib/app/app-provider.ts` in full; `/packages/cli/src/lib/project/local-pin.ts` behind a pin-store port, which would stop the resolution tests writing real files to disk; `local-branch.ts` and `local-status.ts` behind a git port; and the domain error predicates at app.ts:2503-2572, which currently recover meaning by pattern-matching the server's English prose and belong next to the raw HTTP response.

## Side findings, not part of the verdict

These surfaced while reading and are worth separate tickets.

- **`/packages/cli/src/lib/app/app-interaction.ts` is dead.** All 51 lines. `createDeployInteraction` is exported but imported nowhere, and the only deploy call site passes `interaction: undefined` (app.ts:799). Verified by grep.
- **`resolveDurablePlatformMapping` always returns null** (resolution.ts:586-588), making about 26 lines of precedence across two files unreachable.
- **The existing use-case layer does not run in production.** `runBranchList` (`/packages/cli/src/controllers/branch.ts:38-56`) routes real mode to `listRealBranches` and reaches `createBranchUseCases` only when `PRISMA_CLI_MOCK_FIXTURE_PATH` is set. The layer is currently a fixture-mode shadow of a real path that duplicates it — which is the failure mode to design against.
- **`app rollback` may roll forward.** `resolveRollbackTarget` (app.ts:3200-3220) picks the newest deployment that is not currently live, relying on caller-supplied ordering it never states. After one rollback the live deployment is the older one, so a second bare `app rollback` selects the newest again and returns to what was just rolled away from. The error text at 3215-3216 says "earlier", so the intent was different.
- **Liveness is decided by two different precedence orders** — app.ts:3135-3158 versus app.ts:1169-1176.
- **`app promote` and `app rollback` fabricate their returned status**, hard-coding `status: "running", live: true` at lines 1910-1911 and 2022-2023 rather than reading the result back.
- **`build logs` uses two different fields for two related decisions** — the failure flag comes from `record.kind === "error"` (build.ts:72) while the print decision comes from `record.code !== "end"` (build.ts:111), so a terminal record with both would set exit code 1 and print nothing.
