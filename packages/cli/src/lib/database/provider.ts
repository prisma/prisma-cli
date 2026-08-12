// biome-ignore-all lint/performance/noAwaitInLoops: Database pagination requests must run sequentially.
import type { ManagementApiClient, paths } from "@prisma/management-api-sdk";

import { formatPrismaCliCommand } from "../../cli-command";
import { CliError } from "../../errors";
import type {
  DatabaseConnectionSummary,
  DatabaseSummary,
  DatabaseUsageMetric,
  DatabaseUsageMetrics,
  DatabaseUsagePeriod,
} from "../../types/database";
import type { PrismaCliPackageCommandFormatter } from "../agent/cli-command";

export interface DatabaseCreateInput {
  projectId: string;
  name: string;
  branchName?: string;
  region?: string;
  signal?: AbortSignal;
}

type WorkspaceSubscriptionDetails =
  paths["/v1/workspaces/{id}/subscription"]["get"]["responses"][200]["content"]["application/json"]["data"];
export const SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 3_000;

export interface DatabaseConnectionCreateInput {
  databaseId: string;
  name: string;
  signal?: AbortSignal;
}

export interface DatabaseCreateRecord {
  database: DatabaseSummary;
  connection: DatabaseConnectionSummary;
  connectionString: string;
}

export interface DatabaseConnectionCreateRecord {
  connection: DatabaseConnectionSummary;
  connectionString: string;
}

export interface DatabaseUsageRecord {
  period: DatabaseUsagePeriod;
  metrics: DatabaseUsageMetrics;
  generatedAt: string | null;
}

export interface DatabaseBackupRecord {
  id: string;
  backupType: string;
  status: string;
  size: number | null;
  createdAt: string;
}

export interface DatabaseBackupListRecord {
  backups: DatabaseBackupRecord[];
  retentionDays: number | null;
  hasMore: boolean;
}

export interface DatabaseRestoreInput {
  targetDatabaseId: string;
  sourceDatabaseId: string;
  backupId: string;
  projectId: string;
  signal?: AbortSignal;
}

export interface DatabaseConnectionRotateRecord {
  connection: DatabaseConnectionSummary;
  database: { id: string; name: string } | null;
  connectionString: string;
}

