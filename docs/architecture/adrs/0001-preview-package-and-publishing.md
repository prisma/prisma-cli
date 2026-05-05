# ADR 0001 - Preview Package And Publishing

## Status

Accepted

## Context

The Prisma CLI preview needs a public package identity that can coexist with the
existing Prisma CLI while development moves quickly. Contributors also need to
understand how release preparation works without assuming local publishing is
expected.

## Decision

Preview releases use the `@prisma/cli` package name and the `preview` npm
dist-tag. The package exposes a `prisma-cli` binary so it can coexist with the
existing `prisma` executable.

Release preparation is staged through the repository scripts and the manual
GitHub Actions release workflow. The publish workflow is prepared for npm
trusted publishing with provenance and publishes with:

```bash
npm publish --access public --tag preview --provenance
```

Local development should build and stage the package, but should not publish it.

## Consequences

- Public docs should refer to `@prisma/cli@preview` for preview package usage.
- Project scripts may map `prisma` to `prisma-cli` when testing the future
  command shape locally.
- The npm package should contain only the staged package files: built `dist`,
  package README, license, and package manifest.
- Publishing remains manual and gated until the release owner runs the workflow.
