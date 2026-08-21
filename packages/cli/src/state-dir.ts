import path from "node:path";

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

  return path.join(inputs.cwd, DEFAULT_STATE_DIR_NAME);
}
