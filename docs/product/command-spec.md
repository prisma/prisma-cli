# Prisma CLI Preview Command Spec

## Purpose

This document defines the public preview command surface. It is the source of
truth for command names, target resolution, and structured behavior.

## Scope

The preview package includes these command groups:

- `auth`
- `project`
- `branch`
- `app`

Out of scope for the current preview:

- `init`
- `schema`
- `database`
- `migrate`
- product-specific namespaces such as `compute`

## Global Rules

- Canonical shape is `prisma <group> <action>`.
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
- Long flags use kebab-case.
- Boolean negation uses `--no-<flag>`.
- `--json` and non-interactive mode must not block on prompts.
- `prisma.config.ts` stores only the linked project id.
- Remote commands do not silently change local context.

## Context Resolution

### Project

Commands resolve project context in this order:

1. linked project id in `prisma.config.ts`
2. explicit `project link`
3. implicit creation by `app deploy` when no project is linked

Only `app deploy` may create project context implicitly.

### App Selection

Preview app commands that need an app resolve it in this order:

1. `--app <name>`
2. locally selected app for the linked project
3. interactive select-or-create flow in TTY mode
4. `USAGE_ERROR` in non-interactive or `--json` mode when unresolved

### Branch

Commands that use branch context resolve it in this order:

1. explicit branch argument when the command accepts one
2. active branch context in local CLI state
3. `preview`

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
    "id": "usr_123",
    "name": "Alice Example",
    "email": "alice@example.com"
  },
  "workspace": {
    "id": "ws_123",
    "name": "Acme Inc"
  },
  "linkedProjectId": "proj_123"
}
```

Rules:

- `authenticated` is always present
- `provider` is `github`, `google`, or `null`
- `user` is the current user or `null`
- `workspace` is the active workspace or `null`
- `linkedProjectId` is the linked project id for the current repo or `null`
- signed-out state is an empty auth state, not an error

## `prisma auth login`

Purpose:

- establish authenticated CLI session

Behavior:

- starts the login flow
- stores the resulting session locally
- resolves active workspace when required
- returns the current auth state after login

Examples:

```bash
prisma auth login
prisma auth login --json
```

## `prisma auth logout`

Purpose:

- clear authenticated CLI session

Behavior:

- removes local session state
- succeeds even if no session exists
- returns the signed-out auth state

Examples:

```bash
prisma auth logout
prisma auth logout --json
```

## `prisma auth whoami`

Purpose:

- show the current authenticated identity

Behavior:

- returns the current auth state
- succeeds when signed out

Examples:

```bash
prisma auth whoami
prisma auth whoami --json
```

## `prisma project list`

Purpose:

- list projects for the authenticated workspace

Behavior:

- requires auth
- lists projects visible to the active workspace
- marks the locally linked project when one is present

Examples:

```bash
prisma project list
prisma project list --json
```

## `prisma project show`

Purpose:

- show the linked project for the current repo

Behavior:

- reads the linked project id from `prisma.config.ts`
- requires auth when resolving remote project details
- fails with `PROJECT_NOT_LINKED` when no project is linked

Examples:

```bash
prisma project show
prisma project show --json
```

## `prisma project link [project]`

Purpose:

- link the current repo to an existing project

Behavior:

- writes only the project id to `prisma.config.ts`
- prompts for a project when no project id is passed and prompting is allowed
- fails with `USAGE_ERROR` when no project can be selected non-interactively
- does not change active branch context

Examples:

```bash
prisma project link
prisma project link proj_123
```

## `prisma branch list`

Purpose:

- list branches for the linked project

Behavior:

- shows known remote branches for the linked project
- marks active context
- does not create remote state
- does not expose branch `role` or `durability` fields yet

Examples:

```bash
prisma branch list
prisma branch list --json
```

## `prisma branch show`

Purpose:

- show current active branch context

Behavior:

- reads local branch context
- shows linked project context when known
- does not mutate local or remote state
- does not expose branch `role` or `durability` fields yet

Examples:

```bash
prisma branch show
prisma branch show --json
```

## `prisma branch use [name]`

Purpose:

- change local default branch context

Behavior:

- writes only local CLI branch context
- accepts `production` or a preview branch name
- warns when switching to `production`
- does not create remote state
- does not support `local`; local is CLI context only, not a branch

Examples:

```bash
prisma branch use
prisma branch use production
```

## `prisma app build --entry <path> --build-type <auto|bun|nextjs>`

Purpose:

- build the local app into a deployable artifact

Behavior:

- detects supported project shapes when `--build-type auto` is used
- supports Bun and Next.js app builds in the preview package
- fails with `USAGE_ERROR` when framework detection is ambiguous

Examples:

```bash
prisma app build --build-type nextjs
prisma app build --build-type bun --entry server.ts
```

## `prisma app run --entry <path> --build-type <auto|bun|nextjs> --port <port>`

Purpose:

- start a local framework dev server

Behavior:

- detects supported project shapes when `--build-type auto` is used
- starts the local framework command
- reports `RUN_FAILED` when the local process cannot start or exits unsuccessfully

Examples:

```bash
prisma app run --build-type nextjs
prisma app run --build-type bun --entry server.ts --port 3000
```

## `prisma app deploy --app <name> --entry <path> --build-type <auto|bun|nextjs> --http-port <port> --env <name=value>`

Purpose:

- build and release the selected app

Behavior:

- requires auth
- resolves or creates project context
- resolves or creates app context when required
- accepts repeated `--env NAME=VALUE` flags
- does not print secret values
- returns app, deployment id, URL, and next steps

Examples:

```bash
prisma app deploy
prisma app deploy --app hello-world --env DATABASE_URL=postgresql://example
prisma app deploy --app hello-world --build-type nextjs --http-port 3000
```

## `prisma app update-env --app <name> --env <name=value>`

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
prisma app update-env --env DATABASE_URL=postgresql://example
prisma app update-env --app hello-world --env DATABASE_URL=postgresql://another
```

