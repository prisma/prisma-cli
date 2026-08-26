/**
 * The post-login skills tip. Login is the moment a developer sets a
 * project up, so it points at `skills sync` when the project's synced
 * agent skills do not match its installed Prisma packages. Silent in
 * CI, in a directory with no skill-bearing Prisma packages, when the
 * copies are current, and when the check is opted out.
 */
import { resolvePrismaCliPackageCommand } from "../../lib/agent/cli-command";
import { readSkillsStatus } from "../../lib/skills/status";
import { readProjectSkillsConfig } from "../skills/config";

const SKILLS_SYNC_ARGS = ["skills", "sync"] as const;

export interface AgentSetupTipContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}

export async function resolveAgentSetupTipCommand(
  ctx: AgentSetupTipContext,
): Promise<string | null> {
  if (ctx.env.CI) {
    return null;
  }

  // The tip resolves after the credential is stored: a project the
  // status scan or command resolver cannot read must not fail a login
  // that succeeded.
  try {
    const config = await readProjectSkillsConfig(ctx.cwd);
    if (config !== null && !config.check) {
      return null;
    }
    const status = await readSkillsStatus(ctx.cwd, {
      orphans: false,
      agents: config?.agents,
    });
    if (
      status.packages.length === 0 ||
      status.upToDate ||
      status.checkDisabled
    ) {
      return null;
    }
    return await resolvePrismaCliPackageCommand({
      cwd: ctx.cwd,
      signal: ctx.signal,
      args: SKILLS_SYNC_ARGS,
    });
  } catch {
    return null;
  }
}