export interface DatabaseProvider {
  listDatabases(options: {
    projectId: string;
    branchName?: string;
    signal?: AbortSignal;
  }): Promise<DatabaseSummary[]>;
  showDatabase(
    databaseId: string,
    options?: {
      projectId?: string;
      signal?: AbortSignal;
    },
  ): Promise<DatabaseSummary | null>;
  createDatabase(options: DatabaseCreateInput): Promise<DatabaseCreateRecord>;
  removeDatabase(
    databaseId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  listConnections(
    databaseId: string,
    options?: { signal?: AbortSignal },
  ): Promise<DatabaseConnectionSummary[]>;
  createConnection(
    options: DatabaseConnectionCreateInput,
  ): Promise<DatabaseConnectionCreateRecord>;
  removeConnection(
    connectionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  getUsage(
    databaseId: string,
    options?: {
      from?: string;
      to?: string;
      signal?: AbortSignal;
    },
  ): Promise<DatabaseUsageRecord>;
  listBackups(
    databaseId: string,
    options?: {
      limit?: number;
      signal?: AbortSignal;
    },
  ): Promise<DatabaseBackupListRecord>;
  restoreDatabase(options: DatabaseRestoreInput): Promise<DatabaseSummary>;
  rotateConnection(
    connectionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<DatabaseConnectionRotateRecord>;
}

interface RawApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface RawRegion {
  id?: string | null;
  name?: string | null;
}

interface RawBranch {
  id?: string | null;
  gitName?: string | null;
  name?: string | null;
}

interface RawConnectionEndpoint {
  connectionString?: string | null;
}

interface RawDatabaseConnectionRecord {
  id: string;
  name?: string | null;
  databaseId?: string | null;
  createdAt?: string | null;
  connectionString?: string | null;
  endpoints?: {
    pooled?: RawConnectionEndpoint | null;
    direct?: RawConnectionEndpoint | null;
    accelerate?: RawConnectionEndpoint | null;
  } | null;
  database?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

interface RawDatabaseUsageRecord {
  period?: {
    start?: string | null;
    end?: string | null;
  } | null;
  metrics?: {
    operations?: { used?: number | null; unit?: string | null } | null;
    storage?: { used?: number | null; unit?: string | null } | null;
  } | null;
  generatedAt?: string | null;
}

interface RawDatabaseBackupRecord {
  id: string;
  backupType?: string | null;
  status?: string | null;
  size?: number | null;
  createdAt?: string | null;
}

interface RawDatabaseBackupListBody {
  data?: RawDatabaseBackupRecord[] | null;
  meta?: { backupRetentionDays?: number | null } | null;
  pagination?: { hasMore?: boolean | null } | null;
}

interface RawDatabaseRecord {
  id: string;
  name: string;
  projectId?: string | null;
  branchId?: string | null;
  branchGitName?: string | null;
  branchName?: string | null;
  branch?: RawBranch | null;
  region?: RawRegion | string | null;
  regionId?: string | null;
  status?: string | null;
  isDefault?: boolean | null;
  createdAt?: string | null;
  connections?: RawDatabaseConnectionRecord[] | null;
}

export function createManagementDatabaseProvider(
  client: ManagementApiClient,
  options?: {
    formatCommand?: PrismaCliPackageCommandFormatter;
    workspaceId?: string;
  },
): DatabaseProvider {
  const formatCommand =
    options?.formatCommand ?? ((args) => formatPrismaCliCommand(args));
  const toDatabaseApiError = (
    summary: string,
    response: Response | undefined,
    error: RawApiErrorBody | undefined,
    signal?: AbortSignal,
  ) =>
    databaseApiError({
      client,
      workspaceId: options?.workspaceId,
      summary,
      response,
      error,
      signal,
    });

  return {
    async listDatabases(options) {
      const databases: RawDatabaseRecord[] = [];
      let cursor: string | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await client.GET("/v1/databases", {
          params: {
            query: {
              projectId: options.projectId,
              branchGitName: options.branchName,
              cursor,
            },
          },
          signal: options.signal,
        });
        if (result.error || !result.data) {
          throw await toDatabaseApiError(
            "Failed to list databases",
            result.response,
            result.error,
            options.signal,
          );
        }

        databases.push(...(result.data.data as RawDatabaseRecord[]));

        if (
          !result.data.pagination.hasMore ||
          !result.data.pagination.nextCursor
        ) {
          break;
        }
        cursor = result.data.pagination.nextCursor;
      }

      return databases.map((database) =>
        normalizeDatabase(database, options.projectId),
      );
    },

    async showDatabase(databaseId, options) {
      const result = await client.GET("/v1/databases/{databaseId}", {
        params: {
          path: { databaseId },
        },
        signal: options?.signal,
      });
      if (
        result.response?.status === 404 &&
        !isPlanLimitApiError(result.error)
      ) {
        return null;
      }
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to show database",
          result.response,
          result.error,
          options?.signal,
        );
      }

      const database = result.data.data as RawDatabaseRecord;
      return normalizeDatabase(
        database,
        requireDatabaseProjectId(database, options?.projectId),
      );
    },

    async createDatabase(options) {
      const result = await client.POST("/v1/databases", {
        body: {
          projectId: options.projectId,
          name: options.name,
          source: { type: "empty" },
          ...(options.branchName ? { branchGitName: options.branchName } : {}),
          ...(options.region ? { region: options.region } : {}),
        } as never,
        signal: options.signal,
      });
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to create database",
          result.response,
          result.error,
          options.signal,
        );
      }

      return normalizeCreatedDatabase(
        result.data.data as RawDatabaseRecord,
        options.projectId,
      );
    },

    async removeDatabase(databaseId, options) {
      const result = await client.DELETE("/v1/databases/{databaseId}", {
        params: {
          path: { databaseId },
        },
        signal: options?.signal,
      });
      if (result.error) {
        throw await toDatabaseApiError(
          "Failed to remove database",
          result.response,
          result.error,
          options?.signal,
        );
      }
    },

