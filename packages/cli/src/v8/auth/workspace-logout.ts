/** The `auth workspace logout` command. */
import { defineCommand, positional } from "@prisma/cli-engine";
import { runWorkspaceLogout } from "./run-workspace-logout";

export const authWorkspaceLogoutCommand = defineCommand({
  args: {
    positionals: {
      workspace: positional.string({
        brief: "Workspace id or exact name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Remove one local OAuth workspace session",
    examples: ["auth workspace logout my-workspace"],
  },
  handler: async (args, ctx) =>
    runWorkspaceLogout(ctx, args.positionals.workspace),
});
