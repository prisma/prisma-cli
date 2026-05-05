# Architecture Decisions

Architecture Decision Records capture public decisions that contributors need to
understand before changing the CLI.

Keep ADRs short and focused. Add one when a decision changes command shape,
package identity, output contracts, error contracts, release preparation, or
long-term architecture boundaries.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-preview-package-and-publishing.md) | Accepted | Use `@prisma/cli` with the `preview` dist-tag and `prisma-cli` binary for public preview releases. |
| [0002](0002-workflow-command-model.md) | Accepted | Group commands by developer workflow using `prisma <group> <action>`. |
| [0003](0003-structured-output-and-errors.md) | Accepted | Treat structured output and stable error codes as public contracts. |

## ADR Template

```md
# ADR NNNN - Title

## Status

Accepted

## Context

What problem forced the decision?

## Decision

What will the project do?

## Consequences

What does this make easier, harder, or explicitly out of scope?
```
