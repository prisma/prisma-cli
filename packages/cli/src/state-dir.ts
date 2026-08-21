import path from "node:path";
import { findComputeConfigDir } from "@prisma/compute-sdk/config";
import { findNearestPrismaDir } from "./lib/project/prisma-dir";

export const DEFAULT_STATE_DIR_NAME = path.join(".prisma", "cli");

export interface StateDirInputs {
  readonly stateDir?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

export async function resolveStateDir(
  inputs: StateDirInputs,
): Promise<string> {
  const explicitStateDir = inputs.stateDir ?? inputs.env.PRISMA_CLI_STATE_DIR;
  if (explicitStateDir) {
    return explicitStateDir;
  }

  // The nearest ancestor with a `.prisma/` directory marks the project
  // root, so the local state cache lives there instead of fragmenting
  // across invocation directories. Pure filesystem check; nothing is
  // parsed or evaluated.
  const anchor = await findNearestPrismaDir(inputs.cwd);
  if (anchor) {
    return path.join(anchor, DEFAULT_STATE_DIR_NAME);
  }

  // Compute-config fallback until that concept is deleted; this is
  // location-only discovery, the config itself is not loaded here.
  const projectDir = await findComputeConfigDir(inputs.cwd, inputs.signal);
  return path.join(projectDir ?? inputs.cwd, DEFAULT_STATE_DIR_NAME);
}
