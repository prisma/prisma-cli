# Prisma CLI Preview Command Spec

## Purpose

This document defines the public preview command surface. It is the source of
truth for command names, target resolution, and structured behavior.

## Scope

The preview package includes these command groups:

- `auth`
- `project` (includes `project env` subgroup)
- `git`
- `branch`
- `app`

The preview package also includes one top-level utility command:

- `version`

`version` is intentionally outside the workflow groups: it reports CLI build and environment state, requires no auth, no project context, and no network, and is the canonical answer to "is this CLI installed and on the build I expect?"

The Git repository connection slice uses the `git` group. It does not add a
provider-specific `GitHub` group.

Out of scope for the current preview:

- `init`
- `schema`
- `database`
- `migrate`
- product-specific namespaces such as `compute`

## Global Rules

- Canonical shape is `prisma <group> <action>`.
- `version` is the one top-level command outside that shape (see Scope above).
- Every command supports `--json`.
- Shared global flags are:
  - `--json`
  - `-q`, `--quiet`
  - `-v`, `--verbose`
  - `--trace`
  - `--interactive`
  - `--no-interactive`
  - `-y`, `--yes`
  - `--color`
  - `--no-color`
- Universal utility flags also work at the program level:
  - `--help` — prints help for the root program or the named command and exits 0.
  - `--version` — prints the CLI version and exits 0. Honors `--json` for the structured envelope. No short alias (`-v` is reserved for `--verbose`; `-V` is avoided as a near-collision).
- Long flags use kebab-case.
- Boolean negation uses `--no-<flag>`.
- `--json` and non-interactive mode must not block on prompts.
- Public Beta does not read or write committed config files such as `prisma.config.ts` or `.prisma/settings.json` for Project -> Branch -> App resolution. `.prisma/local.json` is a gitignored local pin/cache, not a declarative repo config file.
- Remote commands do not silently change local context.

## Authentication

The CLI accepts two authentication sources, in this fixed precedence:

1. `PRISMA_SERVICE_TOKEN` environment variable — long-lived service token, intended for CI and other headless contexts.
2. Stored OAuth session — created by `prisma-cli auth login`, kept in the OS-appropriate credentials store, refreshed automatically.

When `PRISMA_SERVICE_TOKEN` is set and non-empty, the token is fully sufficient for authenticated commands. If `PRISMA_SERVICE_TOKEN` is set but empty or only whitespace, commands fail with an auth configuration error instead of falling back to stored OAuth. The CLI does not read any locally stored OAuth session when a non-empty service token is present, so behavior is identical on a fresh runner and a developer machine that happens to be signed in. The active workspace is derived from the token's `sub` claim; no additional flag or environment variable is required for the common case where the token is scoped to a single workspace.

`auth login` and `auth logout` operate on the stored OAuth session. They do not affect the `PRISMA_SERVICE_TOKEN` environment variable.

## Context Resolution

### Project

Commands resolve project context in this order:

1. explicit `--project <id-or-name>` when present
2. `PRISMA_PROJECT_ID` when set for headless deploys
3. `.prisma/local.json` project pin when present, revalidated against platform data
4. durable platform mapping when available
5. remembered local project context, revalidated against platform data
6. `package.json` name matched exactly against accessible project id, name, or slug
7. unambiguous project creation for commands that are allowed to create projects
8. prompt in interactive mode, or structured failure in `--json` / `--no-interactive` mode

`--project` is an escape hatch for ambiguous or unavailable automatic
resolution, not a setup step. Only `app deploy` may create a missing project,
and only when the inferred name is unambiguous.
When `PRISMA_PROJECT_ID` is set, `app deploy` skips `.prisma/local.json` reads
and does not write a new pin.

### App Selection

Preview app commands that need an app resolve it in this order:

1. `--app <name>`
2. `PRISMA_APP_ID` when set for headless deploys
3. locally selected app for non-deploy commands when it still exists in the resolved branch
4. inferred app name from `package.json#name`
5. current directory name
6. create the inferred app in the resolved branch when no existing app matches
7. interactive picker only when multiple matching apps make the target ambiguous
8. `APP_AMBIGUOUS` in non-interactive or `--json` mode when unresolved

When `PRISMA_APP_ID` is set, `app deploy` skips `.prisma/local.json` reads and
does not write a new pin.

`.prisma/local.json` pins the directory to a Workspace and Project only. It does
not pin an App ID. App services are branch-scoped; a service ID from `main`
must not be reused automatically when the user deploys from `feat/billing`.

### Branch

