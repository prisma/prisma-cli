import type { ManagementApiClient } from "@prisma/management-api-sdk";

import type { BranchKind } from "../../types/branch";
import { listProjectBranches } from "../branch/list";

export interface ReadBranch {
  id: string;
  name: string;
  kind: BranchKind;
}

/**
 * Returns the branch marked as the project's default, or null when the
 * project has none. Never creates a branch.
 */
export async function resolveDefaultBranch(
  client: ManagementApiClient,
  options: { projectId: string; signal?: AbortSignal },
): Promise<ReadBranch | null> {
  const branches = await listProjectBranches(client, {
    projectId: options.projectId,
    signal: options.signal,
  });
  const chosen = branches.find((branch) => branch.isDefault);
  return chosen
    ? { id: chosen.id, name: chosen.gitName, kind: chosen.role }
    : null;
}
