import { resolvePrismaCliPackageCommand } from "../lib/agent/cli-command";
import {
  PRISMA_AGENT_INSTALL_ARGS,
  PRISMA_COMPUTE_AGENT_SKILL,
} from "../lib/agent/constants";
import {
  readPrismaAgentSetupStatus,
  shouldOfferPrismaAgentSetup,
} from "../lib/agent/setup-status";
import { confirmPrompt } from "../shell/prompt";
import { type CommandContext, canPrompt } from "../shell/runtime";
import { renderSummaryLine } from "../shell/ui";
import { runAgentInstall } from "./agent";

/**
 * One-time interactive offer to install the Prisma Compute skill for the
 * project. Shared by the commands that establish a project setup (init,
 * deploy); the answer is remembered, so whichever command runs first asks.
 * Returns warnings; a failed install must not fail the calling command.
 */
export async function maybePromptForAgentSetup(
  context: CommandContext,
  projectDir: string,
): Promise<string[]> {
  // canPrompt covers json/CI/non-TTY/--no-interactive; quiet and yes runs
  // must also stay prompt-free even on a TTY.
  if (!canPrompt(context) || context.flags.yes || context.flags.quiet) {
    return [];
  }

  const status = await readPrismaAgentSetupStatus({
    cwd: projectDir,
    stateStore: context.stateStore,
    signal: context.runtime.signal,
    requiredSkill: PRISMA_COMPUTE_AGENT_SKILL,
  });
  if (!shouldOfferPrismaAgentSetup(status)) {
    return [];
  }

  const shouldInstall = await confirmPrompt({
    input: context.runtime.stdin,
    output: context.runtime.stderr,
    signal: context.runtime.signal,
    message: "Install the Prisma Compute skill for this project?",
    initialValue: true,
  });

  if (!shouldInstall) {
    await context.stateStore.setAgentSetupPromptDismissedAt(
      new Date().toISOString(),
    );
    return [];
  }

  try {
    await runAgentInstall(
      context,
      { skill: [PRISMA_COMPUTE_AGENT_SKILL] },
      "install",
      { cwd: projectDir },
    );
    if (!context.flags.quiet && !context.flags.json) {
      context.output.stderr.write(
        `${renderSummaryLine(context.ui, "success", "Installed the Prisma Compute skill for this project.")}\n\n`,
      );
    }
    return [];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Prisma skill install failed.";
    if (!context.flags.quiet && !context.flags.json) {
      context.output.stderr.write(
        `${renderSummaryLine(context.ui, "warning", `Skipped Prisma skill install: ${message}`)}\n\n`,
      );
    }
    const retryCommand = await resolvePrismaCliPackageCommand({
      cwd: projectDir,
      signal: context.runtime.signal,
      args: [
        ...PRISMA_AGENT_INSTALL_ARGS,
        "--skill",
        PRISMA_COMPUTE_AGENT_SKILL,
      ],
    });
    return [
      `The Prisma Compute skill was not installed. Run ${retryCommand} to try again.`,
    ];
  }
}
