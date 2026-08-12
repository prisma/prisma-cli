/** Presentation helpers shared by the `postgres *` commands. */
import type { Block } from "@prisma/cli-engine";
import type {
  DatabaseBackupSummary,
  DatabaseSummary,
  DatabaseUsageMetric,
} from "../../types/database";

export interface FieldRow {
  readonly label: string;
  readonly value: string;
  readonly sensitive?: boolean;
}

/** Legacy `formatDatabaseTarget`. */
export function postgresTargetLabel(
  projectName: string,
  branchName: string | null,
): string {
  return branchName ? `${projectName} / ${branchName}` : projectName;
}

/** The human status cell: the database's own status, or the word for a
 *  status the API did not report. Whether the database is the project's
 *  default is a different fact and never stands in for this one — a
 *  reader could not tell that substitution from a real status, and a
 *  stopped database would have read as healthy. */
export function formatStatus(database: DatabaseSummary): string {
  return database.status ?? "unknown";
}

/** The stdout status cell. The Option A channel ruling makes stdout the
 *  machine-usable payload, so it carries the raw status and nothing
 *  else: an absent status is an empty field, and `isDefault` is a
 *  different fact that does not belong in this one. */
export function statusValue(database: DatabaseSummary): string {
  return database.status ?? "";
}

/** The human usage cell: the measurement with the unit the API gave it.
 *  A metric the API did not report reads "unknown" rather than `0`, and a
 *  measurement with no unit prints alone rather than against a unit the
 *  CLI picked. */
export function formatUsageMetric(metric: DatabaseUsageMetric): string {
  if (metric.used === null) {
    return "unknown";
  }
  return metric.unit ? `${metric.used} ${metric.unit}` : String(metric.used);
}

/** The stdout usage cell: the number the API measured, or an empty field
 *  when it measured none. */
export function usageMetricValue(metric: DatabaseUsageMetric): string {
  return metric.used === null ? "" : String(metric.used);
}

/** The human size cell. `formatBackupSize` is for reading; stdout gets
 *  the byte count through `backupStdoutRows`, because "2.0 KiB" will
 *  not parse back to 2048. */
export function formatBackupSize(size: number | null): string {
  if (size === null) {
    return "unknown";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KiB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

export function backupRows(
  backups: readonly DatabaseBackupSummary[],
): string[][] {
  return backups.map((backup) => [
    backup.id,
    backup.backupType || "unknown",
    backup.status || "unknown",
    formatBackupSize(backup.size),
    backup.createdAt || "unknown",
  ]);
}

export function backupStdoutRows(
  backups: readonly DatabaseBackupSummary[],
): string[][] {
  return backups.map((backup) => [
    backup.id,
    backup.backupType,
    backup.status,
    backup.size === null ? "" : String(backup.size),
    backup.createdAt || "",
  ]);
}

/** The one-time-secret card: the URL is masked in the human blocks
 *  and printed bare on stdout. */
export function secretBlocks(
  headline: string,
  connectionString: string,
): Block[] {
  return [
    { kind: "summary", status: "ok", text: headline },
    {
      kind: "list",
      items: ["The connection URL below is shown once, so save it now."],
    },
    {
      kind: "fields",
      rows: [
        { label: "connection URL", value: connectionString, sensitive: true },
      ],
    },
  ];
}
