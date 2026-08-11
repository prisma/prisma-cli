/** The `postgres usage` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { parseUsageDate, resolveDatabase } from "../../controllers/database";
import { usageError } from "../../shell/errors";
import type { DatabaseUsageResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  legacyCommandFormatter,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import { mapPostgresOperationError } from "./errors";
import type { FieldRow } from "./presentation";

const TITLE = "Showing database usage metrics.";

function fieldRows(result: DatabaseUsageResult): FieldRow[] {
  return [
    { label: "project", value: result.projectName },
    { label: "database", value: result.database.name },
    { label: "id", value: result.database.id },
    {
      label: "period",
      value: `${result.period.start || "unknown"} to ${result.period.end || "unknown"}`,
    },
    {
      label: "operations",
      value: `${result.metrics.operations.used} ${result.metrics.operations.unit}`,
    },
    {
      label: "storage",
      value: `${result.metrics.storage.used} ${result.metrics.storage.unit}`,
    },
    { label: "generated", value: result.generatedAt || "unknown" },
  ];
}

/** The stdout mirror of the field rows. The reader's card carries the
 *  unit beside each metric and the word "unknown" for an absent value;
 *  stdout carries the number and an empty field, because that is what a
 *  program can consume. The units and the period bounds are both in the
 *  `--json` record. */
function stdoutFieldRows(result: DatabaseUsageResult): FieldRow[] {
  return [
    { label: "project", value: result.projectName },
    { label: "database", value: result.database.name },
    { label: "id", value: result.database.id },
    { label: "period start", value: result.period.start || "" },
    { label: "period end", value: result.period.end || "" },
    { label: "operations", value: String(result.metrics.operations.used) },
    { label: "storage", value: String(result.metrics.storage.used) },
    { label: "generated", value: result.generatedAt || "" },
  ];
}

function usagePresentations(result: DatabaseUsageResult): Presentations {
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

export const postgresUsageCommand = defineCommand({
  args: {
    positionals: { database: databasePositional },
    flags: {
      from: flag.string({
        brief: "Start of the usage period",
        placeholder: "iso-date",
      }),
      to: flag.string({
        brief: "End of the usage period",
        placeholder: "iso-date",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary: "Show usage metrics for a database",
    examples: [
      "postgres usage db_123",
      "postgres usage acme-production --from 2026-06-01 --to 2026-06-30",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const from = parseUsageDate(
        args.flags.from,
        "--from",
        "start",
        legacyCommandFormatter,
      );
      const to = parseUsageDate(
        args.flags.to,
        "--to",
        "end",
        legacyCommandFormatter,
      );
      if (from && to && Date.parse(from) > Date.parse(to)) {
        throw usageError(
          "Invalid usage period",
          "--from must not be later than --to.",
          "Pass a --from date that is on or before the --to date.",
          [
            legacyCommandFormatter([
              "database",
              "usage",
              "<database>",
              "--from",
              "2026-06-01",
              "--to",
              "2026-06-30",
            ]),
          ],
          "database",
        );
      }

      const { provider, target, projectId, projectName } =
        await resolvePostgresContext(ctx, args.flags, "postgres usage");
      const database = await resolveDatabase(
        provider,
        target,
        args.positionals.database,
        args.flags.branch,
        ctx.signal,
      );
      const usage = await provider.getUsage(database.id, {
        from,
        to,
        signal: ctx.signal,
      });

      const result: DatabaseUsageResult = {
        projectId,
        projectName,
        database,
        period: usage.period,
        metrics: usage.metrics,
        generatedAt: usage.generatedAt,
      };
      return ok(ctx.present({ data: result }, usagePresentations(result)));
    } catch (error) {
      const mapped = mapPostgresOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
