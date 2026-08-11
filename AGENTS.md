# AGENTS.md

## Purpose

Use this file for repo-wide instructions. Use package-local `AGENTS.md` files for package-specific rules.

## Development Setup

1. Run `pnpm install`.
2. Use `pnpm --filter <package> <script>` for package-local checks.
3. Run root scripts only when they match the changed surface.
4. Keep generated artifacts out of commits unless the task requires them.

## Package Manager

- Use `pnpm` for commands run inside this repo.
- Exception: use `npm publish` for npm release workflow publish steps so npm trusted publishing can use its OIDC authentication flow.
- Use `npm` or multiple package-manager examples in user-facing content.

## Every Command Needs a Real-API Happy Path

Every command mounted in the binary must have at least one end-to-end test that runs the shipped binary against the real management API. This applies to commands that arrive from the ORM and from Composer as they are mounted here, not only to the platform commands that live in this repo today.

Write the test in `packages/cli/e2e`, declaring the command with `describeCommand("<command>", ...)`. `packages/cli/tests/e2e-coverage.test.ts` reads that marker and fails the build when a mounted command has no test, so a new command without one does not merge. A command that genuinely cannot be driven against the real API — an interactive browser sign-in, an irreversible transfer — goes in that file's `EXCLUSIONS` map with the reason.

Run the suite with `pnpm --filter @prisma/cli test:e2e`. It needs `PRISMA_E2E_SERVICE_TOKEN` (and optionally `PRISMA_E2E_WORKSPACE_ID`) for a workspace you are willing to see resources created and deleted in; without them the suite skips. CI sets `PRISMA_E2E_REQUIRED=1`, which turns a missing credential into a failure rather than a silent skip.

Why this rule exists: `prisma-v8 project list` reported "No projects found." and exited 0 for a workspace holding 15 projects, and every project-scoped command was broken with it. The unit suite covered that command thoroughly and passed throughout, because its fixtures supplied both sides of every comparison — the credential's workspace id and the API's were the same hand-written string, while the real API returns a `wksp_` prefix that the credential does not carry. A test that writes both sides of a comparison can only confirm what its author already believed. Mocks are still the right tool for error paths and edge cases; they cannot tell you what the API actually returns.

## Pre-Commit Verification

- `pnpm --recursive exec tsc --noEmit`
- `pnpm lint`
- Package-specific tests for changed packages
  - `pnpm --filter @prisma/cli test`
  - `pnpm --filter @prisma/compute test`
- When you add or change a command, also `pnpm --filter @prisma/cli test:e2e`
- If verification fails because work is intentionally incomplete, include the failing command and reason in the commit message.
