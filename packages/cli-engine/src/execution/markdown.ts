import type { ErroredEnvelope } from "../commands";
import type { EngineEvent } from "../events";
import type { Block, PresentedResult, Text, TreeNode } from "../presentation";
import type { Diagnostic, NextAction } from "../protocol";
import type { Invocation } from "./engine";
import type { HelpCard, HelpRow } from "./help";
import { plainText } from "./palette";
import {
  commentaryLine,
  MASK,
  PLACEHOLDER,
  sentenceCase,
  withDocsUrl,
} from "./rendering";

const FENCE = "```";
const LONG_FENCE = "````";
const PIPE = /\|/g;
const NEWLINE = /\n/g;

function orPlaceholder(text: Text): string {
  const plain = plainText(text);
  return plain === "" ? PLACEHOLDER : plain;
}

/**
 * Plain Markdown, for a reader that is a model rather than a terminal:
 * every value labelled, nothing padded, wrapped, aligned, or coloured.
 */
export function renderBlockMarkdown(block: Block): string[] {
  switch (block.kind) {
    case "summary":
      return [`[${block.status}] ${plainText(block.text)}`];
    case "fields":
      return block.rows.map(
        (row) =>
          `${plainText(row.label)}: ${row.sensitive === true ? MASK : orPlaceholder(row.value)}`,
      );
    case "table":
      return renderTable(block.columns, block.rows);
    case "list":
      return block.items.map((item) => `- ${plainText(item)}`);
    case "tree":
      return block.roots.flatMap((root) => renderTreeNode(root, 0));
    case "drawing": {
      const lines = block.lines.map(plainText);
      const fence = lines.some((line) => line.includes(FENCE))
        ? LONG_FENCE
        : FENCE;
      return [fence, ...lines, fence];
    }
  }
}

function escapeCell(text: string): string {
  return text.replace(PIPE, "\\|").replace(NEWLINE, " ");
}

function cell(text: Text): string {
  return escapeCell(orPlaceholder(text));
}

function pipeRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function renderTable(
  columns: readonly Text[],
  rows: ReadonlyArray<readonly Text[]>,
): string[] {
  const lines = [
    pipeRow(columns.map((column) => cell(sentenceCase(column)))),
    pipeRow(columns.map(() => "---")),
    ...rows.map((row) => pipeRow(row.map(cell))),
  ];
  return rows.length === 0 ? [...lines, "(no rows)"] : lines;
}

function renderTreeNode(node: TreeNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const label = plainText(node.label);
  const line =
    node.status === undefined
      ? `${indent}- ${label}`
      : `${indent}- [${node.status}] ${label}`;
  return [
    line,
    ...(node.children ?? []).flatMap((child) =>
      renderTreeNode(child, depth + 1),
    ),
  ];
}

export function renderNextActionMarkdown(action: NextAction): string[] {
  const target = action.command ?? action.url;
  if (target === undefined && action.commands !== undefined) {
    return [
      `- ${action.label}`,
      ...action.commands.map((command) => `  - \`${command}\``),
    ];
  }
  if (target === undefined || target === action.label) {
    return [
      action.command !== undefined
        ? `- \`${action.label}\``
        : `- ${action.label}`,
    ];
  }
  return [
    action.command !== undefined
      ? `- ${action.label}: \`${target}\``
      : `- ${action.label}: ${target}`,
  ];
}

function whereLine(where: Diagnostic["where"]): string | undefined {
  if (where === undefined) {
    return undefined;
  }
  if (where.path !== undefined && where.line !== undefined) {
    return `where: ${where.path}:${where.line}`;
  }
  if (where.path !== undefined) {
    return `where: ${where.path}`;
  }
  if (where.line !== undefined) {
    return `where: line ${where.line}`;
  }
  return undefined;
}

export function renderDiagnosticMarkdown(diagnostic: Diagnostic): string[] {
  const lines = [
    `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.summary}`,
  ];
  if (diagnostic.why !== undefined) {
    lines.push(`why: ${diagnostic.why}`);
  }
  const where = whereLine(diagnostic.where);
  if (where !== undefined) {
    lines.push(where);
  }
  for (const action of diagnostic.nextActions) {
    lines.push(...renderNextActionMarkdown(action));
  }
  if (diagnostic.docsUrl !== undefined) {
    lines.push(`docs: ${diagnostic.docsUrl}`);
  }
  return lines;
}

/** Joins sections with one blank line each, dropping empty ones, and
 *  ends with exactly one newline; nothing when there is nothing. */
export function joinSections(
  sections: ReadonlyArray<readonly string[]>,
): string {
  const kept = sections.filter((section) => section.length > 0);
  if (kept.length === 0) {
    return "";
  }
  return `${kept.map((section) => section.join("\n")).join("\n\n")}\n`;
}

function diagnosticsSection(diagnostics: readonly Diagnostic[]): string[] {
  if (diagnostics.length === 0) {
    return [];
  }
  return [
    "### Diagnostics",
    ...diagnostics.flatMap((diagnostic, index) => [
      ...(index === 0 ? [] : [""]),
      ...renderDiagnosticMarkdown(diagnostic),
    ]),
  ];
}

