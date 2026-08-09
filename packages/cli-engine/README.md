# @prisma/cli-engine

The execution engine of the unified Prisma CLI: it owns the path from argv to exit code — parsing, execution, rendering, and error handling.

## Entry points

- `@prisma/cli-engine` — the engine: command definitions, context, and the runner.
- `@prisma/cli-engine/protocol` — the wire types for machine-readable (JSON) output.
- `@prisma/cli-engine/testing` — the test harness for running commands in-process.

Part of [prisma/prisma-cli](https://github.com/prisma/prisma-cli).
