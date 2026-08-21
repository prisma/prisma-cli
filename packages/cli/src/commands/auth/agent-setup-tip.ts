/**
 * Port of the legacy shell's post-login agent-setup tip (the real-mode
 * path of `resolveAgentSetupTipCommand` in controllers/auth.ts). The
 * legacy --json / --quiet / stderr-TTY suppressions do not translate:
 * the engine's format selection already keeps the tip line out of json
 * output, and handlers cannot read TTY-ness or the interactive flag —
 * both recorded in the S2 parity divergence list. CI suppression is
 * kept via ctx.env.
 */
import { LocalStateStore } from "../../adapters/local-state";
import { resolvePrismaCliPackageCommand } from "../../lib/agent/cli-command";
import { PRISMA_AGENT_INSTALL_ARGS } from "../../lib/agent/constants";
import {
  isLikelyProjectDirectory,
  readPrismaAgentSetupStatus,
  shouldOfferPrismaAgentSetup,
} from "../../lib/agent/setup-status";
import { resolveStateDir } from "../../state-dir";

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

  if (!(await isLikelyProjectDirectory({ cwd: ctx.cwd, signal: ctx.signal }))) {
    return null;
  }

  const stateDir = await resolveStateDir({
    stateDir: undefined,
    env: ctx.env,
    cwd: ctx.cwd,
    signal: ctx.signal,
  });
  const stateStore = new LocalStateStore(stateDir, ctx.signal);

  const shouldOffer = shouldOfferPrismaAgentSetup(
    await readPrismaAgentSetupStatus({
      cwd: ctx.cwd,
      stateStore,
      signal: ctx.signal,
    }),
  );
  if (!shouldOffer) {
    return null;
  }

  return await resolvePrismaCliPackageCommand({
    cwd: ctx.cwd,
    signal: ctx.signal,
    args: PRISMA_AGENT_INSTALL_ARGS,
  });
}
