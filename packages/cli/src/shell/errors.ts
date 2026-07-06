import type { NextAction } from "./next-actions";

export type ErrorDomain =
  | "cli"
  | "auth"
  | "project"
  | "branch"
  | "app"
  | "database"
  | "github";
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
  nextActions?: NextAction[];
  humanLines?: string[];
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
  readonly nextActions: NextAction[];
  readonly humanLines: string[] | null;

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
    this.nextActions = options.nextActions ?? [];
    this.humanLines =
      options.humanLines && options.humanLines.length > 0
        ? [...options.humanLines]
        : null;
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

export function isUsageError(
  error: unknown,
  summary?: string,
): error is CliError {
  return (
    isErrorRecord(error) &&
    error.code === "USAGE_ERROR" &&
    (summary === undefined || error.summary === summary)
  );
}

function isErrorRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === "object" && error !== null;
}

export function authRequiredError(
  nextSteps: string[] = ["prisma-cli auth login"],
  options: { debug?: string | null } = {},
): CliError {
  return new CliError({
    code: "AUTH_REQUIRED",
    domain: "auth",
    summary: "Authentication required",
    why: "This command needs an authenticated session.",
    fix: "Run prisma-cli auth login, or rerun the command in a TTY to sign in interactively.",
    debug: options.debug,
    exitCode: 1,
    nextSteps,
  });
}

export function authConfigInvalidError(message: string): CliError {
  return new CliError({
    code: "AUTH_CONFIG_INVALID",
    domain: "auth",
    summary: "Authentication configuration is invalid",
    why: message,
    fix: "Provide a valid PRISMA_SERVICE_TOKEN value, or unset the variable to use local OAuth login.",
    exitCode: 1,
    nextSteps: ["prisma-cli auth login"],
  });
}

export function commandCanceledError(): CliError {
  return new CliError({
    code: "COMMAND_CANCELED",
    domain: "cli",
    summary: "Command canceled",
    why: null,
    fix: null,
    exitCode: 130,
    humanLines: ["Command canceled [COMMAND_CANCELED]"],
  });
}

export function workspaceRequiredError(): CliError {
  return usageError(
    "Workspace required",
    "This command needs an active workspace, but the authenticated session does not have one.",
    "Run prisma-cli auth login and choose a workspace.",
    ["prisma-cli auth login"],
    "auth",
  );
}

export function workspaceSwitchUnavailableError(): CliError {
  return new CliError({
    code: "WORKSPACE_SWITCH_UNAVAILABLE",
    domain: "auth",
    summary: "Workspace switching is unavailable",
    why: "PRISMA_SERVICE_TOKEN is set, so authenticated commands use that token instead of local OAuth workspaces.",
    fix: "Unset PRISMA_SERVICE_TOKEN to switch between local OAuth workspaces, or use a token for the workspace you want.",
    exitCode: 1,
    nextSteps: ["unset PRISMA_SERVICE_TOKEN", "prisma-cli auth workspace list"],
  });
}

export function workspaceNotAuthenticatedError(workspaceRef: string): CliError {
  return new CliError({
    code: "WORKSPACE_NOT_AUTHENTICATED",
    domain: "auth",
    summary: "Workspace is not authenticated",
    why: `No stored OAuth session matched "${workspaceRef}".`,
    fix: "Run prisma-cli auth login and authorize that workspace, then switch to it.",
    meta: {
      workspaceRef,
    },
    exitCode: 1,
    nextSteps: ["prisma-cli auth workspace list", "prisma-cli auth login"],
  });
}

export function workspaceAmbiguousError(
  workspaceRef: string,
  matches: Array<{ id: string; name: string; credentialWorkspaceId: string }>,
): CliError {
  return new CliError({
    code: "WORKSPACE_AMBIGUOUS",
    domain: "auth",
    summary: "Workspace name is ambiguous",
    why: `Multiple authenticated workspaces matched "${workspaceRef}".`,
    fix: "Run prisma-cli auth workspace list and switch by workspace id.",
    meta: {
      workspaceRef,
      matches,
    },
    exitCode: 2,
    nextSteps: ["prisma-cli auth workspace list"],
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
