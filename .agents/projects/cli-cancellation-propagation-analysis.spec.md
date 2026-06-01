# CLI Cancellation Propagation Spec

## Problem

The CLI does not model cancellation as a first-class runtime concern. Long-running commands, network-heavy workflows, streaming logs, polling loops, filesystem operations, and local child processes mostly rely on process termination or library-specific behavior when users interrupt execution.

This creates inconsistent outcomes: some operations stop promptly, some continue until their current I/O finishes, some surface raw abort exceptions, and some depend on whether the underlying SDK or Node API happens to observe cancellation. The CLI needs one cancellation model that starts at the process boundary, propagates through command execution, and reaches every supported I/O boundary that can honor it.

Success means a keyboard interrupt or process termination signal reliably stops in-flight command work, preserves automation-friendly output contracts, and reports one stable cancellation error shape instead of leaking raw implementation errors.

The case against this work is that normal process termination already stops most user-visible work. That is insufficient for this CLI because app deployment, log streaming, polling, credential refresh, local process execution, and future workflow expansion all depend on explicit runtime contracts rather than accidental process exit behavior.

## Stakeholders

- **S1 CLI users:** Need `Ctrl-C` and termination signals to stop long-running commands predictably without confusing raw errors.
- **S2 Automation and CI users:** Need stable structured cancellation output so agents and scripts can distinguish user cancellation from operational failure.
- **S3 CLI maintainers:** Need a single propagation rule that prevents each controller, adapter, or SDK wrapper from inventing cancellation behavior.
- **S4 SDK and platform integrators:** Need the CLI to pass available `AbortSignal` values into SDK calls that already support cancellation.

## Functional Requirements

- **FR1 Entry cancellation:** The CLI must create exactly one command-lifetime cancellation source at the application entry boundary and use it as the root cancellation source for the command invocation.

- **FR2 Signal mapping:** Keyboard and process cancellation signals must be converted into command cancellation at the application entry boundary. Cancellation signal handling must not be reimplemented by controllers, adapters, providers, or command handlers.

- **FR3 Runtime availability:** Every command execution context must expose the current command cancellation signal so command handlers and their dependencies can observe the same cancellation state.

- **FR4 Central error shape:** Cancellation must map to one stable CLI error envelope at the command execution boundary for both regular commands and streaming commands. The envelope must use stable error code `COMMAND_CANCELED` and must be distinguishable from usage errors, authentication failures, operational failures, and internal bugs.

- **FR5 Human cancellation output:** Human-readable cancellation output must clearly state that the command was canceled and avoid implying an underlying platform, build, auth, or filesystem failure.

- **FR6 JSON cancellation output:** Commands run with `--json` must emit the documented failure envelope with `ok: false`, the command identifier, stable cancellation code, domain, severity, summary, and empty recovery fields when no user action is needed.

- **FR7 Streaming cancellation output:** Streaming commands must report cancellation through the streaming error event shape rather than a raw exception, partial success event, or unformatted process exit.

- **FR8 SDK cancellation:** All Management API and Compute SDK calls that support cancellation must receive the command cancellation signal for each operation started during command execution.

- **FR9 Build and deploy cancellation:** App deployment workflows must propagate cancellation through app lookup, deployment creation, build capability checks, build execution, archive/upload work, HTTP calls, polling, and post-deploy status checks where the underlying boundary can observe cancellation.

- **FR10 Log streaming cancellation:** App log streaming must stop promptly when canceled and normalize SDK cancellation results into the central CLI cancellation outcome.

- **FR11 Polling cancellation:** Every internal polling loop must check cancellation before beginning another poll and must use sleeps that reject promptly when canceled.

- **FR12 Local process cancellation:** Local app execution must propagate cancellation to child process execution and normalize abort-related process outcomes into the central CLI cancellation outcome.

- **FR13 Git process cancellation:** Git adapter operations that spawn local processes must observe command cancellation and stop subprocess work when supported by the process boundary.

- **FR14 Filesystem cancellation:** Internal filesystem helpers must accept and propagate the command cancellation signal. Filesystem operations with native `AbortSignal` support must use it. Unsupported filesystem operations must check cancellation immediately before invoking external I/O.

- **FR15 Unsupported boundary rule:** Internal APIs must propagate the signal until the exact external I/O boundary. If that boundary cannot consume `AbortSignal`, the implementation must deliberately stop propagation there, check cancellation immediately before the call, and document that the external API cannot consume the signal.

- **FR16 Read-only unsupported I/O:** Unsupported read-only I/O boundaries with no dangerous cancellation side effects must also check cancellation after the awaited operation before returning the result.

