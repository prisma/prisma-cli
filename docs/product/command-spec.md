# Prisma CLI Beta Command Spec

## Purpose

This document defines the public beta command surface. It is the source of
truth for command names, target resolution, and structured behavior.
This file is authoritative for command group scope during beta.

## Scope

The beta package includes these command groups:

- `agent`
- `auth`
- `project` (includes `project env` subgroup)
- `git`
- `branch`
- `database` (includes `database connection` subgroup)
- `app`
- `build` (includes `build logs`)

The beta package also includes one top-level utility command:

- `version`

`version` is intentionally outside the workflow groups: it reports CLI build and environment state, requires no auth, no project context, and no network, and is the canonical answer to "is this CLI installed and on the build I expect?"

The Git repository connection slice uses the `git` group. It does not add a
provider-specific `GitHub` group.

Out of scope for the current beta:

- `init`
- `schema`
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
- Automatic update checks are advisory and skipped in CI, `--json`, `--quiet`,
  non-TTY stderr, and when `NO_UPDATE_NOTIFIER` is set. When shown, update
  notifications are stderr-only human output and do not change the original
  command result.
- Public Beta does not read or write committed config files such as `prisma.config.ts` or `.prisma/settings.json` for Project -> Branch resolution. `.prisma/local.json` is a gitignored local pin/cache, not a declarative repo config file. `prisma.app.json` is legacy and no longer read or written. `prisma.compute.ts` supplies typed `app deploy` defaults (app name, app region, app root, framework, entrypoint, HTTP port, env inputs) and never selects Project or Branch scope.
- Remote commands do not silently change local context.

## Authentication

The CLI accepts two authentication sources, in this fixed precedence:

1. `PRISMA_SERVICE_TOKEN` environment variable — long-lived service token, intended for CI and other headless contexts.
2. Stored OAuth session — created by `prisma-cli auth login`, kept in the OS-appropriate credentials store, refreshed automatically.

Stored OAuth sessions include a short-lived access token and a refresh token. The local credentials store may contain OAuth grants for multiple workspaces. One local active workspace pointer selects which grant authenticated commands use. Commands refresh the selected access token automatically when the API rejects it, coordinate refreshes across concurrent CLI processes, and tolerate short refresh-token rotation races. If the selected session cannot be refreshed, commands fail with a structured `AUTH_REQUIRED` error instead of surfacing SDK stack traces or silently falling through to another workspace.

When `PRISMA_SERVICE_TOKEN` is set and non-empty, the token is fully sufficient for authenticated commands. If `PRISMA_SERVICE_TOKEN` is set but empty or only whitespace, commands fail with an auth configuration error instead of falling back to stored OAuth. The CLI does not read any locally stored OAuth session when a non-empty service token is present, so behavior is identical on a fresh runner and a developer machine that happens to be signed in. The active workspace is derived from the token's `sub` claim; no additional flag or environment variable is required for the common case where the token is scoped to a single workspace.

`auth login`, `auth logout`, and `auth workspace` operate on stored OAuth sessions. They do not affect the `PRISMA_SERVICE_TOKEN` environment variable. `auth login` stores the authorized workspace and makes it active. `auth logout` clears all local OAuth workspace sessions. `auth workspace logout` and `auth logout --workspace` clear one local OAuth workspace session, including while `PRISMA_SERVICE_TOKEN` is set, because they only clean local OAuth state. If that workspace was active, the CLI does not silently fall through to another cached workspace; the user must explicitly choose the next workspace with `auth workspace use`. `auth workspace use` changes only local CLI context and never mutates a remote resource. When `PRISMA_SERVICE_TOKEN` is set, workspace switching is unavailable because the token is the active auth source.

## Context Resolution

### Project

Commands resolve project context in this order:

1. explicit `--project <id-or-name>` when present
2. `PRISMA_PROJECT_ID` when set for headless deploy/domain commands
3. `.prisma/local.json` project pin when present, revalidated against platform data
4. durable platform mapping when available
5. explicit setup choice from `project link`, `project create`, an interactive setup picker, `app deploy --project`, or `app deploy --create-project`
6. structured failure when no explicit or durable Project binding exists

`--project` is an explicit Project choice. When used from an unbound directory
with `app deploy`, it writes `.prisma/local.json` after validation and before
the deployment starts. `--create-project <name>` is the explicit deploy-time
choice to create and bind a new Project. Package names and directory names may
suggest setup defaults, but they never authorize Project creation by themselves.
When `PRISMA_PROJECT_ID` is set, `app deploy` and `app domain` commands skip
`.prisma/local.json` reads and do not write a new pin.

Project-scoped commands never use package-name matching, directory-name
matching, or remembered local context as selected Project scope. Local metadata
may suggest setup defaults and candidate Projects, but only explicit input or
durable state may select a Project. Without a pin, durable mapping, supported
env var, or explicit Project flag, Project-scoped commands fail with
`PROJECT_SETUP_REQUIRED`; `app deploy` may enter explicit interactive setup
before failing.

### App Selection

Preview app commands that need an app resolve it in this order:

1. `--app <name>`
2. `PRISMA_APP_ID` when set for headless deploy/domain commands
3. compute config target from the `[app]` argument, or inferred from the invocation directory being inside a target's `root`; the target's `name` (or `apps` key) selects the app
4. locally selected app for non-deploy commands when it still exists in the resolved branch
5. inferred app name from `package.json#name`
6. current directory name
7. `app deploy` only: create the inferred app in the resolved branch when no existing app matches
8. interactive picker only when multiple matching apps make the target ambiguous
9. `APP_AMBIGUOUS` in non-interactive or `--json` mode when unresolved

App management commands (`show`, `open`, `logs`, `list-deploys`, `promote`,
`rollback`, `remove`, `domain`) accept the same `[app]` target argument and
upward config discovery as `app deploy`: the project binding is read from the
config file's directory, and the config target is an additional app-name
source. Unlike deploy, management commands never require a target: with
multiple targets, no argument, and nothing inferred from the invocation
directory, they fall back to the selection order above — except step 7;
management commands never create apps or mutate remote state to resolve one.

Config `region` and `--region` are not app selectors. They are used only when
`app deploy` creates a new app; existing apps keep their current region.

`.prisma/local.json` pins the directory to a Workspace and Project only. It does
not pin an App ID. App services are branch-scoped; a service ID from `main`
must not be reused automatically when the user deploys from `feat/billing`.

`app domain` commands do not create apps. They resolve an existing app on the
resolved production Branch and fail when none exists.

### Branch

Deploy resolves the branch it writes to in this order:

1. explicit branch argument or `--branch <name>` when the command accepts one
2. active Git branch for local deploy workflows
3. `main`

App management commands (`show`, `open`, `logs`, `list-deploys`, `promote`,
`rollback`, `remove`) never create branches, so they resolve the branch they
read in this order:

1. explicit `--branch <name>` when the command accepts one, honored as-is
2. the active Git branch when a branch with that name exists in the project
3. the project's default (production) branch

Resolving the default branch from the project keeps a git-push app deployed on
a non-`main` default branch (for example `master`) visible to management
commands regardless of the local Git branch.

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

`auth workspace list --json` returns local workspace sessions:

