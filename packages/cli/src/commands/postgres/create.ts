/** The `postgres create` command. */
import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { ensureProjectId } from "../../controllers/database";
import type { DatabaseCreateResult } from "../../types/database";
import { branchFlag, projectFlag, resolvePostgresContext } from "./context";
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
        brief:
          "Prisma Postgres region id; set it when the data must live near a location",
        placeholder: "region",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary:
      "Create a Prisma Postgres database and print its one-time connection URL",
    description:
      "Creates a database in a Branch of the project and prints its connection URL exactly once; store it now, nothing prints it again. Mint further URLs for other consumers with 'postgres connection create'.",
    examples: [
      "postgres create my-db",
      "postgres create my-db --branch feature/foo --region eu-central-1",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const name = args.positionals.name.trim();
    if (!name) {
      const example = `${CLI_NAME} postgres create <name>`;
      throw new CliStructuredError(
        "POSTGRES.USAGE_ERROR",
        "Database name required",
        {
          why: "Database create needs a non-empty name.",
          nextActions: [
            { kind: "user-choice", label: "Pass a database name." },
            { kind: "run-command", label: example, command: example },
          ],
        },
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
  },
});
