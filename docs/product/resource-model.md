# Prisma CLI Resource Model

## Purpose

This document defines the nouns and boundaries used by the Prisma CLI. It is the
source of truth for what the CLI means by workspace, project, branch, app,
deployment, database, and environment variables.

## North Star Hierarchy

The Prisma CLI resolves through one hierarchy:

```text
workspace -> project -> branch -> { app, database }
```

The preview implementation exposes only part of this hierarchy, but current
behavior must not contradict it.

## Core Resources

### Workspace

`workspace` is the account, membership, and billing boundary.

Preview relevance:

- authentication
- current identity
- project discovery

### Project

`project` is the remote Prisma resource resolved for local work.

Rules:

- `project` is not the same thing as `app`
- Public Beta does not read or write committed config files such as `prisma.config.ts` or `.prisma/settings.json` for project resolution
- `.prisma/local.json` is a gitignored local pin/cache for Workspace and Project IDs; it is not a declarative repo config file
- `prisma.app.json` is a committed app build-settings file only; it must not contain Workspace, Project, Branch, App, env, or secret resolution state
- Project setup is explicit: users choose an existing Project or explicitly create a new one before remote work starts
- `app deploy` may orchestrate Project setup, but it must not silently choose or create Project scope
- everything under a project happens in a branch

### Branch

`branch` is the named project-scoped isolation boundary for app and database
work.

A Prisma branch is not just a Git branch and not just a database branch. It is
the platform container for a version of a project: app resources, databases,
deploy state, preview URL, scoped configuration, logs, and automation context can
all belong to the branch over time.

Rules:

- `production` is a protected durable branch
- every other named branch is a preview branch by default
- preview branches are disposable by default
- non-production branches can become durable later
- `local` is local CLI context only, not a branch
- branch context comes from explicit targeting, Git, or safe command defaults,
  not `prisma.config.ts`

Examples of preview branches:

- `preview`
- `staging`
- `feat-auth`
- `pr-123`

Branch role and durability are product concepts in the current docs. The preview
command JSON for `branch list` exposes `role`; `durability` remains target-model
until the Management API returns it everywhere.

### Branch Role And Durability

Branch role describes what the branch is used for. Branch durability describes
the reliability contract attached to it.

Rules:

- production branches are durable by default
- preview branches are disposable by default
- a non-production branch can become durable for staging, QA, demos, release
  candidates, or persistent automation work
- all production branches are durable, but not all durable branches are
  production

Disposable preview work can have stricter runtime guardrails, automatic archive
after inactivity, and restore-on-request behavior. Durable branches carry a
stronger recovery expectation and should have stronger safeguards against
accidental destructive actions.

### App

`app` is the deployable runtime workload for a project branch.

Rules:

- `app` is not the same thing as `project`
- the app name is registered within the resolved project
- the runtime app service is scoped by branch in the platform model
- the app may be selected or created as part of app deployment workflows
- app selection is local CLI state when needed for the beta package
- app build settings may live in `prisma.app.json` beside `package.json`; v1 fields are `buildCommand` and `outputDirectory`

### Deployment

`deployment` is one build-and-release instance of an app.

Deployment fields should be treated as first-class:

- `id`
- `status`
- `url` when available
- `timestamps`
- `sourceRevision` when known
- whether it is currently live

A branch can have many deployments over time, but at most one live deployment
for a given app.

### Source Revision

`sourceRevision` is the code state a deployment was built from.

It matters because:

- promotion should be source-aware
- production releases should make clear what source is going live
- rollback should restore a known previous deployment

### Environment Variables

Environment variables are deploy-time inputs, not top-level CLI resources in the
beta command model.

Rules:

- deployments get a snapshot of variables at deploy time
- changing variables does not mutate older deployments
- changing variables does not auto-redeploy unless the command explicitly
  creates a new deployment
- command output must not print secret values
- listing variables should show names only
- pulling preview variables writes values to a local dotenv file only; production
  values remain write-only

The `env` word is reserved for environment-variable ergonomics. The current
top-level target-context group is `branch`, not `env`.

### Schema and Database

`schema` stays a local code artifact. `database` stays a branch-bound remote
resource.

The beta package exposes `database` as the canonical database management group.
The first slice manages Prisma Postgres database metadata and one-time-view
connection strings:

- `database list`
- `database show <database>`
- `database create <name>`
- `database remove <database>`
- `database connection list <database>`
- `database connection create <database>`
- `database connection remove <connection>`

