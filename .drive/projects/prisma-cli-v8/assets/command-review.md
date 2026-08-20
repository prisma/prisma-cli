# Prisma CLI v8 — command review

Every command the CLI mounts, for a semantic review of what each command means and how the tree is organized. Generated from the mounted command tree in `packages/cli/src/cli.ts` at `main` (8.0.0-rc.6, 2026-08-20). Flags and options are deliberately omitted. 90 commands in total.

The tree has five sources: the platform family (this repo), the Composer family (`@prisma/composer-cli`), the ORM family (`@prisma/orm-toolchain`), the engine's telemetry group, and a few local utilities with no owning package.

**The Spec column** compares each command against the original unified-CLI grammar (the consolidate-clis command surface, Layer 4). That document calls its tree "directional, not a launch checklist", so treat mismatches as discussion points, not defects:

- ✅ — matches the spec's path and meaning
- ⚠️ — in the spec, but renamed, moved, or reshaped
- ❌ — not in the spec tree (added later, or ruled interim)

A recurring ⚠️ theme: the spec's deletion verb is `delete` everywhere (it explicitly avoids `remove` as ambiguous), but the platform groups shipped `remove` where the legacy CLI used it — except `bucket delete`, which followed the spec. Worth one ruling.

## Top-level commands

| Command | Meaning | Spec |
| --- | --- | --- |
| `init` | Write a committed compute config for this app | ⚠️ spec's `init` is the single guided entry point; shipped as the compute-config wizard, with the ORM initializer split to `orm init` |
| `format` | Format your PSL contract source | ⚠️ spec: `contract format` |
| `lsp` | Start the Prisma Next language server | ❌ not in the spec tree |
| `migrate` | Apply planned migrations to advance the database | ⚠️ spec: `db migrate` |
| `feedback` | Send feedback to the Prisma CLI team | ✅ |

There is no `version` command — the engine's `--version` answers (spec listed `version` as a utility; removed by ruling 2026-08-11).

## `auth` — Manage local authentication for the CLI

| Command | Meaning | Spec |
| --- | --- | --- |
| `auth login` | Log in to your Prisma platform account | ✅ |
| `auth logout` | Clear stored authentication credentials | ✅ |
| `auth whoami` | Show the authenticated user and accessible workspace | ✅ |

### `auth workspace` — Manage local workspace sessions

| Command | Meaning | Spec |
| --- | --- | --- |
| `auth workspace list` | List your workspace sessions | ✅ |
| `auth workspace use` | Make one of your workspace sessions current | ✅ |
| `auth workspace logout` | End one workspace session | ✅ |

## `project` — Manage and inspect your Prisma projects

| Command | Meaning | Spec |
| --- | --- | --- |
| `project list` | List all projects in your workspace | ✅ |
| `project show` | Show this directory's Project binding | ✅ |
| `project create` | Create a Project and link this directory | ✅ |
| `project link` | Link this directory to a Project | ✅ |
| `project rename` | Rename the resolved Project | ✅ |
| `project remove` | Remove a Project permanently after exact id confirmation | ⚠️ spec: `project delete` |
| `project transfer` | Transfer a Project to another workspace after exact id confirmation | ✅ |

### `project env` — Manage environment variables for the active project

| Command | Meaning | Spec |
| --- | --- | --- |
| `project env add` | Create a new environment variable | ✅ |
| `project env update` | Replace an existing environment variable's value | ✅ |
| `project env list` | List environment variable metadata for a scope (no values) | ✅ |
| `project env remove` | Remove an environment variable from a scope | ⚠️ spec: `project env delete` |

## `postgres` — Manage Prisma Postgres databases for a project

| Command | Meaning | Spec |
| --- | --- | --- |
| `postgres list` | List Prisma Postgres databases for the resolved project | ✅ |
| `postgres show` | Show database metadata without secret values | ✅ |
| `postgres create` | Create a Prisma Postgres database and print its one-time connection URL | ✅ |
| `postgres usage` | Show usage metrics for a database | ✅ |
| `postgres restore` | Restore a database from a backup after exact id confirmation | ⚠️ spec: `postgres backup restore` |
| `postgres remove` | Remove a database after exact id confirmation | ⚠️ spec: `postgres delete` |

