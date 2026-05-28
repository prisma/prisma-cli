# Prisma CLI Beta Command Spec

## Purpose

This document defines the public beta command surface. It is the source of
truth for command names, target resolution, and structured behavior.
This file is authoritative for command group scope during beta.

## Scope

The beta package includes these command groups:

- `auth`
- `project` (includes `project env` subgroup)
- `git`
- `branch`
- `app`

The beta package also includes one top-level utility command:

- `version`

`version` is intentionally outside the workflow groups: it reports CLI build and environment state, requires no auth, no project context, and no network, and is the canonical answer to "is this CLI installed and on the build I expect?"

The Git repository connection slice uses the `git` group. It does not add a
provider-specific `GitHub` group.

Out of scope for the current beta:

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

Stored OAuth sessions include a short-lived access token and a refresh token. Commands refresh the access token automatically when the API rejects it, coordinate refreshes across concurrent CLI processes, and tolerate short refresh-token rotation races. If the stored session cannot be refreshed, commands fail with a structured `AUTH_REQUIRED` error instead of surfacing SDK stack traces.

When `PRISMA_SERVICE_TOKEN` is set and non-empty, the token is fully sufficient for authenticated commands. If `PRISMA_SERVICE_TOKEN` is set but empty or only whitespace, commands fail with an auth configuration error instead of falling back to stored OAuth. The CLI does not read any locally stored OAuth session when a non-empty service token is present, so behavior is identical on a fresh runner and a developer machine that happens to be signed in. The active workspace is derived from the token's `sub` claim; no additional flag or environment variable is required for the common case where the token is scoped to a single workspace.

`auth login` and `auth logout` operate on the stored OAuth session. They do not affect the `PRISMA_SERVICE_TOKEN` environment variable.

## Context Resolution

### Project

Commands resolve project context in this order:

1. explicit `--project <id-or-name>` when present
2. `PRISMA_PROJECT_ID` when set for headless deploy/domain commands
3. `.prisma/local.json` project pin when present, revalidated against platform data
4. durable platform mapping when available
5. remembered local project context, revalidated against platform data
6. `package.json` name matched exactly against an existing accessible Project for non-mutating resolution
7. explicit setup choice from `project link`, `project create`, an interactive setup picker, `app deploy --project`, or `app deploy --create-project`
8. structured failure in `--json` / `--no-interactive` mode

`--project` is an explicit Project choice. When used from an unbound directory
with `app deploy`, it writes `.prisma/local.json` after validation and before
the deployment starts. `--create-project <name>` is the explicit deploy-time
choice to create and bind a new Project. Package names and directory names may
suggest setup defaults, but they never authorize Project creation by themselves.
When `PRISMA_PROJECT_ID` is set, `app deploy` and `app domain` commands skip
`.prisma/local.json` reads and do not write a new pin.

`app deploy` is stricter than general inspection commands: it does not use
package-name matching or remembered local context as Project scope. Without a
pin, durable mapping, env var, or explicit Project flag, it enters explicit
setup or fails with `PROJECT_SETUP_REQUIRED`.

### App Selection

Preview app commands that need an app resolve it in this order:

1. `--app <name>`
2. `PRISMA_APP_ID` when set for headless deploy/domain commands
3. locally selected app for non-deploy commands when it still exists in the resolved branch
4. inferred app name from `package.json#name`
5. current directory name
6. create the inferred app in the resolved branch when no existing app matches
7. interactive picker only when multiple matching apps make the target ambiguous
8. `APP_AMBIGUOUS` in non-interactive or `--json` mode when unresolved

`.prisma/local.json` pins the directory to a Workspace and Project only. It does
not pin an App ID. App services are branch-scoped; a service ID from `main`
must not be reused automatically when the user deploys from `feat/billing`.

`app domain` commands do not create apps. They resolve an existing app on the
resolved production Branch and fail when none exists.

### Branch

Commands that use branch context resolve it in this order:

