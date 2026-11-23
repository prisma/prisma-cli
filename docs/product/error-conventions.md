# Prisma CLI Error Conventions

## Purpose

This document defines how the CLI reports errors in human-readable and structured form.

Errors are part of the product surface. They are not implementation leftovers.

Use `cli-style-guide.md` for tone and presentation, and `output-conventions.md` for stream rules.

## Core Rules

A good CLI error must:

- say what failed
- identify the relevant boundary when it matters
- say what the user can do next
- fail closed around production

A bad CLI error:

- hides target context
- exposes raw internals instead of user meaning
- stops without a next step

## Taxonomy

### Expected Failure

An expected, explainable condition where the command cannot complete as requested.

Examples:

- invalid flags or conflicting arguments
- missing project context
- deploy target not allowed
- blocked protected action
- target CLI capability exists, but the current preview cannot support it yet

Expected failures should:

- have stable structured codes
- include actionable context
- return a structured envelope at the command boundary

### Operational Error

An OAuth `access_denied` callback during `auth login` is an expected authorization
refusal, reported as `AUTH.LOGIN_DENIED`, not `CLI.INTERNAL_ERROR`. It does not
create or clear stored sessions. The CLI suggests signing in again only if the
user intends to authorize access. Callback descriptions are not reflected into
diagnostics because they are untrusted input.
Both browser redirects and pasted callback URLs end login with that error;
an explicit denial must not reopen the paste prompt.

An expected external fault, not a product bug.

Examples:

- network timeout
- platform API unavailable
- permission or auth failure
- underlying runtime or build system failure

Operational errors may be translated into stable structured envelopes when that improves recovery, but they should not be disguised as programming bugs.

### Bug

An unexpected fault or invariant break where the system cannot reliably continue.

Examples:

- impossible branch reached
- unexpected `undefined`
- internal serialization or state invariant broken

Bugs should fail fast and preserve stack traces. Catch them only at the outermost boundary for crash formatting. At that boundary, `--json` runs still emit the standard error envelope with code `UNEXPECTED_ERROR`, and both output modes point at `prisma feedback` pre-filled with the failing command and error line (`--quiet` suppresses the human hint; expected failures never carry the feedback suggestion).

## Boundary Handling

- the site that detects a failure raises it as a structured error, already carrying its code and its next actions
- a structured error travels to the engine untouched; a command boundary does not catch one only to re-emit it under a different code
- an operational fault from a dependency (an API response, a child process) is raised as a structured error where it is recognized, with the underlying error kept as `cause`
- unknown errors should not be broadly wrapped into fake "expected" failures

## Human Error Shape

Without `--json` or `--format`, a failure is a human error on stderr with the
exit code below, whether stdout is a terminal, a pipe, or a file. A piped run
never switches to the JSON envelope on its own.

Human-readable errors should follow this shape:

1. first line: short summary plus stable code
2. relevant context such as project, branch, app, or deployment
3. why
4. fix
5. where when relevant
6. hint for `--log-level verbose` when helpful

A `why` that runs over several lines is indented on every line, each continuation line aligned under the text after `why: `.

Example:

```text
Build failed locally.

✗ Built       next build exited with code 1

Fix: Inspect the build output above, fix the error, and redeploy.
```

If the deployment starts but the app is not ready yet, list the deployment URL
and point to runtime logs without claiming a health-check result until the
platform exposes one:

```text
The deployment started, but the app is not ready yet.

This is usually a missing env var, a failed DB connection,
or a crash on startup.

See what happened
prisma app logs --deployment <id>

URL
https://cv-...
```

## JSON Error Shape

Commands run with `--json` emit this envelope on failure:

```json
{
  "ok": false,
  "error": {
    "code": "SERVICE.DEPLOY_FAILED",
    "severity": "error",
    "summary": "Failed to list services",
    "why": "The Management API returned status 500.",
    "meta": { "status": 500 },
    "nextActions": [
      { "kind": "user-choice", "label": "Re-run with --log-level verbose for the underlying API response details." },
      { "kind": "run-command", "label": "prisma project show", "command": "prisma project show" }
    ]
  }
}
```

Rules:

- `ok` is always `false`
- `error.code` is a stable dotted `NAMESPACE.SUBCODE` string, listed in the error reference
- `error.severity` and `error.summary` are always present; `summary` is the short human-readable headline
- `error.why` explains the immediate cause when known
- `error.nextActions` is always present (empty when there are none). What used to be a free-text `fix` is the first action, a `user-choice`; recovery commands are `run-command` actions, and an address to visit is an `open-url` action, never a `command`
- `error.where` points to the relevant location when applicable
- `error.meta` is structured, not free-form prose — it is where a server's own error code and HTTP status belong
- `error.docsUrl` may be absent when no per-code doc exists yet
- absent optional fields are omitted rather than sent as `null`
- agents and CI should branch on `error.code`, never on prose strings

