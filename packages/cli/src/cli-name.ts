/**
 * The CLI's user-facing identity, in one place: the binary on PATH is
 * `prisma`, published by the `prisma` package, and every user-facing
 * command string and notice consumes this constant rather than
 * restating the name. The `@prisma/cli` package installs the same shell
 * under the name `prisma-cli`; what a user is told to type is the
 * unified binary's name.
 */
export const CLI_NAME = "prisma";

/** The CLI docs page (also the update-check fallback instruction URL).
 *  The old /docs/orm/tools/prisma path 308-redirects to the ORM CLI
 *  reference — the wrong docs for the unified CLI — so this points at
 *  the docs root until the unified CLI has its own page. */
export const CLI_DOCS_URL = "https://www.prisma.io/docs";
