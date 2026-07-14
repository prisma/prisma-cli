import type { Writable } from "node:stream";

import { formatCommandArgument } from "./command-arguments";
import type { CliError } from "./errors";
import type { NextAction } from "./next-actions";
import type { ShellUi } from "./ui";
import { renderNextSteps, renderSummaryLine } from "./ui";

export interface CommandSuccess<T> {
  command: string;
  result: T;
  warnings: string[];
  nextSteps: string[];
  nextActions?: NextAction[];
}

export interface CliOutput {
  stdout: Writable;
  stderr: Writable;
}

export function writeJsonSuccess<T>(
  output: CliOutput,
  success: CommandSuccess<T>,
): void {
  output.stdout.write(
    `${JSON.stringify({ ok: true, nextActions: [], ...success }, null, 2)}\n`,
  );
}

export function writeJsonEvent(
  output: CliOutput,
  event: Record<string, unknown>,
): void {
  output.stdout.write(`${JSON.stringify(event)}\n`);
}

export function cliErrorToJson(error: CliError) {
  return {
    code: error.code,
    domain: error.domain,
    severity: error.severity,
    summary: error.summary,
    why: error.why,
    fix: error.fix,
    where: error.where,
    meta: error.meta,
    docsUrl: error.docsUrl,
  };
}

export function formatUnexpectedError(
  error: unknown,
  trace: boolean,
  feedbackCommand?: string,
): string {
  const feedbackLine = feedbackCommand
    ? `Tell us what happened: ${feedbackCommand}`
    : null;
  const debug =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  if (trace) {
    return [debug, ...(feedbackLine ? [feedbackLine] : []), ""].join("\n");
  }

  const message =
    error instanceof Error && error.message ? error.message : String(error);

  return [
    `Unexpected CLI error: ${message}`,
    "More: Re-run with --trace for deeper diagnostics",
    ...(feedbackLine ? [feedbackLine] : []),
    "",
  ].join("\n");
}

/** Command groups whose second argv token names the subcommand. */
const COMMAND_GROUPS = new Set([
  "agent",
  "auth",
  "project",
  "git",
  "branch",
  "build",
  "database",
  "app",
]);

/** Best-effort `command` label for a crash that predates envelope assembly. */
export function unexpectedErrorCommandLabel(argv: readonly string[]): string {
  const words = argv.filter((arg) => !arg.startsWith("-"));
  const [group, action] = words;
  if (!group) {
    return "unknown";
  }
  return action && COMMAND_GROUPS.has(group) ? `${group}.${action}` : group;
}

/**
 * Pre-filled feedback command for a crash, so the report arrives carrying the
 * failing command and the error's first line.
 */
export function unexpectedErrorFeedbackCommand(
  argv: readonly string[],
  error: unknown,
): string {
  const command = unexpectedErrorCommandLabel(argv).replace(".", " ");
  const message = (
    error instanceof Error && error.message ? error.message : String(error)
  ).split("\n")[0];
  const excerpt = `${command} crashed: ${message}`.slice(0, 200);
  return `prisma-cli feedback ${formatCommandArgument(excerpt)}`;
}

/**
 * A crash must not break the `--json` contract: agents still get a structured
 * envelope, with a recover action pointing at the feedback command.
 */
export function writeJsonUnexpectedError(
  output: CliOutput,
  argv: readonly string[],
  error: unknown,
): void {
  const feedbackCommand = unexpectedErrorFeedbackCommand(argv, error);
  output.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        command: unexpectedErrorCommandLabel(argv),
        error: {
          code: "UNEXPECTED_ERROR",
          domain: "cli",
          severity: "error",
          summary: "Unexpected CLI error",
          why:
            error instanceof Error && error.message
              ? error.message
              : String(error),
          fix: "Re-run with --trace for deeper diagnostics, and report the crash.",
          where: null,
          meta: {},
          docsUrl: null,
        },
        warnings: [],
        nextSteps: [feedbackCommand],
        nextActions: [
          {
            kind: "run-command",
            journey: "recover",
            label: "Report this crash to the Prisma team",
            command: feedbackCommand,
            reason:
              "This looks like a CLI bug; the pre-filled report carries the failing command and error.",
          } satisfies NextAction,
        ],
      },
      null,
      2,
    )}\n`,
  );
}

export function writeJsonError(
  output: CliOutput,
  command: string,
  error: CliError,
): void {
  output.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        command,
        error: cliErrorToJson(error),
        warnings: [],
        nextSteps: error.nextSteps,
        nextActions: error.nextActions,
      },
      null,
      2,
    )}\n`,
  );
}

export function writeHumanLines(output: CliOutput, lines: string[]): void {
  if (lines.length === 0) {
    return;
  }

  output.stderr.write(`${lines.join("\n")}\n`);
}

export function writeHumanError(
  output: CliOutput,
  ui: ShellUi,
  error: CliError,
  options: { trace: boolean },
): void {
  if (error.humanLines && error.humanLines.length > 0) {
    const lines = [...error.humanLines];
    if (options.trace && error.debug) {
      lines.push("");
      lines.push("Trace:");
      lines.push(...error.debug.trimEnd().split("\n"));
    }
    lines.push(...renderNextSteps(error.nextSteps));
    writeHumanLines(output, lines);
    return;
  }

  const lines = [
    renderSummaryLine(ui, "error", `${error.summary} [${error.code}]`),
  ];

  if (error.where) {
    lines.push(...["", `Where: ${error.where}`]);
  }

  if (error.why) {
    if (!error.where) {
      lines.push("");
    }

    lines.push(`Why: ${error.why}`);
  }

  if (error.fix) {
    lines.push(`Fix: ${error.fix}`);
  }

  if (options.trace) {
    if (error.debug) {
      lines.push("");
      lines.push("Trace:");
      lines.push(...error.debug.trimEnd().split("\n"));
    }
  } else {
    lines.push("");
    lines.push("More: Re-run with --trace for deeper diagnostics");
  }

  lines.push(...renderNextSteps(error.nextSteps));

  writeHumanLines(output, lines);
}