### `postgres backup` — Inspect platform-created database backups

| Command | Meaning | Spec |
| --- | --- | --- |
| `postgres backup list` | List backups for a database | ✅ |

### `postgres connection` — Manage one-time-view database connection strings

| Command | Meaning | Spec |
| --- | --- | --- |
| `postgres connection list` | List database connection metadata without secret values | ✅ |
| `postgres connection create` | Create a database connection and print its one-time connection URL | ✅ |
| `postgres connection rotate` | Rotate connection credentials and print the new one-time connection URL | ✅ |
| `postgres connection remove` | Remove a database connection after exact id confirmation | ⚠️ spec: `postgres connection delete` |

## `bucket` — Manage object-store buckets for a project

| Command | Meaning | Spec |
| --- | --- | --- |
| `bucket list` | List object-store buckets for the resolved project | ✅ |
| `bucket create` | Create an object-store bucket | ✅ |
| `bucket delete` | Delete a bucket and all its access keys | ✅ |

### `bucket key` — Manage access keys for an object-store bucket

| Command | Meaning | Spec |
| --- | --- | --- |
| `bucket key list` | List access keys for a bucket | ✅ |
| `bucket key create` | Create a bucket access key and print its one-time credentials | ✅ |
| `bucket key delete` | Revoke and delete a bucket access key | ✅ |

## `branch` — View your Platform branches

| Command | Meaning | Spec |
| --- | --- | --- |
| `branch list` | List Platform branches for the resolved project | ✅ |

## `git` — Manage Git repository connections for a project

| Command | Meaning | Spec |
| --- | --- | --- |
| `git connect` | Connect the resolved project to a GitHub repository | ✅ |
| `git disconnect` | Disconnect the GitHub repository from the resolved project | ✅ |

## `service` — Manage services and deployments for a project

| Command | Meaning | Spec |
| --- | --- | --- |
| `service list` | List the services in a project | ✅ |
| `service create` | Create a service in a project | ❌ not in the spec tree (there, a service comes into existence by deploying) |
| `service show` | Show the service and its current deployment | ✅ |
| `service open` | Open the service's live URL | ✅ |
| `service logs` | Read logs for a deployment of the service | ✅ |
| `service remove` | Remove the service from the resolved branch | ⚠️ spec: `service delete` |

### `service deployment` — Manage deployments for a service

| Command | Meaning | Spec |
| --- | --- | --- |
| `service deployment list` | List deployments for the service | ✅ |
| `service deployment show` | Show a deployment in detail | ✅ |
| `service deployment promote` | Promote a deployment to production by rebuilding with production env vars | ⚠️ spec: flat `service promote` (a Service-level traffic action) |
| `service deployment rollback` | Roll back production to a previous deployment | ⚠️ spec: flat `service rollback` |
| `service deployment start` | Start a stopped deployment | ❌ not in the spec tree |
| `service deployment stop` | Stop a running deployment | ❌ not in the spec tree |
| `service deployment delete` | Delete a deployment and the artifact it holds | ❌ not in the spec tree |

### `service domain` — Manage custom domains for a service

| Command | Meaning | Spec |
| --- | --- | --- |
| `service domain add` | Register a custom domain on the service's production branch | ✅ |
| `service domain show` | Show custom domain status and certificate details | ✅ |
| `service domain remove` | Detach a custom domain from the service | ⚠️ spec: `service domain delete` |
| `service domain retry` | Retry custom domain DNS verification and TLS provisioning | ❌ not in the spec tree |
| `service domain wait` | Wait until a custom domain is active or failed | ❌ not in the spec tree |

## `build` — Inspect builds created by a git push or Console

| Command | Meaning | Spec |
| --- | --- | --- |
| `build logs` | Stream logs for a build | ❌ no `build` group in the spec; it covers build output via `service deployment logs` ("deployment logs also cover builds triggered by Git push") |

Platform builds are their own group; there is no local build verb.

## `composer` — Run and deploy applications composed from Prisma modules

