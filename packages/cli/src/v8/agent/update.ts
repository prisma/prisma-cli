import { defineCommand } from "@prisma/cli-engine";
import { agentInstallFlags, runAgentSkillsInstall } from "./install";

export const agentUpdateCommand = defineCommand({
  help: {
    summary: "Refresh Prisma skills for AI coding agents",
    examples: [
      "agent update",
      "agent update --agent codex",
      "agent update --all-agents",
    ],
  },
  args: { flags: agentInstallFlags },
  handler: async (args, ctx) =>
    runAgentSkillsInstall(args.flags, ctx, "update"),
});
