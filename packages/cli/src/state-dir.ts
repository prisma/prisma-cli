import path from "node:path";
import { findComputeConfigDir } from "@prisma/compute-sdk/config";

export const DEFAULT_STATE_DIR_NAME = path.join(".prisma", "cli");

export interface StateDirInputs {
  readonly stateDir?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

export async function resolveStateDir(inputs: StateDirInputs): Promise<string> {
  const explicitStateDir = inputs.stateDir ?? inputs.env.PRISMA_CLI_STATE_DIR;
  if (explicitStateDir) {
    return explicitStateDir;
  }

  // The compute config marks the project root, so the local state cache lives
  // next to it instead of fragmenting across invocation directories. This is
  // location-only discovery; the config itself is not loaded here.
  const projectDir = await findComputeConfigDir(inputs.cwd, inputs.signal);
  return path.join(projectDir ?? inputs.cwd, DEFAULT_STATE_DIR_NAME);
}
