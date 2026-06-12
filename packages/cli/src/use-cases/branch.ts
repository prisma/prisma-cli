import type { BranchSummary, BranchListResult } from "../types/branch";
import type {
  BranchUseCases,
  BranchGateway,
  ProjectGateway,
  ProjectStateGateway,
  RemoteBranchRecord,
} from "./contracts";

interface BranchUseCaseDependencies {
  branchGateway: BranchGateway;
  projectGateway: ProjectGateway;
  projectStateGateway: ProjectStateGateway;
}

export function createBranchUseCases(
  dependencies: BranchUseCaseDependencies,
): BranchUseCases {
  return {
    list: async (): Promise<BranchListResult> => {
      const projectId =
        await dependencies.projectStateGateway.readRememberedProjectId();
      if (!projectId) {
        return {
          projectId: "",
          projectName: "not resolved",
          branches: [],
        };
      }

      const remoteBranches = await listRemoteBranches(
        dependencies.branchGateway,
        projectId,
      );
      const projectName = resolveProjectName(
        dependencies.projectGateway,
        projectId,
      );

      return {
        projectId,
        projectName: projectName ?? "not resolved",
        branches: buildBranchSummaries(remoteBranches),
      };
    },
  };
}

function resolveProjectName(
  projectGateway: ProjectGateway,
  projectId: string | null,
): string | null {
  if (!projectId) {
    return null;
  }

  return projectGateway.getProject(projectId)?.name ?? null;
}

async function listRemoteBranches(
  branchGateway: BranchGateway,
  projectId: string | null,
): Promise<RemoteBranchRecord[]> {
  if (!projectId) {
    return [];
  }

  return branchGateway.listBranchesForProject(projectId);
}

function buildBranchSummaries(
  remoteBranches: RemoteBranchRecord[],
): BranchSummary[] {
  return sortBranches(
    remoteBranches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      role: branch.role,
      envMap: branch.role,
    })),
  );
}

function sortBranches(branches: BranchSummary[]): BranchSummary[] {
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
  if (branch.role === "production") {
    return 0;
  }

  return 1;
}
