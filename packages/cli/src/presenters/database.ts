import { renderMutate, renderShow, serializeList } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { formatColumns, renderSummaryLine } from "../shell/ui";
import type {
  DatabaseConnectionCreateResult,
  DatabaseConnectionListResult,
  DatabaseConnectionRemoveResult,
  DatabaseCreateResult,
  DatabaseListResult,
  DatabaseRemoveResult,
  DatabaseShowResult,
  DatabaseSummary,
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
    database.branchName ?? "unscoped",
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
          value: result.database.branchName ?? "unscoped",
          tone: result.database.branchName ? "default" : "dim",
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

function formatStatus(database: DatabaseSummary): string {
  return database.status ?? (database.isDefault ? "default" : "unknown");
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
