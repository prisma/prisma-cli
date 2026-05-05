# AGENTS.md

## Purpose

This repo uses document-driven development for the new Prisma CLI.

The docs in `docs/product` are the source of truth. Do not invent product behavior in code that is not already grounded in those docs. If behavior is unclear or missing, update docs first.

## What This CLI Is

- This is the future unified Prisma CLI.
- The first implementation slice is app deployment workflows, but the command model must preserve the long-term CLI for ORM, Postgres, and app workflows.

## Read These First

Start with `docs/README.md` for the public docs index.

1. `docs/product/resource-model.md`
2. `docs/product/command-principles.md`
3. `docs/product/command-spec.md`
4. `docs/product/cli-style-guide.md`
5. `docs/product/output-conventions.md`
6. `docs/product/error-conventions.md`

Architecture and contributor workflow references:

- `ARCHITECTURE.md`
- `docs/architecture/overview.md`
- `docs/onboarding/getting-started.md`
- `docs/onboarding/common-tasks.md`
- `docs/onboarding/testing.md`

## Non-Negotiable Product Rules

- Group commands by developer workflow, not product ownership.
- No `orm`, `postgres`, or `compute` namespaces in the command surface.
- Canonical command shape is `prisma <group> <action>`.
- The current preview uses only `auth`, `project`, `branch`, and `app`.
- Preserve the long-term resource model:
  - `workspace -> project -> branch -> { app, database }`

For exact definitions and resolution rules, see `resource-model.md` and `command-spec.md`.

## Branch Model

Do not redefine this casually:

- everything under a project happens in a branch
- `local` is local CLI context only, not a branch or deploy target
- `production` is a protected durable branch
- every other named branch is preview by default
- preview branches are disposable by default
- non-production branches can become durable later
- first remote deploy defaults to preview
- production is reached by `app promote` or explicit user targeting

See:

- `docs/product/resource-model.md`
- `docs/product/command-spec.md`

## Output and Error Behavior

Before changing CLI UX, read:

- `docs/product/cli-style-guide.md`
- `docs/product/output-conventions.md`
- `docs/product/error-conventions.md`

Important themes:

- stdout is for machine-readable data
- stderr is for human-oriented status and decoration
- `--json` is explicit
- non-TTY and non-interactive behavior must stay automation-friendly
- structured error codes are the branching surface for agents and CI

## When Making Changes

- Prefer tightening existing docs over adding new surface area.
- Keep nouns and verbs stable across docs, help, output, and code.
- Do not add shortcuts or aliases as canonical forms.
- Do not let the current app preview introduce abstractions that will block later ORM/Postgres integration.
- If docs conflict, resolve the docs rather than guessing in implementation.

## Default Agent Workflow

1. Read the product docs above.
2. Identify the relevant source-of-truth doc for the task.
3. If implementation requires undefined behavior, update docs first.
4. Keep changes aligned with the unified CLI direction, not just the current app slice.