The `database connection` subgroup is nested because connection strings exist
only for databases. It follows the same parent-noun/subordinate-noun/action
shape as `project env <action>`. There is no `database connection show` command:
connection strings are secrets and the platform returns them only during create
operations.

Rules:

- `database` is the canonical public group; Public Beta does not add public
  `db` or `postgres` aliases
- `database create` prints the first returned connection URL exactly once
- `database connection create` prints the created connection URL exactly once
- create commands print raw URLs only, never `DATABASE_URL=` or `DIRECT_URL=`
- database wiring uses the existing environment-variable model
- `database list`, `database show`, and `database connection list` never print
  or return secret values
- database and database connection removal require exact id confirmation with
  `--confirm <id>`; `--yes` is not sufficient
- preview Branch setup writes branch-scoped `DATABASE_URL` and `DIRECT_URL` overrides, not separate app bindings
- first production deploy setup writes production `DATABASE_URL` and `DIRECT_URL` env vars before the App has a live deployment
- database setup never overwrites an existing branch-scoped `DATABASE_URL`
- production setup treats existing production `DATABASE_URL` or `DIRECT_URL` as BYO DB intent and leaves env vars unchanged
- schema setup is sourced only from local code; the CLI does not clone or infer schema from another database
- Prisma Next config (`prisma-next.config.*`) is preferred over `schema.prisma`
- known non-Postgres Prisma sources are treated as unsupported for automatic Prisma Postgres setup
- later production database configuration is managed through explicit environment-variable commands

## Relationships

```text
workspace -> project
project -> branch
branch -> app*
branch -> database*
app -> deployment*
```

Long-term, branch is where app and database relationships meet.

## Invariants

- `project` is not `app`
- `project` is not `branch`
- `branch` is not `deployment`
- `deployment` is not `sourceRevision`
- `local` is CLI context, not a branch or deploy target
- `production` is protected and durable
- every other named branch is preview by default
- Public Beta does not use committed repo config files for Project -> Branch -> App resolution
- `.prisma/local.json` may cache Workspace and Project resolution, but Branch still comes from explicit targeting or Git and App is resolved inside the Branch

## Resolution Rules

### Project Resolution

Commands resolve project context in this order:

1. explicit `--project <id-or-name>` when present
2. `PRISMA_PROJECT_ID` when set for headless deploy/domain commands
3. `.prisma/local.json` project pin when present, revalidated against platform data
4. durable platform mapping when available
5. explicit setup choice: `project link`, `project create`, interactive setup picker, `app deploy --project`, or `app deploy --create-project`
6. structured failure when no explicit or durable Project binding exists

Package names and directory names may suggest setup defaults and matching
Project candidates, but they do not select Project scope. Remembered local
context may help with app/deployment convenience after a Project is explicit,
but it is not a Project binding source.

Project-scoped commands require explicit or durable Project context. If the
directory is not pinned and no explicit Project source is provided, they fail
with `PROJECT_SETUP_REQUIRED`; `app deploy` may enter explicit interactive setup
before failing.

### App Selection Resolution

Preview app commands that need an app resolve it inside the resolved branch in
this order:

1. explicit `--app <name>`
2. `PRISMA_APP_ID` when set for headless deploys
3. locally selected app for non-deploy commands when it still exists in the resolved branch
4. inferred app name from `package.json#name`
5. current directory name
6. create the inferred app service in the resolved branch when no existing app matches
7. interactive selection only when multiple matching apps make the target ambiguous
8. structured usage error when no app can be resolved non-interactively

`.prisma/local.json` does not pin an app ID. The local pin binds the directory
to a Workspace and Project; branches come from explicit targeting, Git, or
`main` when neither is available. Apps are resolved within that resolved branch,
including the `main` fallback, which avoids accidentally deploying
feature-branch code into a service owned by another branch.

### Branch Context Resolution

Commands that use branch context resolve it in this order:

1. explicit branch argument when the command accepts one
2. local Git branch when available
3. `main`

Consequences:

- `local` never becomes a branch or deploy target
- first remote app work falls back to `main` when no Git branch is available
- production requires explicit user intent

### Inspect Resolution

Commands that inspect deployments resolve in this order:

1. exact deployment id if the command accepts one
2. selected app for the resolved project
3. latest known live deployment for that app

### Promote Resolution

`app promote` releases an existing successful deployment or source into a more
trusted target. Production promotion must be explicit and must not hide what is
going live.

### Rollback Resolution

`app rollback` restores a previous known deployment. Rollback output must make
clear what changed and which deployment is now live.
