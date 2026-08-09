import { type CommandDefinition, defineCommand } from "@prisma/cli-engine";

export const authWhoamiCommand: CommandDefinition = defineCommand({
  help: {
    summary: "Show the authenticated user and accessible workspace",
    examples: ["prisma-v8 auth whoami", "prisma-v8 auth whoami --json"],
  },
  handler: () => import("./whoami.handler"),
});
