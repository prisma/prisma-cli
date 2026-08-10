/**
 * The consent surface: `telemetry status|enable|disable`, ported from
 * the ORM CLI's commander implementation as engine result commands.
 * Semantics and copy match the reference: `status` is a pure read
 * (never sends, never mints, never writes); `enable` stores the
 * opt-in and mints an installation id when none exists; `disable`
 * stores the opt-out and mints nothing. Mounted shell-owned (no
 * command family), group `telemetry`.
 */
import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { userConfigPath, writeUserConfig } from "@repo/cli-telemetry";
import { isCI } from "./is-ci";
import {
  formatTelemetryStatusLines,
  resolveTelemetryStatus,
  statusSummaryLine,
  type TelemetryStatus,
} from "./status";

function statusPresentations(status: TelemetryStatus): Presentations {
  return {
    human: () => [
      { kind: "summary", tone: "info", text: statusSummaryLine(status) },
      {
        kind: "fields",
        rows: [
          { label: "Config file", value: status.configPath },
          {
            label: "Installation ID",
            value: status.installationIdStored ? "stored" : "not stored",
          },
        ],
      },
    ],
    stdout: () => formatTelemetryStatusLines(status),
    json: () => status,
  };
}

export const telemetryStatusCommand = defineCommand({
  help: {
    summary: "Show whether anonymous CLI telemetry is enabled and why",
    description:
      "Reports whether telemetry is currently enabled or disabled and the reason\n" +
      "(default-on, stored opt-out, environment opt-out, or CI), the path to your\n" +
      "user-level config file, and whether an installation ID has been stored.\n" +
      "Read-only: never sends an event, never mints an ID, never writes anything.",
    examples: ["telemetry status", "telemetry status --json"],
  },
  handler: async (_args, ctx) => {
    const status = resolveTelemetryStatus({ env: ctx.env, inCI: isCI() });
    return ok(ctx.present({ data: status }, statusPresentations(status)));
  },
});

function consentPresentations(line: string, json: unknown): Presentations {
  return {
    human: () => [{ kind: "summary", tone: "ok", text: line }],
    stdout: () => [line],
    json: () => json,
  };
}

export const telemetryEnableCommand = defineCommand({
  help: {
    summary: "Enable anonymous CLI telemetry",
    description:
      'Stores "enableTelemetry": true in your user-level config and mints an\n' +
      "installation ID if one is not already stored.",
    examples: ["telemetry enable"],
  },
  handler: async (_args, ctx) => {
    writeUserConfig({ enableTelemetry: true });
    const configPath = userConfigPath();
    return ok(
      ctx.present(
        { data: { enableTelemetry: true, configPath } },
        consentPresentations(
          `Telemetry enabled. Preference stored in ${configPath}.`,
          { enableTelemetry: true, configPath },
        ),
      ),
    );
  },
});

export const telemetryDisableCommand = defineCommand({
  help: {
    summary: "Disable anonymous CLI telemetry",
    description:
      'Stores "enableTelemetry": false in your user-level config. No installation\n' +
      "ID is minted and no event is sent.",
    examples: ["telemetry disable"],
  },
  handler: async (_args, ctx) => {
    writeUserConfig({ enableTelemetry: false });
    const configPath = userConfigPath();
    return ok(
      ctx.present(
        { data: { enableTelemetry: false, configPath } },
        consentPresentations(
          `Telemetry disabled. Preference stored in ${configPath}.`,
          { enableTelemetry: false, configPath },
        ),
      ),
    );
  },
});
