/**
 * Auth-specific error constructors, owned by the auth module. The
 * CliError base class still lives in the legacy shell (`shell/errors`);
 * it is the one remaining legacy dependency of this module and is
 * named as an S2d survivor until the operations layer throws structured
 * errors directly. The shell re-exports these constructors so legacy
 * imports keep working.
 */
import { CliError } from "../shell/errors";

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
