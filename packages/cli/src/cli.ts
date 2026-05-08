import process from "node:process";

import { Command, CommanderError } from "commander";

import { createAppCommand } from "./commands/app";
import { createAuthCommand } from "./commands/auth";
import { createBranchCommand } from "./commands/branch";
import { createProjectCommand } from "./commands/project";
import { attachCommandDescriptor } from "./shell/command-meta";
import { addCompactGlobalFlags } from "./shell/global-flags";
import { disposePromptState } from "./shell/prompt";
import { configureRuntimeCommand, type CliRuntime } from "./shell/runtime";

export interface RunCliOptions extends Partial<CliRuntime> {
  argv?: string[];
}

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const runtime = resolveRuntime(options);
  const program = createProgram(runtime);
  process.exitCode = 0;

  try {
    const bareHelpCommand = resolveBareHelpCommand(program, runtime.argv);

    if (bareHelpCommand) {
      runtime.stderr.write(bareHelpCommand.helpInformation());
      return 0;
    }

    await program.parseAsync(runtime.argv, { from: "user" });
    return process.exitCode ?? 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" ? 0 : 2;
    }

    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    runtime.stderr.write(`${message}\n`);
    return 1;
  } finally {
    disposePromptState(runtime.stdin);
  }
}

export function createProgram(runtime: CliRuntime): Command {
  const program = attachCommandDescriptor(configureRuntimeCommand(new Command(), runtime), "root");

  addCompactGlobalFlags(program);

  program
    .name("prisma")
    .showSuggestionAfterError();

  program.addCommand(createAuthCommand(runtime));
  program.addCommand(createBranchCommand(runtime));
  program.addCommand(createProjectCommand(runtime));
  program.addCommand(createAppCommand(runtime));

  return program;
}

function resolveBareHelpCommand(program: Command, argv: string[]): Command | null {
  if (argv.length === 0) {
    return program;
  }

  if (argv.length !== 1) {
    return null;
  }

  return program.commands.find((command) => command.name() === argv[0]) ?? null;
}

function resolveRuntime(options: RunCliOptions): CliRuntime {
  return {
    argv: options.argv ?? process.argv.slice(2),
    cwd: options.cwd ?? process.env.INIT_CWD ?? process.cwd(),
    env: options.env ?? process.env,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    fixturePath: options.fixturePath,
    stateDir: options.stateDir,
  };
}
