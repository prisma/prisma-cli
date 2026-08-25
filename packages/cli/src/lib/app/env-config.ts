import { envUsageError } from "./env-errors";

export type EnvVarRole = "production" | "preview";

export type EnvScope =
  | { kind: "role"; role: EnvVarRole }
  | { kind: "branch"; branchName: string };

export interface ScopeFlagInput {
  roleName?: string;
  branchName?: string;
}

export interface ScopeOptions {
  requireExplicit: boolean;
  command: "add" | "update" | "delete" | "list";
}

const VALID_ROLES: ReadonlySet<string> = new Set(["production", "preview"]);

function positionalHint(command: ScopeOptions["command"]): string {
  if (command === "add" || command === "update") return "KEY=value ";
  if (command === "delete") return "KEY ";
  return "";
}

export function resolveEnvScope(
  flags: ScopeFlagInput,
  options: ScopeOptions,
): EnvScope | null {
  if (flags.roleName && flags.branchName) {
    throw envUsageError(
      `prisma project env ${options.command} accepts either --role or --branch`,
      "--role targets a project-level config map; --branch targets a preview branch override.",
      "Pass exactly one scope flag.",
      [
        `prisma project env ${options.command} ${positionalHint(options.command)}--role preview`,
        `prisma project env ${options.command} ${positionalHint(options.command)}--branch feature/foo`,
      ],
    );
  }

  if (flags.roleName) {
    if (!VALID_ROLES.has(flags.roleName)) {
      throw envUsageError(
        `Unknown role "${flags.roleName}"`,
        "--role accepts production or preview.",
        "Pass --role production or --role preview.",
        [
          `prisma project env ${options.command} --role production`,
          `prisma project env ${options.command} --role preview`,
        ],
      );
    }

    return { kind: "role", role: flags.roleName as EnvVarRole };
  }

  if (flags.branchName) {
    return { kind: "branch", branchName: flags.branchName };
  }

  if (options.requireExplicit) {
    const positional = positionalHint(options.command);
    throw envUsageError(
      `prisma project env ${options.command} requires --role or --branch`,
      "Writing without an explicit scope is rejected so the command never silently targets production.",
      "Pass --role production, --role preview, or --branch <git-name>.",
      [
        `prisma project env ${options.command} ${positional}--role production`,
        `prisma project env ${options.command} ${positional}--role preview`,
        `prisma project env ${options.command} ${positional}--branch feature/foo`,
      ],
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
    throw envUsageError(
      `prisma project env ${command} requires KEY=VALUE`,
      "No KEY=VALUE positional argument was supplied.",
      "Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx.",
      [
        `prisma project env ${command} STRIPE_KEY=sk_test_xxx --role production`,
      ],
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

      throw envUsageError(
        `Value for "${raw}" was not provided`,
        `No KEY=VALUE assignment was supplied, and ${raw} is not set in the current environment.`,
        "Pass KEY=VALUE or export the variable before running the command.",
        [
          `prisma project env ${command} ${raw}=value --role production`,
          `${raw}=value prisma project env ${command} ${raw} --role production`,
        ],
      );
    }

    throw envUsageError(
      `KEY=VALUE argument is missing the = separator`,
      `"${raw}" does not contain an = character.`,
      "Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx.",
      [
        `prisma project env ${command} STRIPE_KEY=sk_test_xxx --role production`,
      ],
    );
  }

  const key = raw.slice(0, separatorIndex);
  const value = raw.slice(separatorIndex + 1);

  validateKey(key, command);

  if (value.length === 0) {
    throw envUsageError(
      `KEY=VALUE argument has an empty value`,
      `"${raw}" has an empty value after the = separator.`,
      `Pass a non-empty value, or use prisma project env delete to delete a variable.`,
      [`prisma project env ${command} ${key}=value --role production`],
    );
  }

  return { key, value };
}

const KEY_SHAPE = /^[A-Z_][A-Z0-9_]*$/;

export function validateKey(key: string, command: "add" | "update"): void {
  if (key.length === 0) {
    throw envUsageError(
      `Variable key cannot be empty`,
      "An empty key was passed.",
      "Pass an env-var key, e.g. STRIPE_KEY.",
      [`prisma project env ${command} STRIPE_KEY=value --role production`],
    );
  }

  if (key.length > 256) {
    throw envUsageError(
      `Variable key "${key}" exceeds the 256-character limit`,
      "Env-var keys are capped at 256 characters by the platform.",
      "Use a shorter key.",
    );
  }

  if (!KEY_SHAPE.test(key)) {
    throw envUsageError(
      `Variable key "${key}" must match the POSIX env-var shape`,
      "Keys must start with an uppercase letter or underscore and contain only uppercase letters, digits, and underscores.",
      "Rename the key to match [A-Z_][A-Z0-9_]*.",
      [`prisma project env ${command} STRIPE_KEY=value --role production`],
    );
  }
}

export function formatScopeLabel(scope: EnvScope): string {
  if (scope.kind === "role") {
    return scope.role;
  }
  return `branch:${scope.branchName}`;
}
