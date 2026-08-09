import { type Cli, createCli, defineCommandFamily } from "@prisma/cli-engine";
import { getCliVersion } from "../lib/version";
import { authWhoamiCommand } from "./auth/whoami";

export function buildCli(): Cli {
  return createCli({
    name: "prisma-v8",
    version: getCliVersion(),
    commandFamilies: [
      defineCommandFamily({ commands: { whoami: authWhoamiCommand } }),
    ],
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
    },
    commands: {
      "auth whoami": authWhoamiCommand,
    },
  });
}