## `prisma app list-env --app <name>`

Purpose:

- list environment variable names for the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- returns variable names only
- does not print values

Examples:

```bash
prisma app list-env
prisma app list-env --app hello-world
```

## `prisma app show --app <name>`

Purpose:

- show the current state of the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- shows live URL and deployment summary when available

Examples:

```bash
prisma app show
prisma app show --app hello-world
```

## `prisma app open --app <name>`

Purpose:

- open the live URL for the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- opens the live URL in a browser when possible
- returns the URL in `--json`

Examples:

```bash
prisma app open
prisma app open --app hello-world
```

## `prisma app logs --app <name> --deployment <id>`

Purpose:

- show or stream logs for a deployment

Behavior:

- requires auth and project context
- resolves the selected app and deployment
- returns `FEATURE_UNAVAILABLE` when logs are unavailable in the current preview

Examples:

```bash
prisma app logs
prisma app logs --deployment dep_123
```

## `prisma app list-deploys --app <name>`

Purpose:

- list deployments for the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- marks the live deployment when known

Examples:

```bash
prisma app list-deploys
prisma app list-deploys --app hello-world
```

## `prisma app show-deploy <deployment>`

Purpose:

- show one deployment in detail

Behavior:

- requires auth and project context
- resolves the deployment by id
- includes app context when available

Examples:

```bash
prisma app show-deploy dep_123
```

## `prisma app promote <deployment> --app <name>`

Purpose:

- switch the live deployment for the selected app

Behavior:

- requires auth and project context
- resolves the selected app
- resolves the deployment by id
- reports whether the deployment was already live

Examples:

```bash
prisma app promote dep_123
prisma app promote dep_123 --app hello-world
```

## `prisma app rollback --app <name> --to <deployment>`

Purpose:

- restore the selected app to an earlier deployment

Behavior:

- requires auth and project context
- resolves the selected app
- restores the deployment passed with `--to`, or the previous deployment when available
- fails with `NO_PREVIOUS_DEPLOYMENT` when no previous deployment can be resolved

Examples:

```bash
prisma app rollback
prisma app rollback --app hello-world --to dep_123
```

## `prisma app remove --app <name> -y --yes`

Purpose:

- remove the selected app from the linked project

Behavior:

- requires auth and project context
- resolves the selected app
- requires confirmation unless `-y` or `--yes` is passed
- clears local selected app state when the removed app was selected

Examples:

```bash
prisma app remove --app hello-world
prisma app remove --app hello-world --yes
```
