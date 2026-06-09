import { AuthError as SDKAuthError } from "@prisma/management-api-sdk";
import type { CommandDescriptor } from "./command-meta";
import { getCommandDescriptor } from "./command-meta";
import { collectCommandDiagnostics } from "../lib/diagnostics";
import { renderCommandDiagnostics } from "./diagnostics-output";
import { authRequiredError, CliError, commandCanceledError } from "./errors";
import { resolveGlobalFlags } from "./global-flags";
import type { CommandSuccess } from "./output";
import { cliErrorToJson, writeHumanError, writeHumanLines, writeJsonError, writeJsonEvent, writeJsonSuccess } from "./output";
import { createCommandContext, type CliRuntime } from "./runtime";

interface CommandPresenter<T> {
  renderStdout?: (
    context: Awaited<ReturnType<typeof createCommandContext>>,
    descriptor: CommandDescriptor,
    result: T,
  ) => string[];
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
  const startedAt = Date.now();

  try {
    const success = await handler(context);

    if (flags.json) {
      writeJsonSuccess(context.output, {
        ...success,
        result: presenter.renderJson ? presenter.renderJson(success.result) : success.result,
      });
      return;
    }

    const stdout = presenter.renderStdout?.(context, descriptor, success.result) ?? [];
    if (flags.quiet) {
      if (stdout.length > 0) {
        context.output.stdout.write(`${stdout.join("\n")}\n`);
      }
      return;
    }

    const rendered = presenter.renderHuman(context, descriptor, success.result);
    const diagnostics = await renderBestEffortCommandDiagnostics(context, {
      enabled: flags.verbose && rendered.length > 0,
      durationMs: Date.now() - startedAt,
    });
    const humanLines = [
      ...rendered,
      ...diagnostics,
    ];
    if (stdout.length > 0 && humanLines.length > 0) {
      humanLines.push("");
    }

    writeHumanLines(context.output, humanLines);

    if (stdout.length > 0) {
      context.output.stdout.write(`${stdout.join("\n")}\n`);
    }
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

async function renderBestEffortCommandDiagnostics(
  context: Awaited<ReturnType<typeof createCommandContext>>,
  options: { enabled: boolean; durationMs: number },
): Promise<string[]> {
  if (!options.enabled) {
    return [];
  }

  try {
    return renderCommandDiagnostics(
      context,
      await collectCommandDiagnostics(context, { durationMs: options.durationMs }),
    );
  } catch {
    return [];
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
