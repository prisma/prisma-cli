import type { Block, EngineEvent, Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { COMPUTE_CONFIG_JSON_FILENAME } from "@prisma/compute-sdk/config";
import type { PrismaCliPackageCommandFormatter } from "../../lib/agent/cli-command";
import type { InitResult } from "./types";

function runCommand(command: string): NextAction {
  return { kind: "run-command", label: command, command };
}

/** Both statuses mean the pin is on disk, so nothing more is offered. */
function isLinked(result: InitResult): boolean {
  return (
    result.link.status === "linked" || result.link.status === "already-linked"
  );
}

function typesMissing(result: InitResult): boolean {
  return (
    result.types.status !== "installed" &&
    result.types.status !== "already-installed"
  );
}

function typesBlock(result: InitResult): Block | undefined {
  if (result.types.status === "installed") {
    return {
      kind: "summary",
      status: "ok",
      text: `Installed ${result.types.package} (config types)`,
    };
  }
  if (
    (result.types.status === "skipped" || result.types.status === "declined") &&
    result.types.installCommand
  ) {
    return {
      kind: "summary",
      status: "info",
      text: `For editor types: ${result.types.installCommand}`,
    };
  }
  return undefined;
}

/** A failed link already spoke through its own finding, and an
 *  already-linked directory has nothing to say. */
function linkBlock(
  result: InitResult,
  formatCommand: PrismaCliPackageCommandFormatter,
): Block | undefined {
  switch (result.link.status) {
    case "linked":
      return {
        kind: "summary",
        status: "ok",
        text: `Linked "${result.directory}" to Project "${result.link.project?.name ?? ""}"`,
      };
    case "already-linked":
    case "failed":
      return undefined;
    default:
      return {
        kind: "summary",
        status: "info",
        text: `Not linked to a Project yet; link with ${formatCommand(["project", "link"])}.`,
      };
  }
}

export function initPresentations(
  result: InitResult,
  formatCommand: PrismaCliPackageCommandFormatter,
): Presentations {
  return {
    json: () => result,
    human: () =>
      [
        {
          kind: "summary",
          status: "ok",
          text: result.converted
            ? `Converted ${COMPUTE_CONFIG_JSON_FILENAME} to ${result.configPath}`
            : `Wrote ${result.configPath}`,
        } as Block,
        typesBlock(result),
        linkBlock(result, formatCommand),
      ].filter((block): block is Block => block !== undefined),
    stdout: () => [result.configPath],
    next: () => [
      ...(typesMissing(result) && result.types.installCommand
        ? [runCommand(result.types.installCommand)]
        : []),
      runCommand(formatCommand(["app", "deploy"])),
      ...(isLinked(result)
        ? []
        : [runCommand(formatCommand(["project", "link"]))]),
    ],
  };
}

/** The settings the run will write, in the legacy preview's padded
 *  columns, as the commentary event that replaces the legacy stderr
 *  preview. Null when a conversion transported a config with no single
 *  app to describe. */
export function settingsPreview(
  settings: InitResult["settings"],
): EngineEvent | null {
  if (settings.length === 0) {
    return null;
  }
  const keyWidth = Math.max(...settings.map((row) => row.key.length));
  const valueWidth = Math.max(...settings.map((row) => row.value.length));
  return {
    kind: "message",
    severity: "info",
    text: settings
      .map(
        (row) =>
          `  ${row.key.padEnd(keyWidth)}  ${row.value.padEnd(valueWidth)}  ${row.source}`,
      )
      .join("\n"),
  };
}
