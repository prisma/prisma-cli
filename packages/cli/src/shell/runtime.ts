import path from "node:path";

import type { Command } from "commander";

import { LocalStateStore } from "../adapters/local-state";
import { MockApi } from "../adapters/mock-api";
import type { GlobalFlags } from "./global-flags";
import { renderHelp } from "./help";
import type { CliOutput } from "./output";
import { createShellUi, type ShellUi } from "./ui";

export const DEFAULT_STATE_DIR_NAME = path.join(".prisma", "cli");

export interface CliRuntime {
  cwd: string;
  argv: string[];
  signal: AbortSignal;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
  fixturePath?: string;
  stateDir?: string;
}

export interface CommandContext {
  api: MockApi;
  stateStore: LocalStateStore;
  output: CliOutput;
  flags: GlobalFlags;
  runtime: CliRuntime;
  ui: ShellUi;
}

export function configureRuntimeCommand(
  command: Command,
  runtime: CliRuntime,
): Command {
  return command
    .helpCommand(false)
    .configureHelp({
      formatHelp: (configuredCommand) => renderHelp(configuredCommand, runtime),
    })
    .configureOutput({
      writeOut: (text) => {
        runtime.stderr.write(text);
      },
      writeErr: (text) => {
        runtime.stderr.write(text);
      },
      outputError: (text, write) => {
        write(text);
      },
    })
    .exitOverride();
}

export async function createCommandContext(
  runtime: CliRuntime,
  flags: GlobalFlags,
): Promise<CommandContext> {
  const fixturePath =
    runtime.fixturePath ?? runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
  const stateDir = resolveStateDir(runtime);

  // Load the mock API only when fixture mode is explicitly enabled.
  let loadedApi: MockApi | undefined;
  if (fixturePath) {
    loadedApi = await MockApi.load(fixturePath, runtime.signal);
  }

  return {
    get api(): MockApi {
      if (!loadedApi) {
        throw new Error(
          "context.api accessed in real mode. Set runtime.fixturePath or PRISMA_CLI_MOCK_FIXTURE_PATH to use fixture mode.",
        );
      }

      return loadedApi;
    },
    stateStore: new LocalStateStore(stateDir, runtime.signal),
    output: {
      stdout: runtime.stdout,
      stderr: runtime.stderr,
    },
    flags,
    runtime,
    ui: createShellUi(runtime, flags),
  };
}

export function resolveStateDir(runtime: CliRuntime): string {
  return (
    runtime.stateDir ??
    runtime.env.PRISMA_CLI_STATE_DIR ??
    path.join(runtime.cwd, DEFAULT_STATE_DIR_NAME)
  );
}

export function canPrompt(context: CommandContext): boolean {
  if (context.flags.json) {
    return false;
  }

  if (context.flags.interactive === false) {
    return false;
  }

  if (context.runtime.env.CI && context.flags.interactive !== true) {
    return false;
  }

  return Boolean(context.runtime.stdin.isTTY && context.runtime.stderr.isTTY);
}
