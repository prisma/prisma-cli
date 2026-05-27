import { usageError } from "../../shell/errors";

export function parseEnvAssignments(
  assignments: string[] | undefined,
  options: {
    commandName: "deploy";
    requireAtLeastOne?: boolean;
  },
): Record<string, string> {
  const values = assignments ?? [];

  if (options.requireAtLeastOne && values.length === 0) {
    throw usageError(
      "At least one environment variable is required",
      `prisma-cli app ${options.commandName} needs at least one --env NAME=VALUE flag in the current mode.`,
      `Pass one or more --env NAME=VALUE flags, for example prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example.`,
      [`prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example`],
      "app",
    );
  }

  const parsed: Record<string, string> = {};
  const seen = new Set<string>();

  for (const assignment of values) {
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex === -1) {
      throw usageError(
        "Environment variable assignment must use NAME=VALUE",
        "A provided --env flag is missing the = separator.",
        `Pass repeated --env NAME=VALUE flags, for example prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example.`,
        [`prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example`],
        "app",
      );
    }

    const name = assignment.slice(0, separatorIndex);
    if (name.length === 0) {
      throw usageError(
        "Environment variable name is required",
        "A provided --env flag has an empty variable name.",
        `Pass repeated --env NAME=VALUE flags, for example prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example.`,
        [`prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example`],
        "app",
      );
    }

    if (seen.has(name)) {
      throw usageError(
        `Environment variable "${name}" was provided more than once`,
        "Each environment variable name may be set only once per command invocation.",
        `Remove the duplicate "${name}" assignment and rerun prisma-cli app ${options.commandName}.`,
        [`prisma-cli app ${options.commandName} --env ${name}=value`],
        "app",
      );
    }

    seen.add(name);
    parsed[name] = assignment.slice(separatorIndex + 1);
  }

  return parsed;
}

export function envVarNames(
  envVars: Record<string, string | null> | undefined,
): string[] {
  if (!envVars) {
    return [];
  }

  return Object.entries(envVars)
    .filter(([, value]) => value !== null)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}
