import type { ManagementApiClient } from "@prisma/management-api-sdk";

import type { BranchKind } from "../../types/branch";

export interface ReadBranch {
  id: string;
  name: string;
  kind: BranchKind;
}

/**
 * Resolves the branch an app management command should read from, without ever
 * creating one. Returns the branch whose `gitName` matches `branchName`, else
 * the project's default branch, else null when the project has no branches.
 */
export async function resolveReadBranch(
  client: ManagementApiClient,
  options: { projectId: string; branchName: string; signal?: AbortSignal },
): Promise<ReadBranch | null> {
  const branches: Array<{
    id: string;
    gitName: string;
    isDefault: boolean;
    role: BranchKind;
  }> = [];
  let cursor: string | undefined;

  do {
    const result = await client.GET("/v1/projects/{projectId}/branches", {
      params: { path: { projectId: options.projectId }, query: { cursor } },
      signal: options.signal,
    });
    if (result.error || !result.data) {
      throw new Error(
        `Failed to list branches for project ${options.projectId}: ${JSON.stringify(result.error)}`,
      );
    }

    branches.push(...result.data.data);
    cursor = result.data.pagination.hasMore
      ? (result.data.pagination.nextCursor ?? undefined)
      : undefined;
  } while (cursor);

  const chosen =
    branches.find((branch) => branch.gitName === options.branchName) ??
    branches.find((branch) => branch.isDefault) ??
    null;
  return chosen
    ? { id: chosen.id, name: chosen.gitName, kind: chosen.role }
    : null;
}
