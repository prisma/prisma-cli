import type { ManagementApiClient } from "@prisma/management-api-sdk";

import type { EnvVarRole } from "../lib/app/env-config";
import { authRequiredError, CliError, featureUnavailableError } from "../shell/errors";
import type { EnvScopeDescriptor, EnvVariableMetadata } from "../types/app-env";

export interface ResolvedEnvApiScope {
  descriptor: EnvScopeDescriptor;
  apiTarget: { class: EnvVarRole; branchId: string | null };
}

export interface RawEnvironmentVariable {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
  updatedAt: string;
}

export interface RawPulledEnvironmentVariable {
  key: string;
  value: string;
  source: string;
  isManagedBySystem?: boolean;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

type PullEnvPost = (
  path: "/v1/environment-variables/pull",
  options: {
    body: {
      projectId: string;
      class: "preview";
      branchId?: string;
    };
    signal: AbortSignal;
  },
) => Promise<{
  data?: {
    data?: {
      variables?: RawPulledEnvironmentVariable[];
    };
  };
  error?: ApiErrorBody;
  response?: Response;
}>;

export async function pullPreviewEnvironmentVariables(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchId: string | null;
    signal: AbortSignal;
  },
): Promise<RawPulledEnvironmentVariable[]> {
  const post = client.POST as unknown as PullEnvPost;
  const { data, error, response } = await post("/v1/environment-variables/pull", {
    body: {
      projectId: options.projectId,
      class: "preview",
      ...(options.branchId !== null ? { branchId: options.branchId } : {}),
    },
    signal: options.signal,
  });

  if (error || !data?.data?.variables) {
    if (response?.status === 404 || response?.status === 405 || response?.status === 501) {
      throw featureUnavailableError(
        "Preview environment variable pull is not available yet",
        "The CLI command is ready, but the platform endpoint for returning preview values is not available in this environment.",
        "Retry after the Management API exposes POST /v1/environment-variables/pull.",
        ["prisma-cli project env list --role preview"],
        "app",
      );
    }
    throw apiCallError("Failed to pull preview environment variables", response, error);
  }

  return [...data.data.variables].sort((left, right) => left.key.localeCompare(right.key));
}

export async function findVariableByNaturalKey(
  client: ManagementApiClient,
  projectId: string,
  key: string,
  resolved: ResolvedEnvApiScope,
  signal: AbortSignal,
): Promise<RawEnvironmentVariable | null> {
  const { data, error, response } = await client.GET("/v1/environment-variables", {
    params: {
      query: {
        projectId,
        class: resolved.apiTarget.class,
        key,
      },
    },
    signal,
  });
  if (error || !data) {
    throw apiCallError(`Failed to look up ${key}`, response, error);
  }

  const matches = (data.data as RawEnvironmentVariable[]).filter((row) =>
    rowMatchesExactScope(row, resolved),
  );
  return matches[0] ?? null;
}

export function toMetadata(
  row: RawEnvironmentVariable,
  requestedScope: EnvScopeDescriptor,
): EnvVariableMetadata {
  const rowScope =
    row.branchId === null
      ? ({ kind: "role", role: row.class } satisfies EnvScopeDescriptor)
      : requestedScope;

  return {
    id: row.id,
    key: row.key,
    scope: rowScope,
    source: formatDescriptorLabel(rowScope),
    isManagedBySystem: row.isManagedBySystem,
    updatedAt: row.updatedAt,
  };
}

export function rowMatchesExactScope(
  row: RawEnvironmentVariable,
  resolved: ResolvedEnvApiScope,
): boolean {
  return row.class === resolved.apiTarget.class &&
    row.branchId === resolved.apiTarget.branchId;
}

export function apiCallError(
  summary: string,
  response: Response | undefined,
  error: ApiErrorBody | undefined,
): CliError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  const apiMessage = error?.error?.message;
  const apiHint = error?.error?.hint;

  if (status === 401 || status === 403) {
    return authRequiredError(["prisma auth login"]);
  }

  return new CliError({
    code: apiCode ?? "ENV_API_ERROR",
    domain: "app",
    summary,
    why: apiMessage ?? `The Management API returned status ${status || "unknown"}.`,
    fix: apiHint ?? "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}

function formatDescriptorLabel(scope: EnvScopeDescriptor): string {
  if (scope.kind === "role") {
    return scope.role ?? "unknown";
  }
  if (scope.kind === "overview") {
    return "overview";
  }
  return `branch:${scope.branchName ?? scope.branchId ?? "unknown"}`;
}
