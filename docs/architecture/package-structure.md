# Package Structure

The repository currently contains two publishable packages:

- `packages/cli`: the public Prisma CLI beta package
- `packages/compute`: runtime utilities for deployed Prisma compute applications

The root workspace owns shared scripts, docs, release preparation, and examples.

## CLI Source Layout

- `src/bin.ts`: process entrypoint for the `prisma-cli` binary.
- `src/cli.ts`: program assembly and top-level CLI runner.
- `src/commands/*`: command groups and flags.
- `src/controllers/*`: command orchestration.
- `src/use-cases/*`: product behavior and resolution rules.
- `src/adapters/*`: local config, local state, token storage, and API adapters.
- `src/lib/*`: feature-specific helpers and client code.
- `src/presenters/*`: command result presentation.
- `src/shell/*`: shared CLI runtime, flags, help, prompts, output, and errors.
- `src/types/*`: shared CLI data shapes.

## Layering Rules

- Product behavior starts in `docs/product`, then code follows.
- Command modules may parse inputs and register help, but should not own
  resource resolution or side effects.
- Use cases should not write directly to terminal streams.
- Presenters should not perform filesystem, network, or state mutations.
- Adapter and client modules should keep external boundaries behind small,
  testable interfaces.
- Output should flow through `shell/output` helpers so human and JSON behavior
  stay consistent.

## Tests

Tests live in `packages/cli/tests`.

- Use in-process CLI tests for command behavior, output, prompts, and errors.
- Use controller and use-case tests when a behavior can be exercised without
  going through Commander.
- Use publish-prep tests for package metadata and tarball contents.
- Add subprocess or staged package smoke tests when changing packaging,
  entrypoints, or binary behavior.

See [testing patterns](../reference/testing-patterns.md) for more detail.
