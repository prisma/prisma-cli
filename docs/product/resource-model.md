# Prisma CLI Resource Model

> **Staleness notice (2026-08-18).** This document predates the S8 surface:
> the CLI now presents apps as **services** (`service` group), `app deploy`
> is removed (deploys come from pushing a connected repository, the Console,
> or `composer deploy`), and `database` commands are mounted as `postgres`.
> The resource hierarchy below still holds; command spellings do not.

## Purpose

This document defines the nouns and boundaries used by the Prisma CLI. It is the
source of truth for what the CLI means by workspace, project, branch, app,
deployment, database, and environment variables.

## North Star Hierarchy

The Prisma CLI resolves through one hierarchy:

```text
workspace -> project -> branch -> { app, database, bucket }
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
- `.prisma/local.json` is a gitignored local pin/cache for Workspace and Project IDs; it is not a declarative repo config file. When a `prisma.compute.ts` is discovered (nearest config from the invocation directory up to the repository or workspace root), the pin and the CLI state cache (`.prisma/cli/state.json`) are read and written in the config file's directory; without a config they stay in the invocation directory
- `prisma.compute.ts` is a committed deploy-defaults file; it must not contain Workspace, Project, Branch, env-secret, or credential resolution state
- `init` is the only command that writes `prisma.compute.ts`, and it never overwrites an existing one; deploy reads the config but never writes it
- Project setup is explicit: users choose an existing Project or explicitly create a new one before remote work starts
- `app deploy` may orchestrate Project setup, but it must not silently choose or create Project scope
- everything under a project happens in a branch
- `project rename` mutates only the remote Project name; pins bind by id and stay valid
- `project remove` and `project transfer` take an explicit positional Project target and exact id confirmation with `--confirm <project-id>`; they never default to the directory's bound Project and `--yes` is not sufficient
- removal is permanent and takes the Project's databases with it; transfer moves ownership to another workspace without changing resource ids
- when a destructive Project command invalidates this directory's local pin, the CLI cleans the pin up (clear on remove; rewrite or clear on transfer) and reports it

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
- app region is set at app creation time; `prisma.compute.ts` can provide the new-app default, but deploys to existing apps do not move them between regions
- app build settings live in the `build` block of `prisma.compute.ts` (`command`, `outputDirectory`, `entrypoint`); `prisma.app.json` is legacy and no longer read

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

The `env` word is reserved for environment-variable ergonomics. The current
top-level target-context group is `branch`, not `env`.

### Object Store and Bucket

`bucket` is a branch-scoped object-store resource backed by Tigris.

A bucket is created inside a project and may be scoped to a branch. Access to
its contents is controlled by access keys. Each access key has a role (`read`
or `read_write`) and is issued as a one-time secret: the secret access key is
returned only when the key is created and cannot be retrieved again.

The `bucket key` subgroup manages access keys for a bucket. Its secret-reveal
behavior mirrors `database connection create`: the one-time credential is
written to stdout as a four-line S3-compatible env block, and human metadata
goes to stderr.

Rules:

- `bucket` is the canonical public group; Public Beta does not add public
  `storage` or `object-store` aliases
- `bucket create` provisions the bucket; `--branch <git-name>` scopes it to
  that branch
- `bucket key create` returns the secret access key exactly once, as an env
  block on stdout: `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET`
- `bucket list` and `bucket key list` never print or return secret values
- `bucket delete` cascades: all stored objects are removed and all access
  keys are revoked before the bucket is destroyed; the command requires
  `--confirm <bucket-id>` matching the positional argument to prevent
  accidental data loss

The beta package exposes:

- `bucket list`
- `bucket create`
- `bucket delete <bucketId>`
- `bucket key list <bucketId>`
- `bucket key create <bucketId>`
- `bucket key delete <bucketId> <keyId>`

### Schema and Database

`schema` stays a local code artifact. `database` stays a branch-bound remote
resource.

The beta package exposes `database` as the canonical database management group.
It manages Prisma Postgres database metadata, usage, backups, and one-time-view
connection strings:

- `database list`
- `database show <database>`
- `database create <name>`
- `database usage <database>`
- `database restore <database>`
- `database remove <database>`
- `database backup list <database>`
- `database connection list <database>`
- `database connection create <database>`
- `database connection rotate <connection>`
- `database connection remove <connection>`

The `database connection` and `database backup` subgroups are nested because
connections and backups exist only for databases. They follow the same
parent-noun/subordinate-noun/action shape as `project env <action>`. There is
no `database connection show` command: connection strings are secrets and the
platform returns them only from create and rotate operations.

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
- database restore and connection rotation are equally destructive (restore
  overwrites the target's data; rotation revokes the previous credentials) and
  require the same exact id confirmation with `--confirm <id>`
- backups are platform-created; the CLI lists them and restores from them but
  never creates or deletes them in the current slice
- `database usage` and `database backup list` are read-only and never print
  secret values
- preview Branch setup writes branch-scoped `DATABASE_URL` and `DIRECT_URL` overrides, not separate app bindings
- first production deploy setup writes production `DATABASE_URL` and `DIRECT_URL` env vars before the App has a live deployment
- database setup never overwrites an existing branch-scoped `DATABASE_URL`
- production setup treats existing production `DATABASE_URL` or `DIRECT_URL` as BYO DB intent and leaves env vars unchanged
- the CLI provisions the database and wires its env vars; it never runs schema, migration, or generate commands. A detected local Prisma schema source feeds only the suggested follow-up command the user runs themselves; the CLI does not clone or infer schema from another database
- when detecting that local schema source for the suggestion, a Prisma Next config (`prisma-next.config.*`) is preferred over `schema.prisma`
- a known non-Postgres Prisma source is treated as unsupported: it does not trigger automatic database prompting, and explicit `--db` is rejected
- later production database configuration is managed through explicit environment-variable commands

## Relationships

```text
workspace -> project
project -> branch
branch -> app*
branch -> database*
branch -> bucket*
app -> deployment*
bucket -> bucket_key*
```

Long-term, branch is where app, database, and bucket relationships meet.

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
