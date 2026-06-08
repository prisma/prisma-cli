# Better Result Error Handling Adoption Spec

## Problem

The CLI currently mixes thrown `CliError` instances, generic `Error` wrappers, nullable sentinel returns, local `try`/`catch` blocks, and SDK-specific result handling across adapters, lib modules, use cases, controllers, and shell boundaries. This makes expected failures harder to audit because callers cannot reliably see, from the type signature alone, which failures must be handled before user output is produced.

This work matters because CLI errors are part of the product surface. The product error conventions require stable structured codes, actionable recovery guidance, and agent-friendly branching fields. The implementation needs stronger type-level guarantees that expected failures are carried from the lowest fallible boundary to the command boundary without becoming untyped exceptions, `null`, booleans, or generic messages.

Success means owned fallible application code exposes typed `better-result` outcomes, expected failures are modeled as `TaggedError` variants, command-facing error conversion is exhaustive, and agents can verify by type checking that every propagated expected failure has a user-facing mapping before it reaches CLI output.

The case against this work is migration cost. The codebase is small and the current shell boundary already handles `CliError` formatting. A broad rewrite could add churn without improving user behavior. The adoption must therefore be incremental, bottom-up, and focused on call stacks where typed expected failures materially improve correctness.

## Stakeholders

- **S1** CLI users need errors that explain what failed, why it failed, and what useful recovery step is available.
- **S2** Automation users and agents need stable structured error codes and exhaustive mappings so they can branch on error data rather than prose or process exit codes.
- **S3** CLI maintainers need fallible code paths whose expected failures are visible in types and cannot be accidentally dropped while wiring controllers, use cases, and adapters.
- **S4** Future contributors need adoption rules that allow migration one call stack at a time without requiring a whole-repository rewrite.

## Functional Requirements

- **FR1** Owned application code that can fail must be able to return `better-result` results whose error type includes only locally produced expected failures plus failures propagated from callees.
- **FR2** Expected failures must be represented as `TaggedError` variants with enough structured context to produce the documented CLI error envelope fields: code, domain, summary, why, fix, where, metadata, next steps, and exit code where applicable.
- **FR3** Unexpected failures caught by `Result.try` or `Result.tryPromise` must remain represented as `UnhandledException` unless a boundary can classify the failure as a specific expected `TaggedError` at the lowest throwing expression.
- **FR4** Throwing and rejecting external boundaries must be wrapped at the lowest owned boundary that can classify the result. This includes filesystem, SDK, parsing, process, runtime, prompt, and network-facing calls owned by the CLI implementation.
- **FR5** Lower layers must propagate typed results upward instead of converting failures into generic `Error`, `CliError`, `null`, booleans, or swallowed exceptions. If a failure is intentionally best-effort, the discard or capture decision must happen at the boundary that owns that best-effort policy.
- **FR6** Composition across multiple result-returning operations must preserve the inferred error union and must use generator-based composition where sequential fallible operations would otherwise require manual `isErr` propagation.
- **FR7** Command-facing boundaries must convert typed expected failures into the existing human and JSON CLI error output shapes without weakening the product error conventions in `docs/product/error-conventions.md`.
- **FR8** Error conversion at command-facing boundaries must use exhaustive `matchError` handling for every expected `TaggedError` variant that can reach that boundary. Catch-all or partial matching is not acceptable for expected user-facing failures.
- **FR9** Existing user-visible error codes from `docs/product/error-conventions.md` must remain stable unless the product docs are updated first.
- **FR10** Adoption must proceed bottom-up by call stack: boundary adapters and low-level lib modules first, then use cases, then controllers, then shell or command-boundary conversion.
- **FR11** The implementation must not refactor generated code, third-party SDK internals, or framework internals for result handling. If generated, SDK-owned, or framework-owned code throws, only owned wrapper boundaries may adopt `better-result`.
- **FR12** The dependency on `better-result` must be added to the package that owns the fallible CLI application code before code starts importing it.

## Non-Functional Requirements

- **NFR1** Type checking must be a primary verification mechanism. A newly introduced expected error variant in a migrated call stack must require updates to exhaustive command-facing mapping before the project type check can pass.
- **NFR2** Runtime behavior must remain automation-friendly. JSON error envelopes must keep stable machine-readable fields, and human-readable errors must continue writing to stderr through existing output helpers.
- **NFR3** Migration slices must be reviewable independently. Each slice should target a coherent call stack or boundary area and avoid unrelated command behavior changes.
- **NFR4** User-facing error quality must not regress. For migrated expected failures, the rendered output must include at least the same actionable context as the current `CliError` path or improve it according to the product error conventions.
- **NFR5** Unexpected bugs must remain debuggable. Adoption must not hide invariant failures behind expected user-facing envelopes, and stack-preserving outer crash behavior must remain available for defects.
- **NFR6** Tests for migrated paths must exercise public boundaries used by callers rather than private helpers introduced only for test access.

## Assumptions

- **A1** The first implementation plan should focus on `packages/cli`, because that is where owned fallible CLI application code, adapters, use cases, controllers, and shell boundaries currently live.
- **A2** The existing `CliError` output model remains the public CLI error envelope. It may be tightened internally, but `better-result` should not be exposed to CLI users. `TaggedError` variants become the typed internal source that command-facing boundaries convert into that envelope.
- **A3** Nullable returns that model absence without failure may remain nullable. Nullable returns that currently hide parsing, I/O, SDK, auth, or state failures should migrate to typed results.
- **A4** Best-effort diagnostics and update checks should still return typed results from fallible operations. The boundary that owns the best-effort policy may then explicitly discard the error or capture it in the background.
- **A5** The dependency version available from npm at spec time is `better-result@2.9.2`, and the implementation plan should verify the current version before installation.
- **A6** Result conversion should happen only at CLI-facing boundaries present in this repository, including command runners, controllers that produce command output, auth providers, API/client adapters, storage adapters, and startup assembly.

## Downstream Effects

- **D1** Function signatures in low-level adapters and lib modules will become more explicit, which may require staged updates through callers before a full call stack compiles.
- **D2** Tests that currently assert thrown `CliError` behavior from internals may need to move up to command-facing public surfaces or assert typed results at the module's public API.
- **D3** Existing helper functions that only construct `CliError` instances may become obsolete as `TaggedError` constructors take over message and context construction.
- **D4** Contributors will need to understand `Result.gen`, `TaggedError`, `UnhandledException`, and exhaustive `matchError` before changing migrated call stacks.
- **D5** The migration may reveal product error cases that are not yet represented in `docs/product/error-conventions.md`; those cases require product-doc updates before implementation assigns stable codes.

## Out Of Scope

- **OOS1** This spec does not require a whole-repository migration in one change.
- **OOS2** This spec does not change command names, command behavior, or the documented resource model.
- **OOS3** This spec does not replace the public human or JSON CLI error envelope with serialized `better-result` output.
- **OOS4** This spec does not require converting non-failure absence states, such as optional display fields, into results.
- **OOS5** This spec does not require refactoring generated code, framework internals, or third-party SDK internals.
- **OOS6** This spec does not mandate installing `better-result` skills for agents, though future planning may decide that is useful.

## Open Questions

None.
