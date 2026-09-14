/**
 * The structured errors the `project env` code paths raise, with the
 * registered PROJECT.* codes assigned at origin. This is the lowest
 * layer the env commands, controllers and parsers share, so the
 * parsers can raise without depending on the controllers.
 */
import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";

export function userChoice(label: string): NextAction {
  return { kind: "user-choice", label };
}

export function runCommand(command: string, reason?: string): NextAction {
  return {
    kind: "run-command",
    label: command,
    command,
    ...(reason === undefined ? {} : { reason }),
  };
}

export function envUsageError(
  summary: string,
  why: string,
  fix: string,
  commands: readonly string[] = [],
): CliStructuredError {
  return new CliStructuredError("PROJECT.USAGE_ERROR", summary, {
    why,
    nextActions: [userChoice(fix), ...commands.map((step) => runCommand(step))],
  });
}
