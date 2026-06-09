import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { CliError } from "../../shell/errors";
import type { DatabaseConnectionSummary, DatabaseSummary } from "../../types/database";

export interface DatabaseCreateInput {
  projectId: string;
  name: string;
  branchName?: string;
  region?: string;
  signal?: AbortSignal;
}

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

export interface DatabaseProvider {
  listDatabases(options: {
    projectId: string;
    branchName?: string;
    signal?: AbortSignal;
  }): Promise<DatabaseSummary[]>;
  showDatabase(databaseId: string, options?: { signal?: AbortSignal }): Promise<DatabaseSummary | null>;
  createDatabase(options: DatabaseCreateInput): Promise<DatabaseCreateRecord>;
  removeDatabase(databaseId: string, options?: { signal?: AbortSignal }): Promise<void>;
  listConnections(databaseId: string, options?: { signal?: AbortSignal }): Promise<DatabaseConnectionSummary[]>;
  createConnection(options: DatabaseConnectionCreateInput): Promise<DatabaseConnectionCreateRecord>;
  removeConnection(connectionId: string, options?: { signal?: AbortSignal }): Promise<void>;
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

export function createManagementDatabaseProvider(client: ManagementApiClient): DatabaseProvider {
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
          throw databaseApiError("Failed to list databases", result.response, result.error);
        }

        databases.push(...result.data.data as RawDatabaseRecord[]);

        if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
          break;
        }
        cursor = result.data.pagination.nextCursor;
      }

      return databases.map((database) => normalizeDatabase(database, options.projectId));
    },

    async showDatabase(databaseId, options) {
      const result = await client.GET("/v1/databases/{databaseId}", {
        params: {
          path: { databaseId },
        },
        signal: options?.signal,
      });
      if (result.response?.status === 404) {
        return null;
      }
      if (result.error || !result.data) {
        throw databaseApiError("Failed to show database", result.response, result.error);
      }

      return normalizeDatabase(result.data.data as RawDatabaseRecord, "");
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
        throw databaseApiError("Failed to create database", result.response, result.error);
      }

      return normalizeCreatedDatabase(result.data.data as RawDatabaseRecord, options.projectId);
    },

    async removeDatabase(databaseId, options) {
      const result = await client.DELETE("/v1/databases/{databaseId}", {
        params: {
          path: { databaseId },
        },
        signal: options?.signal,
      });
      if (result.error) {
        throw databaseApiError("Failed to remove database", result.response, result.error);
      }
    },

    async listConnections(databaseId, options) {
      const result = await client.GET("/v1/databases/{databaseId}/connections", {
        params: {
          path: { databaseId },
        },
        signal: options?.signal,
      });
      if (result.error || !result.data) {
        throw databaseApiError("Failed to list database connections", result.response, result.error);
      }

      return (result.data.data as RawDatabaseConnectionRecord[]).map((connection) => normalizeConnection(connection, databaseId));
    },

    async createConnection(options) {
      const result = await client.POST("/v1/databases/{databaseId}/connections", {
        params: {
          path: { databaseId: options.databaseId },
        },
        body: {
          name: options.name,
        } as never,
        signal: options.signal,
      });
      if (result.error || !result.data) {
        throw databaseApiError("Failed to create database connection", result.response, result.error);
      }

      return normalizeCreatedConnection(result.data.data as RawDatabaseConnectionRecord, options.databaseId);
    },

    async removeConnection(connectionId, options) {
      const result = await client.DELETE("/v1/connections/{id}", {
        params: {
          path: { id: connectionId },
        },
        signal: options?.signal,
      });
      if (result.error) {
        throw databaseApiError("Failed to remove database connection", result.response, result.error);
      }
    },
  };
}

export function normalizeDatabase(database: RawDatabaseRecord, fallbackProjectId: string): DatabaseSummary {
  return {
    id: database.id,
    name: database.name,
    projectId: database.projectId ?? fallbackProjectId,
    branchId: database.branchId ?? database.branch?.id ?? null,
    branchName: database.branchGitName ?? database.branchName ?? database.branch?.gitName ?? database.branch?.name ?? null,
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

export function normalizeCreatedDatabase(database: RawDatabaseRecord, fallbackProjectId: string): DatabaseCreateRecord {
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
      nextSteps: [`prisma-cli database connection create ${fallbackDatabaseId}`],
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

function extractConnectionString(connection: RawDatabaseConnectionRecord): string | null {
  return connection.endpoints?.pooled?.connectionString
    ?? connection.connectionString
    ?? connection.endpoints?.direct?.connectionString
    ?? connection.endpoints?.accelerate?.connectionString
    ?? null;
}

function databaseApiError(
  summary: string,
  response: Response | undefined,
  error: RawApiErrorBody | undefined,
): CliError {
  const status = response?.status ?? 0;
  return new CliError({
    code: error?.error?.code ?? "DATABASE_API_ERROR",
    domain: "database",
    summary,
    why: error?.error?.message ?? `The Management API returned status ${status || "unknown"}.`,
    fix: error?.error?.hint ?? "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}
