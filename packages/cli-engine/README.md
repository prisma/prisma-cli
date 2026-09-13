# @prisma/cli-engine

The execution engine of the unified Prisma CLI: it owns the path from argv to exit code — parsing, execution, rendering, and error handling.

Every command describes its output once, as blocks, and the engine renders it in one of three formats chosen by `--format`: `human` for a person at a terminal (padded, aligned, coloured, on stderr, with the machine-usable data lines on stdout), `json` for a program (a stream of frames ending in a result envelope on stdout), and `markdown` for an agent that reads the output as text (plain Markdown with every value labelled, everything on stdout, nothing on stderr). A terminal gets `human` and a pipe gets `json` unless a format is named; `markdown` is only ever explicit.

## Entry points

- `@prisma/cli-engine` — the engine: command definitions, context, and the runner.
- `@prisma/cli-engine/protocol` — the wire types for machine-readable (JSON) output.
- `@prisma/cli-engine/testing` — the test harness for running commands in-process.

Part of [prisma/prisma-cli](https://github.com/prisma/prisma-cli).
