import { defineCommand, flag } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { LocalStateStore } from "../../adapters/local-state";
import { resolvePrismaCliPackageCommand } from "../../lib/agent/cli-command";
import { PRISMA_AGENT_INSTALL_ARGS } from "../../lib/agent/constants";
import {
  readPrismaAgentSetupStatus,
  resolvePrismaAgentSetupCwd,
} from "../../lib/agent/setup-status";
import { formatShellCommand } from "../../shell/command-arguments";
import { resolveStateDir } from "../../state-dir";
import { statusPresentations } from "./presentation";
import type { AgentStatusResult } from "./results";
import {
  type AgentContext,
  listInstalledPrismaSkills,
  type SkillsListFailure,
} from "./skills-cli";

async function openStateStore(ctx: AgentContext): Promise<LocalStateStore> {
  const stateDir = await resolveStateDir({
    env: ctx.env,
    cwd: ctx.cwd,
    signal: ctx.signal,
  });
  return new LocalStateStore(stateDir, ctx.signal);
}

function skillsListUnavailable(
  failure: SkillsListFailure,
  scope: "project" | "global",
  skillsLockPath: string,
): Diagnostic {
  const commandText = formatShellCommand(failure.command);
  return {
    code: "AGENT.SKILLS_LIST_UNAVAILABLE",
    severity: "warn",
    summary:
      scope === "project"
        ? `Could not read installed skills with ${commandText}: ${failure.message}. Falling back to ${skillsLockPath}.`
        : `Could not read globally installed skills with ${commandText}: ${failure.message}.`,
    nextActions: [],
  };
}

export const agentStatusCommand = defineCommand({
  help: {
    summary: "Show installed Prisma skills",
    examples: ["agent status", "agent status --json", "agent status --global"],
  },
  args: {
    flags: {
      global: flag.boolean({
        brief:
          "Check globally installed Prisma skills instead of project skills",
      }),
    },
  },
  handler: async (args, ctx) => {
    const statusScope = args.flags.global ? "global" : "project";
    const cwd = await resolvePrismaAgentSetupCwd({
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    const setupStatus = await readPrismaAgentSetupStatus({
      cwd,
      stateStore: await openStateStore(ctx),
      signal: ctx.signal,
    });
    const skillsList = await listInstalledPrismaSkills(ctx, cwd, statusScope);
    const skillsInstalled =
      skillsList.status === "ok"
        ? skillsList.skills.length > 0
        : statusScope === "project" && setupStatus.skillsInstalled;

    const result: AgentStatusResult = {
      skills: skillsList.status === "ok" ? skillsList.skills : [],
      skillsListCommand: skillsList.command,
      statusScope,
      skillsLockPath: setupStatus.skillsLockPath,
      skillsLockInstalled: setupStatus.skillsInstalled,
      skillsInstalled,
      statusSource:
        skillsList.status === "ok"
          ? "skills-cli"
          : statusScope === "project"
            ? "skills-lock"
            : "unavailable",
      promptDismissedAt: setupStatus.promptDismissedAt,
    };
    const installCommand = skillsInstalled
      ? null
      : await resolvePrismaCliPackageCommand({
          cwd,
          signal: ctx.signal,
          args: args.flags.global
            ? [...PRISMA_AGENT_INSTALL_ARGS, "--global"]
            : PRISMA_AGENT_INSTALL_ARGS,
        });

    return ok(
      ctx.present(
        {
          data: result,
          diagnostics:
            skillsList.status === "ok"
              ? []
              : [
                  skillsListUnavailable(
                    skillsList,
                    statusScope,
                    setupStatus.skillsLockPath,
                  ),
                ],
        },
        statusPresentations(result, installCommand),
      ),
    );
  },
});