```json
{
  "context": {
    "authSource": "oauth",
    "activeWorkspaceId": "wksp_123",
    "activeWorkspaceName": "Acme Inc"
  },
  "items": [
    {
      "id": "wksp_123",
      "name": "Acme Inc",
      "status": "active",
      "source": "oauth",
      "switchable": true,
      "credentialWorkspaceId": "cmmx...",
      "lastSeenAt": "2026-06-19T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

`auth workspace use --json` returns:

```json
{
  "previousWorkspace": {
    "id": "wksp_123",
    "name": "Acme Inc"
  },
  "workspace": {
    "id": "wksp_456",
    "name": "Prisma Labs"
  }
}
```

`auth workspace logout --json` returns:

```json
{
  "workspace": {
    "id": "wksp_123",
    "name": "Acme Inc"
  },
  "wasActive": true,
  "activeWorkspace": null
}
```

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

## `<runner> @prisma/cli@latest agent install --agent <agent> --all-agents --skill <skill> --global --copy`

Purpose:

- install Prisma context for AI coding agents

Behavior:

- user-facing agent install commands use the package runner detected from the project: `bunx`, `pnpm dlx`, `yarn dlx`, or `npx -y`
- installs Prisma skills from `prisma/skills` by invoking `skills@latest` through the detected project package manager:
  `<runner> skills@latest add prisma/skills --skill "*" --agent codex --agent claude-code --yes`
- detects the runner from the current directory and its ancestors:
  - `bun.lock`, `bun.lockb`, or `packageManager: "bun@..."` -> `bunx`
  - `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or `packageManager: "pnpm@..."` -> `pnpm dlx`
  - `yarn.lock` or `packageManager: "yarn@..."` -> `yarn dlx`
  - `package-lock.json`, `npm-shrinkwrap.json`, `packageManager: "npm@..."`, or no package-manager signal -> `npx -y`
- defaults to the `codex` and `claude-code` agent targets because those are the primary local agent workflows during beta
- accepts repeated `--agent <agent>` flags to target specific skills CLI agents, such as `codex`, `claude-code`, or `cursor`
- accepts `--all-agents` to pass `--agent "*"` to the skills CLI
- accepts repeated `--skill <skill>` flags to install a subset such as `prisma-compute`
- accepts `--global` and `--copy` and forwards them to the skills CLI
- accepts `--dry-run` to report the skills CLI command without spawning the installer

Examples:

```bash
npx -y @prisma/cli@latest agent install
pnpm dlx @prisma/cli@latest agent install --agent codex
pnpm dlx @prisma/cli@latest agent install --agent codex --agent cursor
pnpm dlx @prisma/cli@latest agent install --all-agents
pnpm dlx @prisma/cli@latest agent install --skill prisma-compute
```

## `<runner> @prisma/cli@latest agent update --agent <agent> --all-agents --skill <skill> --global --copy`

Purpose:

- refresh Prisma skills

Behavior:

- has the same flags and behavior as `agent install`
- reruns the detected package-manager runner with `skills@latest add prisma/skills ...` instead of `skills update`, so it refreshes only Prisma's skills and works for project-scoped installs

Examples:

```bash
npx -y @prisma/cli@latest agent update
pnpm dlx @prisma/cli@latest agent update --agent codex
pnpm dlx @prisma/cli@latest agent update --all-agents
```

## `<runner> @prisma/cli@latest agent status --global`

Purpose:

- show whether Prisma skills are installed for the current project or globally

Behavior:

- resolves the Compute config directory before checking project skills, so running from an app subdirectory still checks the project root
- runs `skills@latest list --json` through the detected package runner and reports installed Prisma skills from the skills CLI by default
- accepts `--global` to run `skills@latest list -g --json` and report globally installed Prisma skills instead
- filters the list to Prisma skills and includes each skill's name, path, scope, and agent targets in JSON output
- for project status, falls back to whether `skills-lock.json` references `prisma/skills` when the skills CLI list command fails
- for global status, reports the Skills CLI list failure instead of falling back to project-local state
- reports whether the project has dismissed the interactive agent setup prompt
- does not require authentication

Examples:

```bash
npx -y @prisma/cli@latest agent status
pnpm dlx @prisma/cli@latest agent status --json
pnpm dlx @prisma/cli@latest agent status --global
```

## `prisma-cli auth login`

Purpose:

- log in to your Prisma platform account

Behavior:

- starts the login flow
- stores the resulting session locally
- resolves active workspace when required
- confirms successful browser authentication and directs the user back to the terminal
- returns the current auth state after login
- in human output, when run from a project directory that does not already have Prisma skills and has not dismissed the setup prompt, suggests the detected package-runner command, such as `pnpm dlx @prisma/cli@latest agent install`
- does not install skills during auth; auth is not project-scoped and must not mutate the project
- does not show the agent setup tip in `--json`, `--quiet`, CI, non-TTY output, or directories that do not look like projects

Examples:

```bash
prisma-cli auth login
prisma-cli auth login --json
```

## `prisma-cli auth logout`

Purpose:

- clear all stored OAuth workspace credentials

Behavior:

- removes all local OAuth workspace sessions
- with `--workspace <id-or-name>`, removes only the target local OAuth workspace session
- succeeds even if no session exists
- returns the signed-out auth state unless `PRISMA_SERVICE_TOKEN` is still set

Examples:

