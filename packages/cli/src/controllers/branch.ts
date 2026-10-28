import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { listProjectBranches } from "../lib/branch/list";
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
  return await listProjectBranches(client, { projectId, signal });
}

export function toBranchSummary(branch: RawBranchRecord): BranchSummary {
  return {
    id: branch.id,
    name: branch.gitName,
    role: branch.role,
    envMap: branch.role,
  };
}
