# CLI I/O Timeouts Spec

## Problem

CLI commands that perform external I/O currently rely on cooperative cancellation, but they can still wait forever when an API request, SDK operation, filesystem boundary, browser/login callback, child process, polling loop, or stream stalls without resolving. That is bad for humans because the CLI appears broken, and bad for agents/CI because a hung process blocks automation until an external supervisor kills it.

The goal is to make every I/O-based command terminate predictably when progress stops, while preserving legitimate long-running workflows such as deployment, domain verification, GitHub installation approval, OAuth login, local dev processes, and log streaming.

Success means no command can hang indefinitely because of a stalled I/O boundary, timed-out work produces stable actionable CLI errors, user cancellation remains distinct from timeout, and automation can safely branch on structured error codes rather than wall-clock watchdogs.

The case against this work is that overly aggressive timeouts can create false failures for users on slow networks, slow builds, slow domain propagation, or long-lived streams. A single command-wide timeout is especially risky because it punishes legitimate progress and makes commands like `app logs`, `app run`, and `app domain wait` unreliable by default.

## Stakeholders

Primary actors:

- CLI users need commands to fail clearly instead of hanging, and they need long-running workflows to stay usable when work is still making progress.
- CI and agent operators need bounded command behavior, stable structured timeout errors, and no surprise prompts or decorative output in automation.
- CLI maintainers need one cross-command timeout model that prevents each command from inventing incompatible deadlines and error behavior.

Secondary beneficiaries:

- Platform API and SDK teams get clearer timeout reports that identify stalled boundaries rather than generic cancellations.
- Support teams get error metadata that distinguishes user cancellation, command-specific wait expiry, API unavailability, and stalled local runtime work.

## Functional Requirements

**FR1** Every CLI command that performs Prisma-controlled external I/O must have bounded waits for stalled I/O boundaries. Covered boundaries include Prisma API requests, SDK operations, CLI-owned callback waits, polling sleeps, and remote streams where inactivity can be classified without punishing plausible slow-but-healthy user work.

**FR2** Timeouts must be scoped to the smallest user-meaningful stalled boundary rather than the whole command by default. A command may run longer than any single I/O timeout when it is making progress across multiple bounded steps.

**FR3** Command-level deadlines must be reserved for commands whose purpose is explicitly to wait for an eventual condition. Existing command-specific wait semantics, such as `app domain wait --timeout`, remain the user-facing total wait budget for that condition.

**FR4** Long-lived commands must not time out merely because they are long-lived. `app logs`, local app runtime commands, interactive OAuth login, GitHub installation approval waits, deploy/build operations, and domain verification waits must only fail on inactivity, an explicit command wait deadline, process failure, user cancellation, or a terminal remote state.

**FR5** User cancellation must remain distinct from timeout. `SIGINT`, `SIGTERM`, prompt escape cancellation, and upstream runtime aborts must continue to produce `COMMAND_CANCELED` and exit `130`; timeout-caused aborts must not be reported as user cancellation.

**FR6** Timeout failures must produce stable structured errors at the command boundary. JSON output must use `OPERATION_TIMEOUT`, the logical error domain, a summary, why, fix, and structured metadata identifying the timed-out operation and configured duration when known.

**FR7** Timeout failures must use exit code `1`, except usage errors involving invalid timeout configuration continue to use exit code `2`.

**FR8** Human timeout errors must identify what stopped making progress and what the user can do next. The message should prefer action-oriented recovery such as retrying, checking network/VPN/proxy state, inspecting platform status, increasing an explicit wait timeout where supported, or using `--trace` for details.

**FR9** Defaults must be generous enough for normal slow networks and platform latency. Default deadlines must protect against indefinite hangs, not optimize for fast failure or timeout plausible slow-but-healthy cases.

**FR10** Timeout behavior must be consistent across human, `--json`, TTY, non-TTY, CI, quiet, verbose, and trace modes. Output stream rules remain unchanged: structured data on stdout, human status and errors on stderr.

**FR11** Timeout metadata exposed to agents must be stable and non-sensitive. It may include operation labels, command labels, duration milliseconds, whether the timeout was inactivity-based or total-deadline-based, and the last known resource status. It must not include tokens, raw request headers, secrets, or full local absolute paths.

**FR12** Commands that already expose a user-configurable wait timeout must continue to honor that setting. A timeout value of `0` keeps the documented command-specific meaning where one exists, such as poll-once snapshot mode for domain wait.

**FR13** Timeout configuration must not become a broad new public command surface in the first slice. The default behavior should work without adding global `--timeout` flags. Any new user-facing timeout knobs require source-of-truth product documentation before implementation.

