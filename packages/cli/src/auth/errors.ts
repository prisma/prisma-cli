/**
 * Auth-specific error constructors, owned by the auth module. They
 * build the engine's structured errors directly: the legacy CliError
 * base class died with the commander shell, and with it the two layers
 * that used to translate these into `AUTH.*` codes.
 */
import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";

function actions(fix: string, commands: readonly string[]): NextAction[] {
  return [
    { kind: "user-choice", label: fix },
    ...commands.map((command) => ({
      kind: "run-command" as const,
      label: command,
      command,
    })),
  ];
}

export function workspaceNotAuthenticatedError(
  workspaceRef: string,
): CliStructuredError {
  return new CliStructuredError(
    "AUTH.WORKSPACE_NOT_AUTHENTICATED",
    "Workspace is not authenticated",
    {
      why: `No stored OAuth session matched "${workspaceRef}".`,
      meta: { workspaceRef },
      nextActions: actions(
        `Run ${CLI_NAME} auth login and authorize that workspace, then switch to it.`,
        [`${CLI_NAME} auth workspace list`, `${CLI_NAME} auth login`],
      ),
    },
  );
}

export function workspaceAmbiguousError(
  workspaceRef: string,
  matches: Array<{ id: string; name: string; credentialWorkspaceId: string }>,
): CliStructuredError {
  return new CliStructuredError(
    "AUTH.WORKSPACE_AMBIGUOUS",
    "Workspace name is ambiguous",
    {
      why: `Multiple authenticated workspaces matched "${workspaceRef}".`,
      meta: { workspaceRef, matches },
      nextActions: actions(
        `Run ${CLI_NAME} auth workspace list and switch by workspace id.`,
        [`${CLI_NAME} auth workspace list`],
      ),
    },
  );
}
