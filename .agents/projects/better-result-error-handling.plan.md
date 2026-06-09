# Better Result Error Handling Adoption Plan

## Assumptions

- **A1** The plan keeps `CliError` as the public rendering envelope and treats local project pin read/write behavior as the first migration target because it is the narrowest command-relevant slice identified during planning.
- **A2** The first implementation change adds `better-result` to `packages/cli/package.json` because owned fallible application code lives under `packages/cli`.
- **A3** Type checking is currently available through the package TypeScript config rather than a dedicated package script. Use `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` as the type-level verification command unless a script is added during implementation.
- **A4** Existing `CliError` helpers may remain temporarily while a call stack has not migrated. New or migrated expected failures should use `TaggedError` constructors and exhaustive conversion at the CLI-facing boundary.
- **A5** The plan treats missing local state and optional display fields as non-failure states when absence is valid. Best-effort fallible operations still return typed results; the owning boundary explicitly discards or captures those errors.

## Open Questions

None.

## Phases

### Phase 1: Foundation And Local Pin Read

**Status:** ✓ Complete

**Goal:** Add the dependency and prove typed expected failures on the smallest read-only project context slice.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR7, FR8, FR9, FR10, FR12, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 6-9 files

**Changes:**

- Add `better-result` as a runtime dependency of `packages/cli`.
- Update `packages/cli/src/lib/project/local-pin.ts` read behavior so parsing and shape failures are represented with local `TaggedError` variants and `Result` return values.
- Preserve non-failure absence semantics for a missing `.prisma/local.json`; absence remains a successful state, not an error.
- Update local-pin read callers in `packages/cli/src/lib/project/resolution.ts`, `packages/cli/src/controllers/project.ts`, and the local-pin read path in `packages/cli/src/controllers/app.ts`.
- Introduce exhaustive `matchError` conversion for migrated local-pin read failures, preserving existing `LOCAL_STATE_STALE` and `LOCAL_PROJECT_WORKSPACE_MISMATCH` output.
- Add or update targeted tests in `packages/cli/tests/project-resolution.test.ts`, `packages/cli/tests/project.test.ts`, and the local-pin read cases in `packages/cli/tests/app-controller.test.ts`.

**Acceptance Criteria:**

- Local pin parsing no longer relies on thrown `SyntaxError` or an untyped invalid sentinel in migrated read paths.
- Existing JSON and human outputs for `LOCAL_STATE_STALE` and `LOCAL_PROJECT_WORKSPACE_MISMATCH` remain stable.
- Adding a new local-pin read error variant requires updating exhaustive conversion before type checking passes.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Targeted project resolution, project command, and app deploy local-pin read tests pass.

### Phase 2: Local Pin Write And Directory Binding

**Status:** ✓ Complete; full package typecheck blocked by unrelated existing errors

**Goal:** Complete the local-pin call stack by typing write and gitignore update failures used by project binding.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR7, FR8, FR9, FR10, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 5-8 files

**Changes:**

- Update `writeLocalResolutionPin` and `ensureLocalResolutionPinGitignore` in `packages/cli/src/lib/project/local-pin.ts` to return typed results for filesystem and serialization failures.
- Update `bindProjectToDirectory` in `packages/cli/src/lib/project/setup.ts` to compose the typed write results and propagate them upward.
- Update project setup and app deploy callers that bind a project to the directory so failures convert at CLI-facing boundaries.
- Preserve the existing success output that reports `Saved .prisma/local.json`.
- Add or update tests in `packages/cli/tests/project-controller.test.ts`, `packages/cli/tests/project.test.ts`, and app deploy binding tests in `packages/cli/tests/app-controller.test.ts`.

**Acceptance Criteria:**

- Local pin write and gitignore update failures are typed before they reach project/app controllers.
- Existing project link/create and first deploy binding success output remains stable.
- Command-facing conversion for local-pin write failures is exhaustive.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Targeted project binding tests pass.

### Phase 3: Project Resolution Domain Errors

**Status:** ✓ Complete; full package typecheck blocked by unrelated existing errors

**Goal:** Convert project target resolution failures from thrown `CliError` helpers to typed project-domain failures.

**Requirements:** FR1, FR2, FR3, FR5, FR6, FR7, FR8, FR9, FR10, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 5-7 files

**Changes:**

