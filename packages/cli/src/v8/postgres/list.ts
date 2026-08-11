/** The `postgres list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { sortDatabases } from "../../controllers/database";
import { serializeDatabaseList } from "../../presenters/database";
import type { DatabaseListResult } from "../../types/database";
import { branchFlag, projectFlag, resolvePostgresContext } from "./context";
import { mapPostgresOperationError } from "./errors";
import { formatStatus, statusValue } from "./presentation";

const TITLE = "Listing databases for the resolved project.";

function databaseRows(result: DatabaseListResult): string[][] {
  return result.databases.map((database) => [
    database.name,
    database.branchName ?? "unscoped",
    database.region ?? "unknown",
    formatStatus(database),
    database.id,
  ]);
}

/** The stdout rows carry the values, not the reader's placeholders:
 *  an absent branch, region or status is an empty field. */
function databaseStdoutRows(result: DatabaseListResult): string[][] {
  return result.databases.map((database) => [
    database.name,
    database.branchName ?? "",
    database.region ?? "",
    statusValue(database),
    database.id,
  ]);
}

function listPresentations(result: DatabaseListResult): Presentations {
  const rows = databaseRows(result);
  const stdoutRows = databaseStdoutRows(result);
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "info", text: TITLE },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectName },
          ...(result.branchName
            ? [{ label: "branch", value: result.branchName }]
            : []),
        ],
      },
      ...(rows.length === 0
        ? [{ kind: "list" as const, items: ["No databases found."] }]
        : [
            {
              kind: "table" as const,
              columns: ["Name", "Branch", "Region", "Status", "Id"],
              rows,
            },
          ]),
    ],
    stdout: () => stdoutRows.map((row) => row.join("\t")),
    json: () => serializeDatabaseList(result),
    next: () => [],
  };
}

export const postgresListCommand = defineCommand({
  args: { flags: { project: projectFlag, branch: branchFlag } },
  help: {
    summary: "List Prisma Postgres databases for the resolved project",
    examples: [
      "postgres list",
      "postgres list --branch feature/foo",
      "postgres list --json",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const { provider, projectId, projectName } = await resolvePostgresContext(
        ctx,
        args.flags,
        "postgres list",
      );
      const databases = sortDatabases(
        await provider.listDatabases({
          projectId,
          branchName: args.flags.branch,
          signal: ctx.signal,
        }),
      );

      const result: DatabaseListResult = {
        projectId,
        projectName,
        branchName: args.flags.branch ?? null,
        databases,
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
