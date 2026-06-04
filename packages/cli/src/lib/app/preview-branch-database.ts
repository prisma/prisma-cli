import type { ManagementApiClient } from "@prisma/management-api-sdk";

export interface PreviewEnvironmentVariableRecord {
  id: string;
  key: string;
  branchId: string | null;
  className: "production" | "preview";
  isManagedBySystem: boolean;
}

export interface PreviewBranchDatabaseRecord {
  id: string;
  name: string;
  branchId: string | null;
  databaseUrl: string;
  directUrl: string | null;
}

interface RawEnvironmentVariableRecord {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
}

interface RawDatabaseConnectionEndpoint {
  connectionString?: string;
}

interface RawDatabaseRecord {
  id: string;
  name: string;
  branchId: string | null;
  connections?: Array<{
    endpoints?: {
      direct?: RawDatabaseConnectionEndpoint;
      pooled?: RawDatabaseConnectionEndpoint;
      accelerate?: RawDatabaseConnectionEndpoint;
    };
  }>;
}

interface RawApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

export async function createBranchDatabase(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchId: string;
    branchName: string;
    signal?: AbortSignal;
  },
): Promise<PreviewBranchDatabaseRecord> {
  const result = await client.POST("/v1/databases", {
    body: {
      projectId: options.projectId,
      branchId: options.branchId,
      name: options.branchName,
      source: { type: "empty" },
    } as never,
    signal: options.signal,
  });

  if (result.error || !result.data) {
    throw apiCallError(`Failed to create database for branch "${options.branchName}"`, result.response, result.error);
  }

  return normalizeBranchDatabaseRecord(result.data.data as RawDatabaseRecord);
}

export async function listEnvironmentVariables(
  client: ManagementApiClient,
  options: {
    projectId: string;
    className?: "production" | "preview";
    key?: string;
    branchId?: string;
    signal?: AbortSignal;
  },
): Promise<PreviewEnvironmentVariableRecord[]> {
  const variables: RawEnvironmentVariableRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await client.GET("/v1/environment-variables", {
      params: {
        query: {
          projectId: options.projectId,
          class: options.className,
          key: options.key,
          branchId: options.branchId,
          cursor,
        },
      },
      signal: options.signal,
    });
    if (result.error || !result.data) {
      throw apiCallError("Failed to list environment variables", result.response, result.error);
    }

    variables.push(...result.data.data as RawEnvironmentVariableRecord[]);

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      break;
    }
    cursor = result.data.pagination.nextCursor;
  }

  return variables.map((variable) => normalizeEnvironmentVariable(variable));
}

export async function createEnvironmentVariable(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchId?: string;
    className: "production" | "preview";
    key: string;
    value: string;
    signal?: AbortSignal;
  },
): Promise<PreviewEnvironmentVariableRecord> {
  const result = await client.POST("/v1/environment-variables", {
    body: {
      projectId: options.projectId,
      class: options.className,
      key: options.key,
      value: options.value,
      ...(options.branchId ? { branchId: options.branchId } : {}),
    },
    signal: options.signal,
  });

  if (result.error || !result.data) {
    throw apiCallError(`Failed to add ${options.key}`, result.response, result.error);
  }

  return normalizeEnvironmentVariable(result.data.data as RawEnvironmentVariableRecord);
}

function normalizeEnvironmentVariable(variable: RawEnvironmentVariableRecord): PreviewEnvironmentVariableRecord {
  return {
    id: variable.id,
    key: variable.key,
    branchId: variable.branchId,
    className: variable.class,
    isManagedBySystem: variable.isManagedBySystem,
  };
}

function normalizeBranchDatabaseRecord(database: RawDatabaseRecord): PreviewBranchDatabaseRecord {
  const connection = database.connections?.[0];
  const databaseUrl = connection?.endpoints?.pooled?.connectionString;
  const directUrl = connection?.endpoints?.direct?.connectionString ?? null;

  if (!databaseUrl) {
    throw new Error("Created database did not return a pooled connection string.");
  }

  return {
    id: database.id,
    name: database.name,
    branchId: database.branchId,
    databaseUrl,
    directUrl,
  };
}

function apiCallError(
  summary: string,
  response: Response,
  error: RawApiErrorBody,
): Error {
  if (response.status === 404) {
    return new Error("Resource Not Found");
  }

  const message = error.error?.message ?? `Management API returned HTTP ${response.status}.`;
  const hint = error.error?.hint ? ` ${error.error.hint}` : "";
  return new Error(`${summary}: ${message}${hint}`);
}
