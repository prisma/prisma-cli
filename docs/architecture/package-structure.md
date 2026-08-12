# Package Structure

The repository currently contains two publishable packages:

- `packages/cli`: the public Prisma CLI beta package
- `packages/compute`: runtime utilities for deployed Prisma compute applications

The root workspace owns shared scripts, docs, release preparation, and examples.

## CLI Source Layout

- `src/bin.ts`: process entrypoint for the `prisma-cli` binary.
- `src/main.ts`: builds the CLI and hands the engine a runtime.
- `src/cli.ts`: mounts every command and command family.
- `src/commands/<group>/*`: one file per command — flags, help, handler.
- `src/controllers/*` and `src/presenters/*`: the operation layer the handlers
  call, and the serializers they reuse.
- `src/auth/*`: sessions, credentials, and token storage.
- `src/adapters/*`: local state and git.
- `src/lib/*`: feature-specific helpers and client code.
- `src/legacy/*`: the context shape the operation layer still takes.
- `src/types/*`: shared CLI data shapes.

## Layering Rules

- Product behavior starts in `docs/product`, then code follows.
- Command modules may parse inputs and register help, but should not own
  resource resolution or side effects.
- The operation layer should not write directly to terminal streams.
- Presenters should not perform filesystem, network, or state mutations.
- Adapter and client modules should keep external boundaries behind small,
  testable interfaces.
- Output flows through the engine: handlers describe presentation blocks, so
  human and JSON behavior stay consistent.

## Tests

Tests live in `packages/cli/tests`.

- Use in-process CLI tests for command behavior, output, prompts, and errors.
- Use operation-layer tests when a behavior can be exercised without going
  through the engine.
- Use package metadata and tarball-content checks for publishing changes.
- Add subprocess or package smoke tests when changing packaging, entrypoints, or
  binary behavior.

See [testing patterns](../reference/testing-patterns.md) for more detail.
