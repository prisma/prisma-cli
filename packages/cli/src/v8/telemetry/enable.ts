/** The `telemetry enable` command: stores the opt-in and mints an
 *  installation id when none exists. */
import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { userConfigPath, writeUserConfig } from "@repo/cli-telemetry";
import { consentPresentations } from "./consent";

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