- Replace project-resolution `CliError` factory paths in `packages/cli/src/lib/project/resolution.ts` with project-domain `TaggedError` variants for project not found, ambiguous project, local state stale, and local workspace mismatch.
- Convert sequential fallible project resolution operations to result composition, using `Result.gen` where multiple result-returning steps currently require early throws or manual propagation.
- Update `packages/cli/src/controllers/project.ts` and app deployment project-context resolution in `packages/cli/src/controllers/app.ts` to exhaustively map migrated project-domain errors into existing `CliError` envelopes.
- Keep stable product error codes from `docs/product/error-conventions.md`; if implementation reveals a missing expected project error code, update product docs before adding a new code.
- Update project show/list and app project-context tests to assert public command behavior.

**Acceptance Criteria:**

- [x] Migrated project resolution APIs expose typed results rather than throwing expected `CliError` instances.
- [x] Existing project-related structured error codes and recovery guidance remain stable.
- [ ] `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes. Blocked by unrelated existing errors in database/test typing surfaces.
- [x] Project resolution and project show/list tests pass.

### Phase 4: Project Setup Validation And Creation Errors

**Status:** ☐ Not started

**Goal:** Migrate project setup validation and project creation failure mapping without bundling it with target resolution.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR7, FR8, FR9, FR10, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 5-8 files

**Changes:**

- Update project setup failure helpers in `packages/cli/src/lib/project/setup.ts` to use `TaggedError` variants for expected setup and create failures.
- Keep prompt-only validation helpers as plain values when they only produce inline prompt text and do not represent command failure.
- Update project create/link flows in `packages/cli/src/controllers/project.ts` and app first-deploy project creation flows in `packages/cli/src/controllers/app.ts` to convert setup-domain errors exhaustively.
- Preserve `PROJECT_CREATE_FAILED`, `PROJECT_NOT_FOUND`, `PROJECT_AMBIGUOUS`, and setup-related usage output.
- Update project create/link tests and app first-deploy project setup tests.

**Acceptance Criteria:**

- Project setup expected failures are typed and converted only at CLI-facing boundaries.
- Existing project setup error codes, summaries, fixes, and next steps remain stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Targeted project setup tests pass.

### Phase 5: Local State Store Boundary

**Status:** ☐ Not started

**Goal:** Type local state file failures independently from auth token storage and use-case contracts.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR7, FR8, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-7 files

**Changes:**

- Update `packages/cli/src/adapters/local-state.ts` so state file read, JSON parse, and write failures are modeled as typed results where they affect auth, branch, project, app selection, or deployment state.
- Preserve valid absence semantics for a missing state file.
- Update direct local state consumers that need only mechanical signature changes, without broad use-case contract redesign.
- Convert local-state adapter failures at existing controller or command-runner boundaries with exhaustive `matchError`.
- Update `packages/cli/tests/app-state.test.ts` coverage and command tests affected by state read/write failure behavior.

**Acceptance Criteria:**

- Command-relevant local state failures are visible in typed results at the adapter boundary.
- Missing state remains a successful default state.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Local state and affected command tests pass.

### Phase 6: Auth Token Storage Boundary

**Status:** ☐ Not started

**Goal:** Type credential-store and refresh-lock failures without changing unrelated auth command behavior.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR7, FR8, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-7 files

**Changes:**

- Update `packages/cli/src/adapters/token-storage.ts` so credential-store calls and refresh-lock operations distinguish expected storage/lock failures from cancellation and unexpected defects.
- Keep third-party credential-store internals untouched; wrap only from owned adapter code.
- Update auth provider/client paths that consume `FileTokenStorage` only as needed for typed result propagation.
- Convert auth storage failures at auth-facing controller or command-runner boundaries while preserving `AUTH_REQUIRED` and `COMMAND_CANCELED` behavior.
- Update token-storage and auth command tests.

**Acceptance Criteria:**

- Token read/write/clear and refresh-lock failures are typed at the adapter boundary.
- Cancellation still maps to `COMMAND_CANCELED` and exit code `130` where currently expected.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Token-storage and auth tests pass.

### Phase 7: Use-Case Gateway Contracts

**Status:** ☐ Not started

**Goal:** Migrate gateway contracts after their storage dependencies are typed, keeping the PR focused on interface propagation.

**Requirements:** FR1, FR2, FR3, FR5, FR6, FR7, FR8, FR10, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 5-8 files

**Changes:**

- Update `packages/cli/src/use-cases/contracts.ts` and `packages/cli/src/use-cases/create-cli-gateways.ts` so gateway interfaces propagate typed results instead of converting command-relevant failures to `null` or raw throws.
- Migrate affected auth, project, and branch use cases only as far as required by changed gateway contracts.
- Use `Result.gen` for sequential use-case composition where multiple migrated gateway calls must short-circuit.
- Convert migrated use-case failures at controllers or command runners with exhaustive `matchError`.
- Update auth, project, branch, and use-case helper tests.

**Acceptance Criteria:**

- Gateway interfaces make command-relevant failure propagation visible in types.
- Use-case tests exercise public use-case contracts rather than adapter internals.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Auth, project, branch, and use-case tests pass.

### Phase 8: Git And Repository Connection Boundary

**Status:** ☐ Not started

**Goal:** Migrate git process and repository parsing/connection failures as one cohesive repository workflow slice.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-6 files

**Changes:**

- Update `packages/cli/src/adapters/git.ts` so `git` process execution exposes typed results when repository discovery affects command behavior.
- Keep GitHub URL parser functions plain only where invalid input is a non-failure branch; return typed results where invalid input maps to structured command failure.
- Update project repository connection flows in `packages/cli/src/controllers/project.ts` to consume typed git/repository results and map them exhaustively to existing repository-related error codes.
- Preserve repository-related codes such as `REPO_PROVIDER_UNSUPPORTED`, `REPO_INSTALLATION_REQUIRED`, `REPO_NOT_ACCESSIBLE`, `REPO_NOT_CONNECTED`, `REPO_ALREADY_CONNECTED`, and `REPO_CONNECTION_FAILED`.
- Update git adapter and project repository connect/disconnect tests.

**Acceptance Criteria:**

- Git process failures no longer disappear as `null` when the command needs a recoverable reason.
- Repository connection structured errors remain stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Git adapter and project repository tests pass.

### Phase 9: Version Metadata Boundary

**Status:** ☐ Not started

**Goal:** Migrate the small package metadata boundary independently from repository and app work.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR7, FR8, FR9, FR10, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 3-5 files

**Changes:**

- Update `packages/cli/src/lib/version.ts` so package metadata read failures are represented as a typed expected `VERSION_UNAVAILABLE` failure at the lowest owned boundary.
- Update `packages/cli/src/controllers/version.ts` to exhaustively convert the version-domain failure to the existing CLI envelope.
- Preserve current version success output and `VERSION_UNAVAILABLE` failure behavior.
- Update version tests.

**Acceptance Criteria:**

- Version metadata failures are typed below the controller.
- `VERSION_UNAVAILABLE` output remains stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Version tests pass.

### Phase 10: Best-Effort Shell Boundaries

**Status:** ☐ Not started

**Goal:** Make best-effort update checks and diagnostics return typed results before explicit discard or capture.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR10, FR11, NFR1, NFR2, NFR3, NFR5, NFR6

**Estimated Files Touched:** 5-8 files

**Changes:**

- Update `packages/cli/src/shell/update-check.ts` so fallible update-check work returns typed results instead of hidden `null` or swallowed exceptions.
- Update command diagnostics paths around `packages/cli/src/shell/command-runner.ts`, `packages/cli/src/lib/diagnostics.ts`, and `packages/cli/src/shell/diagnostics-output.ts` so failures are typed before the command runner explicitly discards or captures them.
- Do not convert best-effort failures into public CLI envelopes unless product behavior changes first.
- Update shell/update-check/diagnostics tests or add narrow coverage for explicit discard/capture behavior.

**Acceptance Criteria:**

- Best-effort command diagnostics and update checks have explicit typed-result discard or capture points rather than hidden swallowed exceptions.
- Best-effort failures do not change command success/failure behavior.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Targeted shell/update-check/diagnostics tests pass.

### Phase 11: App Config And Env Parsing Boundaries

**Status:** ☐ Not started

**Goal:** Migrate app configuration and environment parsing failures before platform/provider work.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 7-11 files

**Changes:**

- Update app config and env modules under `packages/cli/src/lib/app`, including env config/file parsing, env vars, build settings, and framework/build setting validation.
- Return typed expected failures for invalid config, invalid env files, unsupported framework/build settings, and parsing failures that currently throw usage or app config errors.
- Update app env controllers and deploy config resolution in `packages/cli/src/controllers/app.ts` to exhaustively map the migrated errors.
- Preserve `APP_CONFIG_INVALID`, `FRAMEWORK_NOT_DETECTED`, usage errors, and env command output behavior.
- Update app env, app build settings, and deploy config tests.

**Acceptance Criteria:**

- App config/env parsing failures are typed below controllers.
- Existing config/env structured errors and human output remain stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App env and config-related tests pass.

### Phase 12: App Local Build And Run Boundaries

**Status:** ☐ Not started

**Goal:** Type local process/build/run failures independently from remote deployment/provider failures.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-7 files

**Changes:**

- Update local app build and run helpers under `packages/cli/src/lib/app` so process execution and framework invocation failures return typed errors.
- Update `runAppBuild`, `runAppRun`, and deploy pre-build paths in `packages/cli/src/controllers/app.ts` to use result composition and exhaustive conversion.
- Preserve `BUILD_FAILED`, `RUN_FAILED`, framework validation, trace/debug, and streaming behavior.
- Update app build, app local dev/run, and deploy pre-build tests.

**Acceptance Criteria:**

- Local build/run expected failures are typed before reaching app controllers.
- Existing build/run structured errors and output remain stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App build and local run tests pass.

### Phase 13: Branch Database And Production Gate Boundaries

**Status:** ☐ Not started

**Goal:** Migrate deploy safety and database setup failures as a cohesive deploy-preparation slice.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 5-8 files

**Changes:**

- Update `packages/cli/src/lib/app/production-deploy-gate.ts` to return typed expected failures for production deploy gating and deployment-list inspection.
- Update `packages/cli/src/lib/app/branch-database-deploy.ts` and related preview branch database setup helpers to return typed expected failures.
- Update app deploy controller paths that compose production gate and branch database setup to use result composition and exhaustive conversion.
- Preserve `PROD_DEPLOY_REQUIRES_FLAG`, `BRANCH_DATABASE_SETUP_FAILED`, `SCHEMA_SETUP_FAILED`, and production safety output.
- Update production deploy gate and branch database tests.

**Acceptance Criteria:**

- Production gate and branch database setup failures are typed before deployment starts.
- Production safety behavior remains fail-closed.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- Production deploy gate and branch database tests pass.

### Phase 14: Preview Provider Project And App Boundary

**Status:** ☐ Not started

**Goal:** Replace generic SDK error wrappers for preview provider project, branch, and app-resolution operations.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 3-5 files

**Changes:**

- Update `packages/cli/src/lib/app/preview-provider.ts` project creation, branch resolution, app listing, app lookup, and app selection operations to return typed provider errors instead of generic SDK error wrappers or raw API errors.
- Preserve original status, response, project/branch/app identifiers, and safe debug context in typed errors.
- Keep third-party SDK internals untouched; wrap only provider calls in owned code.
- Update app provider tests for project, branch, and app-resolution operations.

**Acceptance Criteria:**

- Project, branch, and app-resolution provider failures are typed at the provider boundary.
- Unexpected provider defects are not hidden behind expected user-facing envelopes.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App provider tests for project, branch, and app-resolution operations pass.

### Phase 15: Preview Provider Deployment Boundary

**Status:** ☐ Not started

**Goal:** Migrate preview provider deployment lifecycle operations without bundling env or domain provider work.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 3-5 files

**Changes:**

- Update preview provider deployment operations for deploy, list, show, logs, promote, rollback, and remove to return typed provider errors.
- Preserve original status, response, service/deployment identifiers, and safe debug context in typed errors.
- Keep third-party SDK internals untouched; wrap only provider calls in owned code.
- Update app provider tests for deployment lifecycle operations.

**Acceptance Criteria:**

- Deployment lifecycle provider failures are typed at the provider boundary.
- Unexpected provider defects are not hidden behind expected user-facing envelopes.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App provider deployment lifecycle tests pass.

### Phase 16: Preview Provider Env And Domain Boundary

**Status:** ☐ Not started

**Goal:** Migrate environment variable and custom-domain provider operations separately from core deployment operations.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-7 files

**Changes:**

- Update preview provider environment variable operations to return typed provider errors with safe context.
- Update preview provider custom-domain operations to return typed domain/provider errors for add, show, remove, retry, and wait flows.
- Preserve domain-related codes such as `DOMAIN_HOSTNAME_INVALID`, `DOMAIN_DNS_NOT_CONFIGURED`, `DOMAIN_ALREADY_REGISTERED`, `DOMAIN_QUOTA_EXCEEDED`, `DOMAIN_NOT_FOUND`, `DOMAIN_RETRY_NOT_ELIGIBLE`, `DOMAIN_VERIFICATION_FAILED`, and `DOMAIN_VERIFICATION_TIMEOUT`.
- Update app env provider and domain tests.

**Acceptance Criteria:**

- Env-var and domain provider failures are typed at the provider boundary.
- Existing env and domain structured errors remain stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App env provider and domain tests pass.

### Phase 17: App Deploy Controller Composition

**Status:** ☐ Not started

**Goal:** Convert the main deploy orchestration path after its local and provider dependencies return typed results.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-6 files

**Changes:**

- Update `runAppDeploy` and directly related deploy helpers in `packages/cli/src/controllers/app.ts` to compose migrated project, config, build, database, provider, and deployment results with `Result.gen` where appropriate.
- Replace catch-all deploy wrappers with exhaustive mapping from typed deploy/app/provider errors to existing CLI envelopes.
- Preserve deploy progress, streaming, build, branch database, production safety, and deploy result output behavior.
- Update app deploy controller tests.

**Acceptance Criteria:**

- The main deploy path performs exhaustive expected-error conversion rather than relying on catch-all promise handlers.
- Existing deploy success and failure output remains stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App deploy controller tests pass.

### Phase 18: App Management Controller Composition

**Status:** ☐ Not started

**Goal:** Convert non-deploy app management command families after provider operations are typed.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-6 files

**Changes:**

- Update app list/show/open/list-deploys/show-deploy/logs/promote/rollback/remove controllers to consume typed provider results and convert errors exhaustively.
- Preserve `DEPLOYMENT_NOT_FOUND`, `NO_DEPLOYMENTS`, `NO_PREVIOUS_DEPLOYMENT`, `PROMOTE_SOURCE_INVALID`, `ROLLBACK_UNAVAILABLE`, `REMOVE_FAILED`, and deployment inspection output.
- Update app management command tests.

**Acceptance Criteria:**

- App management controllers no longer rely on catch-all provider promise handlers for expected failures.
- Existing management command output and structured errors remain stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App management tests pass.

### Phase 19: App Env And Domain Controller Composition

**Status:** ☐ Not started

**Goal:** Convert env-var and domain command controllers after their provider operations are typed.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 4-7 files

**Changes:**

- Update app env command controllers to consume typed config/provider results and convert errors exhaustively.
- Update app domain command controllers to consume typed domain/provider results and convert errors exhaustively.
- Preserve human and JSON output for env add/update/rm/list and domain add/show/remove/retry/wait flows.
- Update app env and domain controller tests.

**Acceptance Criteria:**

- App env and domain controllers perform exhaustive expected-error conversion.
- Existing env/domain command output remains stable.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- App env and domain controller tests pass.

### Phase 20: Command Boundary Cleanup And Enforcement

**Status:** ☐ Not started

**Goal:** Consolidate CLI-facing conversion after migrated call stacks return typed results and make future regressions harder.

**Requirements:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6

**Estimated Files Touched:** 5-9 files

**Changes:**

- Review `packages/cli/src/shell/command-runner.ts`, `packages/cli/src/shell/errors.ts`, and output helpers so migrated expected failures are converted consistently into the existing human and JSON envelopes.
- Remove forwarding-only `CliError` factory helpers whose only remaining purpose is wrapping constructor arguments already represented in `TaggedError` constructors.
- Keep outer crash behavior for unknown errors and `UnhandledException` cases that should remain defects, preserving stack traces and trace/debug behavior.
- Add lightweight lint, type-level, or test guardrails if needed to prevent migrated lower layers from reintroducing thrown `CliError`, catch-all error mapping, or broad app-wide error unions.
- Update contributor docs only if implementation introduces new repo-local conventions beyond the rules already in `AGENTS.md`.

**Acceptance Criteria:**

- No migrated lower-layer module throws `CliError` for expected failures.
- Command boundaries are the only places where migrated expected failures become public CLI envelopes.
- Exhaustive matching is the verification path for migrated expected error unions.
- `pnpm --filter @prisma/cli exec tsc -p tsconfig.json` passes.
- `pnpm test` passes.
- `pnpm build:cli` passes if command runner, package metadata, or build-facing code changed in the phase.

## Revision Log

- 2026-06-09: Phase 2 added `LOCAL_STATE_WRITE_FAILED` to the product error conventions because local Project binding write failures need a stable structured error code before controller-facing conversion.
