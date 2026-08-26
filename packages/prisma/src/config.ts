/**
 * The `prisma/config` subpath: what a user's prisma.config.ts imports.
 * Re-exported from the engine so user repos never depend on
 * @prisma/cli-engine directly.
 */
export { definePrismaConfig } from "@prisma/cli-engine";
