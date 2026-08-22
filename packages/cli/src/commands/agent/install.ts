import type { CommandContext } from "@prisma/cli-engine";
import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { resolvePrismaCliPackageCommand } from "../../lib/agent/cli-command";
import { PRISMA_AGENT_STATUS_ARGS } from "../../lib/agent/constants";
import { installPresentations } from "./presentation";
import type { AgentInstallResult } from "./results";
import { buildSkillsInstallCommand, runSkillsInstall } from "./skills-cli";

/** `agent install` and `agent update` are one operation with two names,
 *  as in the legacy shell: same flags, same flow, different reported
 *  operation. */
export const agentInstallFlags = {
  agent: flag.repeated({
    brief: "Agent target for Prisma skills; repeat for multiple agents",
    placeholder: "agent",
  }),
  allAgents: flag.boolean({
    brief: "Install Prisma skills for every agent supported by the skills CLI",
  }),
  skill: flag.repeated({
    brief: "Prisma skill to install; repeat for multiple skills",
    placeholder: "skill",
  }),
  global: flag.boolean({
    brief: "Install skills into the user directory instead of the project",
  }),
  copy: flag.boolean({
    brief:
      "Ask the skills CLI to copy files instead of symlinking them (always on Windows)",
  }),
  dryRun: flag.boolean({
    brief: "Show the installer command without running it",
  }),
};

export interface AgentInstallFlagValues {
  readonly agent: readonly string[];
  readonly allAgents: boolean;
  readonly skill: readonly string[];
  readonly global: boolean;
  readonly copy: boolean;
  readonly dryRun: boolean;
}

export async function runAgentSkillsInstall(
  flags: AgentInstallFlagValues,
  ctx: CommandContext,
  operation: "install" | "update",
) {
  const command = await buildSkillsInstallCommand(
    ctx,
    {
      agent: flags.agent ?? [],
      skill: flags.skill ?? [],
      allAgents: flags.allAgents,
      copy: flags.copy,
      global: flags.global,
    },
    ctx.cwd,
  );

  if (!flags.dryRun) {
    await runSkillsInstall(ctx, command, ctx.cwd);
  }

  const result: AgentInstallResult = {
    operation,
    skills: {
      status: flags.dryRun ? "would-install" : "installed",
      command,
    },
  };
  const statusCommand = flags.dryRun
    ? null
    : await resolvePrismaCliPackageCommand({
        cwd: ctx.cwd,
        signal: ctx.signal,
        args: flags.global
          ? [...PRISMA_AGENT_STATUS_ARGS, "--global"]
          : PRISMA_AGENT_STATUS_ARGS,
      });

  return ok(
    ctx.present({ data: result }, installPresentations(result, statusCommand)),
  );
}

export const agentInstallCommand = defineCommand({
  help: {
    summary: "Install Prisma skills for AI coding agents",
    examples: [
      "agent install",
      "agent install --agent codex",
      "agent install --all-agents",
      "agent install --skill prisma-compute",
    ],
  },
  args: { flags: agentInstallFlags },
  handler: async (args, ctx) =>
    runAgentSkillsInstall(args.flags, ctx, "install"),
});
