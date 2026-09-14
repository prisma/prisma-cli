/** The `postgres connection delete` command. */
import { type Block, defineCommand, positional } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { DatabaseConnectionDeleteResult } from "../../types/database";
import { resolvePostgresProviderOnly } from "./context";

const CONSENT_QUESTION =
  "Deleting this database connection is destructive and requires the exact id.";

export const postgresConnectionDeleteCommand = defineCommand({
  args: {
    positionals: {
      connection: positional.string({
        brief: "Connection id",
        placeholder: "connection-id",
      }),
    },
  },
  help: {
    summary: "Delete a database connection after exact id confirmation",
    description:
      "Revokes the credential: anything still using its URL loses access to the database. The database itself and its other connections are untouched. The exact connection id is the consent token.",
    examples: ["postgres connection delete conn_123 --confirm conn_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const connectionId = args.positionals.connection.trim();
    if (!connectionId) {
      const example = `${CLI_NAME} postgres connection delete <connection-id> --confirm <connection-id>`;
      throw new CliStructuredError(
        "POSTGRES.USAGE_ERROR",
        "Connection id required",
        {
          why: "Database connection deletion needs a connection id.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Pass the connection id to delete.",
            },
            { kind: "run-command", label: example, command: example },
          ],
        },
      );
    }

    await ctx.prompt.consent(CONSENT_QUESTION, { token: connectionId });

    const provider = await resolvePostgresProviderOnly(ctx);
    await provider.removeConnection(connectionId, { signal: ctx.signal });

    const result: DatabaseConnectionDeleteResult = {
      connection: { id: connectionId },
    };
    return ok(
      ctx.present(
        { data: result },
        {
          human: (): Block[] => [
            {
              kind: "summary",
              status: "ok",
              text: "Deleting database connection.",
            },
            {
              kind: "fields",
              rows: [{ label: "connection", value: connectionId }],
            },
            {
              kind: "list",
              items: [
                "The connection metadata was deleted. Existing one-time secrets were not shown.",
              ],
            },
          ],
          stdout: () => [],
          json: () => ({ connection: result.connection }),
          next: () => [],
        },
      ),
    );
  },
});