```bash
prisma-cli auth logout
prisma-cli auth logout --workspace wksp_123
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

## `prisma-cli auth workspace list`

Purpose:

- list locally authenticated workspaces

Behavior:

- succeeds when signed out
- lists local OAuth workspaces stored on this machine
- human output includes a table with workspace name and workspace id
- marks the active local workspace when one is selected
- when `PRISMA_SERVICE_TOKEN` is set, shows the token workspace when resolvable and also shows stored local OAuth workspaces as non-switchable until the variable is unset
- does not claim to list every workspace the user can access unless each workspace has been authorized locally
- does not mutate local or remote state

Examples:

```bash
prisma-cli auth workspace list
prisma-cli auth workspace list --json
```

## `prisma-cli auth workspace use [id-or-name]`

Purpose:

- switch or interactively select the local CLI workspace

Behavior:

- with `[id-or-name]`, requires a stored OAuth session for the target workspace
- with `[id-or-name]`, accepts the cached workspace id, credential workspace id, or cached workspace name case-insensitively
- without `[id-or-name]`, lists locally authenticated OAuth workspaces in an interactive picker when prompting is available
- without `[id-or-name]`, shows the workspace name and workspace id for each interactive choice
- without `[id-or-name]`, selects the only local OAuth workspace without prompting when exactly one is available
- without `[id-or-name]`, fails in non-interactive mode when more than one local OAuth workspace is available
- changes local CLI context only; it does not mutate a remote resource
- fails with `WORKSPACE_SWITCH_UNAVAILABLE` when `PRISMA_SERVICE_TOKEN` is set
- fails with `WORKSPACE_NOT_AUTHENTICATED` when no cached OAuth session matches
- fails with `WORKSPACE_AMBIGUOUS` when a workspace name matches multiple cached workspaces

Examples:

```bash
prisma-cli auth workspace use
prisma-cli auth workspace use wksp_123
prisma-cli auth workspace use "Acme Inc"
```

## `prisma-cli auth workspace logout <id-or-name>`

Purpose:

- remove one local OAuth workspace session

Behavior:

- requires a stored OAuth session for the target workspace
- accepts the cached workspace id, credential workspace id, or cached workspace name case-insensitively
- removes only the target workspace's local OAuth grant
- works while `PRISMA_SERVICE_TOKEN` is set; the service token remains the active auth source
- if the removed workspace was active, leaves no active local OAuth workspace selected
- does not mutate a remote resource and does not revoke remote access
- fails with `WORKSPACE_NOT_AUTHENTICATED` when no cached OAuth session matches
- fails with `WORKSPACE_AMBIGUOUS` when a workspace name matches multiple cached workspaces

Examples:

```bash
prisma-cli auth workspace logout wksp_123
prisma-cli auth workspace logout "Acme Inc"
```

## `prisma-cli project list`

Purpose:

- list all projects in your workspace

Behavior:

- requires auth
- lists projects visible to the active workspace
- human output shows each Project's name and id
- does not resolve the current directory
- does not mutate local state
- when the current directory is not linked, human output adds setup hints after the list
- in JSON, unlinked directories include a `user-choice` `nextActions` entry for Project setup
- listed Projects are not marked selected unless durable local binding actually selects one
- listed Projects are candidates only; the user must choose one before `project link <id-or-name>` runs
- `branches` is intentionally deferred until `/v1/projects` exposes a branch count in this same response; the CLI must not make per-project branch-list requests to render `project list`

Examples:

```bash
prisma-cli project list
prisma-cli project list --json
```

## `prisma-cli project show`

Purpose:

- show this directory's Prisma Project binding

Behavior:

- requires auth
- inspects explicit or durable project context without creating projects
- does not prompt for project selection
- does not mutate local state
- `--project <id-or-name>` resolves only the explicit project
- when bound, returns Workspace, Project, and `resolution.projectSource`
- when bound, human output shows the local repo path, the `<workspace> / <project>` platform label, and the Project URL; it does not show the internal resolution source
- when unbound, human output says `project: Not linked` and shows link/create next steps
- when unbound, JSON exits successfully with `project: null`, `localBinding.status: "not-linked"`, `resolution.projectSource: "unbound"`, a suggested Project name, matching Project candidates, recovery commands, and `user-choice` `nextActions`
- package names and directory names only power unbound suggestions
- fails with `PROJECT_NOT_FOUND`, `PROJECT_AMBIGUOUS`, `LOCAL_PROJECT_WORKSPACE_MISMATCH`, or `LOCAL_STATE_STALE` when explicit or durable binding validation cannot continue safely

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

## `prisma-cli project link [id-or-name]`

Purpose:

- bind the current directory to a Prisma Project

Behavior:

- requires auth
- with `[id-or-name]`, resolves exactly one existing Project by id or name in the authenticated workspace
- without `[id-or-name]` in interactive mode, prompts the user to choose an existing Project, create a new Project, or cancel
- choosing an existing Project writes the local binding and does not create remote resources
- choosing "Create a new Project" prompts for a Project name, creates the Project, and writes the local binding
- without `[id-or-name]` in `--json`, `--no-interactive`, non-TTY, CI, or `--yes` mode, fails with `PROJECT_LINK_TARGET_REQUIRED`
- `--yes` does not choose Project scope
- writes `.prisma/local.json` with Workspace and Project IDs
- ensures `.prisma/` is ignored by Git
- does not create Branch, App, Deployment, database, or Git repository connection state
- fails with `PROJECT_NOT_FOUND` or `PROJECT_AMBIGUOUS` when the Project cannot be selected safely

Examples:

```bash
prisma-cli project link
prisma-cli project link proj_123
prisma-cli project link "Acme Dashboard" --json
```

## `prisma-cli project rename <name> --project <id-or-name>`

Purpose:

- rename the resolved Prisma Project

Behavior:

- requires auth
- renames the resolved Project; accepts `--project <id-or-name>` as an explicit fallback and otherwise uses the directory's durable Project binding
- requires a non-empty `<name>`
- renames the remote Project only; `.prisma/local.json` pins Project IDs, so existing directory bindings stay valid without rewrite
- returns the previous and new name
- does not mutate any other remote resource
- fails with `PROJECT_NOT_FOUND`, `PROJECT_AMBIGUOUS`, or `PROJECT_SETUP_REQUIRED` when the Project cannot be resolved safely
- fails with `PROJECT_RENAME_FAILED` when the platform rejects the rename

Examples:

```bash
prisma-cli project rename "Acme Dashboard v2"
prisma-cli project rename billing-api --project proj_123
prisma-cli project rename billing-api --json
```

## `prisma-cli project remove <project> --confirm <project-id>`

Purpose:

- remove a Prisma Project permanently

Behavior:

- requires auth
- resolves `<project>` by exact Project id or exact Project name inside the active workspace
- never defaults to the directory's bound Project: the positional target is required, because removal is destructive
- requires `--confirm <project-id>` where the value exactly matches the resolved Project id; `--yes` does not satisfy this confirmation
- removal is permanent: the Project's databases are deleted and its Apps stop being served
- fails with `PROJECT_REMOVE_BLOCKED` when the platform reports the Project still has active deployments; remove or tear down the Apps first
- when this directory's `.prisma/local.json` pin points at the removed Project, the pin is cleared and the result reports it
- fails with `PROJECT_NOT_FOUND` or `PROJECT_AMBIGUOUS` when the target cannot be selected safely

Examples:

```bash
prisma-cli project remove proj_123 --confirm proj_123
prisma-cli project remove "Old Sandbox" --confirm proj_456
prisma-cli project remove proj_123 --confirm proj_123 --json
```

## `prisma-cli project transfer <project> (--to-workspace <id-or-name> | --recipient-token <token>) --confirm <project-id>`

Purpose:

- transfer a Prisma Project to another workspace

Behavior:

- requires auth
- resolves `<project>` by exact Project id or exact Project name inside the active workspace; the positional target is required and never defaults to the directory's bound Project
- exactly one recipient source is required:
  - `--to-workspace <id-or-name>` resolves a locally authenticated OAuth workspace, the same targets `auth workspace use` accepts, and authorizes the transfer with that workspace's stored session; this is the same-user path
  - `--recipient-token <token>` passes an access token for the receiving workspace directly; this is the cross-account and headless path
- `--to-workspace` and `--recipient-token` are mutually exclusive; passing neither fails with `TRANSFER_RECIPIENT_REQUIRED`
- `--to-workspace` fails with `WORKSPACE_NOT_AUTHENTICATED` or `WORKSPACE_AMBIGUOUS` when no unique local OAuth session matches, and with `TRANSFER_RECIPIENT_UNAVAILABLE` when `PRISMA_SERVICE_TOKEN` is set, because service-token mode does not read local OAuth sessions
- requires `--confirm <project-id>` where the value exactly matches the resolved Project id; `--yes` does not satisfy this confirmation
- after the transfer the Project belongs to the recipient workspace and the source workspace loses access; Project, Branch, App, and database ids are unchanged
- when this directory's `.prisma/local.json` pin points at the transferred Project: with `--to-workspace` the pin's workspace id is rewritten to the recipient workspace, otherwise the pin is cleared; the result reports which happened
- fails with `PROJECT_TRANSFER_REJECTED` when the platform rejects the transfer, for example an invalid or expired recipient token
- fails with `PROJECT_NOT_FOUND` or `PROJECT_AMBIGUOUS` when the target cannot be selected safely

Examples:

```bash
prisma-cli project transfer proj_123 --to-workspace "Prisma Labs" --confirm proj_123
prisma-cli project transfer proj_123 --recipient-token <token> --confirm proj_123
prisma-cli project transfer proj_123 --to-workspace wksp_456 --confirm proj_123 --json
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

