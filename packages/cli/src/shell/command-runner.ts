import { AuthError as SDKAuthError } from "@prisma/management-api-sdk";
import type { CommandDescriptor } from "./command-meta";
import { getCommandDescriptor } from "./command-meta";
import { authRequiredError, CliError, commandCanceledError } from "./errors";
import { resolveGlobalFlags } from "./global-flags";
import type { CommandSuccess } from "./output";
import { cliErrorToJson, writeHumanError, writeHumanLines, writeJsonError, writeJsonEvent, writeJsonSuccess } from "./output";
import { createCommandContext, type CliRuntime } from "./runtime";

interface CommandPresenter<T> {
  renderHuman: (
    context: Awaited<ReturnType<typeof createCommandContext>>,
    descriptor: CommandDescriptor,
    result: T,
  ) => string[];
  renderJson?: (result: T) => unknown;
}

function toCliError(error: unknown, runtime: CliRuntime): CliError | null {
  if (isCancellationError(error) || runtime.signal.aborted) {
    return commandCanceledError();
  }

  if (error instanceof CliError) return error;

  if (error instanceof SDKAuthError) {
    return authRequiredError(["prisma-cli auth login"], { debug: error.message });
  }

  return null;
}

function isCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "CancelledError";
}

export async function runCommand<T>(
  runtime: CliRuntime,
  commandName: string,
  options: Record<string, unknown>,
  handler: (context: Awaited<ReturnType<typeof createCommandContext>>) => Promise<CommandSuccess<T>>,
  presenter: CommandPresenter<T>,
): Promise<void> {
  const flags = resolveGlobalFlags(runtime.argv, options);
  const context = await createCommandContext(runtime, flags);
  const descriptor = getCommandDescriptor(commandName);

  try {
    const success = await handler(context);

    if (flags.json) {
      writeJsonSuccess(context.output, {
        ...success,
        result: presenter.renderJson ? presenter.renderJson(success.result) : success.result,
      });
      return;
    }

    if (flags.quiet) {
      return;
    }

    writeHumanLines(context.output, presenter.renderHuman(context, descriptor, success.result));
  } catch (error) {
    const cliError = toCliError(error, runtime);
    if (cliError) {
      if (flags.json) {
        writeJsonError(context.output, commandName, cliError);
      } else {
        writeHumanError(context.output, context.ui, cliError, { trace: flags.trace });
      }

      process.exitCode = cliError.exitCode;
      return;
    }

    throw error;
  }
}

export async function runStreamingCommand(
  runtime: CliRuntime,
  commandName: string,
  options: Record<string, unknown>,
  handler: (context: Awaited<ReturnType<typeof createCommandContext>>) => Promise<void>,
): Promise<void> {
  const flags = resolveGlobalFlags(runtime.argv, options);
  const context = await createCommandContext(runtime, flags);

  try {
    await handler(context);

    if (flags.json) {
      writeJsonEvent(context.output, {
        type: "success",
        command: commandName,
        timestamp: new Date().toISOString(),
        result: null,
        warnings: [],
        nextSteps: [],
        nextActions: [],
      });
    }
  } catch (error) {
    const cliError = toCliError(error, runtime);
    if (cliError) {
      if (flags.json) {
        writeJsonEvent(context.output, {
          type: "error",
          command: commandName,
          timestamp: new Date().toISOString(),
          error: cliErrorToJson(cliError),
          warnings: [],
          nextSteps: cliError.nextSteps,
          nextActions: cliError.nextActions,
        });
      } else {
        writeHumanError(context.output, context.ui, cliError, { trace: flags.trace });
      }

      process.exitCode = cliError.exitCode;
      return;
    }

    throw error;
  }
}
