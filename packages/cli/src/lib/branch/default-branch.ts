import type { ManagementApiClient } from "@prisma/management-api-sdk";

import type { BranchKind } from "../../types/branch";
import { listProjectBranches } from "./list";

export interface DefaultBranch {
  id: string;
  name: string;
  kind: BranchKind;
}

export type DefaultBranchLookup =
  | { readonly kind: "found"; readonly branch: DefaultBranch }
  | { readonly kind: "no-branches" }
  | { readonly kind: "no-default" };

/** Finds the branch marked as the project's default. Never creates a branch. */
export async function resolveDefaultBranch(
  client: ManagementApiClient,
  options: { projectId: string; signal?: AbortSignal },
): Promise<DefaultBranchLookup> {
  const branches = await listProjectBranches(client, {
    projectId: options.projectId,
    signal: options.signal,
  });
  if (branches.length === 0) {
    return { kind: "no-branches" };
  }
  const chosen = branches.find((branch) => branch.isDefault);
  return chosen
    ? {
        kind: "found",
        branch: { id: chosen.id, name: chosen.gitName, kind: chosen.role },
      }
    : { kind: "no-default" };
}
