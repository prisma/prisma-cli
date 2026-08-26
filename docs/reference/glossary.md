# Glossary

This glossary keeps contributor terminology aligned across docs, help text,
output, and implementation.

## Core Terms

| Term | Meaning | Source |
| --- | --- | --- |
| Workspace | Account, membership, and billing boundary. | Resource model |
| Project | Remote Prisma resource linked to a local repo. | Resource model |
| Branch | Project-scoped isolation boundary for app and database work. | Resource model |
| Local | Local-only CLI context. It is not a branch or remote deploy target. | Resource model |
| Preview branch | Any named branch other than `production` by default. | Resource model |
| Production branch | Protected durable branch that requires explicit user intent. | Resource model |
| Durable branch | Branch with explicit recovery guarantees. | Resource model |
| App | Deployable runtime workload for a project branch. | Resource model |
| Deployment | One build-and-release instance of an app. | Resource model |
| Source revision | Code state a deployment was built from. | Resource model |
| Schema | Local data model in the codebase. Out of scope for the current beta package. | Resource model |
| Database | Branch-bound Prisma Postgres data store managed by the `database` command group. | Resource model |
| Bucket | Branch-scoped Tigris object-store resource managed by the `bucket` command group. | Resource model |
| Bucket key | One-time-credential access key for a bucket, with role `read` or `read_write`. | Resource model |
| Command group | First command segment after `prisma`, such as `auth` or `app`. | Command spec |
| Action | Operation inside a command group, such as `deploy` or `whoami`. | Command spec |
| Structured output | Explicit `--json` output intended for automation. | [Output conventions](../product/output-conventions.md) |
| Human output | Status, prompts, summaries, and decoration intended for terminal users. | [Output conventions](../product/output-conventions.md) |
| Error code | Stable machine-readable failure code. | [Error conventions](../product/error-conventions.md) |
| Beta package | Public prerelease package line for `@prisma/cli`; the RC line publishes on the `next` dist-tag (see [versioning](../oss/versioning.md)). | [ADR 0001](../architecture/adrs/0001-preview-package-and-publishing.md) |
| Dev package | Latest successful `main` build of `@prisma/cli` on the `dev` dist-tag. | [ADR 0001](../architecture/adrs/0001-preview-package-and-publishing.md) |
| PR preview package | Installable pkg.pr.new package for a trusted same-repo pull request commit. | [ADR 0001](../architecture/adrs/0001-preview-package-and-publishing.md) |

## Terminology Alignment

| Use This | Avoid This | Reason |
| --- | --- | --- |
| Project | App, site, service | A project is the remote Prisma resource linked to a repo; app is a deployable workload. |
| App | Project | App and project have different lifecycle and selection rules. |
| Branch | Legacy target wording | Branch is the project-scoped isolation boundary; `env` is reserved for environment variables. |
| Preview branch | Legacy preview target wording | Preview branch is the documented product term. |
| `@prisma/cli` | `@prisma/cli@preview` | The primary package line now resolves to the official beta CLI. |
| `@prisma/cli@dev` | Branch-specific npm tags | The dev dist-tag means latest integrated `main`; PR previews cover exact unmerged commits. |
| `prisma-cli` binary | `prisma` binary | The beta package binary coexists with the existing Prisma CLI. |
| Structured output | Agent output | JSON output is for all automation, not only agents. |
| Error code | Error message string | Automation should branch on stable codes, not prose. |
