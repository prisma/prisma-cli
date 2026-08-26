# Prisma CLI Docs

This directory contains the public working docs for the Prisma CLI.

Product behavior is defined in `docs/product`. Architecture, onboarding, and
reference docs help contributors understand and change the implementation
without inventing behavior outside the product model.

## Start Here

Read these in order before changing command behavior:

1. [Command principles](product/command-principles.md)
2. [CLI style guide](product/cli-style-guide.md)
3. [Output conventions](product/output-conventions.md)
4. [Error conventions](product/error-conventions.md)

For local development, continue with:

- [Getting started](onboarding/getting-started.md)
- [Common tasks](onboarding/common-tasks.md)
- [Testing](onboarding/testing.md)

## Architecture

- [Architecture overview](architecture/overview.md)
- [Package structure](architecture/package-structure.md)
- [Architecture decisions](architecture/adrs/README.md)

## Reference

- [Glossary](reference/glossary.md)
- [Testing patterns](reference/testing-patterns.md)
- [Versioning](oss/versioning.md)

## Contribution Standard

- Update product docs before changing user-visible behavior.
- Keep nouns, verbs, help text, output, and tests aligned.
- Keep public docs focused on contribution, not internal planning.
- Do not add product-specific command namespaces such as `orm`, `postgres`, or
  `compute`.
- Keep the canonical command shape as `prisma <group> <action>`.