**FR14** Update checks and other advisory background work must never extend the command's runtime or change the original command result because of timeout handling. Advisory work should remain best-effort and non-blocking.

**FR15** Timeout handling must compose with existing AbortSignal cancellation. A timeout that aborts an internal operation must not accidentally abort unrelated sibling work or change the root command signal's user-cancellation meaning.

**FR16** Timeouts should be applied only where the CLI can reasonably control or classify the boundary, including Prisma-managed endpoints, SDK operations, and bounded local operations. The CLI must avoid adding timeouts to plausible user-controlled slow paths where a timeout would create more false negatives than protection.

## Non-Functional Requirements

**NFR1** Reliability: no externally backed command may wait indefinitely on a stalled operation when the underlying runtime supports cooperative abort or when the CLI can observe inactivity.

**NFR2** Automation safety: CI and agent runs must receive deterministic process termination and stable error envelopes without relying on external shell watchdogs.

**NFR3** Low false-positive rate: default timeout budgets must be conservative. A normal user on a slow connection or a normally slow deployment must not see timeout failures unless progress has actually stalled at a boundary the CLI controls, or an explicit wait deadline has expired.

**NFR4** Observability: verbose or trace output must make timeout diagnosis possible without exposing secrets. Trace mode may include underlying abort/timeout causes and operation labels.

**NFR5** Maintainability: timeout policy must be centralized enough that new commands inherit the same behavior and error taxonomy, while still allowing command-specific wait semantics where documented.

**NFR6** Compatibility: existing documented behavior for `COMMAND_CANCELED`, `DOMAIN_VERIFICATION_TIMEOUT`, stream output, JSON envelopes, and stdout/stderr separation must not regress.

**NFR7** Security: timeout errors and metadata must never print credentials, token-derived secrets, Authorization headers, secret environment variable values, or full absolute local paths.

**NFR8** Portability: timeout behavior must work in the supported Node.js runtime across macOS, Linux, Windows, TTY, non-TTY, and CI environments.

## Assumptions

**A1** Step-scoped and inactivity-scoped timeouts are the right default. A root command timeout would be simpler, but it would incorrectly fail legitimate long-running commands and collapse useful diagnostics into one generic deadline.

**A2** The first implementation should add `OPERATION_TIMEOUT` as the generic timeout error code for stalled operational I/O, while retaining existing command-specific timeout codes for domain verification and similar explicit wait commands.

**A3** Timeout aborts should be represented separately from user cancellation even if both are implemented with AbortSignal internally.

**A4** Defaults should be documented as product behavior before implementation. The exact durations should be decided during planning after command inventory, but the spec intentionally requires generous defaults rather than fast-fail defaults.

**A5** Existing public command-specific timeout flags should keep their current behavior. This spec should not reinterpret `app domain wait --timeout` as a lower-level network request timeout.

**A6** A global public `--timeout` flag is not part of the first slice. It would be too ambiguous because different commands need request deadlines, inactivity deadlines, and total wait deadlines.

**A7** Timeout behavior does not require dedicated tests in the first slice. Planning should keep implementation simple and avoid building test-only timeout configurability unless it is already needed for another reason.

**A8** Local build and run child processes should avoid total deadlines. Where timeout protection is needed, it should be limited to inactivity or startup boundaries the CLI can reasonably observe and classify.

## Downstream Effects

Timeouts become part of the CLI product contract, not just an implementation detail. That means docs, help text for commands with explicit wait deadlines, error codes, and support playbooks must stay aligned.

In 6-12 months, a step-scoped model should make the CLI safer to extend because new remote commands can inherit the same timeout/error behavior. The maintenance cost is that every new kind of long-lived operation must declare whether it is request-bound, inactivity-bound, or total-deadline-bound.

The main negative effect is that users on unusually slow networks may see timeout errors that did not exist before. The mitigation is generous defaults, operation-specific recovery guidance, and preserving explicit wait knobs only where they map to user intent.

Agents and CI will have a better branching surface, but any downstream scripts that currently rely on a process hanging until an external supervisor kills it will observe earlier failures. That is an intentional behavior change.

## Out of Scope

**OS1** Adding a global `--timeout` flag across all commands.

**OS2** Changing the command grammar or adding new command groups.

**OS3** Changing platform API server-side timeout behavior.

**OS4** Retrying operations automatically beyond already documented retry behavior. Timeouts and retries are related, but this spec only requires bounded waiting and clear failure.

**OS5** Changing existing domain verification semantics beyond ensuring they compose with lower-level I/O timeouts.

**OS6** Replacing external CI/job-level timeouts. Shell supervisors remain useful as a last-resort guardrail, but the CLI should not depend on them for normal stalled I/O.

## Open Questions

None.
