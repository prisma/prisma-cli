// biome-ignore-all lint/performance/noAwaitInLoops: Branch pagination requests must run sequentially.

import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import type { BranchRole, BranchSummary } from "../types/branch";

export interface RawBranchRecord {
  id: string;
  gitName: string;
  role: BranchRole;
}

export function sortBranches(branches: BranchSummary[]): BranchSummary[] {
  return branches.slice().sort((left, right) => {
    const leftRank = branchOrder(left);
    const rightRank = branchOrder(right);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.name.localeCompare(right.name);
  });
}

function branchOrder(branch: BranchSummary): number {
  return branch.role === "production" ? 0 : 1;
}

export async function listBranches(
  client: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<RawBranchRecord[]> {
  const collected: RawBranchRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query: Record<string, string | undefined> = {};
    if (cursor !== undefined) {
      query.cursor = cursor;
    }

    const { data, error, response } = await client.GET(
      "/v1/projects/{projectId}/branches",
      {
        params: { path: { projectId }, query },
        signal,
      },
    );
    if (error || !data) {
      throw branchApiError("Failed to list branches", response, error);
    }

    collected.push(...(data.data as RawBranchRecord[]));

    if (!data.pagination.hasMore || !data.pagination.nextCursor) {
      break;
    }
    cursor = data.pagination.nextCursor;
  }

  return collected;
}

export function toBranchSummary(branch: RawBranchRecord): BranchSummary {
  return {
    id: branch.id,
    name: branch.gitName,
    role: branch.role,
    envMap: branch.role,
  };
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

function branchApiError(
  summary: string,
  response: Response | undefined,
  error: ApiErrorBody | undefined,
): CliStructuredError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  return new CliStructuredError("BRANCH.API_ERROR", summary, {
    why:
      error?.error?.message ??
      `The Management API returned status ${status || "unknown"}.`,
    ...(status || apiCode !== undefined
      ? {
          meta: {
            ...(status ? { status } : {}),
            ...(apiCode !== undefined ? { apiCode } : {}),
          },
        }
      : {}),
    nextActions: [
      {
        kind: "user-choice",
        label:
          error?.error?.hint ??
          "Re-run with --log-level verbose for the underlying API response details.",
      },
    ],
  });
}
