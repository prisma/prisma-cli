import { usageError } from "../../shell/errors";

export type EnvVarClass = "production" | "preview";

export type EnvScope =
  | { kind: "class"; class: EnvVarClass }
  | { kind: "branch"; name: string };

export interface ScopeFlagInput {
  className?: string;
  branchName?: string;
}

export interface ScopeOptions {
  /**
   * `set` and `unset` require an explicit scope (--class XOR --branch); writing
   * with no flag would silently target production. `list` and `diff` allow
   * neither (we infer or default).
   */
  requireExplicit: boolean;
  /**
   * `production` is a project-template; an override against the default
   * branch would be rejected by the database CHECK constraint, so we reject
   * it client-side too with a clearer error.
   */
  command: "set" | "unset" | "list" | "diff";
}

const VALID_CLASSES: ReadonlySet<string> = new Set(["production", "preview"]);

/**
 * Resolves the scope flags into a single {@link EnvScope}. Mirrors the FR21
 * rules: `--class` and `--branch` are mutually exclusive; `set`/`unset`
 * additionally require one of them so the CLI never silently writes to
 * production.
 */
export function resolveEnvScope(
  flags: ScopeFlagInput,
  options: ScopeOptions,
): EnvScope | null {
  if (flags.className && flags.branchName) {
    throw usageError(
      "--class and --branch are mutually exclusive",
      "Pass either --class to target a project template or --branch to target a branch override, but not both.",
      "Choose one scope and rerun the command.",
      [
        `prisma app env ${options.command} --class production`,
        `prisma app env ${options.command} --branch feature-auth`,
      ],
      "app",
    );
  }

  if (flags.className) {
    if (!VALID_CLASSES.has(flags.className)) {
      throw usageError(
        `Unknown class "${flags.className}"`,
        "--class accepts production or preview.",
        "Pass --class production or --class preview.",
        [
          `prisma app env ${options.command} --class production`,
          `prisma app env ${options.command} --class preview`,
        ],
        "app",
      );
    }

    return { kind: "class", class: flags.className as EnvVarClass };
  }

  if (flags.branchName) {
    const trimmed = flags.branchName.trim();
    if (trimmed.length === 0) {
      throw usageError(
        "--branch requires a branch name",
        "An empty value was passed to --branch.",
        "Pass a non-empty branch name, e.g. --branch feature-auth.",
        [`prisma app env ${options.command} --branch feature-auth`],
        "app",
      );
    }

    return { kind: "branch", name: trimmed };
  }

  if (options.requireExplicit) {
    throw usageError(
      `prisma app env ${options.command} requires --class or --branch`,
      "Writing without an explicit scope is rejected so the command never silently targets production.",
      "Pass --class production, --class preview, or --branch <name>.",
      [
        `prisma app env ${options.command} KEY=value --class production`,
        `prisma app env ${options.command} KEY --branch feature-auth`,
      ],
      "app",
    );
  }

  return null;
}

/**
 * Parses the `KEY=VALUE` positional argument used by `app env set`.
 *
 * Validation here is deliberately stricter than the legacy `--env`
 * collector: a single positional has to round-trip the same way the
 * Management API would tokenize it, so we reject empty values and
 * keys that don't match the POSIX env-var shape the API enforces.
 */
export function parseKeyValuePositional(
  raw: string | undefined,
  command: "set",
): { key: string; value: string } {
  if (!raw) {
    throw usageError(
      `prisma app env ${command} requires KEY=VALUE`,
      "No KEY=VALUE positional argument was supplied.",
      "Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx.",
      [`prisma app env ${command} STRIPE_KEY=sk_test_xxx --class production`],
      "app",
    );
  }

  const separatorIndex = raw.indexOf("=");
  if (separatorIndex === -1) {
    throw usageError(
      `KEY=VALUE argument is missing the = separator`,
      `"${raw}" does not contain an = character.`,
      "Pass the variable as KEY=VALUE, e.g. STRIPE_KEY=sk_test_xxx.",
      [`prisma app env ${command} STRIPE_KEY=sk_test_xxx --class production`],
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
      "Pass a non-empty value, or use prisma app env unset to remove a variable.",
      [`prisma app env ${command} ${key}=value --class production`],
      "app",
    );
  }

  return { key, value };
}

/**
 * Mirrors `EnvironmentVariableKeySchema` server-side: `[A-Z_][A-Z0-9_]*`,
 * up to 256 chars. We validate client-side too so users get a focused
 * error rather than a 422 from the API.
 */
const KEY_SHAPE = /^[A-Z_][A-Z0-9_]*$/;

export function validateKey(
  key: string,
  command: "set" | "unset",
): void {
  if (key.length === 0) {
    throw usageError(
      `Variable key cannot be empty`,
      "An empty key was passed.",
      "Pass an env-var key, e.g. STRIPE_KEY.",
      [`prisma app env ${command} STRIPE_KEY${command === "set" ? "=value" : ""} --class production`],
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
      [`prisma app env ${command} STRIPE_KEY${command === "set" ? "=value" : ""} --class production`],
      "app",
    );
  }
}

/**
 * Human-readable label for a scope, used in renderers and the SCOPE
 * column of `prisma app env list`.
 */
export function formatScopeLabel(scope: EnvScope): string {
  if (scope.kind === "class") {
    return scope.class;
  }
  return `branch:${scope.name}`;
}