- list Platform branches for the resolved project

Behavior:

- shows known remote branches for the resolved project
- shows each branch's name, role, and role-derived env map (`production` for `role=production`, `preview` for `role=preview`)
- does not create remote state
- does not include branch-specific env overrides, durability, protection, or deployment metadata

Examples:

```bash
prisma-cli branch list
prisma-cli branch list --json
```

## `prisma-cli branch remove <branch> --project <id-or-name> --confirm <branch-id> --cascade`

Purpose:

- remove a preview Branch from the resolved project

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<branch>` by exact Branch id or exact git name within the resolved project
- requires `--confirm <branch-id>` where the value exactly matches the resolved Branch id; `--yes` does not satisfy this confirmation
- production Branches and the project's default Branch are protected: removal fails with `BRANCH_PROTECTED`, and `--cascade` never widens that; the protection check runs before any member resource is touched
- without `--cascade`, a Branch that still has live Apps or databases fails with `BRANCH_NOT_EMPTY`; plain removal never deletes member resources, and the recovery steps offer both the cascade rerun and individual `app remove --branch` / `database` cleanup
- with `--cascade`, the CLI removes the Branch's Apps, then its databases, then the Branch itself; the result lists every removed resource so the blast radius is explicit, in human output and in `result.removed` for `--json`
- cascade is client-orchestrated because the platform's branch delete refuses non-empty Branches; a mid-cascade failure stops immediately and fails with `BRANCH_CASCADE_INCOMPLETE`, whose `meta` lists what was already removed (removed resources are not restored, and the Branch itself remains)
- removal is a platform soft-delete: the Branch disappears from `branch list`, and the platform owns retention of soft-deleted Branches; cascaded member resources are removed through their own APIs
- Branch creation stays implicit (git-push automation and `app deploy`); there is deliberately no `branch create`
- never touches local Git branches
- fails with `BRANCH_NOT_FOUND` when no Branch matches

Examples:

```bash
prisma-cli branch remove feat-login --confirm br_123
prisma-cli branch remove feat-login --confirm br_123 --cascade
prisma-cli branch remove br_123 --confirm br_123 --json
```

## `prisma-cli database list --project <id-or-name> --branch <git-name>`

Purpose:

- list Prisma Postgres databases for the resolved project

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- lists database metadata only: name, id, branch, region, status, and created timestamp when available
- `--branch <git-name>` narrows the list to databases attached to that Branch
- never prints or returns connection strings, passwords, or endpoint secrets
- does not create, delete, or mutate remote state
- uses the standard list JSON envelope with redacted database metadata

Examples:

```bash
prisma-cli database list
prisma-cli database list --branch feature/foo
prisma-cli database list --json
```

## `prisma-cli database show <database> --project <id-or-name> --branch <git-name>`

Purpose:

- show metadata for one Prisma Postgres database

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<database>` by exact database id or exact database name inside the resolved project
- `--branch <git-name>` narrows name resolution when the same database name exists on multiple Branches
- returns database metadata and connection metadata only
- never prints or returns connection strings, passwords, or endpoint secrets
- fails with `DATABASE_NOT_FOUND` or `DATABASE_AMBIGUOUS` when the target cannot be selected safely

Examples:

```bash
prisma-cli database show db_123
prisma-cli database show acme-preview --branch preview
prisma-cli database show db_123 --json
```

## `prisma-cli database create <name> --project <id-or-name> --branch <git-name> --region <region>`

Purpose:

- create a Prisma Postgres database and return its first one-time connection URL

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- creates an empty Prisma Postgres database in the resolved project
- `--branch <git-name>` targets the created database to a Branch when supplied
- `--region <region>` passes the Prisma Postgres region id when supplied
- the Management API returns the first connection as a one-time-view secret
- in default human mode, stderr shows a short creation summary with the resolved Project and Branch when a Branch is present
- in default human mode, stdout contains exactly one line: the raw connection URL
- human stderr does not repeat, label, or wrap the connection URL
- `--verbose` adds human-only metadata rows such as Workspace, Project, Branch, Database, region, status, and first connection id on stderr before the URL is written to stdout
- `--quiet` suppresses successful stderr output and leaves stdout as exactly the raw connection URL
- in `--json`, `result.connectionString` contains the raw one-time URL exactly once
- no `DATABASE_URL=` or `DIRECT_URL=` formatting is added; consumers decide how to store the URL

Examples:

```bash
prisma-cli database create my-db
prisma-cli database create my-db --branch feature/foo --region eu-central-1
prisma-cli database create my-db --json
```

## `prisma-cli database usage <database> --project <id-or-name> --branch <git-name> --from <iso-date> --to <iso-date>`

Purpose:

- show usage metrics for one Prisma Postgres database

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<database>` by exact database id or exact database name inside the resolved project
- `--branch <git-name>` narrows name resolution when the same database name exists on multiple Branches
- `--from <iso-date>` and `--to <iso-date>` bound the reporting period; when omitted, the platform defaults the period to the current month so far
- `--from` and `--to` accept a calendar date (`2026-06-01`) or an ISO datetime (`2026-06-01T12:00:00Z`); a calendar-date `--from` expands to the start of its UTC day and a calendar-date `--to` expands to the end of its UTC day, so `--from 2026-06-01 --to 2026-06-30` is a calendar-day-inclusive June range without relying on server-side end-of-day handling
- the CLI rejects malformed or impossible calendar dates (for example `2026-02-30`) and a `--from` later than `--to` before calling the API
- reports operations used (`ops`) and storage used (`GiB`) for the period, plus the resolved period bounds and the generation timestamp
- read-only; never prints or returns connection strings, passwords, or endpoint secrets
- fails with `DATABASE_NOT_FOUND` or `DATABASE_AMBIGUOUS` when the target cannot be selected safely

Examples:

```bash
prisma-cli database usage db_123
prisma-cli database usage acme-production --from 2026-06-01 --to 2026-06-30
prisma-cli database usage db_123 --json
```

## `prisma-cli database backup`

Manage backups for a database. `backup` is nested under `database` because
backups exist only in the context of one Prisma Postgres database, following
the same parent-noun/subordinate-noun/action shape as `database connection`.
The platform creates backups automatically; the first slice is read-only.

### `prisma-cli database backup list <database> --limit <n>`

Purpose:

- list backups for a database

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<database>` by exact database id or exact database name inside the resolved project
- supports `--branch <git-name>` to narrow database name resolution
- `--limit <n>` caps the number of returned backups; the platform accepts 1 to 100 and defaults to 25
- lists backup id, type (`full` or `incremental`), status (`running`, `completed`, `failed`, or `unknown`), size when available, and created timestamp
- includes the platform's backup retention window in days
- read-only; never prints or returns secret values
- fails with `DATABASE_BACKUPS_UNSUPPORTED` when the platform reports backups are not available for the database (for example remote/BYO databases)
- fails with `DATABASE_NOT_FOUND` or `DATABASE_AMBIGUOUS` when the target cannot be selected safely