/** Everything on stdout: the blocks, then `### Next`, then
 *  `### Diagnostics`. The `stdout` presentation lines are never
 *  printed; the table already carries them. */
export function renderCompletedMarkdown(
  invocation: Invocation,
  presented: PresentedResult<unknown>,
): void {
  const { runtime, state } = invocation;
  const sections: string[][] =
    presented.presentation.human.map(renderBlockMarkdown);
  if (presented.presentation.next.length > 0) {
    sections.push([
      "### Next",
      ...presented.presentation.next.flatMap(renderNextActionMarkdown),
    ]);
  }
  sections.push(
    diagnosticsSection(
      presented.diagnostics.map((diagnostic) => withDocsUrl(state, diagnostic)),
    ),
  );
  runtime.stdout.write(joinSections(sections));
}

/** The error in the diagnostic shape, then the accompanying findings
 *  under `### Diagnostics`. The envelope's top-level `nextActions`
 *  duplicate the error's and are not printed again. */
export function renderErroredMarkdown(
  invocation: Invocation,
  envelope: ErroredEnvelope,
): void {
  invocation.runtime.stdout.write(
    joinSections([
      renderDiagnosticMarkdown(envelope.error),
      diagnosticsSection(envelope.diagnostics),
    ]),
  );
}

/** Config-section warnings of an OK run, ahead of whatever the run
 *  prints next, with one blank line between. */
export function renderWarningsMarkdown(
  invocation: Invocation,
  diagnostics: readonly Diagnostic[],
): void {
  const section = joinSections(diagnostics.map(renderDiagnosticMarkdown));
  if (section !== "") {
    invocation.runtime.stdout.write(`${section}\n`);
  }
}

export function renderChildNextActionsMarkdown(
  invocation: Invocation,
  actions: readonly NextAction[],
): void {
  invocation.runtime.stdout.write(
    joinSections([actions.flatMap(renderNextActionMarkdown)]),
  );
}

/** One line per event on stdout as it happens. A step starting, its
 *  progress, and a remediation are not printed. */
export function renderEventMarkdown(
  invocation: Invocation,
  event: EngineEvent,
): void {
  const { stdout } = invocation.runtime;
  switch (event.kind) {
    case "message":
      stdout.write(`${event.text}\n`);
      return;
    case "output":
      stdout.write(`${event.line}\n`);
      return;
    case "step-finished":
      stdout.write(`[${event.outcome}] ${event.step}\n`);
      return;
    case "endpoint":
    case "status":
    case "artifact":
      stdout.write(`${commentaryLine(event)}\n`);
      return;
    case "step-started":
    case "progress":
    case "remediation":
      return;
  }
}

const BASH_FENCE = "```bash";

function parenthesized(suffix: string): string {
  return suffix.startsWith("(") ? suffix : `(${suffix})`;
}

function helpTable(
  headers: readonly [string, string],
  rows: readonly HelpRow[],
): string[] {
  return [
    pipeRow(headers),
    pipeRow(["---", "---"]),
    ...rows.map((row) =>
      pipeRow([
        `\`${escapeCell(row.name.trimStart())}\``,
        escapeCell(
          row.suffix === undefined || row.suffix === ""
            ? row.brief
            : `${row.brief} ${parenthesized(row.suffix)}`,
        ),
      ]),
    ),
  ];
}

function helpSection(
  heading: string,
  headers: readonly [string, string],
  rows: readonly HelpRow[],
): string[][] {
  return rows.length === 0 ? [] : [[`## ${heading}`], helpTable(headers, rows)];
}

/** The help card as Markdown: headings, paragraphs, pipe tables, and
 *  bash fences, one blank line between everything. */
export function renderHelpMarkdown(card: HelpCard): string {
  const sections: string[][] = [[`# ${card.name}`]];
  if (card.tagline !== undefined && card.tagline !== "") {
    sections.push([card.tagline]);
  }
  if (card.usage !== undefined) {
    sections.push(["## Usage"], [BASH_FENCE, card.usage, FENCE]);
  }
  if (card.description !== undefined) {
    sections.push([card.description]);
  }
  sections.push(
    ...helpSection("Commands", ["Command", "Description"], card.commands),
    ...helpSection(
      "Workflow",
      ["Run", "Purpose"],
      card.workflow.map((step) => ({ name: step.run, brief: step.brief })),
    ),
    ...helpSection("Arguments", ["Argument", "Description"], card.arguments),
    ...helpSection("Options", ["Flag", "Description"], card.options),
    ...helpSection(
      "Global options",
      ["Flag", "Description"],
      card.globalOptions,
    ),
  );
  if (card.note !== undefined) {
    sections.push([card.note]);
  }
  if (card.examples.length > 0) {
    sections.push(["## Examples"], [BASH_FENCE, ...card.examples, FENCE]);
  }
  if (card.docsUrl !== undefined) {
    sections.push([`Docs: ${card.docsUrl}`]);
  }
  return joinSections(sections);
}