| Command | Meaning | Spec |
| --- | --- | --- |
| `composer dev` | Bring up the application whose root node is the entry's default export, entirely on this machine | ❌ |
| `composer deploy` | Deploy the application whose root node is the entry's default export | ❌ |
| `composer destroy` | Tear down the application whose root node is the entry's default export | ❌ |
| `composer log` | Tail the merged logs of the locally-running application whose root node is the entry's default export | ❌ |

The spec bans product-named groups ("there is no `prisma composer`") and points this workload at `project dev/deploy/…`. The `composer` root is ruled interim parking (operator, 2026-08-10); the final grammar stays open as TML-3189.

## `contract` — Define and emit your application data contract

| Command | Meaning | Spec |
| --- | --- | --- |
| `contract emit` | Emit your contract artifacts | ✅ |
| `contract infer` | Infer a PSL contract from the live database schema | ✅ |

## `db` — Verify, sign and update your database against the contract

| Command | Meaning | Spec |
| --- | --- | --- |
| `db init` | Bootstrap a database to match the current contract and sign it | ✅ |
| `db schema` | Inspect the live database schema | ✅ |
| `db sign` | Sign the database with your contract so you can safely run queries | ✅ |
| `db update` | Update your database schema to match your contract | ✅ |
| `db verify` | Check whether the database marker and live schema match your contract | ✅ |

Applying migrations is the top-level `migrate` (spec: `db migrate`).

## `migration` — Plan, inspect and scaffold on-disk migrations

| Command | Meaning | Spec |
| --- | --- | --- |
| `migration plan` | Plan a migration from contract changes | ✅ |
| `migration new` | Scaffold a new migration for manual authoring | ✅ |
| `migration list` | List on-disk migrations per contract space | ✅ |
| `migration show` | Display migration package contents | ✅ |
| `migration status` | Show migration path and pending status | ✅ |
| `migration log` | Show executed migration history | ✅ |
| `migration graph` | Show the migration graph topology | ✅ |
| `migration check` | Verify artifact and graph integrity | ✅ |

## `ref` — Manage named refs that point at contracts

| Command | Meaning | Spec |
| --- | --- | --- |
| `ref list` | List every named ref | ⚠️ spec: `migration ref list` ("refs stay inside the `migration` group") |
| `ref set` | Point a ref at a contract | ⚠️ spec: `migration ref set` |
| `ref delete` | Delete a ref | ⚠️ spec: `migration ref delete` |

## `orm` — Initialize a Prisma ORM project

| Command | Meaning | Spec |
| --- | --- | --- |
| `orm init` | Initialize a new Prisma Next project | ❌ not in the spec tree; ruled 2026-08-12 to resolve the two families' claim on `init` |

## `agent` — Manage Prisma skills for AI coding agents

| Command | Meaning | Spec |
| --- | --- | --- |
| `agent install` | Install Prisma skills for AI coding agents | ✅ |
| `agent update` | Refresh Prisma skills for AI coding agents | ✅ |
| `agent status` | Show installed Prisma skills | ✅ |

## `telemetry` — Inspect and change anonymous CLI telemetry

| Command | Meaning | Spec |
| --- | --- | --- |
| `telemetry status` | Show whether anonymous CLI telemetry is enabled and why | ✅ |
| `telemetry enable` | Enable anonymous CLI telemetry | ✅ |
| `telemetry disable` | Disable anonymous CLI telemetry | ✅ |

## In the spec, not shipped

For completeness of the comparison — the spec-tree commands with no shipped counterpart today:

- **Orchestration:** `project check | dev | plan | deploy | status`, `project adopt | detach`, `project unlink`
- **Branch lifecycle:** `branch create | show | delete` (spec deliberately deferred create/delete until workflow-created branches prove the need)
- **Service:** `service build | run | deploy` (ruled removals — Composer supersedes them), `service deployment logs`, `service domain list`
- **Postgres:** `postgres update`, `postgres backup create | delete` (and `restore` as a backup subcommand)
- **Bucket:** `bucket show`
- **Git:** `git status`
- **Data world:** `db query | browse | seed`, `contract validate`
- **Auth:** `auth token create | list | delete`
- **Emulators:** `emulator start | stop | status`
- **Utilities:** `version` (ruled removal; `--version` answers), `mcp`, `project env pull`
