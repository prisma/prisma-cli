import type { ManagementApiClient } from "@prisma/management-api-sdk";

import type { BranchKind } from "../../types/branch";

export interface ReadBranch {
  id: string;
  name: string;
  kind: BranchKind;
}

interface ProjectBranch extends ReadBranch {
  isDefault: boolean;
}

/**
 * Lists every branch in a project, following pagination. Management commands
 * read branch context against this list so they never create a branch.
 */
export async function listProjectBranches(
  client: ManagementApiClient,
  options: { projectId: string; signal?: AbortSignal },
): Promise<ProjectBranch[]> {
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

  return branches.map((branch) => ({
    id: branch.id,
    name: branch.gitName,
    kind: branch.role,
    isDefault: branch.isDefault,
  }));
}

/**
 * Resolves the branch an app management command should read from, without ever
 * creating one. Returns the branch whose name matches `branchName`, else the
 * project's default branch, else null when the project has no branches.
 */
export async function resolveReadBranch(
  client: ManagementApiClient,
  options: { projectId: string; branchName: string; signal?: AbortSignal },
): Promise<ReadBranch | null> {
  const branches = await listProjectBranches(client, {
    projectId: options.projectId,
    signal: options.signal,
  });
  const chosen =
    branches.find((branch) => branch.name === options.branchName) ??
    branches.find((branch) => branch.isDefault) ??
    null;
  return chosen
    ? { id: chosen.id, name: chosen.name, kind: chosen.kind }
    : null;
}

/**
 * Resolves a project's production branch by role, not by name. The production
 * branch is the durable default branch; resolving it from the API keeps
 * production-only commands (custom domains) working when that branch is named
 * something other than `production` or `main` (for example `master`).
 *
 * When `branchName` is given (an explicit `--branch`), only that branch is
 * returned so the caller can validate its role; a missing explicit branch
 * returns null. Without `branchName`, the production-role branch (falling back
 * to the default branch) is returned.
 */
export async function resolveProductionBranch(
  client: ManagementApiClient,
  options: { projectId: string; branchName?: string; signal?: AbortSignal },
): Promise<ReadBranch | null> {
  const branches = await listProjectBranches(client, {
    projectId: options.projectId,
    signal: options.signal,
  });

  if (options.branchName !== undefined) {
    const explicit = branches.find(
      (branch) => branch.name === options.branchName,
    );
    return explicit
      ? { id: explicit.id, name: explicit.name, kind: explicit.kind }
      : null;
  }

  const chosen =
    branches.find((branch) => branch.kind === "production") ??
    branches.find((branch) => branch.isDefault) ??
    null;
  return chosen
    ? { id: chosen.id, name: chosen.name, kind: chosen.kind }
    : null;
}
