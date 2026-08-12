# Testing

The CLI test suite should protect the public command surface: command names,
flags, output streams, structured JSON, prompts, errors, and package contents.

## Run Tests

```bash
pnpm test
```

Inspect package contents when changing entrypoints, package metadata, or
publishing preparation:

```bash
pnpm --filter @prisma/cli pack --dry-run
```

## What To Test

- Command behavior and resolution rules.
- Human output on stderr.
- Structured `--json` output on stdout.
- Non-interactive behavior and CI-friendly failures.
- Prompt behavior in TTY mode.
- Error codes, summaries, fixes, and next steps.
- Secret redaction, especially environment variable values.
- Package metadata and tarball contents.

## Test Styles

Use in-process CLI tests for most command behavior. `createTestCli` from
`@prisma/cli-engine/testing` runs a mounted command with captured streams,
environment variables, and temporary state.

Use operation-layer tests when the behavior is easier to express without going
through the engine.

Use package smoke tests when changing:

- binary entrypoints
- build configuration
- package metadata
- publish preparation
- files included in the npm package

## Fixtures And State

- Use temporary directories for local project state.
- Pass explicit `stateDir` and `fixturePath` values when a test needs isolation.
- Do not depend on global auth, config, or process state.
- Avoid leaking secret values into snapshots or assertion messages.

## Acceptance Bar

A user-visible behavior change should usually include:

- one human-output test
- one `--json` test when automation can use the command
- one failure test when the command can produce a structured error
- docs updates for changed product behavior
