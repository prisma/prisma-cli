# Contributing

Thanks for helping improve the Prisma CLI.

This repository uses document-driven development. Product behavior belongs in
`docs/product` first, and implementation should follow those docs. If behavior
is unclear, update the relevant product doc before changing the command surface.

## Setup

Requirements:

- Node.js 20 or newer
- pnpm 10

Install dependencies:

```bash
pnpm install
```

Run tests:

```bash
pnpm test
```

Build the CLI package:

```bash
pnpm build:cli
```

Run the local source CLI:

```bash
pnpm prisma --help
```

## Product Docs

The public docs index lives at `docs/README.md`.
The architecture entrypoint lives at `ARCHITECTURE.md`.

Read these before changing CLI behavior:

1. `docs/product/resource-model.md`
2. `docs/product/command-principles.md`
3. `docs/product/command-spec.md`
4. `docs/product/cli-style-guide.md`
5. `docs/product/output-conventions.md`
6. `docs/product/error-conventions.md`

The CLI must preserve the unified command model:

- Group commands by developer workflow, not product ownership.
- Do not add `orm`, `postgres`, or `compute` namespaces.
- Keep the canonical command shape as `prisma <group> <action>`.
- Keep stdout for machine-readable data and stderr for human-oriented status.

## Package Preview

Preview releases use `@prisma/cli` and expose the `prisma-cli` binary. The
release workflow is configured to publish prerelease versions under the
`preview` dist-tag until the CLI is ready for broader use.

Do not publish from a local checkout unless the release owner has explicitly
asked you to do so. Release publishing is intended to happen through the
configured GitHub Actions workflow.

## Pull Requests

The initial public contribution posture is issues first. Issues and feedback are
welcome. Pull requests should be tied to an existing issue or explicit
maintainer agreement before significant implementation work starts.

Before opening a pull request:

- Keep docs, help text, output, and tests aligned.
- Add focused tests for user-visible behavior changes.
- Run `pnpm test`.
- Run `pnpm build:cli` when touching package or build configuration.

Avoid adding undocumented aliases, shortcuts, or hidden behavior. The CLI should
have one clear happy path and stable structured output for automation.

## Community Standards

Please follow `CODE_OF_CONDUCT.md` in project spaces. Report security-sensitive
issues through `SECURITY.md`, not public GitHub issues.