Commands that use branch context resolve it in this order:

1. explicit branch argument or `--branch <name>` when the command accepts one
2. active Git branch for local deploy workflows
3. `main`

`local` is local CLI context only. It is never a branch or deploy target.
Production is a protected durable branch and must require explicit user intent.

## Command Result Envelopes

Successful `--json` output uses:

```json
{
  "ok": true,
  "command": "app.deploy",
  "result": {},
  "warnings": [],
  "nextSteps": []
}
```

Failure `--json` output uses the error envelope defined in
`error-conventions.md`.

## Auth Result Contract

`auth login`, `auth logout`, and `auth whoami` return the current auth state.

In `--json`, `result` uses this shape:

```json
{
  "authenticated": true,
  "provider": "github",
  "user": {
    "email": "alice@example.com"
  },
  "workspace": {
    "id": "ws_123",
    "name": "Acme Inc"
  }
}
```

Rules:

- `authenticated` is always present
- `provider` is `github`, `google`, or `null`
- `user` contains the current user email or is `null`
- `workspace` is the active workspace or `null`
- signed-out state is an empty auth state, not an error

## `prisma-cli version`

Purpose:

- report the installed CLI build and a small block of host environment metadata

Behavior:

- requires no auth, no project context, and no network
- reads the package's own version from its bundled metadata
- reports CLI name, CLI version, Node.js version, OS platform, OS architecture, and a best-effort `invocation` label (`bunx`, `npx`, `global`, `dev`, or `unknown`)
- uses the `show` output pattern (see `output-conventions.md`)
- fails only when the bundled CLI metadata cannot be read; this is treated as `VERSION_UNAVAILABLE` and is not expected in practice

In `--json`, `result` uses this shape:

```json
{
  "cli": {
    "name": "prisma-cli",
    "version": "3.0.0-alpha.3"
  },
  "node": {
    "version": "v24.14.1"
  },
  "os": {
    "platform": "darwin",
    "arch": "arm64"
  },
  "invocation": "bunx"
}
```

Rules:

- `cli.name` is the published package's `bin` name (`prisma-cli` in the current preview).
- `cli.version` is the published package version.
- `node.version` mirrors `process.version` exactly, including the leading `v`.
- `os.platform` and `os.arch` mirror `process.platform` and `process.arch`.
- `invocation` is best-effort and falls back to `"unknown"` when no signal is conclusive.

Examples:

```bash
prisma-cli version
prisma-cli version --json
```

## `prisma-cli --version`

Purpose:

- universal smoke-test flag at the root of the program

Behavior:

- prints the CLI version and exits 0
- requires no auth, no project context, and no network
- works before any subcommand parsing — bare `prisma-cli --version` is sufficient
- in human mode, prints a single line to stdout: `prisma-cli <version>`
- in `--json` mode, emits the standard success envelope (see Command Result Envelopes) with `command: "version"` and `result.version: "<version>"`
- `--version` is documented as a universal utility flag in Global Rules, not as a shared global flag (it is an early-exit utility, not a per-command modifier)

Examples:

```bash
prisma-cli --version
prisma-cli --version --json
```

`prisma-cli version` is the richer environment report; `prisma-cli --version` is the terse one-liner. Both report the same `cli.version`. Use the flag for quick checks, the subcommand for support tickets and bug reports.

## `prisma-cli auth login`

Purpose:

- log in to your Prisma platform account

Behavior:

- starts the login flow
- stores the resulting session locally
- resolves active workspace when required
- confirms successful browser authentication and directs the user back to the terminal
- returns the current auth state after login

Examples:

```bash
prisma-cli auth login
prisma-cli auth login --json
```

## `prisma-cli auth logout`

Purpose:

- clear stored authentication credentials

Behavior:

- removes local session state
- succeeds even if no session exists
- returns the signed-out auth state

Examples:

```bash
prisma-cli auth logout
prisma-cli auth logout --json
```

## `prisma-cli auth whoami`

Purpose:

- show the authenticated user and accessible workspace

Behavior:

- returns the current auth state
- succeeds when signed out

Examples:

```bash
prisma-cli auth whoami
prisma-cli auth whoami --json
```

## `prisma-cli project list`

Purpose:

- list all projects in your workspace

Behavior:

- requires auth
- lists projects visible to the active workspace
- does not resolve the current directory
- does not mutate local state

Examples:

```bash
prisma-cli project list
prisma-cli project list --json
```

## `prisma-cli project show`

Purpose:

- show the Prisma project resolved for this directory

Behavior:

