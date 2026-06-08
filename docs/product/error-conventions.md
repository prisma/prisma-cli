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
prisma-cli app logs --deployment <id>

URL
https://cv-...
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
  "nextSteps": [],
  "nextActions": []
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
- `warnings`, `nextSteps`, and `nextActions` are always present
- agents and CI should branch on structured error fields, not prose strings

## MVP Error Codes

These codes are the minimum stable set for the MVP:

- `USAGE_ERROR`
- `AUTH_REQUIRED`
- `PROJECT_SETUP_REQUIRED`
- `PROJECT_LINK_TARGET_REQUIRED`
- `PROJECT_CREATE_FAILED`
- `PROJECT_NOT_FOUND`
- `PROJECT_AMBIGUOUS`
- `APP_AMBIGUOUS`
- `LOCAL_PROJECT_WORKSPACE_MISMATCH`
- `LOCAL_STATE_STALE`
- `BRANCH_NOT_DEPLOYABLE`
- `APP_CONFIG_INVALID`
- `FRAMEWORK_NOT_DETECTED`
- `DEPLOYMENT_NOT_FOUND`
- `NO_DEPLOYMENTS`
- `NO_PREVIOUS_DEPLOYMENT`
- `PROD_DEPLOY_REQUIRES_FLAG`
- `PROMOTE_SOURCE_INVALID`
- `ROLLBACK_UNAVAILABLE`
- `CONFIRMATION_REQUIRED`
- `DOMAIN_HOSTNAME_INVALID`
- `DOMAIN_DNS_NOT_CONFIGURED`
- `DOMAIN_ALREADY_REGISTERED`
- `DOMAIN_QUOTA_EXCEEDED`
- `DOMAIN_NOT_FOUND`
- `DOMAIN_RETRY_NOT_ELIGIBLE`
- `DOMAIN_VERIFICATION_FAILED`
- `DOMAIN_VERIFICATION_TIMEOUT`
- `REMOVE_FAILED`
- `FEATURE_UNAVAILABLE`
- `REPO_PROVIDER_UNSUPPORTED`
- `REPO_INSTALLATION_REQUIRED`
- `REPO_NOT_ACCESSIBLE`
- `REPO_NOT_CONNECTED`
- `REPO_ALREADY_CONNECTED`
- `REPO_CONNECTION_FAILED`
- `BUILD_FAILED`
- `BRANCH_DATABASE_SETUP_FAILED`
- `SCHEMA_SETUP_FAILED`
- `RUN_FAILED`
- `DEPLOY_FAILED`
- `VERSION_UNAVAILABLE`
- `COMMAND_CANCELED`

Recommended meanings:

- `USAGE_ERROR`: invalid arguments or invalid command combination
- `AUTH_REQUIRED`: command needs an authenticated session
- `PROJECT_SETUP_REQUIRED`: command needs explicit or durable Project context before it can continue
- `PROJECT_LINK_TARGET_REQUIRED`: `project link` needs the user to choose an existing Project or create a new one
- `PROJECT_CREATE_FAILED`: Project creation failed before deployment or linking could continue
- `PROJECT_NOT_FOUND`: requested project does not exist or is not accessible
- `PROJECT_AMBIGUOUS`: multiple safe project candidates matched
- `APP_AMBIGUOUS`: multiple apps matched the inferred or explicit app target
- `LOCAL_PROJECT_WORKSPACE_MISMATCH`: local Project pin points at a different workspace than the active authenticated workspace; callers should sign in to the linked workspace or relink the directory
- `LOCAL_STATE_STALE`: local Project pin no longer matches platform data and continuing would be ambiguous
- `BRANCH_NOT_DEPLOYABLE`: command tried to deploy to a non-deployable branch context
- `APP_CONFIG_INVALID`: `prisma.app.json` is missing required build settings, has invalid JSON, or points outside the app root
- `FRAMEWORK_NOT_DETECTED`: app deploy could not detect a supported Beta framework and no explicit framework/build type was provided
- `DEPLOYMENT_NOT_FOUND`: requested deployment id does not exist
- `NO_DEPLOYMENTS`: command resolved a branch or app but found no deployments
- `NO_PREVIOUS_DEPLOYMENT`: rollback could not find an earlier deployment for the selected app
- `PROD_DEPLOY_REQUIRES_FLAG`: app deploy resolved a production Branch with a prior production deployment, but `--prod` was not passed
- `PROMOTE_SOURCE_INVALID`: source for promote is missing, invalid, or not promotable
- `ROLLBACK_UNAVAILABLE`: no previous healthy production deployment exists
- `CONFIRMATION_REQUIRED`: command cannot continue without confirmation in the current mode
- `DOMAIN_HOSTNAME_INVALID`: custom-domain hostname is malformed or rejected by the platform
- `DOMAIN_DNS_NOT_CONFIGURED`: custom-domain hostname does not yet point to the required Prisma DNS target
- `DOMAIN_ALREADY_REGISTERED`: custom-domain hostname is already attached outside the selected app
- `DOMAIN_QUOTA_EXCEEDED`: selected app has reached its custom-domain quota
- `DOMAIN_NOT_FOUND`: requested custom domain is not attached to the selected app
- `DOMAIN_RETRY_NOT_ELIGIBLE`: requested custom domain is not in a state where verification can be retried
- `DOMAIN_VERIFICATION_FAILED`: custom-domain verification reached a terminal failed state
- `DOMAIN_VERIFICATION_TIMEOUT`: custom-domain verification did not reach a terminal state before the requested timeout
- `REMOVE_FAILED`: app removal could not complete remotely
- `FEATURE_UNAVAILABLE`: the command exists in the CLI model, but the current preview cannot support it yet
- `REPO_PROVIDER_UNSUPPORTED`: repository connection received a non-GitHub repository URL
- `REPO_INSTALLATION_REQUIRED`: repository connection needs a GitHub App installation before the project can be linked
- `REPO_NOT_ACCESSIBLE`: the connected GitHub App installations do not expose the requested repository
- `REPO_NOT_CONNECTED`: a command expected a project repository connection, but none exists
- `REPO_ALREADY_CONNECTED`: a project already has a different GitHub repository connected
- `REPO_CONNECTION_FAILED`: the Management API repository connection operation failed
- `BUILD_FAILED`: build failed before a healthy deployment existed
- `BRANCH_DATABASE_SETUP_FAILED`: database creation or env-var wiring failed before deployment started
- `SCHEMA_SETUP_FAILED`: local Prisma schema source setup against a newly created database failed before deployment started
- `RUN_FAILED`: local framework run command could not be started or exited unsuccessfully
- `DEPLOY_FAILED`: deployment or post-build health failed
- `VERSION_UNAVAILABLE`: CLI could not read its own bundled package metadata to report a version (defensive; not expected in normal installs)
- `COMMAND_CANCELED`: command execution was canceled by a runtime cancellation signal such as `SIGINT` or `SIGTERM`

## Exit Codes

The MVP should use these process exit codes:

- `0`: success
- `1`: runtime or command failure
- `2`: usage or configuration error
- `130`: command cancellation

Stable structured error codes, not exit code granularity, are the main branching surface for agents and CI.

Cancellation intentionally uses `130` instead of the generic runtime failure code because it has established shell semantics for interrupted commands and is useful to operators and process supervisors. Agents and CI should still branch on `COMMAND_CANCELED` rather than the numeric exit code.

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
