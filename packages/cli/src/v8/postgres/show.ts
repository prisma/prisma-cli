/** The `postgres show` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { resolveDatabase } from "../../controllers/database";
import type { DatabaseShowResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import { mapPostgresOperationError } from "./errors";
import { type FieldRow, formatStatus, statusValue } from "./presentation";

const TITLE = "Showing database metadata.";

function fieldRows(result: DatabaseShowResult): FieldRow[] {
  return [
    { label: "project", value: result.projectName },
    { label: "database", value: result.database.name },
    { label: "id", value: result.database.id },
    { label: "branch", value: result.database.branchName ?? "unscoped" },
    { label: "region", value: result.database.region ?? "unknown" },
    { label: "status", value: formatStatus(result.database) },
    { label: "connections", value: String(result.connections.length) },
  ];
}

/** The stdout mirror of the field rows: same labels, raw values. An
 *  absent branch, region or status is an empty field rather than the
 *  word the card shows a reader. */
function stdoutFieldRows(result: DatabaseShowResult): FieldRow[] {
  return [
    { label: "project", value: result.projectName },
    { label: "database", value: result.database.name },
    { label: "id", value: result.database.id },
    { label: "branch", value: result.database.branchName ?? "" },
    { label: "region", value: result.database.region ?? "" },
    { label: "status", value: statusValue(result.database) },
    { label: "connections", value: String(result.connections.length) },
  ];
}

function showPresentations(result: DatabaseShowResult): Presentations {
  const rows = fieldRows(result);
  return {
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      { kind: "fields", rows },
    ],
    stdout: () =>
      stdoutFieldRows(result).map((row) => `${row.label}: ${row.value}`),
  };
}

export const postgresShowCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: { project: projectFlag, branch: branchFlag },
  },
  help: {
    summary: "Show database metadata without secret values",
    examples: [
      "postgres show db_123",
      "postgres show acme-preview --branch preview --json",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const { provider, target, projectId, projectName } =
        await resolvePostgresContext(ctx, args.flags, "postgres show");
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

      const result: DatabaseShowResult = {
        projectId,
        projectName,
        database,
        connections,
      };
      return ok(ctx.present({ data: result }, showPresentations(result)));
    } catch (error) {
      const mapped = mapPostgresOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
