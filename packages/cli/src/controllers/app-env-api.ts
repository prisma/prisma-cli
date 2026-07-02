import type { ManagementApiClient } from "@prisma/management-api-sdk";

import type { EnvVarRole } from "../lib/app/env-config";
import { authRequiredError, CliError } from "../shell/errors";
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

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

export async function findVariableByNaturalKey(
  client: ManagementApiClient,
  projectId: string,
  key: string,
  resolved: ResolvedEnvApiScope,
  signal: AbortSignal,
): Promise<RawEnvironmentVariable | null> {
  // Filter by branchId server-side — the list pages at 100, so client-side-only filtering drops branch rows past page 1.
  const { data, error, response } = await client.GET(
    "/v1/environment-variables",
    {
      params: {
        query: {
          projectId,
          class: resolved.apiTarget.class,
          key,
          ...(resolved.apiTarget.branchId !== null
            ? { branchId: resolved.apiTarget.branchId }
            : {}),
        },
      },
      signal,
    },
  );
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
  return (
    row.class === resolved.apiTarget.class &&
    row.branchId === resolved.apiTarget.branchId
  );
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
    why:
      apiMessage ??
      `The Management API returned status ${status || "unknown"}.`,
    fix:
      apiHint ?? "Re-run with --trace for the underlying API response details.",
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
