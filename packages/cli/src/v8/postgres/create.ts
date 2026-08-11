/** The `postgres create` command. */
import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { ensureProjectId } from "../../controllers/database";
import { usageError } from "../../shell/errors";
import type { DatabaseCreateResult } from "../../types/database";
import { branchFlag, projectFlag, resolvePostgresContext } from "./context";
import { mapPostgresOperationError } from "./errors";
import { postgresTargetLabel, secretBlocks } from "./presentation";

export const postgresCreateCommand = defineCommand({
  args: {
    positionals: {
      name: positional.string({
        brief: "Database name",
        placeholder: "name",
      }),
    },
    flags: {
      region: flag.string({
        brief: "Prisma Postgres region id",
        placeholder: "region",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary:
      "Create a Prisma Postgres database and print its one-time connection URL",
    examples: [
      "postgres create my-db",
      "postgres create my-db --branch feature/foo --region eu-central-1",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const name = args.positionals.name.trim();
      if (!name) {
        throw usageError(
          "Database name required",
          "Database create needs a non-empty name.",
          "Pass a database name.",
          [`${CLI_NAME} postgres create <name>`],
          "database",
        );
      }

      const { provider, projectId, projectName } = await resolvePostgresContext(
        ctx,
        args.flags,
        "postgres create",
      );
      const created = await provider.createDatabase({
        projectId,
        name,
        branchName: args.flags.branch,
        region: args.flags.region,
        signal: ctx.signal,
      });

      const result: DatabaseCreateResult = {
        projectId,
        projectName,
        database: ensureProjectId(created.database, projectId),
        connection: created.connection,
        connectionString: created.connectionString,
      };
      return ok(
        ctx.present(
          { data: result },
          {
            human: () =>
              secretBlocks(
                `Created database "${result.database.name}" in ${postgresTargetLabel(projectName, result.database.branchName)}.`,
                result.connectionString,
              ),
            stdout: () => [result.connectionString],
            json: () => result,
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
