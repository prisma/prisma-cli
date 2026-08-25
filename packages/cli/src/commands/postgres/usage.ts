/** The `postgres usage` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  parseUsageDate,
  resolveDatabase,
  USAGE_PERIOD_EXAMPLE_COMMAND,
} from "../../controllers/database";
import type { DatabaseUsageResult } from "../../types/database";
import {
  branchFlag,
  databasePositional,
  projectFlag,
  resolvePostgresContext,
} from "./context";
import {
  type FieldRow,
  formatUsageMetric,
  usageMetricValue,
} from "./presentation";

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
      value: formatUsageMetric(result.metrics.operations),
    },
    { label: "storage", value: formatUsageMetric(result.metrics.storage) },
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
    {
      label: "operations",
      value: usageMetricValue(result.metrics.operations),
    },
    { label: "storage", value: usageMetricValue(result.metrics.storage) },
    { label: "generated", value: result.generatedAt || "" },
  ];
}

function usagePresentations(result: DatabaseUsageResult): Presentations {
  const rows = fieldRows(result);
  return {
    json: () => result,
    next: () => [],
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
    const from = parseUsageDate(args.flags.from, "--from", "start");
    const to = parseUsageDate(args.flags.to, "--to", "end");
    if (from && to && Date.parse(from) > Date.parse(to)) {
      throw new CliStructuredError(
        "POSTGRES.USAGE_ERROR",
        "Invalid usage period",
        {
          why: "--from must not be later than --to.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Pass a --from date that is on or before the --to date.",
            },
            {
              kind: "run-command",
              label: USAGE_PERIOD_EXAMPLE_COMMAND,
              command: USAGE_PERIOD_EXAMPLE_COMMAND,
            },
          ],
        },
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
  },
});
