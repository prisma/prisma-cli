/** The `postgres connection remove` command. */
import { type Block, defineCommand, positional } from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { usageError } from "../../shell/errors";
import type { DatabaseConnectionRemoveResult } from "../../types/database";
import { resolvePostgresProviderOnly } from "./context";
import { mapPostgresOperationError } from "./errors";

const CONSENT_QUESTION =
  "Removing this database connection is destructive and requires the exact id.";

export const postgresConnectionRemoveCommand = defineCommand({
  args: {
    positionals: {
      connection: positional.string({
        brief: "Connection id",
        placeholder: "connection-id",
      }),
    },
  },
  help: {
    summary: "Remove a database connection after exact id confirmation",
    examples: ["postgres connection remove conn_123 --confirm conn_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const connectionId = args.positionals.connection.trim();
      if (!connectionId) {
        throw usageError(
          "Connection id required",
          "Database connection removal needs a connection id.",
          "Pass the connection id to remove.",
          [
            `${CLI_NAME} postgres connection remove <connection-id> --confirm <connection-id>`,
          ],
          "database",
        );
      }

      await ctx.prompt.consent(CONSENT_QUESTION, { token: connectionId });

      const provider = await resolvePostgresProviderOnly(ctx);
      await provider.removeConnection(connectionId, { signal: ctx.signal });

      const result: DatabaseConnectionRemoveResult = {
        connection: { id: connectionId },
      };
      return ok(
        ctx.present(
          { data: result },
          {
            human: (): Block[] => [
              {
                kind: "summary",
                tone: "ok",
                text: "Removing database connection.",
              },
              {
                kind: "fields",
                rows: [{ label: "connection", value: connectionId }],
              },
              {
                kind: "list",
                items: [
                  "The connection metadata was removed. Existing one-time secrets were not shown.",
                ],
              },
            ],
            stdout: () => [],
            json: () => ({ connection: result.connection }),
            next: () => [],
          },
        ),
      );
    } catch (error) {
      const mapped = mapPostgresOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
