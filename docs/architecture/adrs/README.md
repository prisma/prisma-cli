# Architecture Decisions

Architecture Decision Records capture public decisions that contributors need to
understand before changing the CLI.

Keep ADRs short and focused. Add one when a decision changes command shape,
package identity, output contracts, error contracts, release preparation, or
long-term architecture boundaries.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-preview-package-and-publishing.md) | Accepted | Use `@prisma/cli` latest for official beta releases, `dev` for integrated main builds, and PR previews for trusted unmerged work. |
| [0002](0002-workflow-command-model.md) | Accepted | Group commands by developer workflow using `prisma <group> <action>`. |
| [0003](0003-structured-output-and-errors.md) | Accepted | Treat structured output and stable error codes as public contracts. |
| [0004](0004-platform-domain-model-and-language.md) | Proposed | Branch-scoped resources, Versions instead of Deployments, and one ubiquitous language across API, Console, and CLI. |

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