Examples:

```bash
prisma-cli database backup list db_123
prisma-cli database backup list acme-production --limit 50
prisma-cli database backup list db_123 --json
```

## `prisma-cli database restore <database> --backup <backup-id> --source-database <database> --confirm <database-id>`

Purpose:

- restore a database's data from a backup

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- restores into the resolved `<database>` (the target): all current data is immediately and irreversibly overwritten with the backup contents; connections and credentials are preserved, so no new connection URL is printed
- resolves `<database>` by exact database id or exact database name inside the resolved project; `--branch <git-name>` narrows name resolution
- `--backup <backup-id>` is required and names the backup to restore from; ids come from `database backup list`
- by default the backup must belong to the target database; `--source-database <database>` restores from another database's backup, for example a production backup into a scratch database, and requires access to both databases' projects
- requires `--confirm <database-id>` where the value exactly matches the resolved target database id; `--yes` does not satisfy this confirmation
- the restore runs asynchronously: the target database status becomes `recovering` until the restore completes, and `database show` reports the current status; `nextSteps` includes the show command
- fails with `DATABASE_BACKUP_NOT_FOUND` when the backup id cannot be resolved for the source database
- fails with `DATABASE_RESTORE_CONFLICT` when the target database is provisioning or already recovering
- fails with `DATABASE_NOT_FOUND` or `DATABASE_AMBIGUOUS` when a database target cannot be selected safely
- never prints or returns connection strings, passwords, or endpoint secrets

Examples:

```bash
prisma-cli database restore db_123 --backup bkp_456 --confirm db_123
prisma-cli database restore scratch --backup bkp_456 --source-database acme-production --confirm db_789
prisma-cli database restore db_123 --backup bkp_456 --confirm db_123 --json
```

## `prisma-cli database remove <database> --confirm <database-id>`

Purpose:

- remove a Prisma Postgres database

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<database>` by exact database id or exact database name inside the resolved project
- requires `--confirm <database-id>` where the value exactly matches the resolved database id
- `--yes` does not satisfy this confirmation
- removes the database and its connection metadata through the Management API
- never prints or returns connection strings, passwords, or endpoint secrets

Examples:

```bash
prisma-cli database remove db_123 --confirm db_123
```

## `prisma-cli database connection`

Manage one-time-view connection strings for a database.

`connection` is nested under `database` because connection strings are only
valid in the context of a Prisma Postgres database. The subgroup mirrors the
`project env <action>` shape: the parent command names the resource family,
the nested noun names the subordinate resource, and the final token is the
action. There is no `database connection show` command because connection
strings are one-time-view secrets: the platform returns them only from
`connection create` and `connection rotate`, never from read endpoints.

### `prisma-cli database connection list <database>`

Purpose:

- list connection metadata for a database

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<database>` by exact database id or exact database name inside the resolved project
- supports `--branch <git-name>` to narrow database name resolution
- lists connection names, ids, and created timestamps when available
- never prints or returns connection strings, passwords, or endpoint secrets

Examples:

```bash
prisma-cli database connection list db_123
prisma-cli database connection list acme-preview --branch preview
prisma-cli database connection list db_123 --json
```

### `prisma-cli database connection create <database> --name <name>`

Purpose:

- create a new one-time-view connection URL for a database

Behavior:

- requires auth and resolved project context; accepts `--project <id-or-name>` as an explicit fallback
- resolves `<database>` by exact database id or exact database name inside the resolved project
- supports `--branch <git-name>` to narrow database name resolution
- `--name <name>` sets the connection metadata name; when omitted, the CLI generates a `cli-YYYYMMDDhhmmssSSS-xxxx` name
- in default human mode, stderr shows a short creation summary with the resolved Project and Branch when a Branch is present
- in default human mode, stdout contains exactly one line: the raw connection URL
- human stderr does not repeat, label, or wrap the connection URL
- default human stderr does not show generated connection names; use `--verbose` or `--json` for connection metadata
- `--verbose` adds human-only metadata rows such as Workspace, Project, Branch, Database, and connection id on stderr before the URL is written to stdout
- `--quiet` suppresses successful stderr output and leaves stdout as exactly the raw connection URL
- in `--json`, `result.connectionString` contains the raw one-time URL exactly once
- no `DATABASE_URL=` or `DIRECT_URL=` formatting is added; consumers decide how to store the URL

Examples:

```bash
prisma-cli database connection create db_123
prisma-cli database connection create db_123 --name readonly
prisma-cli database connection create db_123 --json
```

### `prisma-cli database connection rotate <connection> --confirm <connection-id>`

Purpose:

- rotate a database connection's credentials and print the new one-time connection URL

Behavior:

- requires auth
- treats `<connection>` as the connection id to rotate
- requires `--confirm <connection-id>` where the value exactly matches the connection id; `--yes` does not satisfy this confirmation, because rotation revokes the previous credentials (best-effort) and breaks clients still using them
- mints new credentials for the same connection; the connection id and name are unchanged
- the new connection URL is a one-time-view secret with the same output contract as `database connection create`:
  - in default human mode, stderr shows a short rotation summary and stdout contains exactly one line, the raw new connection URL
  - human stderr does not repeat, label, or wrap the connection URL
  - `--verbose` adds human-only metadata rows such as database and connection id on stderr before the URL is written to stdout
  - `--quiet` suppresses successful stderr output and leaves stdout as exactly the raw connection URL
  - in `--json`, `result.connectionString` contains the raw one-time URL exactly once
- no `DATABASE_URL=` or `DIRECT_URL=` formatting is added; consumers decide how to store the URL
- fails with `DATABASE_CONNECTION_NOT_FOUND` when the connection does not exist

Examples:

```bash
prisma-cli database connection rotate conn_123 --confirm conn_123
prisma-cli database connection rotate conn_123 --confirm conn_123 --json
```

### `prisma-cli database connection remove <connection> --confirm <connection-id>`

Purpose:

- remove a database connection

Behavior:

- requires auth
- treats `<connection>` as the connection id to remove
- requires `--confirm <connection-id>` where the value exactly matches the connection id
- `--yes` does not satisfy this confirmation
- never prints or returns connection strings, passwords, or endpoint secrets

Examples:

```bash
prisma-cli database connection remove conn_123 --confirm conn_123
```

## `prisma-cli app build [app] --entry <path> --build-type <auto|bun|nextjs|nuxt|astro|nestjs|tanstack-start|custom>`

Purpose:

- build the app locally into a deployable artifact

Behavior:

- resolves the optional `[app]` target, app root, framework, and entrypoint from `prisma.compute.ts` exactly like `app deploy`; explicit `--entry` and a non-`auto` `--build-type` override the config
- detects supported project shapes when `--build-type auto` is used and no config framework applies
- supports Bun, Next.js, Nuxt, Astro, NestJS, TanStack Start, and custom artifact app builds in the beta package
- fails with `USAGE_ERROR` when framework detection is ambiguous

