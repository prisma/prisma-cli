/**
 * The one-time offer to install the Prisma Compute skill for this
 * project. A "no" is remembered in the local state store, so whichever
 * command asks first is the only one that asks. An install that fails is
 * a finding, never a failed init.
 *
 * The legacy `maybePromptForAgentSetup` calls `runAgentInstall`, which
 * takes the commander `CommandContext`; the engine cannot build one. The status
 * read, the dismissal record and the skills-CLI argv are all taken from
 * the same `src/lib/agent` modules the legacy controller uses.
 *
 * CI is checked here rather than left to the prompt surface, following
 * `commands/auth/agent-setup-tip.ts`: handlers cannot read TTY state, and an
 * unattended run that answered the offer from its default would record a
 * dismissal nobody gave.
 */
import { execa } from "execa";
import { LocalStateStore } from "../../adapters/local-state";
import { resolvePrismaCliPackageCommand } from "../../lib/agent/cli-command";
import {
  DEFAULT_PRISMA_AGENT_TARGETS,
  PRISMA_AGENT_INSTALL_ARGS,
  PRISMA_COMPUTE_AGENT_SKILL,
  PRISMA_SKILLS_SOURCE,
  SKILLS_CLI_PACKAGE,
} from "../../lib/agent/constants";
import { resolveSkillsPackageRunner } from "../../lib/agent/package-manager";
import {
  readPrismaAgentSetupStatus,
  shouldOfferPrismaAgentSetup,
} from "../../lib/agent/setup-status";
import { resolveStateDir } from "../../state-dir";
import type { InitStepContext } from "./types";

async function skillsInstallCommand(
  cwd: string,
  signal: AbortSignal,
  platform: string,
): Promise<string[]> {
  return [
    ...(await resolveSkillsPackageRunner({ cwd, signal })),
    SKILLS_CLI_PACKAGE,
    "add",
    PRISMA_SKILLS_SOURCE,
    "--skill",
    PRISMA_COMPUTE_AGENT_SKILL,
    ...DEFAULT_PRISMA_AGENT_TARGETS.flatMap((agent) => ["--agent", agent]),
    ...(platform === "win32" ? ["--copy"] : []),
    "--yes",
  ];
}

export async function maybeOfferAgentSetup(
  step: InitStepContext,
): Promise<void> {
  const ctx = step.engine;
  if (ctx.env.CI) {
    return;
  }

  const stateStore = new LocalStateStore(
    await resolveStateDir({ env: ctx.env, cwd: ctx.cwd, signal: ctx.signal }),
    ctx.signal,
  );
  const status = await readPrismaAgentSetupStatus({
    cwd: ctx.cwd,
    stateStore,
    signal: ctx.signal,
    requiredSkill: PRISMA_COMPUTE_AGENT_SKILL,
  });
  if (!shouldOfferPrismaAgentSetup(status)) {
    return;
  }

  const shouldInstall = await ctx.prompt.confirm(
    "Install the Prisma Compute skill for this project?",
    { default: false },
  );
  if (!shouldInstall) {
    await stateStore.setAgentSetupPromptDismissedAt(new Date().toISOString());
    return;
  }

  const command = await skillsInstallCommand(
    ctx.cwd,
    ctx.signal,
    ctx.host.platform,
  );
  try {
    const [executable, ...args] = command;
    await execa(executable as string, args, {
      cwd: ctx.cwd,
      env: ctx.env,
      cancelSignal: ctx.signal,
      stdin: "ignore",
    });
  } catch {
    ctx.signal.throwIfAborted();
    const retryCommand = await resolvePrismaCliPackageCommand({
      cwd: ctx.cwd,
      signal: ctx.signal,
      args: [
        ...PRISMA_AGENT_INSTALL_ARGS,
        "--skill",
        PRISMA_COMPUTE_AGENT_SKILL,
      ],
    });
    step.record({
      code: "INIT.AGENT_SETUP_FAILED",
      severity: "warn",
      summary: `The Prisma Compute skill was not installed. Run ${retryCommand} to try again.`,
      nextActions: [
        { kind: "run-command", label: retryCommand, command: retryCommand },
      ],
    });
  }
}
