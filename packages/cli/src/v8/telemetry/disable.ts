/** The `telemetry disable` command: stores the opt-out; mints
 *  nothing, sends nothing. */
import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { userConfigPath, writeUserConfig } from "@repo/cli-telemetry";
import { consentPresentations } from "./consent";

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