Examples:

```bash
prisma-cli app build --build-type nextjs
prisma-cli app build --build-type nuxt
prisma-cli app build --build-type astro
prisma-cli app build --build-type nestjs
prisma-cli app build --build-type tanstack-start
prisma-cli app build --build-type bun --entry server.ts
prisma-cli app build api
prisma-cli app build frontend
```

## `prisma-cli app run [app] --entry <path> --build-type <auto|bun|nextjs> --port <port>`

Purpose:

- run your app locally

Behavior:

- resolves the optional `[app]` target, app root, framework, entrypoint, and port from `prisma.compute.ts` exactly like `app deploy`; explicit `--entry`, `--port`, and a non-`auto` `--build-type` override the config
- fails with `USAGE_ERROR` when the configured framework has no local dev server in the current preview
- detects supported project shapes when `--build-type auto` is used and no config framework applies
- starts the local framework command
- reports `RUN_FAILED` when the local process cannot start or exits unsuccessfully

Examples:

```bash
prisma-cli app run --build-type nextjs
prisma-cli app run --build-type bun --entry server.ts --port 3000
prisma-cli app run api
```

## `prisma-cli app deploy [app] --project <id-or-name> --create-project <name> --app <name> --branch <name> --framework <nextjs|nuxt|astro|hono|nestjs|tanstack-start|custom|bun> --entry <path> --http-port <port> --region <region> --env <name=value|file> --db --no-db --prod --no-promote`

Purpose:

- creates a new deployment for the app

Compute config file (`prisma.compute.ts`):

- deploy reads an optional typed config file, using the nearest one from the invocation directory up to the repository or workspace root (the closest ancestor with `.git`, `pnpm-workspace.yaml`, `bun.lock`, or a `workspaces` field); without such a boundary only the invocation directory is checked, so discovery never escapes the repository
- per directory, exactly one of `prisma.compute.ts`, `prisma.compute.mts`, `prisma.compute.js`, `prisma.compute.mjs`, or `prisma.compute.cjs` may exist
- config-relative paths (`root`, `env.file`) resolve from the config file's directory, so the config means the same thing from any working directory; `--env` flag paths still resolve from the invocation directory
- when a config is discovered, its directory is the project directory: `.prisma/local.json` is read and written there, the local CLI state cache (`.prisma/cli/state.json`) lives there, and `--db` scans for Prisma schema sources there (for prompting and suggestions only); locating the config for these purposes never evaluates it
- the config default-exports `defineComputeConfig({ ... })` from `@prisma/compute-sdk/config` (the shared compute config contract; the CLI loader resolves the import without a local install); the helper is an identity function, so plain object exports also work for JavaScript configs
- the config defines exactly one of:
  - `app` — a single-app repository
  - `apps` — a multi-app or monorepo repository, keyed by deploy target name
- each app accepts `name`, `region`, `root`, `framework`, `entry`, `httpPort`, `env`, and `build`:
  - `region` is the Compute region id used when deploy creates a new app; existing apps keep their current region
  - `env` is a dotenv file path, or `{ file, vars }` with file path(s) and inline assignments
  - `build` is `{ command, outputDirectory, entrypoint }`; all fields are optional except where a framework requires enough information to stage a runnable artifact, and `command: null` skips the build step
  - `build.entrypoint` is the built artifact entrypoint when `outputDirectory` is set, and is the source entrypoint for Bun/Hono configs that do not set an output directory
  - `framework: "custom"` deploys a prebuilt or custom-built artifact and requires `build.outputDirectory` and `build.entrypoint`
- when `build` is present, the compute config owns build settings for that app: fields it sets override framework defaults, fields it omits are inferred; without a `build` block, settings are inferred entirely, with their sources shown
- the compute config does not declare databases in the current beta; database setup stays on the `--db`/`--no-db` flags (a future project-level `database` field is the reserved growth path, since databases are branch resources shared by every app on the branch)

Unification note (forward-looking, normative for design decisions): Prisma ORM
ships `prisma.config.ts` (`defineConfig` from `prisma/config`). The compute
config is designed to become a `compute` key inside that unified file: its
shape must remain self-contained, must not add top-level keys that collide
with ORM config keys, and `database.schema` will become unnecessary once the
unified file's own `schema` field is in scope. Project, branch, and
production targeting stay out of committed config in the unified file for the
same reasons they are excluded today.
- config values are deploy defaults; explicit flags always win: `--framework`, `--entry`, `--http-port`, and `--region` override per value, and any `--env` flag replaces the config env inputs entirely
- the config `name` (or the `apps` key when `name` is absent) selects the app like `--app`, but ranks below both `--app` and `PRISMA_APP_ID`
- `--region` and config `region` apply only when the resolved app does not exist yet and deploy creates it; `--app` and `PRISMA_APP_ID` still control which app is selected
- `root` is a relative path inside the repository; framework detection, entrypoint resolution, build settings, and the build/upload run in that directory while Project binding and the local pin stay in the config file's directory
- `prisma.compute.ts` never selects Project or Branch scope; project resolution is unchanged
- the `[app]` argument selects an `apps` target by key:
  - without an `[app]` argument, a command run from inside a target's `root` selects that target, so `cd apps/api && prisma-cli app deploy` deploys `api`; the deepest matching root wins and an ambiguous tie selects nothing
  - with multiple `apps` entries, no `[app]` argument, and no target inferred from the invocation directory, deploy deploys every target sequentially in declaration order — the config declares the system, and a bare `prisma-cli app deploy` ships it
  - deploying all targets rejects per-app inputs (`--app`, `--framework`, `--entry`, `--http-port`, `--region`, `--env`, `PRISMA_APP_ID`) with a usage error; project- and branch-level flags (`--project`, `--create-project`, `--branch`, `--db`, `--no-db`, `--prod`, `--no-promote`, `--yes`) apply to the whole run, with `--create-project` creating and binding the Project once before the first target
  - a deploy-all run stops at the first failure and reports the targets already live; `--json` output aggregates one full deploy result per target
  - `app build` and `app run` still require a target in multi-app configs and fail with `COMPUTE_CONFIG_TARGET_REQUIRED` (a dev server cannot run N apps at once; build keeps the same shape)
  - an `[app]` argument that matches no target fails with `COMPUTE_CONFIG_TARGET_UNKNOWN`
  - a single-entry `apps` map deploys its only target without an argument
  - with a single `app` config, `[app]` is accepted only when it equals the configured `name`
  - `[app]` without any compute config file is a usage error
- a config that fails to load or validate fails with `COMPUTE_CONFIG_INVALID` before any remote work
- settings sourced from the config are annotated `set by prisma.compute.ts` in human output and deploy settings metadata

