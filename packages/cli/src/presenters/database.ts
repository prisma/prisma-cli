import { renderMutate, renderShow, serializeList } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { formatColumns, renderSummaryLine } from "../shell/ui";
import type {
  DatabaseBackupListResult,
  DatabaseConnectionCreateResult,
  DatabaseConnectionListResult,
  DatabaseConnectionRemoveResult,
  DatabaseConnectionRotateResult,
  DatabaseCreateResult,
  DatabaseListResult,
  DatabaseRemoveResult,
  DatabaseRestoreResult,
  DatabaseShowResult,
  DatabaseSummary,
  DatabaseUsageMetric,
  DatabaseUsageResult,
} from "../types/database";
import {
  renderResolvedProjectContextBlock,
  stripVerboseContext,
} from "./verbose-context";

export function renderDatabaseList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseListResult,
): string[] {
  const ui = context.ui;
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing databases for the resolved project.")}`,
    "",
  ];
  const rail = ui.dim("│");
  lines.push(`${rail}  ${ui.accent("project:")}  ${result.projectName}`);
  if (result.branchName) {
    lines.push(`${rail}  ${ui.accent("branch:")}   ${result.branchName}`);
  }
  lines.push(rail);

  if (result.databases.length === 0) {
    lines.push(`${rail}  ${ui.dim("No databases found.")}`);
    lines.push(
      ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
    );
    return lines;
  }

  const rows = result.databases.map((database) => [
    database.name,
    branchLabel(database),
    database.region ?? "unknown",
    formatStatus(database),
    database.id,
  ]);
  const widths = [
    Math.max("Name".length, ...rows.map((row) => row[0].length)),
    Math.max("Branch".length, ...rows.map((row) => row[1].length)),
    Math.max("Region".length, ...rows.map((row) => row[2].length)),
    Math.max("Status".length, ...rows.map((row) => row[3].length)),
    Math.max("Id".length, ...rows.map((row) => row[4].length)),
  ];

  lines.push(
    `${rail}  ${ui.accent(formatColumns(["Name", "Branch", "Region", "Status", "Id"], widths))}`,
  );
  for (const row of rows) {
    lines.push(`${rail}  ${formatColumns(row, widths)}`);
  }

  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseList(result: DatabaseListResult) {
  return {
    ...serializeList({
      context: {
        project: result.projectName,
        ...(result.branchName ? { branch: result.branchName } : {}),
      },
      items: result.databases.map((database) => ({
        noun: "database",
        label: database.name,
        id: database.id,
        status: database.isDefault ? "default" : null,
      })),
    }),
    projectId: result.projectId,
    branchName: result.branchName,
    databases: result.databases,
  };
}