- requires auth
- resolves project context without creating projects
- does not prompt for project selection
- does not mutate local state
- `--project <id-or-name>` resolves only the explicit project
- returns Workspace, Project, and `resolution.projectSource`
- fails with `PROJECT_UNRESOLVED`, `PROJECT_NOT_FOUND`, `PROJECT_AMBIGUOUS`, or `LOCAL_STATE_STALE` when resolution cannot continue safely

Examples:

```bash
prisma-cli project show
prisma-cli project show --json
prisma-cli project show --project proj_123 --json
```

## `prisma-cli git connect [git-url]`

Purpose:

- connect the resolved Prisma project to a GitHub repository

Behavior:

- requires auth
- resolves project context without creating projects
- supports `--project <id-or-name>` for explicit project selection
- if `[git-url]` is provided, parses it as a GitHub repository URL
- if `[git-url]` is omitted, reads the local Git `origin` remote URL
- accepts common GitHub URL forms such as:
  - `https://github.com/prisma/prisma-cli`
  - `https://github.com/prisma/prisma-cli.git`
  - `git@github.com:prisma/prisma-cli.git`
- rejects unsupported providers with `REPO_PROVIDER_UNSUPPORTED`
- stores the repository connection server-side through the Management API
- does not write repository data to `prisma.config.ts`
- does not create branches synchronously
- when the connection is active, enables platform webhook automation to map GitHub branch activity to Prisma Branch state

Current backend contract:

- the CLI lists GitHub App installations for the authenticated workspace through the Management API
- if no installation exists, the CLI creates a GitHub App install intent and returns the install URL
- in interactive mode, the CLI attempts to open the install URL in the browser and waits for the installation to become available
- in non-interactive or `--json` mode, the CLI exits with `REPO_INSTALLATION_REQUIRED` and includes the install URL
- the CLI lists repositories visible to the installation and finds the matching `owner/repo`
- if the repository is not visible to any installation, the CLI creates a GitHub App install intent and exposes the install URL
- if the repository still is not visible after the installation or repository-access step, the command fails with `REPO_NOT_ACCESSIBLE`
- if the project is already connected to the same repository, the command returns the existing connection without creating a duplicate
- if the project is already connected to a different repository, the command fails with `REPO_ALREADY_CONNECTED`
- the CLI links the project to the repository with `POST /v1/source-repositories`
- the link call sends `projectId`, `provider: "github"`, `providerRepositoryId`, and `installationId`

Examples:

```bash
prisma-cli git connect
prisma-cli git connect git@github.com:prisma/prisma-cli.git
prisma-cli git connect --project proj_123
prisma-cli git connect https://github.com/prisma/prisma-cli --project proj_123
```

## `prisma-cli git disconnect`

Purpose:

- disconnect the GitHub repository from the resolved Prisma project

Behavior:

- requires auth
- resolves project context without creating projects
- supports `--project <id-or-name>` for explicit project selection
- removes the active server-side repository connection
- stops future GitHub branch automation for that project
- does not delete the resolved Prisma project
- does not delete existing Branches synchronously; server-side retention rules own that behavior

Examples:

```bash
prisma-cli git disconnect
prisma-cli git disconnect --project proj_123
prisma-cli git disconnect --json
```

## `prisma-cli branch list`

Purpose:

- list active Platform branches for the resolved project

Behavior:

- shows known remote branches for the resolved project
- marks active context
- does not create remote state
- does not expose branch `role` or `durability` fields yet

Examples:

```bash
prisma-cli branch list
prisma-cli branch list --json
```

## `prisma-cli branch show`

Purpose:

- show the Platform branch matching your current Git branch

Behavior:

- reads local branch context
- shows resolved project context when known
- does not mutate local or remote state
- does not expose branch `role` or `durability` fields yet

Examples:

```bash
prisma-cli branch show
prisma-cli branch show --json
```

## `prisma-cli app build --entry <path> --build-type <auto|bun|nextjs|nuxt|astro|tanstack-start>`

Purpose:

- build the app locally into a deployable artifact

Behavior:

- detects supported project shapes when `--build-type auto` is used
- supports Bun, Next.js, Nuxt, Astro, and TanStack Start app builds in the preview package
- fails with `USAGE_ERROR` when framework detection is ambiguous

Examples:

```bash
prisma-cli app build --build-type nextjs
prisma-cli app build --build-type nuxt
prisma-cli app build --build-type astro
prisma-cli app build --build-type tanstack-start
prisma-cli app build --build-type bun --entry server.ts
```

