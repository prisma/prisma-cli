# Getting Started

This guide gets a local checkout ready for CLI development.

## Requirements

- Node.js 24 or newer
- pnpm 10

## Install

```bash
pnpm install
```

## Run The Source CLI

```bash
pnpm prisma-cli --help
pnpm prisma-cli auth whoami
pnpm prisma-cli service --help
```

The root `prisma-cli` script runs the TypeScript source entrypoint through `tsx`.

## Read The Product Docs

Before changing behavior, read:

1. [Command principles](../product/command-principles.md)
2. [CLI style guide](../product/cli-style-guide.md)
3. [Output conventions](../product/output-conventions.md)
4. [Error conventions](../product/error-conventions.md)

## Test And Build

Run the existing CLI tests:

```bash
pnpm test
```

Build the package:

```bash
pnpm build:cli
```

Inspect the publish package locally without publishing:

```bash
pnpm --filter @prisma/cli pack --dry-run
```

## Examples

Manual smoke apps live in:

- `examples/hello-world`
- `examples/next-smoke`

They are intentionally not part of the root pnpm workspace. Install dependencies
inside an example only when running a manual end-to-end check.
