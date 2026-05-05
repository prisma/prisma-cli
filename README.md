# Prisma CLI

Preview of the unified Prisma CLI.

This repository contains the unified Prisma command-line experience. The current
implementation focuses on app deployment workflows while preserving the
long-term command model for Prisma projects, branches, schemas, databases, and
apps.

Preview releases use `@prisma/cli` under the `preview` dist-tag during early
development. The package exposes a `prisma-cli` binary so it can coexist with
the existing `prisma` executable.

## Install

```bash
pnpm add -D @prisma/cli@preview
pnpm prisma-cli --help
```

Example workflow:

```bash
pnpm prisma-cli auth login
pnpm prisma-cli app deploy --env DATABASE_URL=postgresql://example
pnpm prisma-cli app list-env
```

If you want local project scripts that look like the future command shape, add:

```json
{
  "scripts": {
    "prisma": "prisma-cli"
  }
}
```

Then run:

```bash
pnpm prisma app deploy
```

## Local Development

Requirements:

- Node.js 20+
- pnpm 10+

Install dependencies:

```bash
pnpm install
```

Run the source CLI:

```bash
pnpm prisma --help
```

Run tests:

```bash
pnpm test
```

Build the package:

```bash
pnpm build:cli
```

Stage the npm package locally without publishing:

```bash
pnpm build:cli
pnpm prepare:cli-publish
```

## Command Model

The CLI groups commands by developer workflow:

- `auth`
- `project`
- `branch`
- `app`

The canonical command shape is:

```text
prisma <group> <action>
```

The preview package includes app build, run, deploy, environment-variable,
deployment inspection, promotion, rollback, and removal commands. The product
model intentionally keeps room for future schema, database, and migration
workflows without introducing product-specific namespaces.

## Documentation

The public docs start at `docs/README.md`.

Product behavior is defined in `docs/product`.

Start here when changing command behavior:

1. `docs/product/resource-model.md`
2. `docs/product/command-principles.md`
3. `docs/product/command-spec.md`
4. `docs/product/cli-style-guide.md`
5. `docs/product/output-conventions.md`
6. `docs/product/error-conventions.md`

See `CONTRIBUTING.md` for local development and contribution guidance.
See `ARCHITECTURE.md` for the short architecture entrypoint.

## Community

Issues and feedback are welcome while the CLI is in public preview. Pull
requests should be tied to an existing issue or maintainer agreement so product
behavior, docs, and tests stay aligned.

Please follow `CODE_OF_CONDUCT.md` in project spaces. Security reports should
use `SECURITY.md`, not public issues.

## Examples

Manual smoke apps live in:

- `examples/hello-world`
- `examples/next-smoke`

They are intentionally not part of the root pnpm workspace. Install dependencies
inside an example only when you want to run manual end-to-end checks.

## Publishing

Publishing is intentionally manual and gated through GitHub Actions.

The prerelease line uses `3.0.0-alpha.N`. The release workflow is configured to
publish to the `preview` dist-tag. Do not publish from a local checkout unless
the release owner explicitly asks you to do so.
