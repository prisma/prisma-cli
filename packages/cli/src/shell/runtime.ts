import type { Command } from "commander";
import { LocalStateStore } from "../adapters/local-state";
import { DEFAULT_STATE_DIR_NAME, resolveStateDir } from "../state-dir";
import type { GlobalFlags } from "./global-flags";
import { renderHelp } from "./help";
import type { CliOutput } from "./output";
import { createShellUi, type ShellUi } from "./ui";

// Moved to src/state-dir.ts (durable home); re-exported so legacy
// imports stay valid.
export { DEFAULT_STATE_DIR_NAME, resolveStateDir };

export interface CliRuntime {
  cwd: string;
  argv: string[];
  signal: AbortSignal;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
  stateDir?: string;
}

export interface CommandContext {
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
  const stateDir = await resolveStateDir(runtime);

  return {
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
