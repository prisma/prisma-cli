/** The `postgres connection rotate` command. */
import { defineCommand, positional } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { DatabaseConnectionRotateResult } from "../../types/database";
import { resolvePostgresProviderOnly } from "./context";
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
    const connectionId = args.positionals.connection.trim();
    if (!connectionId) {
      const example = `${CLI_NAME} postgres connection rotate <connection-id> --confirm <connection-id>`;
      throw new CliStructuredError(
        "POSTGRES.USAGE_ERROR",
        "Connection id required",
        {
          why: "Database connection rotation needs a connection id.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Pass the connection id to rotate.",
            },
            { kind: "run-command", label: example, command: example },
          ],
        },
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
          json: () => result,
          next: () => [],
        },
      ),
    );
  },
});
