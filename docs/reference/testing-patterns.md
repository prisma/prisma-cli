# Testing Patterns

This reference describes the CLI testing patterns contributors should prefer.

## In-Process CLI Tests

Use in-process tests for most command behavior. They are fast, deterministic,
and can capture stdout, stderr, stdin, TTY state, environment variables, and
local state.

Good fit:

- command parsing
- global flags
- `--json` output
- stdout and stderr separation
- prompt behavior
- structured errors
- resource resolution

The shared helpers in `packages/cli/tests/helpers.ts` provide temporary working
directories and captured streams.

## Controller And Use-Case Tests

Use controller and use-case tests when command parsing is not the behavior under
test.

Good fit:

- project resolution
- app selection
- auth state transitions
- branch targeting
- edge cases that need precise fixture data

These tests should avoid terminal formatting assertions unless presentation is
the behavior under test.

## Subprocess And Package Smoke Tests

Use subprocess or staged package smoke tests when changing packaging or runtime
entrypoints.

Good fit:

- `prisma-cli` binary behavior
- built `dist/cli.js`
- package manifest fields
- npm tarball contents
- publish preparation

The staged package should not include source, tests, fixtures, docs, `.prisma`,
or `.publish` directories.

## Stream Assertions

Follow the product output rules:

- Human status, prompts, warnings, and errors go to stderr.
- Machine-readable data goes to stdout.
- `--json` output should be valid JSON and should not require stderr parsing.
- Secret values must not appear in either stream.

## Prompt And CI Tests

For interactive behavior:

- Test TTY mode with simulated stdin.
- Test non-interactive mode and `--json` mode separately.
- Ensure commands fail with structured usage errors instead of hanging when
  prompting is unavailable.

For CI behavior:

- Avoid tests that depend on global user state.
- Use explicit temporary directories.
- Set environment variables in the test invocation instead of relying on the
  machine environment.

## Fixture Hygiene

- Keep fixtures small and purpose-built.
- Prefer generated temporary projects over shared mutable fixtures.
- Avoid global cleanup that can race with parallel tests.
- Keep assertion messages free of secrets and machine-specific paths when
  possible.