- **FR17 No fake cancellation:** The CLI must not wrap non-cancelable upstream APIs in local `Promise.race` shims to simulate cancellation.

- **FR18 Prompt separation:** Prompt-library cancellation and keyboard/process cancellation must remain distinct. Prompt cancellation may continue to surface as usage-oriented behavior, while runtime cancellation must take the higher-priority command cancellation path.

- **FR19 Existing behavior preservation:** Cancellation support must not change command names, command grouping, target resolution, branch semantics, output stream ownership, or success output shapes.

## Non-Functional Requirements

- **NFR1 Responsiveness:** Signal-aware sleeps and supported SDK/process/filesystem boundaries must react to cancellation without waiting for the next fixed polling interval to elapse.

- **NFR2 Consistency:** The same cancellation source and error mapping must apply across command groups, including `auth`, `project`, `branch`, and `app`.

- **NFR3 Automation safety:** Structured cancellation output must be stable enough for agents and CI to branch on `error.code`, not prose.

- **NFR4 Maintainability:** Cancellation propagation must be represented in public internal types where possible so new command code receives type pressure to pass the signal forward.

- **NFR5 Minimality:** The change must not add a cancellation abstraction layer beyond the platform-standard `AbortController` and `AbortSignal` unless a concrete unsupported boundary requires a small local helper.

- **NFR6 Operational clarity:** Canceled commands must not be reported as platform failures, build failures, run failures, or deployment failures unless cancellation exposed a separate, completed failure before the cancellation was observed.

- **NFR7 Cleanup:** Cancellation handling must not leave local child processes intentionally running after the parent CLI command has been canceled.

## Assumptions

- **A1 SDK baseline:** `@prisma/management-api-sdk@1.35.0` and `@prisma/compute-sdk@0.20.0` are the baseline dependencies for implementation, and their documented per-call cancellation support is available.

- **A2 Runtime root:** The correct root cancellation source is the CLI entry boundary rather than each command boundary, because cancellation must apply uniformly to parsing-triggered execution paths and command handlers.

- **A3 Signal coverage:** `SIGINT` and `SIGTERM` must both map to the same formatted command cancellation envelope.

- **A4 Exit code:** Canceled commands must use exit code `130`. This intentionally departs from the current MVP exit-code set because cancellation has established shell semantics and should be recognizable to operators and process supervisors while `COMMAND_CANCELED` remains the structured branching surface for agents and CI.

- **A5 Error domain:** Command cancellation should use the `cli` error domain because cancellation is initiated by the CLI runtime rather than by auth, project, branch, app, or platform state.

- **A6 Existing architecture analysis:** `docs/architecture/cancellation-propagation-analysis.md` is source material for implementation planning, not the governing spec artifact.

- **A7 No product command changes:** This work is runtime behavior only and does not require changes to the product command model.

## Downstream Effects

- **DE1 Implementation surface:** Many signatures across controllers, libraries, adapters, providers, and local helper functions will need to accept cancellation options. This is deliberate because shallow cancellation creates false confidence.

- **DE2 Test fixtures:** Tests that construct `CliRuntime` or command contexts will need to provide or inherit a command signal. This should improve testability by making cancellation behavior explicit.

- **DE3 Error docs:** The product error conventions will need a new stable cancellation code and an explicit cancellation exit-code exception.

- **DE4 Streaming behavior:** Consumers of JSON streaming output will see a structured error event on cancellation rather than relying on process interruption or raw abort output.

- **DE5 Maintenance burden:** New I/O helpers must decide whether their external boundary supports `AbortSignal`; the unsupported boundary rule keeps that decision local and reviewable.

- **DE6 Partial remote effects:** Cancellation can stop waiting, polling, streaming, or local work, but it cannot guarantee rollback of remote operations already accepted by platform APIs. User-facing output must avoid promising rollback or no-op semantics.

## Out Of Scope

- **OOS1 Rollback semantics:** This work does not add rollback or compensation for deployments, environment updates, project creation, app deletion, or other remote operations already accepted by an API.

- **OOS2 New command surface:** This work does not add commands, flags, aliases, namespaces, or shortcuts.

- **OOS3 Product workflow changes:** This work does not alter project, branch, app, repository, deployment, or domain resolution semantics.

- **OOS4 Prompt redesign:** This work does not redesign prompt cancellation behavior beyond preserving separation from runtime signal cancellation.

- **OOS5 Upstream SDK behavior:** This work does not patch external SDKs or Node APIs that cannot consume `AbortSignal`.

- **OOS6 Fake cancellation:** This work does not simulate cancellation for unsupported external operations with local racing wrappers.

## Open Questions

None.
