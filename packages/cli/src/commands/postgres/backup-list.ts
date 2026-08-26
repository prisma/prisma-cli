/** The `postgres backup list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { parseBackupLimit, resolveDatabase } from "../../controllers/database";
import { serializeDatabaseBackupList } from "../../presenters/database";
import type { DatabaseBackupListResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import { backupRows, backupStdoutRows } from "./presentation";

const TITLE = "Listing platform-created database backups.";

function backupListPresentations(
  result: DatabaseBackupListResult,
): Presentations {
  const rows = backupRows(result.backups);
  const stdoutRows = backupStdoutRows(result.backups);
  return {
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: [
          { label: "database", value: result.database.name },
          ...(result.retentionDays !== null
            ? [{ label: "retention", value: `${result.retentionDays} days` }]
            : []),
        ],
      },
      ...(rows.length === 0
        ? [
            {
              kind: "summary" as const,
              status: "info" as const,
              text: "No backups found.",
            },
          ]
        : [
            {
              kind: "table" as const,
              columns: ["Id", "Type", "Status", "Size", "Created"],
              rows,
            },
          ]),
      ...(result.hasMore
        ? [
            {
              kind: "list" as const,
              items: ["More backups exist; raise --limit to see them."],
            },
          ]
        : []),
    ],
    stdout: () => stdoutRows.map((row) => row.join("\t")),
    json: () => serializeDatabaseBackupList(result),
  };
}

export const postgresBackupListCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: {
      limit: flag.string({
        brief: "Maximum number of backups to return",
        placeholder: "n",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary: "List backups for a database",
    examples: [
      "postgres backup list db_123",
      "postgres backup list acme-production --limit 50",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const limit = parseBackupLimit(args.flags.limit);
    const { provider, target, projectId, projectName } =
      await resolvePostgresContext(ctx, args.flags, "postgres backup list");
    const database = await resolveDatabase(
      provider,
      target,
      args.positionals.database,
      args.flags.branch,
      ctx.signal,
    );
    const backups = await provider.listBackups(database.id, {
      limit,
      signal: ctx.signal,
    });

    const result: DatabaseBackupListResult = {
      projectId,
      projectName,
      database,
      backups: backups.backups,
      retentionDays: backups.retentionDays,
      hasMore: backups.hasMore,
    };
    return ok(ctx.present({ data: result }, backupListPresentations(result)));
  },
});
