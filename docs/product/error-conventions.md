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

Human-readable errors should follow this shape:

1. first line: short summary plus stable code
2. relevant context such as project, branch, app, or deployment
3. why
4. fix
5. where when relevant
6. hint for `--log-level verbose` when helpful

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

If a condition is expected and actionable, document it as a structured failure. If it is a bug, do not hide it behind a fake user-facing success envelope.
