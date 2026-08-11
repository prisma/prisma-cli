/**
 * The consent surface both CLIs ship: `telemetry status | enable |
 * disable`, over the shared user-level preference file. A product mounts
 * them instead of writing its own.
 */
import type { MountedTree } from "../command-family";
import { defineCommand } from "../commands";
import type { Presentations } from "../presentation";
import { CliStructuredError, notOk, ok } from "../protocol";
import { resolveGating, type TelemetryStatusReason } from "./gating";
import { readUserConfig, userConfigPath, writeUserConfig } from "./user-config";

/**
 * The environment names no config directory, so there is no preference
 * to read or write. Unreachable in production — `runtime.env` is
 * `process.env`, where `HOME` (or `USERPROFILE`) is always set.
 */
function storeUnavailableError(): CliStructuredError {
  return new CliStructuredError(
    "CLI.USER_CONFIG_UNRESOLVED",
    "Cannot tell where your telemetry preference is stored.",
    {
      why: "The environment sets none of XDG_CONFIG_HOME, HOME, APPDATA or USERPROFILE, so the user-level config directory cannot be resolved.",
    },
  );
}

export interface TelemetryStatus {
  readonly enabled: boolean;
  readonly reason: TelemetryStatusReason;
  readonly configPath: string;
  readonly installationIdStored: boolean;
}

/**
 * Resolves the same decision the reporting path uses and projects it
 * into a user-facing status. Pure read: never mints, never writes. The
 * `installationId` value itself is never surfaced — only its presence —
 * so `status` discloses nothing identifying.
 */
export function resolveTelemetryStatus(inputs: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly inCI: boolean;
  readonly configPath: string;
}): TelemetryStatus {
  const config = readUserConfig(inputs.env);
  const installationId = config.installationId;
  const gating = resolveGating({
    env: inputs.env,
    config,
    inCI: inputs.inCI,
  });
  return {
    enabled: gating.enabled,
    reason: gating.reason,
    configPath: inputs.configPath,
    installationIdStored:
      typeof installationId === "string" && installationId.length > 0,
  };
}

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

export function formatTelemetryStatusLines(
  status: TelemetryStatus,
): readonly string[] {
  return [
    statusSummaryLine(status),
    `Config file: ${status.configPath}`,
    `Installation ID: ${status.installationIdStored ? "stored" : "not stored"}`,
  ];
}

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
    stdout: () => [...formatTelemetryStatusLines(status)],
    json: () => status,
  };
}

/** One confirmation line, echoed on stdout, with the stored decision as
 *  the json result. */
function consentPresentations(line: string, json: unknown): Presentations {
  return {
    human: () => [{ kind: "summary", tone: "ok", text: line }],
    stdout: () => [line],
    json: () => json,
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
    const configPath = userConfigPath(ctx.env);
    if (configPath === undefined) {
      return notOk(storeUnavailableError());
    }
    const status = resolveTelemetryStatus({
      env: ctx.env,
      inCI: ctx.isCI,
      configPath,
    });
    return ok(ctx.present({ data: status }, statusPresentations(status)));
  },
});

export const telemetryEnableCommand = defineCommand({
  help: {
    summary: "Enable anonymous CLI telemetry",
    description:
      'Stores "enableTelemetry": true in your user-level config and mints an\n' +
      "installation ID if one is not already stored.",
    examples: ["telemetry enable"],
  },
  handler: async (_args, ctx) => {
    const configPath = userConfigPath(ctx.env);
    if (configPath === undefined) {
      return notOk(storeUnavailableError());
    }
    writeUserConfig(ctx.env, { enableTelemetry: true });
    const decision = { enableTelemetry: true, configPath };
    return ok(
      ctx.present(
        { data: decision },
        consentPresentations(
          `Telemetry enabled. Preference stored in ${configPath}.`,
          decision,
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
    const configPath = userConfigPath(ctx.env);
    if (configPath === undefined) {
      return notOk(storeUnavailableError());
    }
    writeUserConfig(ctx.env, { enableTelemetry: false });
    const decision = { enableTelemetry: false, configPath };
    return ok(
      ctx.present(
        { data: decision },
        consentPresentations(
          `Telemetry disabled. Preference stored in ${configPath}.`,
          decision,
        ),
      ),
    );
  },
});

/**
 * The three commands with the group help text that belongs to them,
 * ready to spread into `createCli`. `docsUrl` is the same URL the
 * telemetry declaration names; the group description points users at it
 * for what is collected and why.
 *
 * ```ts
 * const telemetry = telemetryCommandGroup({ docsUrl: DOCS_URL });
 * createCli({
 *   commands: { ...telemetry.commands, ...ownCommands },
 *   groups: { ...telemetry.groups, ...ownGroups },
 *   telemetry: { docsUrl: DOCS_URL },
 * });
 * ```
 */
export function telemetryCommandGroup(options: { readonly docsUrl: string }): {
  readonly commands: MountedTree;
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
} {
  return {
    commands: {
      "telemetry status": telemetryStatusCommand,
      "telemetry enable": telemetryEnableCommand,
      "telemetry disable": telemetryDisableCommand,
    },
    groups: {
      telemetry: {
        brief: "Inspect and change anonymous CLI telemetry",
        description:
          "Show telemetry status, or enable / disable anonymous CLI usage data.\n" +
          `Telemetry is on by default (opt-out); see ${options.docsUrl}\n` +
          "for what is collected and why.",
      },
    },
  };
}
