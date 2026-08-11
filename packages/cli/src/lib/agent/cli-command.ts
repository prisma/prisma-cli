import { formatPrismaCliCommand } from "../../cli-command";
import {
  resolvePackageRunner,
  resolvePackageRunnerSync,
} from "./package-manager";

export type PrismaCliPackageCommandFormatter = (
  args: readonly string[],
) => string;

export async function resolvePrismaCliPackageCommandFormatter(options: {
  cwd: string;
  signal: AbortSignal;
}): Promise<PrismaCliPackageCommandFormatter> {
  const packageRunner = await resolvePackageRunner(options);
  return createPrismaCliPackageCommandFormatter(packageRunner);
}

export async function resolvePrismaCliPackageCommand(options: {
  cwd: string;
  signal: AbortSignal;
  args: readonly string[];
}): Promise<string> {
  const formatCommand = await resolvePrismaCliPackageCommandFormatter(options);
  return formatCommand(options.args);
}

export function resolvePrismaCliPackageCommandFormatterSync(
  cwd: string,
): PrismaCliPackageCommandFormatter {
  return createPrismaCliPackageCommandFormatter(resolvePackageRunnerSync(cwd));
}

export function resolvePrismaCliPackageCommandSync(
  cwd: string,
  args: readonly string[],
): string {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(cwd);
  return formatCommand(args);
}

function createPrismaCliPackageCommandFormatter(
  packageRunner: readonly string[],
): PrismaCliPackageCommandFormatter {
  return (args) =>
    formatPrismaCliCommand(args, {
      packageRunner,
    });
}
