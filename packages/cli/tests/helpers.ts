import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import { runCli } from "../src/cli";
import { LocalStateStore } from "../src/adapters/local-state";
import { createCommandContext, resolveStateDir, type CliRuntime, type CommandContext } from "../src/shell/runtime";
import type { GlobalFlags } from "../src/shell/global-flags";

class CaptureStream extends Writable {
  buffer = "";
  declare isTTY?: boolean;
  declare columns?: number;
  declare rows?: number;

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.buffer += chunk.toString();
    callback();
  }
}

class CaptureInput extends PassThrough {
  declare isTTY?: boolean;
  setRawMode(_value: boolean) {
    return this;
  }
}

export async function createTempCwd(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "prisma-cli-"));
}

export async function readPrismaConfig(cwd: string): Promise<string> {
  return readFile(path.join(cwd, "prisma.config.ts"), "utf8");
}

export async function executeCli(options: {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
  stateDir?: string;
  isTTY?: boolean;
  stdinText?: string;
  preserveCI?: boolean;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  stdout.isTTY = options.isTTY ?? false;
  stderr.isTTY = options.isTTY ?? false;
  stdout.columns = 80;
  stderr.columns = 80;
  stdout.rows = 24;
  stderr.rows = 24;

  const stdin = new CaptureInput();
  stdin.isTTY = options.isTTY ?? false;
  const env = createTestEnv(options.env, options.preserveCI);
  const runtime: CliRuntime = {
    argv: options.argv,
    cwd: options.cwd,
    env,
    fixturePath: options.fixturePath,
    stateDir: options.stateDir,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
  };
  await seedRememberedProjectStateForTest(runtime);

  const cliPromise = runCli(runtime);

  void streamInput(stdin, options.stdinText);

  const exitCode = await cliPromise;

  return {
    exitCode,
    stdout: stdout.buffer,
    stderr: stderr.buffer,
  };
}

export async function createTestCommandContext(options: {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
  stateDir?: string;
  isTTY?: boolean;
  stdinText?: string;
  flags?: Partial<GlobalFlags>;
  preserveCI?: boolean;
}): Promise<{
  context: CommandContext;
  runtime: CliRuntime;
  stdout: CaptureStream;
  stderr: CaptureStream;
}> {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  stdout.isTTY = options.isTTY ?? false;
  stderr.isTTY = options.isTTY ?? false;
  stdout.columns = 80;
  stderr.columns = 80;
  stdout.rows = 24;
  stderr.rows = 24;

  const stdin = new CaptureInput();
  stdin.isTTY = options.isTTY ?? false;
  void streamInput(stdin, options.stdinText);

  const runtime: CliRuntime = {
    argv: options.argv ?? [],
    cwd: options.cwd ?? (await createTempCwd()),
    env: createTestEnv(options.env, options.preserveCI),
    fixturePath: options.fixturePath,
    stateDir: options.stateDir,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
  };

  const flags: GlobalFlags = {
    json: options.flags?.json ?? false,
    quiet: options.flags?.quiet ?? false,
    verbose: options.flags?.verbose ?? false,
    trace: options.flags?.trace ?? false,
    yes: options.flags?.yes ?? false,
    interactive: options.flags?.interactive,
    color: options.flags?.color,
  };

  return {
    context: await seedRememberedProjectForTest(await createCommandContext(runtime, flags), runtime.env),
    runtime,
    stdout,
    stderr,
  };
}

async function seedRememberedProjectForTest(
  context: CommandContext,
  env: NodeJS.ProcessEnv,
): Promise<CommandContext> {
  const projectId = env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID;
  if (!projectId) {
    return context;
  }

  await context.stateStore.setRememberedProject({
    id: projectId,
    name: env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME ?? "Acme Dashboard",
    workspaceId: env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID ?? "ws_123",
  });
  return context;
}

async function seedRememberedProjectStateForTest(runtime: CliRuntime): Promise<void> {
  const projectId = runtime.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID;
  if (!projectId) {
    return;
  }

  await new LocalStateStore(resolveStateDir(runtime)).setRememberedProject({
    id: projectId,
    name: runtime.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME ?? "Acme Dashboard",
    workspaceId: runtime.env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID ?? "ws_123",
  });
}

function createTestEnv(env: NodeJS.ProcessEnv | undefined, preserveCI = false): NodeJS.ProcessEnv {
  const next = { ...process.env, ...env };

  if (!preserveCI) {
    delete next.CI;
    delete next.GITHUB_ACTIONS;
  }

  return next;
}

async function streamInput(input: CaptureInput, text: string | undefined): Promise<void> {
  if (!text) {
    input.end();
    return;
  }

  for (const char of text) {
    input.write(char);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  input.end();
}
