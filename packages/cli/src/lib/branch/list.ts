import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import type { BranchRole } from "../../types/branch";

export interface BranchRecord {
  readonly id: string;
  readonly gitName: string;
  readonly isDefault: boolean;
  readonly role: BranchRole;
}

/** Every live Branch of a Project, following the cursor through each
 *  page. `gitName` asks the API for the one Branch with that git name. */
export async function listProjectBranches(
  client: Pick<ManagementApiClient, "GET">,
  options: {
    readonly projectId: string;
    readonly gitName?: string | undefined;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<BranchRecord[]> {
  const collected: BranchRecord[] = [];
  let cursor: string | undefined;
  do {
    // biome-ignore lint/performance/noAwaitInLoops: each page is fetched with the cursor the previous page returned.
    const { data, error, response } = await client.GET(
      "/v1/projects/{projectId}/branches",
      {
        params: {
          path: { projectId: options.projectId },
          query: {
            ...(options.gitName !== undefined
              ? { gitName: options.gitName }
              : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          },
        },
        signal: options.signal,
      },
    );
    if (error || !data) {
      throw branchApiError("Failed to list branches", response, error);
    }
    collected.push(
      ...data.data.map((branch) => ({
        id: branch.id,
        gitName: branch.gitName,
        isDefault: branch.isDefault,
        role: branch.role,
      })),
    );
    cursor = data.pagination.hasMore
      ? (data.pagination.nextCursor ?? undefined)
      : undefined;
  } while (cursor);
  return collected;
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
