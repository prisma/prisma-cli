import type { Argument, Command, Option } from "commander";

import { formatDescriptorLabel, getDescriptorForCommand } from "./command-meta";
import {
  COMPACT_GLOBAL_OPTION_FLAGS,
  resolveGlobalFlags,
} from "./global-flags";
import type { CliRuntime } from "./runtime";
import { createShellUi, padDisplay, wrapText } from "./ui";

const CARD_PREFIX = "│  ";

export function renderHelp(command: Command, runtime: CliRuntime): string {
  const descriptor = getDescriptorForCommand(command);
  const ui = createShellUi(runtime, resolveGlobalFlags(runtime.argv, {}));
  const rail = ui.isTTY ? ui.dim("│") : "│";
  const lines = [
    `${formatDescriptorLabel(descriptor)} ${ui.dim("→")} ${ui.dim(descriptor.description)}`,
    "",
  ];
  const visibleCommands = command.commands.filter(
    (candidate) =>
      candidate.name() !== "help" &&
      !(candidate as Command & { hidden?: boolean }).hidden,
  );
  const visibleOptions = command.options.filter(
    (candidate) => !candidate.hidden,
  );

  if (visibleCommands.length > 0) {
    lines.push(...renderCommandRows(rail, ui, visibleCommands));
  }

  if (descriptor.longDescription) {
    lines.push(`${rail}`);
    const wrapped = wrapText(
      descriptor.longDescription,
      Math.max(ui.width - CARD_PREFIX.length, 40),
    );
    for (const line of wrapped) {
      lines.push(`${rail}  ${line}`);
    }
  }

  if (visibleOptions.length > 0) {
    if (visibleCommands.length > 0) {
      lines.push(`${rail}`);
    }

    if (
      visibleCommands.length > 0 &&
      visibleOptions.every((option) =>
        COMPACT_GLOBAL_OPTION_FLAGS.includes(option.flags),
      )
    ) {
      lines.push(`${rail}  Global options:`);
    }

    lines.push(...renderOptionRows(rail, ui, visibleOptions));
  }

  if (descriptor.examples && descriptor.examples.length > 0) {
    lines.push(`${rail}`);
    lines.push(`${rail}  Examples:`);
    for (const example of descriptor.examples) {
      lines.push(`${rail}    $ ${example}`);
    }
  }

  if (descriptor.docsPath) {
    lines.push(`${rail}`);
    lines.push(
      `${rail}  ${ui.accent(padDisplay("Read more", 16))}  ${ui.link(descriptor.docsPath)}`,
    );
  }

  lines.push("");

  return `${lines.join("\n")}`;
}

function renderCommandRows(
  rail: string,
  ui: ReturnType<typeof createShellUi>,
  commands: Command[],
): string[] {
  const rows = commands.map((command) => {
    const descriptor = getDescriptorForCommand(command);
    return {
      term: renderCommandTerm(command),
      description: descriptor.description,
    };
  });

  return renderAlignedRows(rail, ui, rows);
}

function renderOptionRows(
  rail: string,
  ui: ReturnType<typeof createShellUi>,
  options: Option[],
): string[] {
  const rows = options.map((option) => ({
    term: option.flags,
    description: option.description || "",
    defaultValue:
      option.defaultValueDescription ?? formatDefaultValue(option.defaultValue),
  }));

  return renderAlignedRows(rail, ui, rows);
}

function renderAlignedRows(
  rail: string,
  ui: ReturnType<typeof createShellUi>,
  rows: Array<{
    term: string;
    description: string;
    defaultValue?: string | null;
  }>,
): string[] {
  const termWidth = rows.reduce(
    (width, row) => Math.max(width, row.term.length),
    0,
  );
  const descriptionWidth = Math.max(
    ui.width - CARD_PREFIX.length - termWidth - 4,
    30,
  );
  const lines: string[] = [];

  for (const row of rows) {
    const wrapped = wrapText(
      row.description,
      descriptionWidth,
      " ".repeat(termWidth + 2),
    );
    const [firstLine, ...rest] = wrapped;
    lines.push(
      `${rail}  ${ui.accent(padDisplay(row.term, termWidth))}  ${firstLine}`,
    );

    for (const line of rest) {
      lines.push(`${rail}  ${" ".repeat(termWidth)}  ${line.trimStart()}`);
    }

    if (row.defaultValue) {
      lines.push(
        `${rail}  ${" ".repeat(termWidth)}  ${ui.dim(`default: ${row.defaultValue}`)}`,
      );
    }
  }

  return lines;
}

function renderCommandTerm(command: Command): string {
  const argumentsList = command.registeredArguments
    .map(renderArgumentLabel)
    .join(" ");
  return `${command.name()}${argumentsList ? ` ${argumentsList}` : ""}`;
}

function renderArgumentLabel(argument: Argument): string {
  const name = argument.name();
  return argument.required ? `<${name}>` : `[${name}]`;
}

function formatDefaultValue(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}