    async listConnections(databaseId, options) {
      const result = await client.GET(
        "/v1/databases/{databaseId}/connections",
        {
          params: {
            path: { databaseId },
          },
          signal: options?.signal,
        },
      );
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to list database connections",
          result.response,
          result.error,
          options?.signal,
        );
      }

      return (result.data.data as RawDatabaseConnectionRecord[]).map(
        (connection) => normalizeConnection(connection, databaseId),
      );
    },

    async createConnection(options) {
      const result = await client.POST(
        "/v1/databases/{databaseId}/connections",
        {
          params: {
            path: { databaseId: options.databaseId },
          },
          body: {
            name: options.name,
          } as never,
          signal: options.signal,
        },
      );
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to create database connection",
          result.response,
          result.error,
          options.signal,
        );
      }

      return normalizeCreatedConnection(
        result.data.data as RawDatabaseConnectionRecord,
        options.databaseId,
      );
    },

    async removeConnection(connectionId, options) {
      const result = await client.DELETE("/v1/connections/{id}", {
        params: {
          path: { id: connectionId },
        },
        signal: options?.signal,
      });
      if (result.error) {
        throw await toDatabaseApiError(
          "Failed to remove database connection",
          result.response,
          result.error,
          options?.signal,
        );
      }
    },

    async getUsage(databaseId, options) {
      const result = await client.GET("/v1/databases/{databaseId}/usage", {
        params: {
          path: { databaseId },
          query: {
            ...(options?.from ? { startDate: options.from } : {}),
            ...(options?.to ? { endDate: options.to } : {}),
          },
        },
        signal: options?.signal,
      });
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to fetch database usage",
          result.response,
          result.error,
          options?.signal,
        );
      }

      return normalizeUsage(result.data as RawDatabaseUsageRecord);
    },

    async listBackups(databaseId, options) {
      const result = await client.GET("/v1/databases/{databaseId}/backups", {
        params: {
          path: { databaseId },
          query: {
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
          },
        },
        signal: options?.signal,
      });
      if (
        result.response?.status === 422 &&
        !isPlanLimitApiError(result.error)
      ) {
        throw backupsUnsupportedError(databaseId, result.error);
      }
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to list database backups",
          result.response,
          result.error,
          options?.signal,
        );
      }

      return normalizeBackupList(result.data as RawDatabaseBackupListBody);
    },

    async restoreDatabase(options) {
      const result = await client.POST(
        "/v1/databases/{targetDatabaseId}/restore",
        {
          params: {
            path: { targetDatabaseId: options.targetDatabaseId },
          },
          body: {
            source: {
              type: "backup",
              databaseId: options.sourceDatabaseId,
              backupId: options.backupId,
            },
          },
          signal: options.signal,
        },
      );
      if (
        result.response?.status === 409 &&
        !isPlanLimitApiError(result.error)
      ) {
        throw restoreConflictError(
          options.targetDatabaseId,
          result.error,
          formatCommand,
        );
      }
      // Target and source databases are resolved before this call, so a 404
      // here identifies the backup.
      if (
        result.response?.status === 404 &&
        !isPlanLimitApiError(result.error)
      ) {
        throw restoreBackupNotFoundError(options, result.error, formatCommand);
      }
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to restore database",
          result.response,
          result.error,
          options.signal,
        );
      }

      return normalizeDatabase(
        result.data.data as RawDatabaseRecord,
        options.projectId,
      );
    },

    async rotateConnection(connectionId, options) {
      const result = await client.POST("/v1/connections/{id}/rotate", {
        params: {
          path: { id: connectionId },
        },
        signal: options?.signal,
      });
      if (result.error || !result.data) {
        throw await toDatabaseApiError(
          "Failed to rotate database connection",
          result.response,
          result.error,
          options?.signal,
        );
      }

      return normalizeRotatedConnection(
        result.data.data as RawDatabaseConnectionRecord,
      );
    },
  };
}

export function normalizeDatabase(
  database: RawDatabaseRecord,
  fallbackProjectId: string,
): DatabaseSummary {
  return {
    id: database.id,
    name: database.name,
    projectId: database.projectId ?? fallbackProjectId,
    branchId: database.branchId ?? database.branch?.id ?? null,
    branchName:
      database.branchGitName ??
      database.branchName ??
      database.branch?.gitName ??
      database.branch?.name ??
      null,
    region: normalizeRegion(database),
    status: database.status ?? null,
    isDefault: database.isDefault ?? null,
    createdAt: database.createdAt ?? null,
  };
}

export function normalizeConnection(
  connection: RawDatabaseConnectionRecord,
  fallbackDatabaseId: string,
): DatabaseConnectionSummary {
  return {
    id: connection.id,
    name: connection.name ?? connection.id,
    databaseId: connection.databaseId ?? fallbackDatabaseId,
    createdAt: connection.createdAt ?? null,
  };
}

export function normalizeCreatedDatabase(
  database: RawDatabaseRecord,
  fallbackProjectId: string,
): DatabaseCreateRecord {
  const rawConnection = database.connections?.[0];
  if (!rawConnection) {
    throw new CliError({
      code: "DATABASE_CONNECTION_MISSING",
      domain: "database",
      summary: "Created database did not return a connection string",
      why: "The Management API created the database but did not include the one-time connection payload.",
      fix: "Create a connection explicitly with prisma-cli database connection create <database>.",
      exitCode: 1,
      nextSteps: [`prisma-cli database connection create ${database.id}`],
    });
  }

  return {
    database: normalizeDatabase(database, fallbackProjectId),
    ...normalizeCreatedConnection(rawConnection, database.id),
  };
}

