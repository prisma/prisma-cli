export type ErrorDomain = "cli" | "auth" | "project" | "branch" | "app";
export type ErrorSeverity = "error";

export interface CliErrorOptions {
  code: string;
  domain: ErrorDomain;
  summary: string;
  why: string | null;
  fix: string | null;
  debug?: string | null;
  where?: string | null;
  meta?: Record<string, unknown>;
  docsUrl?: string | null;
  exitCode?: number;
  nextSteps?: string[];
}

export class CliError extends Error {
  readonly code: string;
  readonly domain: ErrorDomain;
  readonly severity: ErrorSeverity;
  readonly summary: string;
  readonly why: string | null;
  readonly fix: string | null;
  readonly debug: string | null;
  readonly where: string | null;
  readonly meta: Record<string, unknown>;
  readonly docsUrl: string | null;
  readonly exitCode: number;
  readonly nextSteps: string[];

  constructor(options: CliErrorOptions) {
    super(options.summary);
    this.name = "CliError";
    this.code = options.code;
    this.domain = options.domain;
    this.severity = "error";
    this.summary = options.summary;
    this.why = options.why;
    this.fix = options.fix;
    this.debug = options.debug ?? null;
    this.where = options.where ?? null;
    this.meta = options.meta ?? {};
    this.docsUrl = options.docsUrl ?? null;
    this.exitCode = options.exitCode ?? 1;
    this.nextSteps = options.nextSteps ?? [];
  }
}

export function usageError(
  summary: string,
  why: string,
  fix: string,
  nextSteps: string[] = [],
  domain: ErrorDomain = "cli",
): CliError {
  return new CliError({
    code: "USAGE_ERROR",
    domain,
    summary,
    why,
    fix,
    exitCode: 2,
    nextSteps,
  });
}

export function authRequiredError(nextSteps: string[] = ["prisma auth login"]): CliError {
  return new CliError({
    code: "AUTH_REQUIRED",
    domain: "auth",
    summary: "Authentication required",
    why: "This command needs an authenticated session.",
    fix: "Run prisma auth login, or rerun the command in a TTY to sign in interactively.",
    exitCode: 1,
    nextSteps,
  });
}

export function featureUnavailableError(
  summary: string,
  why: string,
  fix: string,
  nextSteps: string[] = [],
  domain: ErrorDomain = "cli",
): CliError {
  return new CliError({
    code: "FEATURE_UNAVAILABLE",
    domain,
    summary,
    why,
    fix,
    exitCode: 1,
    nextSteps,
  });
}
