# ADR 0001 - Package Channels And Publishing

## Status

Accepted

## Context

The new Prisma CLI needs the primary `@prisma/cli` package identity while the
team is still iterating through beta. Contributors also need clear test channels
for integrated `main` builds and unmerged trusted pull requests without assuming
local publishing is expected.

## Decision

Official beta releases use the `@prisma/cli` package name and the `latest` npm
dist-tag. The package exposes a `prisma-cli` binary so it can coexist with the
existing `prisma` executable.

The committed `packages/cli/package.json` version is a development placeholder.
Release versions are injected into the staged package by CI:

- Manual official releases compute the next `3.0.0-beta.N`, publish to
  `latest`, and create `cli-v<version>`.
- Pushes to `main` publish unique `3.0.0-dev.<run_number>.<run_attempt>`
  builds to the `dev` dist-tag. Commit traceability comes from npm provenance
  and the GitHub Actions run.
- Trusted same-repo pull requests publish installable pkg.pr.new previews for
  the exact commit. Fork pull requests do not publish preview packages
  automatically. Preview publishing is best-effort because it depends on the
  pkg.pr.new GitHub App being installed for the repository. After that app is
  installed, set the repository variable `CLI_PR_PREVIEW_REQUIRED=true` to make
  preview publishing failures block CI.

The publish workflow is prepared for npm trusted publishing with provenance.
Official releases publish with:

```bash
npm publish --access public --tag latest --provenance
```

Local development should build and stage the package, but should not publish it.

## Consequences

- Public docs should refer to `@prisma/cli` for official beta package usage.
- Team testing can use `@prisma/cli@dev` for latest integrated `main` or PR
  preview comments for exact unmerged commits.
- Project scripts may map `prisma` to `prisma-cli` when testing the future
  command shape locally.
- The npm package should contain only the staged package files: built `dist`,
  package README, license, and package manifest.
- Official publishing remains manual and gated until a maintainer runs the
  workflow.
- Release version bumps are not committed through pull requests; npm versions
  and `cli-v<version>` tags are the release record.
