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

Bugs should fail fast and preserve stack traces. Catch them only at the outermost boundary for crash formatting.

## Boundary Handling

- internals may throw structured failures to abort quickly and preserve context
- command boundaries convert expected failures into the documented error envelope
- operational errors may be translated at boundaries when helpful
- unknown errors should not be broadly wrapped into fake "expected" failures

## Human Error Shape

Human-readable errors should follow this shape:

1. first line: short summary plus stable code
2. relevant context such as project, branch, app, or deployment
3. why
4. fix
5. where when relevant
6. hint for `-v` or `--trace` when helpful

Example:

```text
✘ Deployment failed during build [BUILD_FAILED]
Branch: preview
Why: Next.js build returned a non-zero exit code
Fix: Inspect logs and redeploy after fixing the build

More: Re-run with --trace for deeper diagnostics

Next steps:
- prisma-cli app logs
- fix the issue and rerun prisma-cli app deploy
```

## JSON Error Shape

Commands run with `--json` should emit this envelope on failure:

```json
{
  "ok": false,
  "command": "app.deploy",
  "error": {
    "code": "BUILD_FAILED",
    "domain": "app",
    "severity": "error",
    "summary": "Deployment failed during build",
    "why": "Next.js build returned a non-zero exit code",
    "fix": "Inspect logs and redeploy after fixing the build",
    "where": null,
    "meta": {},
    "docsUrl": null
  },
  "warnings": [],
  "nextSteps": []
}
```

Rules:

- `ok` is always `false`
- `command` is always present
- `error.code` is stable and machine-readable
- `error.domain` is a stable logical area such as `cli`, `auth`, `project`, `branch`, or `app`
- `error.severity` is stable and machine-readable
- `error.summary` is the short human-readable headline
- `error.why` explains the immediate cause when known
- `error.fix` explains the next useful recovery step when known
- `error.where` points to the relevant location when applicable
- `error.meta` is structured, not free-form prose
- `error.docsUrl` may be `null` when no per-code doc exists yet
- `warnings` and `nextSteps` are always present
- agents and CI should branch on structured error fields, not prose strings

## MVP Error Codes

These codes are the minimum stable set for the MVP:

- `USAGE_ERROR`
- `AUTH_REQUIRED`
- `PROJECT_UNRESOLVED`
- `PROJECT_NOT_FOUND`
- `PROJECT_AMBIGUOUS`
- `LOCAL_STATE_STALE`
- `BRANCH_NOT_DEPLOYABLE`
- `DEPLOYMENT_NOT_FOUND`
- `NO_DEPLOYMENTS`
- `NO_PREVIOUS_DEPLOYMENT`
- `PROMOTE_SOURCE_INVALID`
- `ROLLBACK_UNAVAILABLE`
- `CONFIRMATION_REQUIRED`
- `REMOVE_FAILED`
- `FEATURE_UNAVAILABLE`
- `BUILD_FAILED`
- `RUN_FAILED`
- `DEPLOY_FAILED`
- `VERSION_UNAVAILABLE`

Recommended meanings:

- `USAGE_ERROR`: invalid arguments or invalid command combination
- `AUTH_REQUIRED`: command needs an authenticated session
- `PROJECT_UNRESOLVED`: command needs project context and none could be resolved
- `PROJECT_NOT_FOUND`: requested project does not exist or is not accessible
- `PROJECT_AMBIGUOUS`: multiple safe project candidates matched
- `LOCAL_STATE_STALE`: remembered local project context no longer matches platform data and continuing would be ambiguous
- `BRANCH_NOT_DEPLOYABLE`: command tried to deploy to a non-deployable branch context
- `DEPLOYMENT_NOT_FOUND`: requested deployment id does not exist
- `NO_DEPLOYMENTS`: command resolved a branch or app but found no deployments
- `NO_PREVIOUS_DEPLOYMENT`: rollback could not find an earlier deployment for the selected app
- `PROMOTE_SOURCE_INVALID`: source for promote is missing, invalid, or not promotable
- `ROLLBACK_UNAVAILABLE`: no previous healthy production deployment exists
- `CONFIRMATION_REQUIRED`: command cannot continue without confirmation in the current mode
- `REMOVE_FAILED`: app removal could not complete remotely
- `FEATURE_UNAVAILABLE`: the command exists in the CLI model, but the current preview cannot support it yet
- `BUILD_FAILED`: build failed before a healthy deployment existed
- `RUN_FAILED`: local framework run command could not be started or exited unsuccessfully
- `DEPLOY_FAILED`: deployment or post-build health failed
- `VERSION_UNAVAILABLE`: CLI could not read its own bundled package metadata to report a version (defensive; not expected in normal installs)

## Exit Codes

The MVP should use these process exit codes:

- `0`: success
- `1`: runtime or command failure
- `2`: usage or configuration error

Stable structured error codes, not exit code granularity, are the main branching surface for agents and CI.

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
