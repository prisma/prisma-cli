# Architecture

This repository contains the public preview implementation of the unified Prisma
CLI.

The canonical architecture docs live under `docs/architecture`:

- [Architecture overview](docs/architecture/overview.md)
- [Package structure](docs/architecture/package-structure.md)
- [Architecture decisions](docs/architecture/adrs/README.md)

Product behavior is defined separately in `docs/product`. If architecture and
product docs appear to disagree, update the product docs first and make the
implementation follow them.

## Implementation Shape

The CLI is organized around a thin command layer and documented product rules:

- command modules define grammar, arguments, flags, and help text
- controllers orchestrate command-specific flows
- use cases enforce documented behavior and resource resolution
- adapters isolate local state, config, auth, and platform boundaries
- presenters and shell helpers own human and JSON output

This shape keeps the current app-focused preview small while preserving the
long-term unified model for projects, branches, schemas, databases, and apps.

## Contribution Rule

Do not add new command behavior from architecture intuition alone. Start with
the relevant product doc, then update the implementation and tests.
