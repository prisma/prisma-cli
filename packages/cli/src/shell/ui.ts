// biome-ignore-all lint/style/noNestedTernary: Existing status symbol selection is intentionally compact.
import { createColors } from "colorette";
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import wrapAnsi from "wrap-ansi";

import type { GlobalFlags } from "./global-flags";
import type { CliRuntime } from "./runtime";

export interface ShellUi {
  isTTY: boolean;
  colorEnabled: boolean;
  width: number;
  quiet: boolean;
  verbose: boolean;
  trace: boolean;
  accent(text: string): string;
  success(text: string): string;
  error(text: string): string;
  warning(text: string): string;
  info(text: string): string;
  link(text: string): string;
  dim(text: string): string;
  strong(text: string): string;
}

export interface HeaderRow {
  key: string;
  value: string;
  tone?: "default" | "dim" | "link";
  sensitive?: boolean;
}

export interface FieldRow {
  key: string;
  value: string;
  tone?: "default" | "dim";
}

export interface VerboseRow {
  key: string;
  value: string;
  tone?: "default" | "dim" | "success" | "warning" | "link";
  sensitive?: boolean;
}

const DEFAULT_WIDTH = 80;

export function createShellUi(
  runtime: CliRuntime,
  flags: GlobalFlags,
): ShellUi {
  const isTTY = Boolean(runtime.stderr.isTTY);
  const colorEnabled = resolveColorEnabled(runtime, flags, isTTY);
  const colors = createColors({ useColor: colorEnabled });
  const width =
    runtime.stderr.columns && runtime.stderr.columns > 0
      ? runtime.stderr.columns
      : DEFAULT_WIDTH;

  return {
    isTTY,
    colorEnabled,
    width,
    quiet: flags.quiet,
    verbose: flags.verbose,
    trace: flags.trace,
    accent: (text) => colors.cyan(text),
    success: (text) => colors.greenBright(text),
    error: (text) => colors.redBright(text),
    warning: (text) => colors.yellow(text),
    info: (text) => colors.blue(text),
    link: (text) => colors.blue(text),
    dim: (text) => colors.dim(text),
    strong: (text) => colors.bold(text),
  };
}

export function renderCommandHeader(
  ui: ShellUi,
  options: {
    commandLabel: string;
    description: string;
    docsPath?: string;
    rows?: HeaderRow[];
  },
): string[] {
  if (!ui.isTTY) {
    return [];
  }

  const rows = options.rows ?? [];
  const lines = [
    `${ui.strong(options.commandLabel)} ${ui.dim("→")} ${ui.dim(options.description)}`,
    "",
  ];
  const rail = ui.dim("│");
  const keyWidth =
    rows.length > 0
      ? Math.max(
          ...rows.map((row) => stringWidth(`${row.key}:`)),
          stringWidth("Read more"),
        )
      : stringWidth("Read more");

  for (const row of rows) {
    lines.push(
      `${rail}  ${ui.accent(padDisplay(`${row.key}:`, keyWidth))}  ${formatHeaderValue(ui, row)}`,
    );
  }

  if (rows.length > 0 || options.docsPath) {
    lines.push(rail);
  }

  if (options.docsPath) {
    lines.push(
      `${rail}  ${ui.accent(padDisplay("Read more", keyWidth))}  ${ui.link(options.docsPath)}`,
    );
  }

  lines.push("");

  return lines;
}

export function renderSummaryLine(
  ui: ShellUi,
  status: "success" | "error" | "info" | "warning",
  text: string,
): string {
  const symbol =
    status === "success"
      ? ui.success("✔")
      : status === "error"
        ? ui.error("✘")
        : status === "warning"
          ? ui.warning("⚠")
          : ui.info("ℹ");
  return `${symbol} ${text}`;
}

export function renderFieldRows(ui: ShellUi, rows: FieldRow[]): string[] {
  if (rows.length === 0) {
    return [];
  }

  const keyWidth = Math.max(...rows.map((row) => stringWidth(`${row.key}:`)));

  return rows.map((row) => {
    const key = ui.isTTY
      ? ui.accent(padDisplay(`${row.key}:`, keyWidth))
      : padDisplay(`${row.key}:`, keyWidth);
    const value = row.tone === "dim" ? ui.dim(row.value) : row.value;
    return `${key}  ${value}`;
  });
}

export function renderNextSteps(steps: string[]): string[] {
  if (steps.length === 0) {
    return [];
  }

  return [
    "",
    steps.length === 1 ? "Next step:" : "Next steps:",
    ...steps.map((step) => `- ${step}`),
  ];
}

export function renderVerboseBlock(
  ui: ShellUi,
  rows: VerboseRow[],
  options: { title?: string } = {},
): string[] {
  if (!ui.verbose || rows.length === 0) {
    return [];
  }

  const title = options.title ?? "Details";
  const keyWidth = Math.max(...rows.map((row) => stringWidth(`${row.key}:`)));
  const rail = ui.dim("│");

  return [
    "",
    `${ui.dim(title)}:`,
    ...rows.map(
      (row) =>
        `${rail}  ${ui.accent(padDisplay(`${row.key}:`, keyWidth))}  ${formatVerboseValue(ui, row)}`,
    ),
  ];
}

export function formatColumns(columns: string[], widths: number[]): string {
  return columns
    .map((value, index) => padDisplay(value, widths[index]))
    .join("   ")
    .trimEnd();
}

export function plain(text: string): string {
  return stripAnsi(text);
}

export function wrapText(text: string, width: number, indent = ""): string[] {
  return wrapAnsi(text, width, { hard: false, trim: false })
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`));
}

export function padDisplay(text: string, width: number): string {
  const padding = Math.max(width - stringWidth(stripAnsi(text)), 0);
  return `${text}${" ".repeat(padding)}`;
}

export function maskValue(value: string): string {
  return value
    .replace(/([A-Za-z0-9._%+-]{1,})(?=@)/g, "****")
    .replace(/:\/\/[^:@/\s]+:[^@/\s]+@/g, "://****:****@");
}

function resolveColorEnabled(
  runtime: CliRuntime,
  flags: GlobalFlags,
  isTTY: boolean,
): boolean {
  if (flags.color === true) {
    return true;
  }

  if (flags.color === false) {
    return false;
  }

  if (runtime.env.NO_COLOR !== undefined) {
    return false;
  }

  return isTTY;
}

function formatHeaderValue(ui: ShellUi, row: HeaderRow): string {
  const value = row.sensitive ? maskValue(row.value) : row.value;

  if (row.tone === "dim") {
    return ui.dim(value);
  }

  if (row.tone === "link") {
    return ui.link(value);
  }

  return value;
}

function formatVerboseValue(ui: ShellUi, row: VerboseRow): string {
  const value = row.sensitive ? maskValue(row.value) : row.value;

  if (row.tone === "dim") {
    return ui.dim(value);
  }

  if (row.tone === "success") {
    return ui.success(value);
  }

  if (row.tone === "warning") {
    return ui.warning(value);
  }

  if (row.tone === "link") {
    return ui.link(value);
  }

  return value;
}
