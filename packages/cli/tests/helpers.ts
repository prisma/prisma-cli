import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CliRuntime, CommandContext } from "../src/controllers/context";

export async function createTempCwd(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "prisma-cli-"));
}

export async function readPrismaConfig(cwd: string): Promise<string> {
  return readFile(path.join(cwd, "prisma.config.ts"), "utf8");
}

export async function createTestCommandContext(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  preserveCI?: boolean;
}): Promise<{ context: CommandContext; runtime: CliRuntime }> {
  const runtime: CliRuntime = {
    cwd: options.cwd ?? (await createTempCwd()),
    env: createTestEnv(options.env, options.preserveCI),
    signal: new AbortController().signal,
  };

  return { context: { runtime }, runtime };
}

function createTestEnv(
  env: NodeJS.ProcessEnv | undefined,
  preserveCI = false,
): NodeJS.ProcessEnv {
  const next = { ...process.env, ...env };

  if (!preserveCI) {
    delete next.CI;
    delete next.GITHUB_ACTIONS;
  }

  return next;
}
