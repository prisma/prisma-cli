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

That file also holds `AWAITING_COVERAGE`: commands that were already mounted when this rule arrived and still need a happy path written. It is a backlog of work owed, not a second exclusions list. Do not add to it — a command added from today on needs either a test or an `EXCLUSIONS` entry.

Run the suite with `pnpm --filter @prisma/cli test:e2e`. It needs `PRISMA_E2E_SERVICE_TOKEN` (and optionally `PRISMA_E2E_WORKSPACE_ID`) for a workspace you are willing to see resources created and deleted in; without them the suite skips. CI sets `PRISMA_E2E_REQUIRED=1`, which turns a missing credential into a failure rather than a silent skip.

Unit tests may still mock, and should — error paths and edge cases belong there. Two rules keep those mocks honest. Give fixtures the id shapes the API really uses: `wksp_`-prefixed workspace ids in API responses, the bare form in credential claims and stored sessions, and the `proj_` / `db_` / `bkt_` prefixes on resources. And never write both sides of a comparison from one constant — if a test supplies the credential's workspace id and the API's, they must differ exactly as they differ in production. Where a fake API server is easier than mocking a client, `packages/cli/tests/helpers/fake-management-api.ts` starts one.

Why this rule exists: `prisma project list` reported "No projects found." and exited 0 for a workspace holding 15 projects, and every project-scoped command was broken with it. The unit suite covered that command thoroughly and passed throughout, because its fixtures supplied both sides of every comparison — the credential's workspace id and the API's were the same hand-written string, while the real API returns a `wksp_` prefix that the credential does not carry. A test that writes both sides of a comparison can only confirm what its author already believed. Mocks are still the right tool for error paths and edge cases; they cannot tell you what the API actually returns.

## Help Text

Hold every new or changed command's help (summary, description, flag briefs, group brief) to `docs/product/cli-help-standard.md`. Write for a reader who has never used Prisma: each summary stands alone, defines any Prisma term in place (usually by stating the consequence), and never uses internal vocabulary such as "binding", "resolved", or "pinned". Card structure and formatting rules are in `docs/product/cli-style-guide.md`.

## Pre-Commit Verification

- `pnpm typecheck`
- `pnpm lint`
- Package-specific tests for changed packages
  - `pnpm --filter @prisma/cli test`
  - `pnpm --filter @prisma/compute test`
- When you add or change a command, also `pnpm --filter @prisma/cli test:e2e`
- If verification fails because work is intentionally incomplete, include the failing command and reason in the commit message.
