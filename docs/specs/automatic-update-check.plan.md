# Automatic Update Check Plan

## Assumptions

**A1** The plan implements the behavior from `docs/specs/automatic-update-check.spec.md`.

**A2** Update-check state should live in a user-level CLI cache, not in the repo-local `.prisma/cli/state.json`, because the check is package-scoped rather than project-scoped. Tests should be able to override this cache location through runtime/env plumbing.

**A3** The first implementation should use Node 20's built-in `fetch` and a small internal adapter rather than adding an update-notifier dependency. The behavior needed here is narrow, and keeping the public package dependency set smaller reduces packaging and supply-chain surface.

**A4** Version comparison should handle normal semver prerelease ordering for official beta and dev versions. If the installed version cannot be compared safely, the CLI should skip notification rather than guessing.

**A5** Background discovery may be abandoned when a short-lived process exits. That is acceptable because the update check is advisory and will be retried after the next eligible invocation.

**A6** `.agents/projects` is unavailable in this worktree, so this plan is stored next to the spec under `docs/specs`.

## Open Questions

None.

## Phases

### Phase 1 - Cached Notification Slice

**Status** ✓ Complete

**Goal** Add the shell-level update-check model and render a notification from cached state without doing remote network discovery yet. This proves stream behavior, eligibility rules, state isolation, and command-continuation behavior end to end.

**Requirements** FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR11, FR13, FR15, FR18, FR19, FR20, FR21, NFR3, NFR4, NFR5, NFR6, NFR7

**Changes**

**P1.1** Add update-check domain types and helpers under `packages/cli/src/lib` or `packages/cli/src/shell`, including cached-state shape, eligibility decisions, notification rendering, and safe version comparison.

**P1.2** Add a user-level update-check state adapter separate from `LocalStateStore`. It should persist only package name, installed version, latest known version, last check timestamp, last notification timestamp or equivalent suppression data, and recommendation metadata that is safe to store.

**P1.3** Add shell integration in `packages/cli/src/cli.ts` so cached stale-version information can print before command execution when the invocation is eligible.

**P1.4** Use the safe fallback docs instruction for this thin slice, including the temporary `https://prisma.io/docs` URL and the required code TODO.

**P1.5** Keep all notification output on stderr and suppress it for CI, `--json`, `--quiet`, non-TTY stderr, `NO_UPDATE_NOTIFIER`, and test mode.

**P1.6** Add focused tests around cached notification behavior in the CLI test suite, using test-controlled state and TTY settings.

**Acceptance Criteria**

**AC1.1** [x] A cached stale-version record prints exactly one concise update notice to stderr before an eligible command's human output, and the original command still exits with its normal exit code.

**AC1.2** [x] The same cached state produces no stdout changes.

**AC1.3** [x] Notification is suppressed in `--json`, `--quiet`, CI, non-TTY stderr, `NO_UPDATE_NOTIFIER`, and default unit-test mode.

**AC1.4** [x] The update-check state file is outside project-local `.prisma/local.json` and outside the repo-local CLI state file.

**AC1.5** [x] The fallback notification includes `https://prisma.io/docs` and no package-manager-specific command guess.

**AC1.6** [x] Tests cover successful command continuation, error command continuation, and at least one early root utility path such as `--version` or help.

### Phase 2 - Background Remote Discovery

**Status** ☐ Not started

**Goal** Add 24-hour npm `latest` discovery that runs opportunistically without blocking the original command.

**Requirements** FR1, FR10, FR11, FR12, FR14, FR16, NFR1, NFR2, NFR7, NFR8

**Changes**

**P2.1** Add a registry client that retrieves the `latest` dist-tag for `@prisma/cli` from npm and returns a typed result without leaking raw network errors into command output.

**P2.2** Add interval eligibility based on a fixed 24-hour constant. Do not expose a flag or configuration setting for this interval.

**P2.3** Start remote discovery after cached notification eligibility is evaluated, racing it against normal command execution without delaying command handlers or holding the process open for slow network responses.