## `prisma-cli app run --entry <path> --build-type <auto|bun|nextjs> --port <port>`

Purpose:

- run your app locally

Behavior:

- detects supported project shapes when `--build-type auto` is used
- starts the local framework command
- reports `RUN_FAILED` when the local process cannot start or exits unsuccessfully

Examples:

```bash
prisma-cli app run --build-type nextjs
prisma-cli app run --build-type bun --entry server.ts --port 3000
```

## `prisma-cli app deploy --project <id-or-name> --app <name> --branch <name> --framework <nextjs|hono|tanstack-start> --entry <path> --http-port <port> --env <name=value>`

Purpose:

- creates a new deployment for the app

Behavior:

- requires auth
- resolves or creates project context from `--project`, `PRISMA_PROJECT_ID`, `.prisma/local.json`, `package.json#name`, or current directory name
- resolves or creates branch context from `--branch`, local Git branch, or `main`
- resolves or creates app context inside the resolved branch from `--app`, `PRISMA_APP_ID`, `package.json#name`, or current directory name
- does not prompt when there is no real choice; zero matching apps creates the inferred app
- detects supported frameworks and shows the resolved framework/runtime settings only while binding the directory for the first time
- writes `.prisma/local.json` after Project binding succeeds and before build/deploy starts, so retries after a failed deploy do not repeat setup
- asks `Customize settings? (y/N)` only while binding the directory for the first time, and only asks for Framework and HTTP port when the user opts in
- subsequent deploys print a compact target header such as `Deploying ./j1 to j1 / main / j1`
- deploy progress uses phase copy (`Building locally`, `Packaging artifact`, `Uploading`, `Starting deployment`, `Checking runtime health`) and never prints `Status: running` or `Deployment is running at ...`
- success human output prints `Deployed to <url>` and `Runtime logs: prisma app logs`
- accepts repeated `--env NAME=VALUE` flags
- maps user-facing framework names to deploy build strategies
- accepts `--build-type <auto|bun|nextjs|nuxt|astro|tanstack-start>` as a legacy passthrough, but `--framework` wins when both are passed
- does not print secret values
- returns app, deployment id, URL, and next steps in `--json` output

Examples:

```bash
prisma-cli app deploy
prisma-cli app deploy --app my-app --env DATABASE_URL=postgresql://example
prisma-cli app deploy --framework nextjs --http-port 3000
prisma-cli app deploy --branch feat-login --framework hono --http-port 3000
```

## `prisma-cli project env`

Manage durable, platform-stored environment variables for the resolved
project. Replaces the legacy `prisma app update-env` / `prisma app
list-env` workflow, which mutated env vars on a single Foundry version
and is now deprecated. The `env` namespace operates on the
platform-managed `/v1/environment-variables` API; values are stored
encrypted at rest and **never returned** by the platform — read-back
is not supported in Beta.

### Scope flags

The `--role` flag is recognized on every `env` verb:

- `--role <production|preview>` targets a project template.
- For write verbs (`add`, `update`, `rm`), `--role` is required
  so the CLI never silently writes to production.
- For read verbs (`list`), omitting `--role` defaults to `--role production`.

### `prisma-cli project env add KEY=VALUE --role <production|preview>`

Purpose:

- create a new environment variable on the targeted scope. Fails if a
  variable with the same key already exists.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- KEY=VALUE is parsed from a single positional; KEY must match
  `[A-Z_][A-Z0-9_]*`
- KEY without `=VALUE` reads the value from the current process environment
- if a variable with the same key already exists in the scope, the
  command fails with a clear error directing to `env update`
- the response carries metadata only — the value is never echoed back

Examples:

```bash
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role preview
API_URL=https://api.example prisma-cli project env add API_URL --project proj_123 --role preview
```

### `prisma-cli project env update KEY=VALUE --role <production|preview>`

Purpose:

- replace the value of an existing environment variable on the
  targeted scope. Fails if no variable with the given key exists.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- KEY=VALUE is parsed from a single positional; KEY must match
  `[A-Z_][A-Z0-9_]*`
- KEY without `=VALUE` reads the value from the current process environment
- if no variable with the key exists in the scope, the command fails
  with a clear error directing to `env add`
- the response carries metadata only — the value is never echoed back

Examples:

```bash
prisma-cli project env update STRIPE_KEY=sk_new_xxx --role production
prisma-cli project env update STRIPE_KEY=sk_new_xxx --role preview
```

### `prisma-cli project env list [--role <production|preview>]`

Purpose:

