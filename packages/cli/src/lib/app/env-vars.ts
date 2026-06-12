// biome-ignore-all lint/performance/noAwaitInLoops: Env file expansion preserves assignment order.
import { usageError } from "../../shell/errors";
import { validateKey } from "./env-config";
import { readEnvFileAssignments } from "./env-file";

type EnvAssignmentOptions = {
  commandName: "deploy";
  requireAtLeastOne?: boolean;
};

export function parseEnvAssignments(
  assignments: string[] | undefined,
  options: EnvAssignmentOptions,
): Record<string, string> {
  const values = assignments ?? [];

  if (options.requireAtLeastOne && values.length === 0) {
    throw usageError(
      "At least one environment variable is required",
      `prisma-cli app ${options.commandName} needs at least one --env NAME=VALUE flag in the current mode.`,
      `Pass one or more --env NAME=VALUE flags, for example prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example.`,
      [
        `prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example`,
      ],
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
        [
          `prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example`,
        ],
        "app",
      );
    }

    const name = assignment.slice(0, separatorIndex);
    if (name.length === 0) {
      throw usageError(
        "Environment variable name is required",
        "A provided --env flag has an empty variable name.",
        `Pass repeated --env NAME=VALUE flags, for example prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example.`,
        [
          `prisma-cli app ${options.commandName} --env DATABASE_URL=postgresql://example`,
        ],
        "app",
      );
    }
    validateEnvAssignmentName(name, options.commandName);

    if (seen.has(name)) {
      throw usageError(
        `Environment variable "${name}" was provided more than once`,
        "Each environment variable name may be set only once per command invocation.",
        `Remove the duplicate "${name}" assignment and rerun prisma-cli app ${options.commandName}.`,
        [`prisma-cli app ${options.commandName} --env ${name}=value`],
        "app",
      );
    }

    const value = assignment.slice(separatorIndex + 1);
    if (value.length === 0) {
      throw usageError(
        `Environment variable "${name}" has an empty value`,
        `A provided --env flag defines ${name} with no value.`,
        "Pass a non-empty value, or omit the key from the deploy command.",
        [`prisma-cli app ${options.commandName} --env ${name}=value`],
        "app",
      );
    }

    seen.add(name);
    parsed[name] = value;
  }

  return parsed;
}

export async function parseEnvInputs(
  cwd: string,
  inputs: string[] | undefined,
  options: EnvAssignmentOptions,
): Promise<Record<string, string>> {
  const values = inputs ?? [];
  const expandedAssignments: string[] = [];

  for (const value of values) {
    if (value.includes("=")) {
      expandedAssignments.push(value);
      continue;
    }

    const fileAssignments = await readEnvFileAssignments(
      cwd,
      value,
      options.commandName,
    );
    expandedAssignments.push(
      ...fileAssignments.map(
        (assignment) => `${assignment.key}=${assignment.value}`,
      ),
    );
  }

  return parseEnvAssignments(expandedAssignments, options);
}

function validateEnvAssignmentName(
  name: string,
  commandName: EnvAssignmentOptions["commandName"],
): void {
  try {
    validateKey(name, "add");
  } catch (error) {
    const reason =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "Invalid environment variable name.";
    throw usageError(
      `Invalid environment variable "${name}"`,
      reason,
      "Use a valid env-var name and retry the deploy.",
      [`prisma-cli app ${commandName} --env DATABASE_URL=postgresql://example`],
      "app",
    );
  }
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