## Error Codes

Every user-facing error carries a dotted `NAMESPACE.SUBCODE` code, assigned where the error is raised. The canonical registry of every code, with the condition that raises it, is [docs/reference/error-reference.md](../reference/error-reference.md); `pnpm check:error-reference` fails CI if a code in production source is missing from it.

Two rules govern codes:

- **Assign at origin.** The site that detects the failure names the code. No boundary rewrites a code on the way out, and no code is built by concatenation — a code assembled from a prefix and a variable is a code the registry cannot list and a caller cannot rely on.
- **A server's code is data, not your code.** When a Management API request fails, raise the domain's registered `*.API_ERROR` and put the API's own code and status in `meta.apiCode` and `meta.status`.

Adding a code means adding its entry to the registry in the same change.

## Errors From The Systems Below The API

Many resources the CLI shows are kept by a system below the Management API: a custom domain and its certificate live in Foundry, a TXT record in DNS. When one of those systems fails, the failure reaches the user through the API and then the CLI. The rule for every layer is in the control plane's [Modeling errors across system boundaries](https://github.com/prisma/pdp-control-plane/blob/main/docs/ErrorsAcrossSystemBoundaries.md) (the link works once that document has merged). It is the one source; this section says only what the rule means for a command.

Will Madden, 2026-11-23: "Anytime we're modeling a resource which is maintained in a lower-level system like this, we should be treating this the same way." On why a failure happened: "This is not something we care about. We only care if we've been given instructions for the user or not."

Such a failure is one of three kinds, and the system that reports it decides which, by how it answers. The CLI does not sort failures by reading message text.

| Kind | How it reaches the CLI | What the command says |
| --- | --- | --- |
| Internal | A 5xx answer, or a resource that says it failed or is still being brought up to date, with no detail | That the operation failed for reasons we are not sure about, and that the user can try again or contact support |
| Relayed | A 4xx answer with a message, or a field that holds the lower system's message, such as a hostname's `failureReason` | The message as given. The command does not interpret it and adds no advice of its own, such as "fix it and retry" or "try again, it may work" |
| Modelled | A state, condition or error code the API defines for the case | The command's own message, with the specific thing the user must do |

The reasoning: a user cannot act on an internal error, and printing it turns another system's internals into an interface nobody designed. The lower system knows more about its own refusals than the CLI does, so when it marks a message as fit for the user, passing it on unchanged gives the user something to act on without tying the CLI to that system's wording. A message of the CLI's own costs design and upkeep, and earns it only when the CLI knows exactly what the user must fix.

A command gives a failure handling of its own only when the API models it. It does not turn a lower system's fault, such as a hung job, into a state or message of its own: that fault reaches the user as a timeout or an internal failure.

For `service domain`, the modelled cases are the ones the API reports on the hostname: ownership not verified, DNS not pointing at Prisma, no live version, the service deleted, the hostname held elsewhere, and a limit reached on `retry`. A failed certificate is relayed: "Provisioning failed. The platform reported: …". A failed certificate with no reason, a failed platform update, and a `wait` that times out while the platform is still working are internal.

## Exit Codes

The MVP should use these process exit codes:

- `0`: success
- `1`: runtime or command failure
- `2`: usage or configuration error
- `130`: command cancellation

Stable structured error codes, not exit code granularity, are the main branching surface for agents and CI.

Cancellation intentionally uses `130` instead of the generic runtime failure code because it has established shell semantics for interrupted commands and is useful to operators and process supervisors. Agents and CI should still branch on the structured code (`CLI.PROMPT_CANCELLED`, `CLI.ABORTED`) rather than the numeric exit code.

## Production Safety

Production-related failures should fail closed.

That means:

- do not guess production intent
- do not proceed when target resolution is unclear
- do not hide whether production changed

If a production action is blocked or fails, the output should make clear whether production stayed unchanged.

## Design Rule

Every error should help the user recover without opening another document first.

Custom-domain input errors preserve an explicitly supplied `--branch` in recovery
commands, even when validation fails before the service is selected. Recovery must
not silently switch a preview or staging request to production.

Custom-domain quota errors use the API's recovery hint when supplied. Without an API hint, the CLI keeps its advice to free an existing domain slot. The hourly limit of new certificates is a separate failure, raised by `service domain retry`: it requires waiting, and deleting a domain does not restore that budget.

If a condition is expected and actionable, document it as a structured failure. If it is a bug, do not hide it behind a fake user-facing success envelope.
