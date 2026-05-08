import stringWidth from "string-width";

import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { ShellUi } from "../shell/ui";
import { maskValue, padDisplay, renderSummaryLine } from "../shell/ui";

type ValueTone = "default" | "dim" | "success" | "warning" | "error" | "link";
type AnnotationStatus = "active" | "linked" | "default" | null;

interface CardRow {
  key: string;
  value: string;
  tone?: ValueTone;
  sensitive?: boolean;
}

interface ListItem {
  noun: string;
  label: string;
  id: string;
  status: AnnotationStatus;
}

interface ListPatternInput {
  title: string;
  descriptor: CommandDescriptor;
  parentContext: {
    key: string;
    value: string;
  };
  items: ListItem[];
  emptyMessage: string;
}

interface ShowField extends CardRow {}

interface ShowPatternInput {
  title: string;
  descriptor: CommandDescriptor;
  fields: ShowField[];
}

interface MutatePatternInput {
  title: string;
  descriptor: CommandDescriptor;
  context: CardRow[];
  operationDescription: string;
  operationCount: number;
  details: string[];
  alerts?: Array<{
    tone: "warning" | "error" | "info";
    text: string;
  }>;
}

export function renderList(input: ListPatternInput, ui: ShellUi): string[] {
  const keyWidth = Math.max(
    stringWidth(`${input.parentContext.key}:`),
    ...input.items.map((item) => stringWidth(`⚬ ${item.noun}:`)),
    ...readMoreWidth(input.descriptor),
  );
  const lines = renderCardTitle(input.descriptor, input.title, ui);

  lines.push(renderCardRow(ui, keyWidth, input.parentContext.key, input.parentContext.value));

  if (input.items.length === 0) {
    lines.push(renderPlainCardLine(ui, ui.dim(input.emptyMessage)));
  } else {
    for (const item of input.items) {
      lines.push(renderCardRow(ui, keyWidth, `⚬ ${item.noun}`, formatListItemValue(ui, item)));
    }
  }

  pushReadMore(lines, ui, keyWidth, input.descriptor);

  return lines;
}

export function serializeList(input: {
  context: Record<string, string>;
  items: ListItem[];
}) {
  return {
    context: input.context,
    items: input.items.map((item) => ({
      name: item.label,
      id: item.id,
      status: item.status,
    })),
    count: input.items.length,
  };
}

export function renderShow(input: ShowPatternInput, ui: ShellUi): string[] {
  const keyWidth = Math.max(...input.fields.map((field) => stringWidth(`${field.key}:`)), ...readMoreWidth(input.descriptor));
  const lines = renderCardTitle(input.descriptor, input.title, ui);

  for (const field of input.fields) {
    lines.push(renderCardRow(ui, keyWidth, field.key, formatValue(ui, field.value, field.tone, field.sensitive)));
  }

  pushReadMore(lines, ui, keyWidth, input.descriptor);

  return lines;
}

export function renderMutate(input: MutatePatternInput, ui: ShellUi): string[] {
  const rows = [...input.context, { key: "mode", value: "apply", tone: "dim" as const }];
  const keyWidth = Math.max(...rows.map((row) => stringWidth(`${row.key}:`)), ...readMoreWidth(input.descriptor));
  const lines = renderCardTitle(input.descriptor, input.title, ui);

  for (const row of rows) {
    lines.push(renderCardRow(ui, keyWidth, row.key, formatValue(ui, row.value, row.tone, row.sensitive)));
  }

  pushReadMore(lines, ui, keyWidth, input.descriptor);
  lines.push("");
  lines.push(`${ui.warning("◇")} ${input.operationDescription}...`);
  lines.push(renderSummaryLine(ui, "success", `Applied ${input.operationCount} operation(s)`));

  for (const detail of input.details) {
    lines.push(`  ${detail}`);
  }

  for (const alert of input.alerts ?? []) {
    lines.push("");
    lines.push(renderSummaryLine(ui, alert.tone, alert.text));
  }

  return lines;
}

export function renderVerify(_input: unknown, _ui: ShellUi): string[] {
  return [];
}

export function renderInspect(_input: unknown, _ui: ShellUi): string[] {
  return [];
}

function renderCardTitle(descriptor: CommandDescriptor, title: string, ui: ShellUi): string[] {
  return [`${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim(title)}`, ""];
}

function renderCardRow(ui: ShellUi, keyWidth: number, key: string, value: string): string {
  return `${renderCardRail(ui)}  ${ui.accent(padDisplay(`${key}:`, keyWidth))}  ${value}`;
}

function renderPlainCardLine(ui: ShellUi, text: string): string {
  return `${renderCardRail(ui)}  ${text}`;
}

function renderCardDivider(ui: ShellUi): string {
  return renderCardRail(ui);
}

function readMoreWidth(descriptor: CommandDescriptor): number[] {
  return descriptor.docsPath ? [stringWidth("Read more")] : [];
}

function pushReadMore(lines: string[], ui: ShellUi, keyWidth: number, descriptor: CommandDescriptor): void {
  if (!descriptor.docsPath) {
    return;
  }

  lines.push(renderCardDivider(ui));
  lines.push(`${renderCardRail(ui)}  ${ui.accent(padDisplay("Read more", keyWidth))}  ${ui.link(descriptor.docsPath)}`);
}

function renderCardRail(ui: ShellUi): string {
  return ui.dim("│");
}

function formatListItemValue(ui: ShellUi, item: ListItem): string {
  const annotation = renderAnnotation(ui, item.status);
  return annotation ? `${item.label} ${annotation}` : item.label;
}

function renderAnnotation(ui: ShellUi, status: AnnotationStatus): string {
  if (status === "active") {
    return ui.success("(active)");
  }

  if (status === "linked") {
    return ui.accent("(linked)");
  }

  if (status === "default") {
    return ui.dim("(default)");
  }

  return "";
}

function formatValue(ui: ShellUi, value: string, tone: ValueTone = "default", sensitive = false): string {
  const resolvedValue = sensitive ? maskValue(value) : value;

  if (tone === "success") {
    return ui.success(resolvedValue);
  }

  if (tone === "warning") {
    return ui.warning(resolvedValue);
  }

  if (tone === "error") {
    return ui.error(resolvedValue);
  }

  if (tone === "link") {
    return ui.link(resolvedValue);
  }

  if (tone === "dim") {
    return ui.dim(resolvedValue);
  }

  return resolvedValue;
}