1. explicit branch argument or `--branch <name>` when the command accepts one
2. active Git branch for local deploy workflows
3. `main`

`local` is local CLI context only. It is never a branch or deploy target.
Production is a protected durable branch and must require explicit user intent.

`app domain` commands default to the production Branch. During Public Beta,
custom domains are supported only on production Branches. Passing a
non-production `--branch` fails with `BRANCH_NOT_DEPLOYABLE`.

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
    "id": "usr_123",
    "email": "alice@example.com",
    "name": "Alice"
  },
  "workspace": {
    "id": "wksp_123",
    "name": "Acme Inc"
  },
  "credential": {
    "type": "oauth",
    "id": null,
    "name": null
  }
}
```

For service-token sessions, `user` is `null` and `credential` identifies the token when the API can resolve it:

```json
{
  "authenticated": true,
  "provider": null,
  "user": null,
  "workspace": {
    "id": "wksp_123",
    "name": "Acme Inc"
  },
  "credential": {
    "type": "service_token",
    "id": "itgr_123",
    "name": "ci-deploys-prod"
  }
}
```

Fallback auth states may omit user details when the deployed Management API does not yet expose `/v1/me`:

```json
{
  "authenticated": true,
  "provider": "github",
  "user": {
    "email": "alice@example.com"
  },
  "workspace": {
    "id": "wksp_123",
    "name": "Acme Inc"
  },
  "credential": null
}
```

Rules:

- `authenticated` is always present
- `provider` is `github`, `google`, or `null`
- `user` contains the current user id, email, and display name when known, a fallback email-only object during rollout, or `null`
- `workspace` is the active workspace or `null`
- `credential` identifies the active credential when known, or is `null`
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
    "version": "3.0.0-beta.0"
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

- `cli.name` is the published package's `bin` name (`prisma-cli` in the current beta).
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

## `prisma-cli project create <name>`

Purpose:

- create a Prisma Project and bind the current directory to it

Behavior:

- requires auth
- creates a Project in the authenticated workspace
- writes `.prisma/local.json` with Workspace and Project IDs
- ensures `.prisma/` is ignored by Git
- does not create a Branch, App, Deployment, database, or Git repository connection
- fails if the platform rejects Project creation

Examples:

```bash
prisma-cli project create my-app
prisma-cli project create my-app --json
```

## `prisma-cli project link <id-or-name>`

Purpose:

- bind the current directory to an existing Prisma Project

Behavior:

- requires auth
- resolves exactly one Project by id or name in the authenticated workspace
- writes `.prisma/local.json` with Workspace and Project IDs
- ensures `.prisma/` is ignored by Git
- does not create remote resources
- fails with `PROJECT_NOT_FOUND` or `PROJECT_AMBIGUOUS` when the Project cannot be selected safely

Examples:

```bash
prisma-cli project link proj_123
prisma-cli project link "Acme Dashboard" --json
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
- supports Bun, Next.js, Nuxt, Astro, and TanStack Start app builds in the beta package
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

## `prisma-cli app deploy --project <id-or-name> --create-project <name> --app <name> --branch <name> --framework <nextjs|hono|tanstack-start|bun> --entry <path> --http-port <port> --env <name=value>`

Purpose:

- creates a new deployment for the app

Behavior:

- requires auth
- resolves project context from `--project`, `--create-project`, `PRISMA_PROJECT_ID`, `.prisma/local.json`, durable platform mapping, or an interactive setup choice
- does not infer and create Project context from `package.json#name` or current directory name without explicit setup
- when no Project is resolved in interactive mode, asks which Project the directory should use:

  ```text
  ? Which Project should this directory use?
    ❯ Acme Dashboard
      Billing API
      Create a new Project
      Cancel
  ```

