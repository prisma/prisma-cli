/** The `postgres connection create` command. */
import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { defaultConnectionName } from "../../controllers/database";
import type { DatabaseConnectionCreateResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresDatabase,
} from "./context";
import { postgresTargetLabel, secretBlocks } from "./presentation";

export const postgresConnectionCreateCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: {
      name: flag.string({
        brief:
          "Connection name; use it to record which consumer holds the credential",
        placeholder: "name",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary:
      "Create an additional connection URL for a database; printed exactly once",
    description:
      "Mints an additional credential for an existing database, shown exactly once. Give each consumer (an app, CI, a teammate) its own named connection, so its access can later be rotated or revoked without touching the others.",
    examples: [
      "postgres connection create db_123",
      "postgres connection create db_123 --name readonly",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, projectId, projectName, database } =
      await resolvePostgresDatabase(
        ctx,
        args.flags,
        args.positionals.database,
        "postgres connection create",
      );
    const created = await provider.createConnection({
      databaseId: database.id,
      name: args.flags.name?.trim() || defaultConnectionName(),
      signal: ctx.signal,
    });

    const result: DatabaseConnectionCreateResult = {
      projectId,
      projectName,
      database,
      connection: created.connection,
      connectionString: created.connectionString,
    };
    return ok(
      ctx.present(
        { data: result },
        {
          human: () =>
            secretBlocks(
              `Added a connection to "${database.name}" in ${postgresTargetLabel(projectName, database.branchName)}.`,
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
