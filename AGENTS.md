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

## Error Handling

- Use `better-result` for owned application code that can fail.
- Model expected failures as `TaggedError` types from `better-result`.
- Put tagged error message construction in the constructor. Instantiate tagged errors directly; delete factory functions that only wrap constructors. Use static constructors only when they encode distinct domain variants.
- Represent unexpected failures as `UnhandledException` from `better-result`.
- Return only errors produced by the function plus errors propagated from callees. Do not create app-wide error unions.
- Wrap throwing or rejecting boundaries with `Result.try` or `Result.tryPromise`. This includes SDK calls, I/O, parsing, and async framework calls.
- Wrap expected throwing failures at the lowest throwing expression and map them to the local tagged error type.
- Once a function returns `Result`, do not throw inside its body for modeled boundaries. Return expected errors, abort errors, and propagated `UnhandledException` values in the error union; throw only at temporary or final CLI-facing boundaries.
- When mapping abortable boundary failures, prefer `signal.aborted` over matching error names or messages to detect cancellation.
- Do not wrap a boundary only to match `UnhandledException` and rethrow it. Let unexpected failures throw directly when no expected error is modeled or propagated.
- Use `Result.gen` to compose multiple results. Do not manually chain `isErr` propagation when `yield*` can express the flow.
- Propagate typed results through lower layers. Do not convert results to plain values, `null`, booleans, or thrown exceptions below the boundary.
- Convert results only at CLI-facing boundaries: command runners, controllers that produce command output, auth providers, API/client adapters, storage adapters, and startup assembly.
- Match errors exhaustively with `matchError`. Do not use catch-all handlers or partial matches.
- Throw tagged errors directly when their message and context are already correct. Do not wrap them in generic `Error` instances.
- Do not refactor generated code, third-party SDK internals, or framework internals for result handling.

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