- when "Create a new Project" is selected, prompts for a Project name with the package/directory name as a suggestion
- when no Project is resolved in `--json` / `--no-interactive` mode, fails with `PROJECT_SETUP_REQUIRED`
- `--yes` alone does not choose Project scope; use `--project` or `--create-project`
- `--project` and `--create-project` are mutually exclusive with each other and with `PRISMA_PROJECT_ID`
- resolves or creates branch context from `--branch`, local Git branch, or `main`
- resolves or creates app context inside the resolved branch from `--app`, `PRISMA_APP_ID`, `package.json#name`, or current directory name
- does not prompt when there is no real choice; zero matching apps creates the inferred app
- writes `.prisma/local.json` after Project binding succeeds and before build/deploy starts, so retries after a failed deploy do not repeat setup
- asks `Customize settings? (y/N)` only while binding the directory for the first time, and only asks for Framework and HTTP port when the user opts in
- after setup, deploy prints `Deploying to <Project> / <Branch> / <App>`; later deploys print a compact target header such as `Deploying ./j1 to j1 / main / j1`
- deploy progress uses short stage copy (`Building locally...`, `Built <size>`, `Uploading...`, `Uploaded`, `Deploying...`, `Deployed`) and never prints `Status: running` or `Deployment is running at ...`
- success human output prints `Live in <duration>`, the URL on its own line, and `Logs   prisma-cli app logs`
- accepts repeated `--env NAME=VALUE` flags
- maps user-facing framework names to deploy build strategies
- uses `src/index.ts` as the Hono deploy entrypoint when the app has no `package.json#main` or `package.json#module` and that file exists
- supports vanilla Bun apps with `--framework bun --entry <path>`
- treats `--entry <path>` without `--framework` as a Bun app deploy
- does not print secret values
- returns app, deployment id, URL, and next steps in `--json` output

Examples:

```bash
prisma-cli app deploy
prisma-cli app deploy --project proj_123
prisma-cli app deploy --create-project my-app --yes
prisma-cli app deploy --app my-app --env DATABASE_URL=postgresql://example
prisma-cli app deploy --framework nextjs --http-port 3000
prisma-cli app deploy --branch feat-login --framework hono --http-port 3000
prisma-cli app deploy --framework bun --entry src/server.ts --http-port 3000
prisma-cli app deploy --entry src/server.ts --http-port 3000
```

## `prisma-cli project env`

Manage durable, platform-stored environment variables for the resolved
project. The `env` namespace operates on the
platform-managed `/v1/environment-variables` API; values are stored
encrypted at rest and **never returned** by the platform — read-back
is not supported in Beta.

### Scope flags

Every write targets exactly one scope:

- `--role <production|preview>` targets a project template.
- `--branch <git-name>` targets a preview branch override.
- `--role` and `--branch` are mutually exclusive.
- For write verbs (`add`, `update`, `remove`), one scope flag is required
  so the CLI never silently writes to production.
- For read verbs (`list`), omitting `--role` defaults to `--role production`.

### `prisma-cli project env add KEY=VALUE (--role <production|preview> | --branch <git-name>)`

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
- branch-only variables are allowed; the CLI warns when the key does
  not exist in the preview template
- the response carries metadata only — the value is never echoed back

Examples:

```bash
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role preview
prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo
API_URL=https://api.example prisma-cli project env add API_URL --project proj_123 --role preview
```

### `prisma-cli project env update KEY=VALUE (--role <production|preview> | --branch <git-name>)`

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
prisma-cli project env update DATABASE_URL=postgresql://branch --branch feature/foo
```

### `prisma-cli project env list [--role <production|preview> | --branch <git-name>]`

Purpose:

- list environment variable names and metadata for the targeted scope.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- defaults to `--role production` when `--role` is not supplied
- `--branch` lists the resolved preview branch view: preview defaults
  plus branch overrides, with source metadata
- never prints values (never-reveal)
- emits `key`, `id`, `last updated`, and a `scope` annotation per row

Examples:

```bash
prisma-cli project env list
prisma-cli project env list --role preview
prisma-cli project env list --branch feature/foo
```

### `prisma-cli project env remove KEY (--role <production|preview> | --branch <git-name>)`

Purpose:

- remove an environment variable from the targeted scope.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- looks the variable up by natural key in the scope and `DELETE`s it
- `rm` is supported as an alias for `remove`
- returns a focused error when no matching variable exists

Examples:

```bash
prisma-cli project env remove STRIPE_KEY --role production
prisma-cli project env remove STRIPE_KEY --role preview
prisma-cli project env remove DATABASE_URL --branch feature/foo
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