```ts
import { defineComputeConfig } from "@prisma/compute-sdk/config";

// Single-app repository: prisma-cli app deploy
export default defineComputeConfig({
  app: {
    name: "api",
    region: "eu-central-1",
    framework: "hono",
    httpPort: 8080,
    env: ".env",
  },
});

// Multi-app repository: prisma-cli app deploy web
export default defineComputeConfig({
  apps: {
    web: { root: "apps/web", framework: "nextjs" },
    worker: { root: "apps/worker", framework: "bun", entry: "src/index.ts" },
    frontend: {
      root: "apps/frontend",
      framework: "custom",
      build: {
        command: "npm run build",
        outputDirectory: "build",
        entrypoint: "handler.js",
      },
    },
  },
});
```

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
- `PROJECT_SETUP_REQUIRED` preserves readable recovery commands in `nextSteps` and includes structured `nextActions` for choosing, linking, creating, or retrying with an explicit Project
- `--yes` alone does not choose Project scope; use `--project` or `--create-project`
- `--project` and `--create-project` are mutually exclusive with each other and with `PRISMA_PROJECT_ID`
- resolves or creates branch context from `--branch`, local Git branch, or `main`
- treats only the resolved Branch `role` as production authority; branch name, `main`, `production`, and `isDefault` are not production authority
- resolves or creates app context inside the resolved branch from `--app`, `PRISMA_APP_ID`, `package.json#name`, or current directory name
- auto-promotes the first production deploy for an App without `--prod`
- requires `--prod` for subsequent deploys to a production Branch; `--yes` only skips the confirmation prompt when `--prod` is also present
- supports `--no-promote` to build a new deployment without promoting it to live: the previous deployment keeps serving, and the new deployment is reachable only at its own candidate URL until a later `app promote <deployment-id>` makes it live
- `--no-promote` never replaces the live deployment, so it bypasses the production gate: `app deploy --no-promote` on a production Branch builds a candidate without `--prod` and without confirmation. It is the CI build-then-verify path — build the candidate, health-check its URL, then `app promote`
- does not prompt when there is no real choice; zero matching apps creates the inferred app
- writes `.prisma/local.json` after Project binding succeeds and before build/deploy starts, so retries after a failed deploy do not repeat setup
- before asking `Customize build settings? (y/N)`, previews the detected framework and runtime so the user can see the defaults they are accepting or changing
- asks `Customize build settings? (y/N)` only while binding the directory for the first time, and only asks for Framework and HTTP port when the user opts in
- resolves build settings from the compute config `build` block over framework inference; nothing is read from or written to disk for them:
  - `Build Command` prefers `<package-manager> run build` when `package.json` has `scripts.build`
  - the package manager is detected from the app directory first, then from each ancestor up to the repository or workspace root, so workspace apps build with the workspace package manager
  - build commands run with every `node_modules/.bin` between the app and the repository or workspace root on `PATH`, so hoisted workspace binaries resolve
  - otherwise `Build Command` falls back to the framework default, such as `next build`
  - `Output Directory` is a literal framework output path, such as `.next/standalone`, `.output`, or `.`
  - `Entrypoint` is shown when the config or framework settings provide a concrete built artifact entrypoint
- `prisma.app.json` is legacy and never read or written; a leftover file that matches the resolved settings produces a deletion warning, an unparsable one is ignored with a warning, and one with custom values fails with `BUILD_SETTINGS_MIGRATION_REQUIRED` including the exact `build` block to move into `prisma.compute.ts`
- after setup, deploy prints `Deploying to <Project> / <Branch> / <App>`; later deploys print a compact target header such as `Deploying ./j1 to j1 / main / j1`
- deploy progress uses short stage copy (`Building locally...`, `Built <size>`, `Uploading...`, `Uploaded`, `Deploying...`, `Deployed`) and never prints `Status: running` or `Deployment is running at ...`
- success human output prints `Live in <duration>`, the URL on its own line, and `Logs   prisma-cli app logs`
- with `--no-promote`, success human output instead prints `Built <deployment-id> in <duration> (not promoted)`, the candidate URL on its own line, a note that the live deployment is unchanged, and a `Promote   prisma-cli app promote <deployment-id>` next step
- accepts repeated `--env NAME=VALUE` flags and dotenv file paths such as `--env .env`
- supports `--db` to create a new empty Prisma Postgres database and write `DATABASE_URL` and `DIRECT_URL` through the existing `project env` storage; the CLI never runs schema or migration commands — applying the schema stays with the user's own tooling
- `--db` is the opinionated single-database path: it creates **one** branch database and exposes `DATABASE_URL`/`DIRECT_URL` as branch-scoped env vars, so every app on the branch shares it. In a multi-app deploy-all run the database is created once (on the first target) and reused by the rest; the run never creates a database per app. Per-app or per-service database topologies are explicit-configuration territory — set each app's database env vars yourself rather than relying on `--db` to infer app-to-database ownership
- supports `--no-db` to suppress automatic database prompting for the deploy
- `--db` and `--no-db` are mutually exclusive; passing both is rejected
- `--yes` alone never creates a database; CI must pass `--db --yes` to create and wire one
- preview Branch setup writes branch-scoped env-var overrides
- production setup writes production env vars only during the first production deploy, before the selected App has a live deployment
- later production deploys do not prompt for database setup; explicit `--db` is rejected once the selected production App has a live deployment
- database setup never overwrites an existing branch-scoped `DATABASE_URL`; when the branch already has `DATABASE_URL`, `--db` leaves branch database env vars unchanged and continues
- production setup treats existing production `DATABASE_URL` or `DIRECT_URL` as BYO DB intent; it does not prompt, and explicit `--db` leaves production env vars unchanged and continues with a warning
- when only `DIRECT_URL` exists on a preview branch, explicit `--db` treats it as partial setup and repairs the pair by writing fresh branch database env values
- if env-var wiring fails after database creation, the CLI deletes the newly created database before returning the error
- after creating a database, the CLI emits a warning that the database is empty and suggests a schema command based on the detected local schema source (`prisma migrate deploy` when `prisma/migrations` exists, `prisma db push` for a bare `schema.prisma`, `prisma-next db init` for a Prisma Next config); the suggestion is never executed
- known non-Postgres Prisma sources do not trigger automatic database prompting; explicit `--db` is rejected because the created database is Prisma Postgres
- `--env DATABASE_URL=...`, `--env DIRECT_URL=...`, or the same keys loaded from an env file suppress automatic database prompting; combining those database env vars with `--db` is rejected
- maps user-facing framework names to deploy build strategies
- does not accept `--build-command` or `--output-directory`; custom build settings live in the `build` block of `prisma.compute.ts`
- deploys arbitrary framework output with `framework: "custom"` when the config provides a built output directory and entrypoint; `build.command` is optional for prebuilt artifacts
- in interactive human deploys, prompts once to install the Prisma Compute skill for the project when `prisma-compute` is missing; accepting installs `prisma-compute` from `prisma/skills` from the project directory, equivalent to the detected package-runner command such as `pnpm dlx @prisma/cli@latest agent install --skill prisma-compute`; declining records the prompt as dismissed in local CLI state
- does not prompt for agent setup in `--json`, `--quiet`, CI, `--no-interactive`, or `--yes`
- uses `src/index.ts` as the Hono deploy entrypoint when the app has no `package.json#main` or `package.json#module` and that file exists
- supports vanilla Bun apps with `--framework bun` using `package.json#main` or `package.json#module`, or with `--entry <path>`
- treats `--entry <path>` without `--framework` as a Bun app deploy
- does not print secret values
- returns app, deployment id, URL, deploy settings including build settings origin metadata, and next steps in `--json` output

