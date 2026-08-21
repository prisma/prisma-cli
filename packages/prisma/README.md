<p align="center">
  <img src="https://i.imgur.com/h6UIYTu.png" alt="Prisma" width="360" />
</p>

# Prisma CLI

[![npm version](https://img.shields.io/npm/v/prisma?label=npm)](https://www.npmjs.com/package/prisma)
[![license](https://img.shields.io/npm/l/prisma)](https://github.com/prisma/prisma-cli/blob/main/LICENSE)
[![Node.js](https://img.shields.io/node/v/prisma)](https://www.npmjs.com/package/prisma)

[Quickstart](#quickstart) • [Commands](#commands) • [Beta notes](#beta-notes) • [Documentation](#documentation) • [Support](#support)

---

`prisma` is the public beta of the new CLI for the
Prisma Developer Platform.

It is one binary for the ORM, Composer, and the Prisma Developer
Platform: projects, branches, services, service versions, environment
variables, and the Prisma ORM schema and migration workflow.

---

## Quickstart

Install the beta package locally:

```bash
npm install --save-dev prisma@next
```

Run the binary exposed by this package:

```bash
npx prisma --help
npx prisma auth login
npx prisma project create my-app
npx prisma git connect git@github.com:owner/repo.git
```

Deployments start from pushing the connected repository, the Console, or `prisma deploy`.

With `pnpm`:

```bash
pnpm add -D prisma@next
pnpm prisma auth login
pnpm prisma git connect
```

Useful next commands:

```bash
npx prisma service list
npx prisma service logs
npx prisma project env add DATABASE_URL=postgresql://example --role preview
npx prisma project env add --file .env --role preview
npx prisma project env list
npx prisma project env list --role preview
```

---

## Commands

| Group | What it does |
| --- | --- |
| `auth` | Log in, log out, and inspect the active Prisma account. |
| `project` | List, create, link, and manage projects and their environment variables. |
| `git` | Connect or disconnect a project from a GitHub repository; pushes deploy. |
| `branch` | List Prisma branches for the resolved project. |
| `postgres` | Create, inspect, back up, restore, and delete Prisma Postgres databases and their connections. |
| `bucket` | Create, list, and delete object-store buckets and their access keys. |
| `service` | Inspect services: versions, logs, domains, promote, roll back, delete. |
| `dev`, `deploy` | Run a Composer app locally; deploy it to the platform. |
| `contract`, `db`, `migration`, `orm init`, `lsp` | The Prisma ORM workflow. |

Common examples:

```bash
npx prisma --version
npx prisma auth whoami
npx prisma project show
npx prisma branch list
npx prisma service list
npx prisma service version promote VERSION_ID
```

### Built for humans, CI, and agents

- Human-readable output by default.
- `--json` for structured output.
- `--no-interactive` and `--yes` for automation.
- `PRISMA_SERVICE_TOKEN` for headless authenticated commands.
- Stable command groups, flags, and error codes for scripts and agents.
- Environment variable values are not printed back to the terminal.

---

## Beta notes

- Requires Node.js 22.18 or newer.
- This is a release-candidate package and may change quickly.
- The 8.0.0 release candidates publish as `prisma` on the `next` dist-tag.
- The package binary is `prisma`.
- Local project context is cached in `.prisma/local.json`, which is gitignored and not a declarative repo config file.

---

## Documentation

- [CLI docs index](https://github.com/prisma/prisma-cli/blob/main/docs/README.md)
- [Command principles](https://github.com/prisma/prisma-cli/blob/main/docs/product/command-principles.md)
- [Output conventions](https://github.com/prisma/prisma-cli/blob/main/docs/product/output-conventions.md)
- [Error conventions](https://github.com/prisma/prisma-cli/blob/main/docs/product/error-conventions.md)

## Support

Issues and feedback are welcome while the CLI is in public beta. Please use
[GitHub issues](https://github.com/prisma/prisma-cli/issues) for bug reports and
feature requests.

Security reports should follow Prisma's
[security policy](https://github.com/prisma/prisma-cli/blob/main/SECURITY.md)
and should not be filed as public issues.

## License

Apache-2.0
