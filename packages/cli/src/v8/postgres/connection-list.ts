/** The `postgres connection list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { resolveDatabase } from "../../controllers/database";
import { serializeDatabaseConnectionList } from "../../presenters/database";
import type { DatabaseConnectionListResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import { mapPostgresOperationError } from "./errors";

const TITLE = "Listing database connection metadata.";

function connectionRows(result: DatabaseConnectionListResult): string[][] {
  return result.connections.map((connection) => [
    connection.name,
    connection.id,
    connection.createdAt ?? "unknown",
  ]);
}

/** The stdout rows: an absent creation time is an empty field. */
function connectionStdoutRows(
  result: DatabaseConnectionListResult,
): string[][] {
  return result.connections.map((connection) => [
    connection.name,
    connection.id,
    connection.createdAt ?? "",
  ]);
}

function listPresentations(
  result: DatabaseConnectionListResult,
): Presentations {
  const rows = connectionRows(result);
  const stdoutRows = connectionStdoutRows(result);
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "info", text: TITLE },
      {
        kind: "fields",
        rows: [{ label: "database", value: result.database.name }],
      },
      ...(rows.length === 0
        ? [{ kind: "list" as const, items: ["No database connections found."] }]
        : [
            {
              kind: "table" as const,
              columns: ["Name", "Id", "Created"],
              rows,
            },
          ]),
    ],
    stdout: () => stdoutRows.map((row) => row.join("\t")),
    json: () => serializeDatabaseConnectionList(result),
    next: () => [],
  };
}

export const postgresConnectionListCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: { project: projectFlag, branch: branchFlag },
  },
  help: {
    summary: "List database connection metadata without secret values",
    examples: [
      "postgres connection list db_123",
      "postgres connection list acme-preview --branch preview --json",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const { provider, target, projectId, projectName } =
        await resolvePostgresContext(
          ctx,
          args.flags,
          "postgres connection list",
        );
      const database = await resolveDatabase(
        provider,
        target,
        args.positionals.database,
        args.flags.branch,
        ctx.signal,
      );
      const connections = await provider.listConnections(database.id, {
        signal: ctx.signal,
      });

      const result: DatabaseConnectionListResult = {
        projectId,
        projectName,
        database,
        connections,
      };
      return ok(ctx.present({ data: result }, listPresentations(result)));
    } catch (error) {
      const mapped = mapPostgresOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
