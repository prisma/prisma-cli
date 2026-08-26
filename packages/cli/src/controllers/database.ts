import { randomBytes } from "node:crypto";
import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";
import type { DatabaseProvider } from "../lib/database/provider";
import type { ResolvedProjectTarget } from "../lib/project/resolution";
import type { DatabaseSummary } from "../types/database";

const USAGE_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const USAGE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

const LIST_DATABASES_COMMAND = `${CLI_NAME} postgres list`;

/** The corrected `postgres usage` form both period errors point at. */
export const USAGE_PERIOD_EXAMPLE_COMMAND = `${CLI_NAME} postgres usage <database> --from 2026-06-01 --to 2026-06-30`;

function userChoice(label: string): NextAction {
  return { kind: "user-choice", label };
}

function runCommand(command: string): NextAction {
  return { kind: "run-command", label: command, command };
}

export function parseUsageDate(
  value: string | undefined,
  flagName: string,
  dayBoundary: "start" | "end",
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  // The Management API validates startDate/endDate as full ISO datetimes, so
  // date-only input is expanded to a full UTC day boundary: --from to the
  // start of its day, --to to the end, keeping `--from X --to Y` a
  // calendar-day-inclusive range without relying on server-side end-of-day
  // handling. Date.parse alone is too permissive: it rolls over invalid
  // calendar dates such as 2026-02-30, so the date part must round-trip
  // through toISOString unchanged.
  const trimmed = value.trim();
  if (USAGE_DATE_ONLY_PATTERN.test(trimmed) && isValidCalendarDate(trimmed)) {
    return dayBoundary === "start"
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999Z`;
  }
  if (
    USAGE_DATETIME_PATTERN.test(trimmed) &&
    !Number.isNaN(Date.parse(trimmed)) &&
    isValidCalendarDate(trimmed.slice(0, 10))
  ) {
    return trimmed;
  }

  throw new CliStructuredError("POSTGRES.USAGE_ERROR", "Invalid usage period", {
    why: `${flagName} must be an ISO date such as 2026-06-01 or an ISO datetime such as 2026-06-01T12:00:00Z.`,
    nextActions: [
      userChoice(`Pass an ISO date or datetime to ${flagName}.`),
      runCommand(USAGE_PERIOD_EXAMPLE_COMMAND),
    ],
  });
}

function isValidCalendarDate(datePart: string): boolean {
  const timestamp = Date.parse(`${datePart}T00:00:00.000Z`);
  return (
    !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString().startsWith(datePart)
  );
}

export function parseBackupLimit(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const limit = Number(value.trim());
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new CliStructuredError(
      "POSTGRES.USAGE_ERROR",
      "Invalid backup limit",
      {
        why: "--limit must be an integer between 1 and 100.",
        nextActions: [
          userChoice("Pass a --limit between 1 and 100."),
          runCommand(`${CLI_NAME} postgres backup list <database> --limit 50`),
        ],
      },
    );
  }

  return limit;
}

export async function resolveDatabase(
  provider: DatabaseProvider,
  target: ResolvedProjectTarget,
  databaseRef: string,
  branchName: string | undefined,
  signal: AbortSignal,
): Promise<DatabaseSummary> {
  const ref = databaseRef.trim();
  if (!ref) {
    throw new CliStructuredError(
      "POSTGRES.USAGE_ERROR",
      "Database id or name required",
      {
        why: "This command needs a database id or name.",
        nextActions: [
          userChoice("Pass a database id or name."),
          runCommand(LIST_DATABASES_COMMAND),
        ],
      },
    );
  }

  const databases = await provider.listDatabases({
    projectId: target.project.id,
    branchName,
    signal,
  });
  // The stable id is primary and the name is the fallback, so a
  // database named like another database's id can never shadow it or
  // make it ambiguous.
  const byId = databases.filter((database) => database.id === ref);
  const matches =
    byId.length > 0
      ? byId
      : databases.filter((database) => database.name === ref);

  if (matches.length === 0) {
    throw databaseNotFoundError(ref, target.project.name, branchName);
  }

  if (matches.length > 1) {
    throw databaseAmbiguousError(ref, matches, branchName);
  }

  const selected = matches[0];
  const shown = await provider.showDatabase(selected.id, {
    projectId: target.project.id,
    signal,
  });
  // `showDatabase` returns null for one condition only: a 404 that is not
  // a plan-limit error, which is the API saying the database is gone.
  // Falling back to the row from the list call taken moments earlier let
  // `postgres delete` name a database in its confirmation prompt that no
  // longer existed. A read the API refused is a failure, not a reason to
  // use an older copy.
  if (shown === null) {
    throw databaseRemovedDuringResolutionError(selected, target.project.name);
  }
  return ensureProjectId(shown, target.project.id);
}

function databaseRemovedDuringResolutionError(
  database: DatabaseSummary,
  projectName: string,
): CliStructuredError {
  return new CliStructuredError("POSTGRES.NOT_FOUND", "Database not found", {
    why: `"${database.name}" (${database.id}) was listed for project "${projectName}", but reading it returned 404. It was most likely removed while this command was running.`,
    nextActions: [
      userChoice(
        "Re-run the command, or list the project's databases to see what is there now.",
      ),
      runCommand(LIST_DATABASES_COMMAND),
    ],
  });
}

export function ensureProjectId(
  database: DatabaseSummary,
  projectId: string,
): DatabaseSummary {
  return database.projectId ? database : { ...database, projectId };
}

export function sortDatabases(databases: DatabaseSummary[]): DatabaseSummary[] {
  return databases.slice().sort((left, right) => {
    const branchOrder = (left.branchName ?? "").localeCompare(
      right.branchName ?? "",
    );
    if (branchOrder !== 0) {
      return branchOrder;
    }

    const nameOrder = left.name.localeCompare(right.name);
    return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
  });
}

export function defaultConnectionName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 17);
  const suffix = randomBytes(2).toString("hex");
  return `cli-${timestamp}-${suffix}`;
}

function databaseNotFoundError(
  databaseRef: string,
  projectName?: string,
  branchName?: string,
): CliStructuredError {
  const scope = projectName
    ? ` in project "${projectName}"${branchName ? ` on branch "${branchName}"` : ""}`
    : "";
  return new CliStructuredError("POSTGRES.NOT_FOUND", "Database not found", {
    why: `No database matched "${databaseRef}"${scope}.`,
    nextActions: [
      userChoice(`Pass a database id or name from ${LIST_DATABASES_COMMAND}.`),
      runCommand(LIST_DATABASES_COMMAND),
    ],
  });
}

function databaseAmbiguousError(
  databaseRef: string,
  matches: DatabaseSummary[],
  branchName: string | undefined,
): CliStructuredError {
  return new CliStructuredError(
    "POSTGRES.AMBIGUOUS",
    "Database resolution is ambiguous",
    {
      why: branchName
        ? `Multiple databases matched "${databaseRef}" on branch "${branchName}".`
        : `Multiple databases matched "${databaseRef}".`,
      meta: {
        matches: matches.map((database) => ({
          id: database.id,
          name: database.name,
          branchName: database.branchName,
        })),
      },
      nextActions: [
        userChoice(
          "Pass the database id, or pass --branch <git-name> to narrow the match.",
        ),
        runCommand(LIST_DATABASES_COMMAND),
      ],
    },
  );
}
