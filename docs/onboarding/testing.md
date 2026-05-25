# Testing

The CLI test suite should protect the public command surface: command names,
flags, output streams, structured JSON, prompts, errors, and package contents.

## Run Tests

```bash
pnpm test
```

Build the package when changing entrypoints, package metadata, or publishing
preparation:

```bash
pnpm build:cli
pnpm prepare:cli-publish
```

Run the Next.js artifact smoke before publishing a preview CLI build that
touches build, archive, or deploy packaging. This uses the compiled
`packages/cli/dist/cli.js` against `examples/next-smoke` and verifies that the
staged standalone artifact can resolve Next's pnpm-managed transitive
dependencies:

```bash
pnpm build:cli
pnpm smoke:cli-nextjs
```

## What To Test

- Command behavior and resolution rules.
- Human output on stderr.
- Structured `--json` output on stdout.
- Non-interactive behavior and CI-friendly failures.
- Prompt behavior in TTY mode.
- Error codes, summaries, fixes, and next steps.
- Secret redaction, especially environment variable values.
- Package staging and tarball contents.

## Test Styles

Use in-process CLI tests for most command behavior. The shared test helpers can
run `runCli` with captured stdin, stdout, stderr, environment variables, and
temporary state.

Use controller or use-case tests when the behavior is easier to express without
going through Commander.

Use staged package smoke tests when changing:

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