- list environment variable names and metadata for the targeted scope.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- defaults to `--role production` when `--role` is not supplied
- never prints values (never-reveal)
- emits `key`, `id`, `last updated`, and a `scope` annotation per row

Examples:

```bash
prisma-cli project env list
prisma-cli project env list --role preview
```

### `prisma-cli project env rm KEY --role <production|preview>`

Purpose:

- remove an environment variable from the targeted scope.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- looks the variable up by natural key in the scope and `DELETE`s it
- returns a focused error when no matching variable exists

Examples:

```bash
prisma-cli project env rm STRIPE_KEY --role production
prisma-cli project env rm STRIPE_KEY --role preview
```

## `prisma-cli app update-env --app <name> --env <name=value>`

> **Deprecated.** Use `prisma-cli project env add` instead. The legacy command
> still works for backward compatibility but emits a deprecation
> warning and will be removed in a future release.

Purpose:

- create a new deployment with updated environment variables

Behavior:

- requires auth and project context
- resolves the selected app
- accepts repeated `--env NAME=VALUE` flags
- returns the new deployment
- does not print secret values

Examples:

```bash
prisma-cli app update-env --env DATABASE_URL=postgresql://example
prisma-cli app update-env --app hello-world --env DATABASE_URL=postgresql://another
```

## `prisma-cli app list-env --app <name>`

> **Deprecated.** Use `prisma-cli project env list` instead. The legacy command
> still works for backward compatibility but emits a deprecation
> warning and will be removed in a future release.

Purpose:

- list environment variable names for the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- returns variable names only
- does not print values

Examples:

```bash
prisma-cli app list-env
prisma-cli app list-env --app hello-world
```

## `prisma-cli app show --app <name>`

Purpose:

- show the app and its current deployment

Behavior:

- requires auth and project context
- resolves the selected app
- shows live URL and deployment summary when available

Examples:

```bash
prisma-cli app show
prisma-cli app show --app hello-world
```

## `prisma-cli app open --app <name>`

Purpose:

- open the app's live URL

Behavior:

- requires auth and project context
- resolves the selected app
- opens the live URL in a browser when possible
- returns the URL in `--json`

Examples:

```bash
prisma-cli app open
prisma-cli app open --app hello-world
```

## `prisma-cli app logs --app <name> --deployment <id>`

Purpose:

- stream logs for the app's current deployment

Behavior:

- requires auth and project context
- resolves the selected app and the deployment currently serving live traffic
- streams raw app log lines to stdout in human mode
- writes CLI status and errors to stderr
- when `--deployment` is provided, streams logs for that exact deployment
- when both `--app` and `--deployment` are provided, verifies the deployment belongs to the selected app
- returns `FEATURE_UNAVAILABLE` only when the platform cannot provide logs for the resolved deployment

Examples:

```bash
prisma-cli app logs
prisma-cli app logs --deployment dep_123
```

## `prisma-cli app list-deploys --app <name>`

Purpose:

- list deployments for the app

Behavior:

- requires auth and project context
- resolves the selected app
- marks the live deployment when known

Examples:

```bash
prisma-cli app list-deploys
prisma-cli app list-deploys --app hello-world
```

## `prisma-cli app show-deploy <deployment>`

Purpose:

- show a deployment in detail

Behavior:

- requires auth and project context
- resolves the deployment by id
- includes app context when available

Examples:

```bash
prisma-cli app show-deploy dep_123
```

## `prisma-cli app promote <deployment> --app <name>`

Purpose:

- promote a deployment to production by rebuilding with production env vars

Behavior:

- requires auth and project context
- resolves the selected app
- resolves the deployment by id
- reports whether the deployment was already live

Examples:

```bash
prisma-cli app promote dep_123
prisma-cli app promote dep_123 --app hello-world
```

## `prisma-cli app rollback --app <name> --to <deployment>`

Purpose:

- roll back production to a previous deployment

Behavior:

- requires auth and project context
- resolves the selected app
- restores the deployment passed with `--to`, or the previous deployment when available
- fails with `NO_PREVIOUS_DEPLOYMENT` when no previous deployment can be resolved

Examples:

```bash
prisma-cli app rollback
prisma-cli app rollback --app hello-world --to dep_123
```

## `prisma-cli app remove --app <name> -y --yes`

Purpose:

- remove the app from the current branch

Behavior:

- requires auth and project context
- resolves the selected app
- requires confirmation unless `-y` or `--yes` is passed
- clears local selected app state when the removed app was selected

Examples:

```bash
prisma-cli app remove --app hello-world
prisma-cli app remove --app hello-world --yes
```