export function normalizeCreatedConnection(
  connection: RawDatabaseConnectionRecord,
  fallbackDatabaseId: string,
): DatabaseConnectionCreateRecord {
  const connectionString = extractConnectionString(connection);
  if (!connectionString) {
    throw new CliError({
      code: "DATABASE_CONNECTION_STRING_MISSING",
      domain: "database",
      summary: "Created connection did not return a connection string",
      why: "Database connection strings are one-time-view secrets, but the Management API did not include one in this create response.",
      fix: "Create another database connection and store the returned URL immediately.",
      exitCode: 1,
      nextSteps: [
        `prisma-cli database connection create ${fallbackDatabaseId}`,
      ],
    });
  }

  return {
    connection: normalizeConnection(connection, fallbackDatabaseId),
    connectionString,
  };
}

function normalizeRegion(database: RawDatabaseRecord): string | null {
  if (typeof database.region === "string") {
    return database.region;
  }
  return database.region?.id ?? database.regionId ?? null;
}

function requireDatabaseProjectId(
  database: RawDatabaseRecord,
  fallbackProjectId: string | undefined,
): string {
  const projectId = database.projectId ?? fallbackProjectId;
  if (projectId) {
    return projectId;
  }

  throw new CliError({
    code: "DATABASE_API_ERROR",
    domain: "database",
    summary: "Database response did not include a project id",
    why: "The Management API returned database metadata without project context.",
    fix: "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}

function extractConnectionString(
  connection: RawDatabaseConnectionRecord,
): string | null {
  return (
    connection.endpoints?.pooled?.connectionString ??
    connection.connectionString ??
    connection.endpoints?.direct?.connectionString ??
    connection.endpoints?.accelerate?.connectionString ??
    null
  );
}

/** Absence is carried, not filled in. A `0` here reached the card, the
 *  stdout lane and the json record as though the API had measured it, and
 *  "you used nothing" is the answer a user acts on. The unit is the same
 *  problem an order of magnitude worse: `GiB` was a guess, and a value the
 *  API denominates in bytes would print against it unchanged. */
function normalizeUsageMetric(
  metric: { used?: number | null; unit?: string | null } | null | undefined,
): DatabaseUsageMetric {
  return { used: metric?.used ?? null, unit: metric?.unit ?? null };
}

export function normalizeUsage(
  usage: RawDatabaseUsageRecord,
): DatabaseUsageRecord {
  return {
    period: {
      start: usage.period?.start ?? null,
      end: usage.period?.end ?? null,
    },
    metrics: {
      operations: normalizeUsageMetric(usage.metrics?.operations),
      storage: normalizeUsageMetric(usage.metrics?.storage),
    },
    generatedAt: usage.generatedAt ?? null,
  };
}

export function normalizeBackupList(
  body: RawDatabaseBackupListBody,
): DatabaseBackupListRecord {
  return {
    backups: (body.data ?? []).map((backup) => ({
      id: backup.id,
      // Absence is carried, not renamed: "unknown" here reached the json
      // envelope as though the API had said it, and a consumer could not
      // tell it from a real value. The human table supplies the word.
      backupType: backup.backupType ?? "",
      status: backup.status ?? "",
      size: backup.size ?? null,
      createdAt: backup.createdAt ?? "",
    })),
    retentionDays: body.meta?.backupRetentionDays ?? null,
    hasMore: body.pagination?.hasMore ?? false,
  };
}

export function normalizeRotatedConnection(
  connection: RawDatabaseConnectionRecord,
): DatabaseConnectionRotateRecord {
  const connectionString = extractConnectionString(connection);
  if (!connectionString) {
    throw new CliError({
      code: "DATABASE_CONNECTION_STRING_MISSING",
      domain: "database",
      summary: "Rotated connection did not return a connection string",
      why: "Rotated connection strings are one-time-view secrets, but the Management API did not include one in this rotate response.",
      fix: "Re-run the rotation, or create a replacement connection and store the returned URL immediately.",
      exitCode: 1,
      nextSteps: [],
    });
  }

  const database =
    connection.database?.id && connection.database?.name
      ? { id: connection.database.id, name: connection.database.name }
      : null;

  return {
    connection: normalizeConnection(
      connection,
      connection.database?.id ?? connection.databaseId ?? "",
    ),
    database,
    connectionString,
  };
}

function backupsUnsupportedError(
  databaseId: string,
  error: RawApiErrorBody | undefined,
): CliError {
  return new CliError({
    code: "DATABASE_BACKUPS_UNSUPPORTED",
    domain: "database",
    summary: "Backups are not available for this database",
    why:
      error?.error?.message ??
      `The platform does not manage backups for database "${databaseId}", for example because it is a remote/BYO database.`,
    fix: "Use your own backup tooling for externally managed databases.",
    exitCode: 1,
    nextSteps: [],
  });
}

function restoreBackupNotFoundError(
  options: { backupId: string; sourceDatabaseId: string },
  error: RawApiErrorBody | undefined,
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  const listCommand = formatCommand([
    "database",
    "backup",
    "list",
    options.sourceDatabaseId,
  ]);
  return new CliError({
    code: "DATABASE_BACKUP_NOT_FOUND",
    domain: "database",
    summary: "Database backup not found",
    why:
      error?.error?.message ??
      `No backup matched "${options.backupId}" for database "${options.sourceDatabaseId}".`,
    fix: `Pass a backup id from ${listCommand}.`,
    exitCode: 1,
    nextSteps: [listCommand],
  });
}

function restoreConflictError(
  targetDatabaseId: string,
  error: RawApiErrorBody | undefined,
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "DATABASE_RESTORE_CONFLICT",
    domain: "database",
    summary: "Database cannot be restored right now",
    why:
      error?.error?.message ??
      `Database "${targetDatabaseId}" is provisioning or already recovering.`,
    fix: "Wait for the database to become ready, then retry the restore.",
    exitCode: 1,
    nextSteps: [formatCommand(["database", "show", targetDatabaseId])],
  });
}

async function databaseApiError(options: {
  client: ManagementApiClient;
  workspaceId?: string;
  summary: string;
  response: Response | undefined;
  error: RawApiErrorBody | undefined;
  signal?: AbortSignal;
}): Promise<CliError> {
  if (isPlanLimitApiError(options.error)) {
    return planLimitReachedError(options);
  }

  const status = options.response?.status ?? 0;
  return new CliError({
    code: options.error?.error?.code ?? "DATABASE_API_ERROR",
    domain: "database",
    summary: options.summary,
    why:
      options.error?.error?.message ??
      `The Management API returned status ${status || "unknown"}.`,
    fix:
      options.error?.error?.hint ??
      "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}

async function planLimitReachedError(options: {
  client: ManagementApiClient;
  workspaceId?: string;
  signal?: AbortSignal;
}): Promise<CliError> {
  const subscription = options.workspaceId
    ? await readWorkspaceSubscription(
        options.client,
        options.workspaceId,
        options.signal,
      )
    : null;
  const workspaceLine = options.workspaceId
    ? `Workspace: ${options.workspaceId}`
    : "Workspace: unavailable";
  const planName = subscription?.planName || null;
  const usageBlocked = subscription?.usageBlocked ?? null;
  const upgradeUrl = subscription?.upgradeUrl || null;
  const recoveryLines = [
    ...(planName ? [`Current plan: ${planName}`] : []),
    upgradeUrl
      ? `Upgrade: ${upgradeUrl}`
      : "Upgrade: Open Prisma Console and upgrade the affected workspace plan.",
  ];

  return new CliError({
    code: "PLAN_LIMIT_REACHED",
    domain: "database",
    summary: "Workspace plan limit reached",
    why: "Database operations are blocked because this workspace has used the operations included in its plan. This is a workspace plan limit, not a Prisma outage.",
    fix: upgradeUrl
      ? `Upgrade the workspace plan at ${upgradeUrl}.`
      : "Open Prisma Console and upgrade the affected workspace plan.",
    meta: {
      workspaceId: options.workspaceId ?? null,
      blockedFeature: null,
      planName,
      usageBlocked,
      upgradeUrl,
    },
    exitCode: 1,
    nextSteps: [],
    humanLines: [
      "Workspace plan limit reached [PLAN_LIMIT_REACHED]",
      "",
      "Database operations are blocked because this workspace has used the operations included in its plan. This is a workspace plan limit, not a Prisma outage.",
      "",
      workspaceLine,
      ...recoveryLines,
    ],
  });
}

function isPlanLimitApiError(error: RawApiErrorBody | undefined): boolean {
  return error?.error?.code === "planLimitReached";
}

async function readWorkspaceSubscription(
  client: ManagementApiClient,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceSubscriptionDetails | null> {
  signal?.throwIfAborted();
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    SUBSCRIPTION_LOOKUP_TIMEOUT_MS,
  );
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const result = await client.GET("/v1/workspaces/{id}/subscription", {
      params: { path: { id: workspaceId } },
      signal: requestSignal,
    });
    signal?.throwIfAborted();
    if (result.error) {
      return null;
    }
    return result.data?.data ?? null;
  } catch {
    signal?.throwIfAborted();
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
