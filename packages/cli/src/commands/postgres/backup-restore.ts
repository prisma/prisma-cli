/** The `postgres backup restore` command. */
import {
  type Block,
  defineCommand,
  flag,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { resolveDatabase } from "../../controllers/database";
import { consentToken, isNodeAddress } from "../../lib/address/node-address";
import type { DatabaseRestoreResult } from "../../types/database";
import { branchFlag, projectFlag, resolvePostgresDatabase } from "./context";
import type { FieldRow } from "./presentation";

function consentQuestion(subject: string): string {
  return `Restoring immediately and irreversibly overwrites all data in the target database, so it requires the exact target database ${isNodeAddress(subject) ? "address" : "id"}.`;
}

function restorePresentations(
  result: DatabaseRestoreResult,
  sourceDatabaseId: string | null,
  targetDatabaseId: string,
): Presentations {
  const rows: FieldRow[] = [
    { label: "project", value: result.projectName },
    { label: "database", value: result.database.name },
    { label: "id", value: result.database.id },
    { label: "backup", value: result.source.backupId },
    ...(sourceDatabaseId ? [{ label: "source", value: sourceDatabaseId }] : []),
  ];

  return {
    stdout: noDataLines(
      "A restore overwrites an existing database and creates nothing new to pass on.",
    ),
    json: () => result,
    human: (): Block[] => [
      {
        kind: "summary",
        status: "ok",
        text: "Restoring database from backup.",
      },
      { kind: "fields", rows },
      {
        kind: "list",
        items: [
          `The restore is running; the database status is "${result.database.status ?? "recovering"}" until it completes.`,
          "Connections and credentials are preserved.",
        ],
      },
    ],
    next: () => [
      {
        kind: "run-command",
        label: `${CLI_NAME} postgres show ${targetDatabaseId}`,
        command: `${CLI_NAME} postgres show ${targetDatabaseId}`,
      },
    ],
  };
}

export const postgresBackupRestoreCommand = defineCommand({
  args: {
    positionals: {
      database: positional.string({
        brief:
          "Target database id or name, or its deploy address: @shop.db (default branch) or @pr-42:shop.db (branch pr-42)",
        placeholder: "database",
      }),
    },
    flags: {
      backup: flag.string({
        brief: "Backup to restore from, listed by 'postgres backup list'",
        placeholder: "backup-id",
      }),
      sourceDatabase: flag.string({
        brief:
          "Database the backup belongs to; use when restoring another database's backup into the target",
        placeholder: "database",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary: "Restore a database from a backup after exact id confirmation",
    description:
      "Replaces the target database's current state with the backup's contents; anything written since that backup is lost, so the exact target database id is the consent token (or the address, when you pass one). To restore another database's backup into this one, name where the backup came from with --source-database.",
    examples: [
      "postgres backup restore db_123 --backup bkp_456 --confirm db_123",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const backupId = args.flags.backup?.trim();
    if (!backupId) {
      const listCommand = `${CLI_NAME} postgres backup list <database>`;
      throw new CliStructuredError(
        "POSTGRES.USAGE_ERROR",
        "Backup id required",
        {
          why: "Database restore needs the backup to restore from.",
          nextActions: [
            {
              kind: "user-choice",
              label: `Pass --backup <backup-id> from ${listCommand}.`,
            },
            { kind: "run-command", label: listCommand, command: listCommand },
          ],
        },
      );
    }

    const { provider, target, projectId, projectName, branchName, database } =
      await resolvePostgresDatabase(
        ctx,
        args.flags,
        args.positionals.database,
        "postgres backup restore",
      );
    const sourceDatabase = args.flags.sourceDatabase
      ? await resolveDatabase(
          provider,
          target,
          args.flags.sourceDatabase,
          branchName,
          ctx.signal,
        )
      : database;

    await ctx.prompt.consent(consentQuestion(args.positionals.database), {
      token: consentToken(args.positionals.database, database.id),
    });

    const restored = await provider.restoreDatabase({
      targetDatabaseId: database.id,
      sourceDatabaseId: sourceDatabase.id,
      backupId,
      projectId,
      signal: ctx.signal,
    });

    const result: DatabaseRestoreResult = {
      projectId,
      projectName,
      database: restored,
      source: { databaseId: sourceDatabase.id, backupId },
    };
    return ok(
      ctx.present(
        { data: result },
        restorePresentations(
          result,
          sourceDatabase.id === database.id ? null : sourceDatabase.id,
          database.id,
        ),
      ),
    );
  },
});
