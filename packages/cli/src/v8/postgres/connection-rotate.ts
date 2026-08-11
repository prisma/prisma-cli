/** The `postgres connection rotate` command. */
import { defineCommand, positional } from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { usageError } from "../../shell/errors";
import type { DatabaseConnectionRotateResult } from "../../types/database";
import { legacyCommandFormatter, resolvePostgresProviderOnly } from "./context";
import { mapPostgresOperationError } from "./errors";
import { secretBlocks } from "./presentation";

const CONSENT_QUESTION =
  "Rotating revokes the previous credentials and breaks clients still using them, so it requires the exact connection id.";

export const postgresConnectionRotateCommand = defineCommand({
  args: {
    positionals: {
      connection: positional.string({
        brief: "Connection id",
        placeholder: "connection-id",
      }),
    },
  },
  help: {
    summary:
      "Rotate connection credentials and print the new one-time connection URL",
    examples: ["postgres connection rotate conn_123 --confirm conn_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const connectionId = args.positionals.connection.trim();
      if (!connectionId) {
        throw usageError(
          "Connection id required",
          "Database connection rotation needs a connection id.",
          "Pass the connection id to rotate.",
          [
            legacyCommandFormatter([
              "database",
              "connection",
              "rotate",
              "<connection-id>",
              "--confirm",
              "<connection-id>",
            ]),
          ],
          "database",
        );
      }

      await ctx.prompt.consent(CONSENT_QUESTION, { token: connectionId });

      const provider = await resolvePostgresProviderOnly(ctx);
      const rotated = await provider.rotateConnection(connectionId, {
        signal: ctx.signal,
      });

      const result: DatabaseConnectionRotateResult = {
        connection: rotated.connection,
        database: rotated.database,
        connectionString: rotated.connectionString,
      };
      const subject = result.database
        ? `"${result.database.name}"`
        : `connection ${result.connection.id}`;
      return ok(
        ctx.present(
          { data: result },
          {
            human: () =>
              secretBlocks(
                `Rotated credentials for ${subject}. The previous credentials no longer work.`,
                result.connectionString,
              ),
            stdout: () => [result.connectionString],
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
