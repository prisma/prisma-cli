import process from "node:process";

import { Command, CommanderError, Option } from "commander";

import { createAppCommand } from "./commands/app";
import { createAuthCommand } from "./commands/auth";
import { createBranchCommand } from "./commands/branch";
import { createGitCommand } from "./commands/git";
import { createProjectCommand } from "./commands/project";
import { createVersionCommand } from "./commands/version";
import { runVersion } from "./controllers/version";
import { getCliName, getCliVersion } from "./lib/version";
import { attachCommandDescriptor } from "./shell/command-meta";
import { CliError } from "./shell/errors";
import { addCompactGlobalFlags } from "./shell/global-flags";
import { formatUnexpectedError, writeHumanError, writeJsonError, writeJsonSuccess } from "./shell/output";
import { disposePromptState } from "./shell/prompt";
import { configureRuntimeCommand, createCommandContext, type CliRuntime } from "./shell/runtime";
import { createShellUi } from "./shell/ui";
import { maybeWriteCachedUpdateNotification } from "./shell/update-check";

export interface RunCliOptions extends Partial<CliRuntime> {
  argv?: string[];
}

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const runtime = resolveRuntime(options);
  const program = createProgram(runtime);
  process.exitCode = 0;

  try {
    await maybeWriteCachedUpdateNotification(runtime);

    if (runtime.argv.includes("--version")) {
      return await handleVersionFlag(runtime);
    }

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

    runtime.stderr.write(formatUnexpectedError(error, runtime.argv.includes("--trace")));
    return 1;
  } finally {
    disposePromptState(runtime.stdin);
  }
}

export function createProgram(runtime: CliRuntime): Command {
  const program = attachCommandDescriptor(configureRuntimeCommand(new Command(), runtime), "root");

  addCompactGlobalFlags(program);

  program.addOption(new Option("--version", "Print the CLI version and exit."));

  program
    .name("prisma")
    .showSuggestionAfterError();

  program.addCommand(createVersionCommand(runtime));
  program.addCommand(createAuthCommand(runtime));
  program.addCommand(createProjectCommand(runtime));
  program.addCommand(createGitCommand(runtime));
  program.addCommand(createBranchCommand(runtime));
  program.addCommand(createAppCommand(runtime));

  return program;
}

async function handleVersionFlag(runtime: CliRuntime): Promise<number> {
  const wantsJson = runtime.argv.includes("--json");
  const output = { stdout: runtime.stdout, stderr: runtime.stderr };

  try {
    if (wantsJson) {
      const context = await createCommandContext(runtime, buildVersionFlagFlags(runtime));
      const success = await runVersion(context);
      writeJsonSuccess(output, {
        command: success.command,
        result: { version: success.result.cli.version },
        warnings: success.warnings,
        nextSteps: success.nextSteps,
      });
      return 0;
    }

    const versionLine = `${getCliName()} ${getCliVersion()}`;
    runtime.stdout.write(`${versionLine}\n`);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      if (wantsJson) {
        writeJsonError(output, "version", error);
      } else {
        const ui = createShellUi(runtime, buildVersionFlagFlags(runtime));
        writeHumanError(output, ui, error, { trace: false });
      }

      return error.exitCode;
    }

    throw error;
  }
}

function buildVersionFlagFlags(runtime: CliRuntime) {
  return {
    json: runtime.argv.includes("--json"),
    quiet: false,
    verbose: false,
    trace: false,
    yes: false,
    interactive: undefined,
    color: undefined,
  };
}

function resolveBareHelpCommand(program: Command, argv: string[]): Command | null {
  if (argv.length === 0) {
    return program;
  }

  if (argv.length !== 1) {
    return null;
  }

  const candidate = program.commands.find((command) => command.name() === argv[0]) ?? null;

  if (!candidate) {
    return null;
  }

  // Group commands (with subcommands) print help when invoked bare.
  // Leaf commands (no subcommands) own their own action and must execute.
  if (candidate.commands.length === 0) {
    return null;
  }

  return candidate;
}

function resolveRuntime(options: RunCliOptions): CliRuntime {
  return {
    argv: options.argv ?? process.argv.slice(2),
    cwd: options.cwd ?? process.env.INIT_CWD ?? process.cwd(),
    env: options.env ?? process.env,
    signal: options.signal ?? new AbortController().signal,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    fixturePath: options.fixturePath,
    stateDir: options.stateDir,
  };
}
