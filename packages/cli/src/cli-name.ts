/**
 * The CLI's user-facing identity, in one place. The npm package is
 * "@prisma/cli" but the binary on PATH is "prisma-cli" (the S1
 * convention) — every user-facing command string and notice consumes
 * this constant rather than restating the name.
 */
export const CLI_NAME = "prisma-cli";

/** The CLI docs page (also the update-check fallback instruction URL). */
export const CLI_DOCS_URL = "https://www.prisma.io/docs/orm/tools/prisma-cli";
