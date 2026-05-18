import { usageError } from "../../shell/errors";

export type EnvVarRole = "production" | "preview";

export type EnvScope = { kind: "role"; role: EnvVarRole };

export interface ScopeFlagInput {
  roleName?: string;
}

export interface ScopeOptions {
  requireExplicit: boolean;
  command: "add" | "update" | "rm" | "list";
}

const VALID_ROLES: ReadonlySet<string> = new Set(["production", "preview"]);

function positionalHint(command: "add" | "update" | "rm" | "list"): string {
  if (command === "add" || command === "update") return "KEY=value ";
  if (command === "rm") return "KEY ";
  return "";
}

export function resolveEnvScope(
  flags: ScopeFlagInput,
  options: ScopeOptions,
): EnvScope | null {
  if (flags.roleName) {
    if (!VALID_ROLES.has(flags.roleName)) {
      throw usageError(
        `Unknown role "${flags.roleName}"`,
        "--role accepts production or preview.",
        "Pass --role production or --role preview.",
        [
          `prisma-cli project env ${options.command} --role production`,
          `prisma-cli project env ${options.command} --role preview`,
        ],
        "app",
      );
    }

    return { kind: "role", role: flags.roleName as EnvVarRole };
  }

  if (options.requireExplicit) {
    const positional = positionalHint(options.command);
    throw usageError(
      `prisma-cli project env ${options.command} requires --role`,
      "Writing without an explicit scope is rejected so the command never silently targets production.",
      "Pass --role production or --role preview.",
      [
        `prisma-cli project env ${options.command} ${positional}--role production`,
        `prisma-cli project env ${options.command} ${positional}--role preview`,
      ],
      "app",
    );
  }

  return null;
}

export function parseKeyValuePositional(
  raw: string | undefined,
  command: "add" | "update",
  env: NodeJS.ProcessEnv = process.env,
): { key: string; value: string } {
  if (!raw) {
    throw usageError(
      `prisma-cli project env ${command} requires KEY=VALUE`,
      "No KEY=VALUE positional argument was supplied.",
      "Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx.",
      [`prisma-cli project env ${command} STRIPE_KEY=sk_test_xxx --role production`],
      "app",
    );
  }

  const separatorIndex = raw.indexOf("=");
  if (separatorIndex === -1) {
    if (KEY_SHAPE.test(raw)) {
      validateKey(raw, command);
      const value = env[raw];
      if (typeof value === "string" && value.length > 0) {
        return { key: raw, value };
      }

      throw usageError(
        `Value for "${raw}" was not provided`,
        `No KEY=VALUE assignment was supplied, and ${raw} is not set in the current environment.`,
        "Pass KEY=VALUE or export the variable before running the command.",
        [
          `prisma-cli project env ${command} ${raw}=value --role production`,
          `${raw}=value prisma-cli project env ${command} ${raw} --role production`,
        ],
        "app",
      );
    }

    throw usageError(
      `KEY=VALUE argument is missing the = separator`,
      `"${raw}" does not contain an = character.`,
      "Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx.",
      [`prisma-cli project env ${command} STRIPE_KEY=sk_test_xxx --role production`],
      "app",
    );
  }

  const key = raw.slice(0, separatorIndex);
  const value = raw.slice(separatorIndex + 1);

  validateKey(key, command);

  if (value.length === 0) {
    throw usageError(
      `KEY=VALUE argument has an empty value`,
      `"${raw}" has an empty value after the = separator.`,
      `Pass a non-empty value, or use prisma-cli project env rm to remove a variable.`,
      [`prisma-cli project env ${command} ${key}=value --role production`],
      "app",
    );
  }

  return { key, value };
}

const KEY_SHAPE = /^[A-Z_][A-Z0-9_]*$/;

export function validateKey(
  key: string,
  command: "add" | "update" | "rm",
): void {
  if (key.length === 0) {
    throw usageError(
      `Variable key cannot be empty`,
      "An empty key was passed.",
      "Pass an env-var key, e.g. STRIPE_KEY.",
      [`prisma-cli project env ${command} STRIPE_KEY${command === "rm" ? "" : "=value"} --role production`],
      "app",
    );
  }

  if (key.length > 256) {
    throw usageError(
      `Variable key "${key}" exceeds the 256-character limit`,
      "Env-var keys are capped at 256 characters by the platform.",
      "Use a shorter key.",
      [],
      "app",
    );
  }

  if (!KEY_SHAPE.test(key)) {
    throw usageError(
      `Variable key "${key}" must match the POSIX env-var shape`,
      "Keys must start with an uppercase letter or underscore and contain only uppercase letters, digits, and underscores.",
      "Rename the key to match [A-Z_][A-Z0-9_]*.",
      [`prisma-cli project env ${command} STRIPE_KEY${command === "rm" ? "" : "=value"} --role production`],
      "app",
    );
  }
}

export function formatScopeLabel(scope: EnvScope): string {
  return scope.role;
}
