/** Presentation helpers shared by the `postgres *` commands. */
import type { Block } from "@prisma/cli-engine";
import type {
  DatabaseBackupSummary,
  DatabaseSummary,
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

export function formatStatus(database: DatabaseSummary): string {
  return database.status ?? (database.isDefault ? "default" : "unknown");
}

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
    backup.backupType,
    backup.status,
    formatBackupSize(backup.size),
    backup.createdAt || "unknown",
  ]);
}

/** The one-time-secret card: the URL is masked in the human blocks
 *  and printed bare on stdout. */
export function secretBlocks(
  headline: string,
  connectionString: string,
): Block[] {
  return [
    { kind: "summary", tone: "ok", text: headline },
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
