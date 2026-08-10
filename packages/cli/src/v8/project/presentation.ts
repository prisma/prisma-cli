/** Presentation helpers shared by the `project *` commands. */
import type { Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { serializeProjectSetup } from "../../presenters/project";
import type { NextAction as LegacyNextAction } from "../../shell/next-actions";
import type { ProjectSetupResult } from "../../types/project";
import { portCommandString } from "./errors";

export const DEPLOY_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: `${CLI_NAME} app deploy`,
  command: `${CLI_NAME} app deploy`,
};

/** The legacy NextAction shape minus its `journey` field, which the v8
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
    human: () => [
      ...(result.action === "created"
        ? [
            {
              kind: "summary" as const,
              tone: "ok" as const,
              text: `Created Project "${result.project.name}"`,
            },
          ]
        : []),
      {
        kind: "summary",
        tone: "ok",
        text: `Linked "${result.directory}" to Project "${result.project.name}"`,
      },
      {
        kind: "summary",
        tone: "info",
        text: `Saved ${result.localPin.path}`,
      },
    ],
    json: () => serializeProjectSetup(result),
    next: () => [DEPLOY_NEXT_ACTION],
  };
}
