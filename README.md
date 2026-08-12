# Prisma CLI

Beta of the unified Prisma CLI.

This repository contains the unified Prisma command-line experience. The current
implementation focuses on app deployment workflows while preserving the
long-term command model for Prisma projects, branches, schemas, databases, and
apps.

Official beta releases use the primary `@prisma/cli` package line. The package
exposes a `prisma-cli` binary so it can coexist with the existing `prisma`
executable.

## Install

```bash
pnpm add -D @prisma/cli
pnpm prisma-cli --help
```

Example workflow:

```bash
pnpm prisma-cli auth login
pnpm prisma-cli app deploy --env DATABASE_URL=postgresql://example
pnpm prisma-cli project env add --file .env --role preview
pnpm prisma-cli project env list --role preview
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

- Node.js 24 or newer
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

Inspect the npm package locally without publishing:

```bash
pnpm --filter @prisma/cli pack --dry-run
```

## Command Model

The CLI groups commands by developer workflow:

- `auth`
- `project`
- `git`
- `branch`
- `database`
- `bucket`
- `app`

The canonical command shape is:

```text
prisma <group> <action>
```

The beta package includes app build, run, deploy, environment-variable,
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

The npm package README lives at `packages/cli/README.md`.

## Community

Issues and feedback are welcome while the CLI is in public beta. Pull
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

Publishing happens through the `Publish to npm` GitHub Actions workflow. Do not
publish from a local checkout unless the release owner explicitly asks you to do
so. The full policy and procedure live in `docs/oss/versioning.md`.

The committed root `package.json` version (mirrored across the workspace in
lockstep) is the release source of truth. The workflow publishes
`@prisma/cli-engine` and then `@prisma/cli`.

Release channels:

- `latest`: releases on the Prisma 8 RC line (`8.0.0-rc.N`). A merged
  `chore(release)` PR that bumps the root version (via `pnpm bump-version`)
  publishes automatically; `workflow_dispatch` is the manual escape hatch and
  the dry-run path.
- `dev`: latest successful `main` build. Every push to `main` that does not
  change the root version publishes `<base>-dev.N` under the `dev` dist-tag.
  Commit traceability comes from npm provenance and the GitHub Actions run.
- PR preview packages: trusted same-repo pull requests get an installable
  pkg.pr.new comment for the exact commit. Fork PRs do not publish preview
  packages automatically. Preview publishing is best-effort and requires the
  pkg.pr.new GitHub App to be installed for this repository. Once that app is
  installed, set the repository variable `CLI_PR_PREVIEW_REQUIRED=true` to make
  preview publishing failures block CI.

For a release: run `pnpm bump-version` on a branch, commit, open the release
PR, and merge it — the merge is the publish trigger (`docs/oss/versioning.md`
has the full procedure).

If a release workflow fails after the npm publish step, check npm before
rerunning. The package version may already be published even if the GitHub
Release creation failed.
