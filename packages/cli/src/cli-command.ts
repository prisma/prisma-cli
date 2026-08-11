export const PRISMA_CLI_PACKAGE_NAME = "@prisma/cli";
export const PRISMA_CLI_PACKAGE_SPEC = `${PRISMA_CLI_PACKAGE_NAME}@latest`;
export const DEFAULT_PRISMA_CLI_PACKAGE_RUNNER = ["npx", "-y"];
export const PRISMA_CLI_BINARY = "prisma-cli";

export type PrismaCliCommandInvocation = "binary" | "package";

export interface PrismaCliCommandFormatOptions {
  invocation?: PrismaCliCommandInvocation;
  packageRunner?: readonly string[];
}

export function formatPrismaCliCommand(
  args: readonly string[],
  options: PrismaCliCommandFormatOptions = {},
): string {
  return [...getPrismaCliCommandPrefix(options), ...args].join(" ");
}

function getPrismaCliCommandPrefix({
  invocation = "package",
  packageRunner = DEFAULT_PRISMA_CLI_PACKAGE_RUNNER,
}: PrismaCliCommandFormatOptions): string[] {
  if (invocation === "binary") {
    return [PRISMA_CLI_BINARY];
  }

  return [...packageRunner, PRISMA_CLI_PACKAGE_SPEC];
}
