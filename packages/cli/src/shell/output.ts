import type { Writable } from "node:stream";

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

export function writeJsonSuccess<T>(output: CliOutput, success: CommandSuccess<T>): void {
  output.stdout.write(`${JSON.stringify({ ok: true, nextActions: [], ...success }, null, 2)}\n`);
}

export function writeJsonEvent(output: CliOutput, event: Record<string, unknown>): void {
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

export function writeJsonError(output: CliOutput, command: string, error: CliError): void {
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

  const lines = [renderSummaryLine(ui, "error", `${error.summary} [${error.code}]`)];

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
