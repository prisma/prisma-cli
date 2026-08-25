/** The `postgres connection create` command. */
import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  defaultConnectionName,
  resolveDatabase,
} from "../../controllers/database";
import type { DatabaseConnectionCreateResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import { postgresTargetLabel, secretBlocks } from "./presentation";

export const postgresConnectionCreateCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: {
      name: flag.string({ brief: "Connection name", placeholder: "name" }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary:
      "Create a database connection and print its one-time connection URL",
    examples: [
      "postgres connection create db_123",
      "postgres connection create db_123 --name readonly",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, target, projectId, projectName } =
      await resolvePostgresContext(
        ctx,
        args.flags,
        "postgres connection create",
      );
    const database = await resolveDatabase(
      provider,
      target,
      args.positionals.database,
      args.flags.branch,
      ctx.signal,
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