**P2.4** Persist successful discovery results for later invocations. Treat DNS failures, blocked registries, invalid registry responses, and timeouts as silent best-effort failures.

**P2.5** Add concurrency-tolerant state writes so overlapping CLI invocations do not corrupt the update-check cache or repeatedly notify in normal use.

**Acceptance Criteria**

**AC2.1** When the interval has elapsed, the CLI attempts remote discovery at most once per 24 hours per user/package identity.

**AC2.2** A slow or failing registry lookup does not delay command output, does not change the command exit code, and emits no warning or error.

**AC2.3** A successful lookup for a newer latest version is persisted and becomes visible as a notification on a later eligible invocation.

**AC2.4** Network discovery is skipped for CI, `--json`, `--quiet`, non-TTY stderr, `NO_UPDATE_NOTIFIER`, and default unit-test mode.

**AC2.5** Tests use injected or stubbed registry behavior; they do not reach the real npm registry.

### Phase 3 - Install Context Recommendations

**Status** ☐ Not started

**Goal** Add best-effort recommendations that match the detected invocation or install context, while preserving the safe docs fallback.

**Requirements** FR3, FR17, FR18, FR19, NFR4, NFR6

**Changes**

**P3.1** Extend the existing invocation detection in `packages/cli/src/lib/version.ts` or a shared helper so update notices can reuse runtime signals without duplicating classification logic.

**P3.2** Add recommendation selection for confidently detected local npm, global npm, local pnpm, and local Bun installs.

**P3.3** Treat `npx`, `pnpx`, `bunx`, development, PR-preview, and ambiguous invocations conservatively. Use rerun guidance or fallback docs instead of telling the user to mutate a persistent install that may not exist.

**P3.4** Use `https://prisma.io/docs` as the temporary fallback docs URL and leave a code TODO beside the constant so it is replaced when the canonical CLI installation page exists.

**P3.5** Add tests covering npm, pnpm, Bun, global, ephemeral, and unknown invocation signals.

**Acceptance Criteria**

**AC3.1** Eligible local npm usage recommends `npm install --save-dev @prisma/cli@latest`.

**AC3.2** Eligible confidently detected global npm usage recommends `npm install --global @prisma/cli@latest`.

**AC3.3** Eligible local pnpm and Bun usage recommend package-manager-appropriate dev-dependency update commands.

**AC3.4** Ambiguous, ephemeral, dev, and PR-preview invocations do not receive misleading persistent-install commands.

**AC3.5** Fallback notification copy includes `https://prisma.io/docs` and no command-specific guess.

### Phase 4 - Packaging, Documentation, and Verification

**Status** ☐ Not started

**Goal** Lock down package contents, public docs, and regression coverage so the update check ships without breaking automation, publishing, or the existing version command contract.

**Requirements** FR5, FR6, FR7, FR8, FR9, FR12, FR20, FR21, NFR2, NFR3, NFR8

**Changes**

**P4.1** Update product docs if implementation introduces user-visible behavior beyond this planning spec, especially `docs/product/output-conventions.md`, `docs/product/cli-style-guide.md`, or `docs/product/command-spec.md`.

**P4.2** Update package README/support docs only if the fallback installation guidance needs to be discoverable before the stable CLI installation docs exist.

**P4.3** Update publish-prep tests if any runtime dependency, bundled file, or manifest field changes.

**P4.4** Add or update end-to-end CLI tests for stdout stability, JSON stability, `--version`, `version --json`, help output, CI suppression, quiet suppression, and non-TTY suppression.

**P4.5** Run the relevant verification commands for CLI behavior, packaging, and build output.

**Acceptance Criteria**

**AC4.1** `pnpm --filter @prisma/cli test` passes.

**AC4.2** `pnpm build:cli` passes.

**AC4.3** `pnpm prepare:cli-publish` passes if package contents or dependencies changed.

**AC4.4** `prisma-cli --version` and `prisma-cli version --json` remain stdout-stable and do not include update notices.

**AC4.5** The final implementation still satisfies every out-of-scope boundary: no self-update, no stale-version blocking, no telemetry, no new update command, and no change to version command semantics.

## Revision log
