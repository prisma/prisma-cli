import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { formatShellCommand } from "../../shell-command";

/**
 * The installer's own command line is the next action: legacy carried it
 * as the error's single nextStep with the fix "Run the command below to
 * retry the installer directly."
 */
export function skillsInstallFailedError(options: {
  command: readonly string[];
  exitCode: number | null;
  cause: unknown;
}): CliStructuredError {
  return new CliStructuredError(
    "AGENT.SKILLS_INSTALL_FAILED",
    "Prisma skills install failed",
    {
      why: `The skills installer exited with code ${options.exitCode ?? "unknown"}.`,
      nextActions: [
        {
          kind: "run-command",
          label: "Retry the installer directly",
          command: formatShellCommand(options.command),
        },
      ],
      cause: options.cause,
    },
  );
}
