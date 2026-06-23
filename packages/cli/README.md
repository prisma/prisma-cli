<p align="center">
  <img src="https://i.imgur.com/h6UIYTu.png" alt="Prisma" width="360" />
</p>

# Prisma CLI

[![npm version](https://img.shields.io/npm/v/@prisma/cli?label=npm)](https://www.npmjs.com/package/@prisma/cli)
[![license](https://img.shields.io/npm/l/@prisma/cli)](https://github.com/prisma/prisma-cli/blob/main/LICENSE)
[![Node.js](https://img.shields.io/node/v/@prisma/cli)](https://www.npmjs.com/package/@prisma/cli)

[Quickstart](#quickstart) • [Commands](#commands) • [Beta notes](#beta-notes) • [Documentation](#documentation) • [Support](#support)

---

`@prisma/cli` is the public beta of the new CLI for the
Prisma Developer Platform.

It is the terminal surface managing your platform projects, branches, apps,
deployments, and environment variables.

The command model is under active development to include tooling for your
schema, database, migration, and broader platform workflows.

Looking for Prisma ORM commands such as `prisma generate`, `prisma migrate`, or
`prisma studio`? Use the [`prisma`](https://www.npmjs.com/package/prisma)
package.

---

## Quickstart

Install the beta package locally:

```bash
npm install --save-dev @prisma/cli
```

Run the binary exposed by this package:

```bash
npx prisma-cli --help
npx prisma-cli auth login
npx prisma-cli app deploy
```

With `pnpm`:

```bash
pnpm add -D @prisma/cli
pnpm prisma-cli auth login
pnpm prisma-cli app deploy
```

Useful next commands:

```bash
npx prisma-cli app logs
npx prisma-cli app open
npx prisma-cli project env add DATABASE_URL=postgresql://example --role preview
npx prisma-cli project env add --file .env --role preview
npx prisma-cli project env list
npx prisma-cli project env list --role preview
```

The beta package exposes `prisma-cli` so it can coexist with the existing
`prisma` executable.

---

## Commands

| Group | What it does |
| --- | --- |
| `version` | Show the installed CLI build and host environment. |
| `auth` | Log in, log out, and inspect the active Prisma account. |
| `project` | List projects, show the resolved project, and manage project environment variables. |
| `git` | Connect or disconnect a project from a GitHub repository. |
| `branch` | List Prisma branches for the resolved project. |
| `app` | Build, run, deploy, inspect, open, stream logs, promote, roll back, and remove apps. |

Common examples:

```bash
npx prisma-cli version
npx prisma-cli auth whoami
npx prisma-cli project show
npx prisma-cli branch list
npx prisma-cli app deploy --branch feat-login --framework nextjs
npx prisma-cli app promote <deployment-id>
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

- Requires Node.js 22.12 or newer.
- This is a beta package and may change quickly.
- Official beta releases publish as `@prisma/cli`.
- The package binary is `prisma-cli`, not `prisma`, during beta.
- Local project context is cached in `.prisma/local.json`, which is gitignored and not a declarative repo config file.

---

## Documentation

- [CLI docs index](https://github.com/prisma/prisma-cli/blob/main/docs/README.md)
- [Resource model](https://github.com/prisma/prisma-cli/blob/main/docs/product/resource-model.md)
- [Command principles](https://github.com/prisma/prisma-cli/blob/main/docs/product/command-principles.md)
- [Command spec](https://github.com/prisma/prisma-cli/blob/main/docs/product/command-spec.md)
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
