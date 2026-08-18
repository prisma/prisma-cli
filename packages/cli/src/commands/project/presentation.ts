/** Presentation helpers shared by the `project *` commands. */
import type { Presentations } from "@prisma/cli-engine";
import type { Diagnostic, NextAction } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { NextAction as LegacyNextAction } from "../../next-actions";
import { serializeProjectSetup } from "../../presenters/project";
import type { ProjectSetupResult } from "../../types/project";
import { portCommandString } from "./errors";

/** Deploys come from pushing a connected repository, so the step after
 *  creating or linking a Project is connecting one. */
export const CONNECT_REPO_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: `${CLI_NAME} git connect`,
  command: `${CLI_NAME} git connect`,
};

/** The legacy local-pin warnings of `project remove` / `project
 *  transfer`: the operation succeeded, so they are warn diagnostics
 *  under the pinned local-state code, never errors. */
export function localPinDiagnostics(warnings: readonly string[]): Diagnostic[] {
  return warnings.map((warning) => ({
    code: "PROJECT.LOCAL_STATE_WRITE_FAILED" as const,
    severity: "warn" as const,
    summary: warning,
    nextActions: [],
  }));
}

/** The legacy NextAction shape minus its `journey` field, which the engine
 *  protocol does not carry. */
export function toNextActions(
  actions: readonly LegacyNextAction[],
): NextAction[] {
  return actions.map((action) => ({
    kind: action.kind,
    label: action.label,
    ...(action.command ? { command: portCommandString(action.command) } : {}),
    ...(action.commands
      ? { commands: action.commands.map(portCommandString) }
      : {}),
    ...(action.reason ? { reason: action.reason } : {}),
  }));
}

export function setupPresentations(result: ProjectSetupResult): Presentations {
  return {
    stdout: () => [],
    human: () => [
      ...(result.action === "created"
        ? [
            {
              kind: "summary" as const,
              status: "ok" as const,
              text: `Created Project "${result.project.name}"`,
            },
          ]
        : []),
      {
        kind: "summary",
        status: "ok",
        text: `Linked "${result.directory}" to Project "${result.project.name}"`,
      },
      {
        kind: "summary",
        status: "info",
        text: `Saved ${result.localPin.path}`,
      },
    ],
    json: () => serializeProjectSetup(result),
    next: () => [CONNECT_REPO_NEXT_ACTION],
  };
}