export function renderDatabaseShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseShowResult,
): string[] {
  const lines = renderShow(
    {
      title: "Showing database metadata.",
      descriptor,
      fields: [
        { key: "project", value: result.projectName },
        { key: "database", value: result.database.name },
        { key: "id", value: result.database.id, tone: "dim" },
        {
          key: "branch",
          value: branchLabel(result.database),
          tone: result.database.branchId ? "default" : "dim",
        },
        {
          key: "region",
          value: result.database.region ?? "unknown",
          tone: result.database.region ? "default" : "dim",
        },
        { key: "status", value: formatStatus(result.database) },
        { key: "connections", value: String(result.connections.length) },
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseShow(result: DatabaseShowResult) {
  return stripVerboseContext(result);
}

export function renderDatabaseCreateStdout(
  _context: CommandContext,
  _descriptor: CommandDescriptor,
  result: DatabaseCreateResult,
): string[] {
  return [result.connectionString];
}

export function renderDatabaseCreate(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: DatabaseCreateResult,
): string[] {
  const ui = context.ui;
  const lines = [
    "Creating database...",
    renderSummaryLine(
      ui,
      "success",
      `Created database "${result.database.name}" in ${formatDatabaseTarget(result.projectName, result.database.branchName)}.`,
    ),
    "  The connection URL below is shown once, so save it now.",
  ];

  if (ui.verbose) {
    lines.push("");
    lines.push(...renderDatabaseCreateVerboseRows(context, result));
  }

  return lines;
}

export function serializeDatabaseCreate(result: DatabaseCreateResult) {
  return stripVerboseContext(result);
}

export function renderDatabaseRemove(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseRemoveResult,
): string[] {
  const lines = renderMutate(
    {
      title: "Removing database.",
      descriptor,
      context: [
        { key: "project", value: result.projectName },
        { key: "database", value: result.database.name },
        { key: "id", value: result.database.id, tone: "dim" },
      ],
      operationDescription: "Removing database",
      operationCount: 1,
      details: ["Database and its connection metadata were removed."],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseRemove(result: DatabaseRemoveResult) {
  return stripVerboseContext(result);
}

export function renderDatabaseConnectionList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseConnectionListResult,
): string[] {
  const ui = context.ui;
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing database connection metadata.")}`,
    "",
  ];
  const rail = ui.dim("│");
  lines.push(`${rail}  ${ui.accent("database:")}  ${result.database.name}`);
  lines.push(rail);

  if (result.connections.length === 0) {
    lines.push(`${rail}  ${ui.dim("No database connections found.")}`);
    lines.push(
      ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
    );
    return lines;
  }

  const rows = result.connections.map((connection) => [
    connection.name,
    connection.id,
    connection.createdAt ?? "unknown",
  ]);
  const widths = [
    Math.max("Name".length, ...rows.map((row) => row[0].length)),
    Math.max("Id".length, ...rows.map((row) => row[1].length)),
    Math.max("Created".length, ...rows.map((row) => row[2].length)),
  ];

  lines.push(
    `${rail}  ${ui.accent(formatColumns(["Name", "Id", "Created"], widths))}`,
  );
  for (const row of rows) {
    lines.push(`${rail}  ${formatColumns(row, widths)}`);
  }

  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseConnectionList(
  result: DatabaseConnectionListResult,
) {
  return {
    ...serializeList({
      context: {
        project: result.projectName,
        database: result.database.name,
      },
      items: result.connections.map((connection) => ({
        noun: "connection",
        label: connection.name,
        id: connection.id,
        status: null,
      })),
    }),
    projectId: result.projectId,
    database: result.database,
    connections: result.connections,
  };
}

export function renderDatabaseConnectionCreateStdout(
  _context: CommandContext,
  _descriptor: CommandDescriptor,
  result: DatabaseConnectionCreateResult,
): string[] {
  return [result.connectionString];
}

export function renderDatabaseConnectionCreate(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: DatabaseConnectionCreateResult,
): string[] {
  const ui = context.ui;
  const lines = [
    "Creating connection...",
    renderSummaryLine(
      ui,
      "success",
      `Added a connection to "${result.database.name}" in ${formatDatabaseTarget(result.projectName, result.database.branchName)}.`,
    ),
    "  The connection URL below is shown once, so save it now.",
  ];

  if (ui.verbose) {
    lines.push("");
    lines.push(...renderDatabaseConnectionCreateVerboseRows(context, result));
  }

  return lines;
}

export function serializeDatabaseConnectionCreate(
  result: DatabaseConnectionCreateResult,
) {
  return stripVerboseContext(result);
}

export function renderDatabaseConnectionRemove(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseConnectionRemoveResult,
): string[] {
  return renderMutate(
    {
      title: "Removing database connection.",
      descriptor,
      context: [
        { key: "connection", value: result.connection.id, tone: "dim" },
      ],
      operationDescription: "Removing database connection",
      operationCount: 1,
      details: [
        "The connection metadata was removed. Existing one-time secrets were not shown.",
      ],
    },
    context.ui,
  );
}

export function serializeDatabaseConnectionRemove(
  result: DatabaseConnectionRemoveResult,
) {
  return { connection: result.connection };
}

export function renderDatabaseUsage(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseUsageResult,
): string[] {
  const lines = renderShow(
    {
      title: "Showing database usage metrics.",
      descriptor,
      fields: [
        { key: "project", value: result.projectName },
        { key: "database", value: result.database.name },
        { key: "id", value: result.database.id, tone: "dim" },
        {
          key: "period",
          value: `${formatUsageTimestamp(result.period.start)} to ${formatUsageTimestamp(result.period.end)}`,
        },
        {
          key: "operations",
          value: formatUsageMetric(result.metrics.operations),
        },
        { key: "storage", value: formatUsageMetric(result.metrics.storage) },
        {
          key: "generated",
          value: formatUsageTimestamp(result.generatedAt),
          tone: "dim",
        },
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseUsage(result: DatabaseUsageResult) {
  return stripVerboseContext(result);
}

export function renderDatabaseBackupList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseBackupListResult,
): string[] {
  const ui = context.ui;
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing platform-created database backups.")}`,
    "",
  ];
  const rail = ui.dim("│");
  lines.push(`${rail}  ${ui.accent("database:")}  ${result.database.name}`);
  if (result.retentionDays !== null) {
    lines.push(
      `${rail}  ${ui.accent("retention:")} ${result.retentionDays} days`,
    );
  }
  lines.push(rail);

  if (result.backups.length === 0) {
    lines.push(`${rail}  ${ui.dim("No backups found.")}`);
    lines.push(
      ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
    );
    return lines;
  }

  const rows = result.backups.map((backup) => [
    backup.id,
    backup.backupType,
    backup.status,
    formatBackupSize(backup.size),
    backup.createdAt,
  ]);
  const widths = [
    Math.max("Id".length, ...rows.map((row) => row[0].length)),
    Math.max("Type".length, ...rows.map((row) => row[1].length)),
    Math.max("Status".length, ...rows.map((row) => row[2].length)),
    Math.max("Size".length, ...rows.map((row) => row[3].length)),
    Math.max("Created".length, ...rows.map((row) => row[4].length)),
  ];

  lines.push(
    `${rail}  ${ui.accent(formatColumns(["Id", "Type", "Status", "Size", "Created"], widths))}`,
  );
  for (const row of rows) {
    lines.push(`${rail}  ${formatColumns(row, widths)}`);
  }

  if (result.hasMore) {
    lines.push(rail);
    lines.push(
      `${rail}  ${ui.dim("More backups exist; raise --limit to see them.")}`,
    );
  }

  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseBackupList(result: DatabaseBackupListResult) {
  return {
    ...serializeList({
      context: {
        project: result.projectName,
        database: result.database.name,
      },
      items: result.backups.map((backup) => ({
        noun: "backup",
        label: backup.id,
        id: backup.id,
        status: null,
      })),
    }),
    projectId: result.projectId,
    database: result.database,
    backups: result.backups,
    retentionDays: result.retentionDays,
    hasMore: result.hasMore,
  };
}

export function renderDatabaseRestore(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: DatabaseRestoreResult,
): string[] {
  const lines = renderMutate(
    {
      title: "Restoring database from backup.",
      descriptor,
      context: [
        { key: "project", value: result.projectName },
        { key: "database", value: result.database.name },
        { key: "id", value: result.database.id, tone: "dim" },
        { key: "backup", value: result.source.backupId },
        ...(result.source.databaseId !== result.database.id
          ? [{ key: "source", value: result.source.databaseId }]
          : []),
      ],
      operationDescription: "Restoring database",
      operationCount: 1,
      details: [
        `The restore is running; the database status is "${result.database.status ?? "recovering"}" until it completes.`,
        "Connections and credentials are preserved.",
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeDatabaseRestore(result: DatabaseRestoreResult) {
  return stripVerboseContext(result);
}

export function renderDatabaseConnectionRotateStdout(
  _context: CommandContext,
  _descriptor: CommandDescriptor,
  result: DatabaseConnectionRotateResult,
): string[] {
  return [result.connectionString];
}

export function renderDatabaseConnectionRotate(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: DatabaseConnectionRotateResult,
): string[] {
  const ui = context.ui;
  const target = result.database
    ? `"${result.database.name}"`
    : `connection ${result.connection.id}`;
  const lines = [
    "Rotating connection...",
    renderSummaryLine(
      ui,
      "success",
      `Rotated credentials for ${target}. The previous credentials no longer work.`,
    ),
    "  The connection URL below is shown once, so save it now.",
  ];

  if (ui.verbose) {
    lines.push("");
    lines.push(...renderDatabaseConnectionRotateVerboseRows(context, result));
  }

  return lines;
}

export function serializeDatabaseConnectionRotate(
  result: DatabaseConnectionRotateResult,
) {
  return result;
}

function renderDatabaseConnectionRotateVerboseRows(
  context: CommandContext,
  result: DatabaseConnectionRotateResult,
): string[] {
  const rows = [
    ...(result.database
      ? [
          [
            "database",
            formatResourceWithId(
              context,
              result.database.name,
              result.database.id,
            ),
          ],
        ]
      : []),
    [
      "connection",
      formatResourceWithId(
        context,
        result.connection.name,
        result.connection.id,
      ),
    ],
  ];

  return renderMetadataRows(rows);
}

function formatBackupSize(size: number | null): string {
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

function formatUsageTimestamp(value: string | null): string {
  return value || "unknown";
}

/** A metric the API did not report reads "unknown", and a measurement
 *  with no unit prints alone. See `v8/postgres/presentation.ts`. */
function formatUsageMetric(metric: DatabaseUsageMetric): string {
  if (metric.used === null) {
    return "unknown";
  }
  return metric.unit ? `${metric.used} ${metric.unit}` : String(metric.used);
}

/** The status the API reported, or the word for none. `isDefault` is a
 *  different fact and never stands in for a status. */
function formatStatus(database: DatabaseSummary): string {
  return database.status ?? "unknown";
}

/** "unscoped" is a claim that the database belongs to no branch, so only
 *  an absent `branchId` may produce it. The API does not always send a
 *  branch name beside the id it does send. */
function branchLabel(database: DatabaseSummary): string {
  return database.branchName ?? database.branchId ?? "unscoped";
}

function formatDatabaseTarget(
  projectName: string,
  branchName: string | null,
): string {
  return branchName ? `${projectName} / ${branchName}` : projectName;
}

function renderDatabaseCreateVerboseRows(
  context: CommandContext,
  result: DatabaseCreateResult,
): string[] {
  const rows = [
    ...renderWorkspaceProjectRows(result),
    ["branch", result.database.branchName ?? "unscoped"],
    [
      "database",
      formatResourceWithId(context, result.database.name, result.database.id),
    ],
    ["region", result.database.region ?? "unknown"],
    ["status", formatStatus(result.database)],
    [
      "connection",
      formatResourceWithId(
        context,
        result.connection.name,
        result.connection.id,
      ),
    ],
  ];

  return renderMetadataRows(rows);
}

function renderDatabaseConnectionCreateVerboseRows(
  context: CommandContext,
  result: DatabaseConnectionCreateResult,
): string[] {
  const rows = [
    ...renderWorkspaceProjectRows(result),
    ["branch", result.database.branchName ?? "unscoped"],
    [
      "database",
      formatResourceWithId(context, result.database.name, result.database.id),
    ],
    [
      "connection",
      formatResourceWithId(
        context,
        result.connection.name,
        result.connection.id,
      ),
    ],
  ];

  return renderMetadataRows(rows);
}

function renderWorkspaceProjectRows(
  result: DatabaseCreateResult | DatabaseConnectionCreateResult,
): string[][] {
  return [
    ...(result.verboseContext
      ? [["workspace", result.verboseContext.workspace.name]]
      : []),
    ["project", result.projectName],
  ];
}

function formatResourceWithId(
  context: CommandContext,
  name: string,
  id: string,
): string {
  return `${name}  ${context.ui.dim(`(${id})`)}`;
}

function renderMetadataRows(rows: string[][]): string[] {
  const widths = [Math.max(...rows.map((row) => row[0].length)), 0];
  return rows.map(([key, value]) => `  ${formatColumns([key, value], widths)}`);
}