## `prisma-cli app domain`

Purpose:

- manage custom domains for an app's production Branch runtime

Behavior:

- requires auth and project context
- resolves the selected app on the production Branch
- supports only production Branch custom domains during Public Beta
- does not expose workspace-wide domain listing until the Management API has a
  workspace-scoped list endpoint

Commands:

- `add <hostname>` registers a custom domain
- `show <hostname>` shows status, certificate detail, and fix hints
- `remove <hostname>` detaches a custom domain
- `retry <hostname>` re-triggers DNS verification and TLS issuance
- `wait <hostname>` blocks until `active`, terminal `failed`, or timeout

Examples:

```bash
prisma-cli app domain add shop.acme.com
prisma-cli app domain wait shop.acme.com --timeout 15m
prisma-cli app domain retry shop.acme.com
```

## `prisma-cli app domain add <hostname>`

Purpose:

- register a custom domain on the selected app's production Branch

Behavior:

- requires auth and project context
- resolves the selected app
- registers the hostname against the selected app's compute service
- is idempotent for a hostname already attached to the same app
- does not re-trigger DNS verification for an existing row
- prints DNS record instructions only when returned by the API
- does not synthesize DNS records client-side when the API omits them
- returns `DOMAIN_DNS_NOT_CONFIGURED` with a CNAME target only when the API error includes the required target
- returns `DOMAIN_ALREADY_REGISTERED` when the hostname is attached outside the selected app
- rejects non-production `--branch` with `BRANCH_NOT_DEPLOYABLE`

Examples:

```bash
prisma-cli app domain add shop.acme.com
prisma-cli app domain add shop.acme.com --app shop --branch production
```

## `prisma-cli app domain show <hostname>`

Purpose:

- show status and recovery guidance for one custom domain

Behavior:

- requires auth and project context
- resolves the selected app
- finds the domain by hostname within the selected app
- includes failure category, failure reason, certificate expiry, and DNS record
  instructions when returned by the API

Examples:

```bash
prisma-cli app domain show checkout.acme.com
```

## `prisma-cli app domain remove <hostname>`

Purpose:

- detach a custom domain from the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- requires confirmation unless `-y` or `--yes` is passed
- deletes the domain binding by id after resolving the hostname

Examples:

```bash
prisma-cli app domain remove old.acme.com
prisma-cli app domain remove old.acme.com --yes
```

## `prisma-cli app domain retry <hostname>`

Purpose:

- re-trigger DNS verification and TLS issuance for a failed or stuck domain

Behavior:

- requires auth and project context
- resolves the selected app
- finds the domain by hostname within the selected app
- calls the domain retry endpoint
- prints DNS record instructions and failure guidance when returned by the API
- returns `DOMAIN_RETRY_NOT_ELIGIBLE` when the API reports the domain is not in
  a retryable state

Examples:

```bash
prisma-cli app domain retry checkout.acme.com
```

## `prisma-cli app domain wait <hostname>`

Purpose:

- block until a custom domain reaches `active`, terminal `failed`, or timeout

Behavior:

- requires auth and project context
- resolves the selected app
- finds the domain by hostname within the selected app
- polls domain detail until status is `active`, `failed`, or the timeout expires
- defaults `--timeout` to `15m`
- treats `--timeout 0` as poll-once snapshot mode
- exits 0 on `active`, and 1 on terminal `failed` or timeout
- in `--json` mode, streams newline-delimited status events

Examples:

```bash
prisma-cli app domain wait shop.acme.com
prisma-cli app domain wait shop.acme.com --timeout 0 --json
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
