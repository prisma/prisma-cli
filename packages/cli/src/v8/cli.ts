import { type Cli, createCli, defineCommandFamily } from "@prisma/cli-engine";
import { getCliVersion } from "../lib/version";
import { authWhoamiCommand } from "./auth/whoami";
import {
  telemetryDisableCommand,
  telemetryEnableCommand,
  telemetryStatusCommand,
} from "./telemetry/commands";

export function buildCli(): Cli {
  return createCli({
    name: "prisma-v8",
    version: getCliVersion(),
    commandFamilies: [
      defineCommandFamily({ commands: { whoami: authWhoamiCommand } }),
    ],
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
      telemetry: {
        brief: "Inspect and change anonymous CLI telemetry",
        description:
          "Show telemetry status, or enable / disable anonymous CLI usage data.\n" +
          "Telemetry is on by default (opt-out); see https://prisma-next.dev/docs/cli/telemetry\n" +
          "for what is collected and why.",
      },
    },
    commands: {
      "auth whoami": authWhoamiCommand,
      // Shell-owned consent surface (no command family).
      "telemetry status": telemetryStatusCommand,
      "telemetry enable": telemetryEnableCommand,
      "telemetry disable": telemetryDisableCommand,
    },
  });
}
