/**
 * The `telemetry status` command and its status resolution. Ported
 * from the ORM CLI's consent surface: a pure read (never sends, never
 * mints, never writes).
 */
import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  type GatingDisabledReason,
  type GatingEnabledReason,
  readUserConfig,
  resolveGating,
  userConfigPath,
} from "@repo/cli-telemetry";
import { isCI } from "./is-ci";

/** The gating resolver's total reason union, surfaced verbatim. */
export type TelemetryStatusReason = GatingDisabledReason | GatingEnabledReason;

export interface TelemetryStatus {
  readonly enabled: boolean;
  readonly reason: TelemetryStatusReason;
  readonly configPath: string;
  readonly installationIdStored: boolean;
}

/**
 * Resolves the same decision the runtime wiring uses (`resolveGating`,
 * CI included) and projects it into a user-facing status. Pure read:
 * never mints, never writes. The `installationId` value itself is
 * never surfaced — only its presence — so `status` discloses nothing
 * identifying.
 */
export function resolveTelemetryStatus(inputs: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly inCI: boolean;
}): TelemetryStatus {
  const config = readUserConfig();
  const configPath = userConfigPath();
  const installationIdStored =
    typeof config.installationId === "string" &&
    config.installationId.length > 0;
  const gating = resolveGating({
    env: inputs.env,
    config,
    inCI: inputs.inCI,
  });
  return {
    enabled: gating.enabled,
    reason: gating.reason,
    configPath,
    installationIdStored,
  };
}

/** Projection of the gating reasons to user-facing copy. */
const REASON_EXPLANATION: Record<TelemetryStatusReason, string> = {
  ci: "CI environment detected — telemetry is hard-disabled.",
  "env-opt-out":
    "an environment opt-out is set (DO_NOT_TRACK / PRISMA_NEXT_DISABLE_TELEMETRY).",
  "stored-opt-out": '"enableTelemetry": false is stored in your config.',
  "stored-opt-in": '"enableTelemetry": true is stored in your config.',
  "default-on": "no explicit choice is stored, so the opt-out default applies.",
};

export function statusSummaryLine(status: TelemetryStatus): string {
  return `Telemetry is ${status.enabled ? "enabled" : "disabled"}: ${REASON_EXPLANATION[status.reason]}`;
}

export function formatTelemetryStatusLines(status: TelemetryStatus): string[] {
  return [
    statusSummaryLine(status),
    `Config file: ${status.configPath}`,
    `Installation ID: ${status.installationIdStored ? "stored" : "not stored"}`,
  ];
}

function statusPresentations(status: TelemetryStatus): Presentations {
  return {
    human: () => [
      { kind: "summary", status: "info", text: statusSummaryLine(status) },
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