Examples:

```bash
prisma-cli app deploy
prisma-cli app deploy --project proj_123
prisma-cli app deploy --create-project my-app --yes
prisma-cli app deploy --app my-app --env DATABASE_URL=postgresql://example
prisma-cli app deploy --app my-app --region us-west-1
prisma-cli app deploy --db
prisma-cli app deploy --db --yes
prisma-cli app deploy --no-db
prisma-cli app deploy --framework nextjs --http-port 3000
prisma-cli app deploy --branch feat-login --framework hono --http-port 3000
prisma-cli app deploy --prod --yes
prisma-cli app deploy --no-promote
prisma-cli app deploy --framework bun --entry src/server.ts --http-port 3000
prisma-cli app deploy --entry src/server.ts --http-port 3000
prisma-cli app deploy web
prisma-cli app deploy worker --branch feat-queue
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
- For read verbs (`list`), omitting `--role` or `--branch` resolves from
  the active local Git branch when one exists; outside a Git branch it
  shows a production/preview project-level overview.

### `prisma-cli project env add (KEY=VALUE | --file <path>) (--role <production|preview> | --branch <git-name>)`

Purpose:

- create a new environment variable on the targeted scope. Fails if a
  variable with the same key already exists.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- KEY=VALUE is parsed from a single positional; KEY must match
  `[A-Z_][A-Z0-9_]*`
- KEY without `=VALUE` reads the value from the current process environment
- `--file <path>` reads KEY=VALUE assignments from a dotenv file relative to
  the current directory; `--file` is mutually exclusive with the positional
  assignment
- file imports validate the whole file before writing; duplicate keys, invalid
  keys, empty values, or existing target variables fail before any variables are
  created
- if a variable with the same key already exists in the scope, the
  command fails with a clear error directing to `env update`
- branch-only variables are allowed; the CLI warns when the key does
  not exist in the preview template
- the response carries metadata only — the value is never echoed back

Examples:

```bash
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role production
prisma-cli project env add STRIPE_KEY=sk_test_xxx --role preview
prisma-cli project env add --file .env --role preview
prisma-cli project env add DATABASE_URL=postgresql://branch --branch feature/foo
prisma-cli project env add --file .env.local --branch feature/foo
API_URL=https://api.example prisma-cli project env add API_URL --project proj_123 --role preview
```

### `prisma-cli project env update (KEY=VALUE | --file <path>) (--role <production|preview> | --branch <git-name>)`

Purpose:

- replace the value of an existing environment variable on the
  targeted scope. Fails if no variable with the given key exists.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- KEY=VALUE is parsed from a single positional; KEY must match
  `[A-Z_][A-Z0-9_]*`
- KEY without `=VALUE` reads the value from the current process environment
- `--file <path>` reads KEY=VALUE assignments from a dotenv file relative to
  the current directory; `--file` is mutually exclusive with the positional
  assignment
- file imports validate the whole file before writing; duplicate keys, invalid
  keys, empty values, or missing target variables fail before any variables are
  updated
- if no variable with the key exists in the scope, the command fails
  with a clear error directing to `env add`
- the response carries metadata only — the value is never echoed back

Examples:

```bash
prisma-cli project env update STRIPE_KEY=sk_new_xxx --role production
prisma-cli project env update STRIPE_KEY=sk_new_xxx --role preview
prisma-cli project env update --file .env --role production
prisma-cli project env update DATABASE_URL=postgresql://branch --branch feature/foo
```

### `prisma-cli project env list [--role <production|preview> | --branch <git-name>]`

Purpose:

- list environment variable names and metadata for the targeted scope.

Behavior:

- requires auth and a resolved project; accepts `--project <id-or-name>` as an explicit fallback
- explicit `--role production|preview` lists that project-level map
- explicit `--branch` lists the resolved preview branch view: preview defaults
  plus branch overrides, with source metadata
- with no scope and an active local Git branch, resolves the matching
  Platform Branch and lists the env map for its role; preview Branches
  include preview defaults plus Branch overrides
- with no scope and an active local Git branch that has no Platform
  Branch yet, lists preview template metadata and marks the target as
  not created yet
- with no scope and no local Git branch, lists an overview of the
  production and preview project-level maps, excluding Branch overrides
- never prints values (never-reveal)
- emits `key`, `id`, `last updated`, and source/scope annotations per
  row, plus resolved target metadata for human and JSON output

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

## `prisma-cli app show [app] --app <name>`

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

## `prisma-cli app open [app] --app <name>`

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

## `prisma-cli app domain add <hostname> [app]`

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

## `prisma-cli app domain show <hostname> [app]`

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

## `prisma-cli app domain remove <hostname> [app]`

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

## `prisma-cli app domain retry <hostname> [app]`

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

## `prisma-cli app domain wait <hostname> [app]`

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

## `prisma-cli app logs [app] --app <name> --deployment <id>`

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

## `prisma-cli build logs <build-id> --follow --cursor <cursor>`

Purpose:

- stream the build log for a specific build (from a git-push or a Console deploy)

Behavior:

- requires auth; authorizes against the workspace that owned the build when it ran (build logs can contain secrets, so access stays with that workspace)
- takes a build id — shown in the Console build view and in git-push output; this is a build id, distinct from a runtime deployment id (`prisma-cli app logs` streams a deployment's runtime logs; this streams a build's logs)
- streams the build's log records to stdout in human mode (each line carries its source — `runner` / `stdout` / `stderr` — and the build step); `stderr` and error-level records are written to stderr so stdout stays redirectable to a clean build log
- a clean end prints no trailing line; a build with no recorded logs prints `No build logs are available for this build.`, and read errors print their message (these terminal messages are written to stderr)
- `--follow` keeps the connection open and streams new lines while an in-flight build runs; it ends on its own once the build reaches a terminal state
- `--cursor <cursor>` resumes from a prior terminal cursor
- `--json` emits one JSON event per record, ending in a terminal record (no trailing wrapper success event)
- returns an indistinguishable `BUILD_NOT_FOUND` when the build does not exist or the caller's workspace does not own it

Examples:

```bash
prisma-cli build logs cmcz3v6ft0a1b2c3d
prisma-cli build logs cmcz3v6ft0a1b2c3d --follow
prisma-cli build logs cmcz3v6ft0a1b2c3d --json
```

## `prisma-cli app list-deploys [app] --app <name>`

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

## `prisma-cli app promote <deployment> [app] --app <name>`

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

## `prisma-cli app rollback [app] --app <name> --to <deployment>`

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

## `prisma-cli app remove [app] --app <name> --branch <name> -y --yes`

Purpose:

- remove the app from the resolved branch

Behavior:

- requires auth and project context
- resolves the branch it reads like the other management commands: explicit `--branch` honored as-is, then the active Git branch when it exists in the project, then the project's default branch
- `--branch <name>` makes branch cleanup possible for branches that are not checked out locally, such as a teammate's preview branch
- resolves the selected app within that branch
- requires confirmation unless `-y` or `--yes` is passed
- clears local selected app state when the removed app was selected

Examples:

```bash
prisma-cli app remove --app hello-world
prisma-cli app remove --app hello-world --yes
```
