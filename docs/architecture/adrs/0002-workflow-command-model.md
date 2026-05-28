# ADR 0002 - Workflow Command Model

## Status

Accepted

## Context

The first implementation slice focuses on app deployment workflows, but the CLI
is the future unified Prisma CLI. A product-specific command surface would be
hard to grow into schema, database, and migration workflows later.

## Decision

Commands are grouped by developer workflow. The canonical command shape is:

```text
prisma <group> <action>
```

The beta implementation includes the command groups defined in
`docs/product/command-spec.md`, which is authoritative for beta command-group
scope. At the time of this ADR, those groups are:

- `auth`
- `project`
- `git`
- `branch`
- `app`

The command surface must not introduce `orm`, `postgres`, or `compute`
namespaces.

## Consequences

- Product docs, help text, tests, and implementation should use the same nouns
  and verbs.
- New commands must fit the workflow model before they are implemented.
- MVP shortcuts are allowed only when they preserve the long-term unified CLI
  model.
