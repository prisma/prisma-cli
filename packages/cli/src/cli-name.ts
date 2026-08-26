/**
 * The CLI's user-facing identity, in one place: the binary on PATH is
 * `prisma`, published by the `prisma` package, and every user-facing
 * command string and notice consumes this constant rather than
 * restating the name. The `@prisma/cli` package installs the same shell
 * under the name `prisma-cli`; what a user is told to type is the
 * unified binary's name.
 */
export const CLI_NAME = "prisma";

/** The unified CLI's docs section (also the update-check fallback
 *  instruction URL). */
export const CLI_DOCS_URL = "https://www.prisma.io/docs/cli";

/**
 * Base URL for structured-error documentation links. The engine composes
 * each diagnostic's docsUrl as base + code; every code is documented at
 * this page (registry: docs/reference/error-reference.md).
 */
export const DOCS_ERRORS_BASE_URL =
  "https://www.prisma.io/docs/cli/error-reference/";
