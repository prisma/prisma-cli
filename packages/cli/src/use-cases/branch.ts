import type { BranchDetail, BranchKind, BranchSummary, BranchListResult, BranchShowResult } from "../types/branch";
import type {
  DeploymentRecord,
  BranchUseCases,
  BranchGateway,
  BranchStateGateway,
  ProjectGateway,
  ProjectStateGateway,
  RemoteBranchRecord,
} from "./contracts";

interface BranchUseCaseDependencies {
  branchGateway: BranchGateway;
  branchStateGateway: BranchStateGateway;
  projectGateway: ProjectGateway;
  projectStateGateway: ProjectStateGateway;
}

export function createBranchUseCases(dependencies: BranchUseCaseDependencies): BranchUseCases {
  return {
    list: async (): Promise<BranchListResult> => {
      const [projectId, activeBranch] = await Promise.all([
        dependencies.projectStateGateway.readRememberedProjectId(),
        dependencies.branchStateGateway.readActiveBranch(),
      ]);
      const remoteBranches = await listRemoteBranches(dependencies.branchGateway, projectId);
      const projectName = resolveProjectName(dependencies.projectGateway, projectId);

      return {
        projectId,
        projectName,
        activeBranch,
        branches: buildBranchSummaries(activeBranch, remoteBranches),
      };
    },
    show: async (): Promise<BranchShowResult> => {
      const [projectId, activeBranch] = await Promise.all([
        dependencies.projectStateGateway.readRememberedProjectId(),
        dependencies.branchStateGateway.readActiveBranch(),
      ]);
      const projectName = resolveProjectName(dependencies.projectGateway, projectId);

      return {
        projectId,
        projectName,
        branch: buildBranchDetail(
          dependencies.branchGateway,
          projectId,
          activeBranch,
        ),
      };
    },
    use: async (branchName: string): Promise<BranchShowResult> => {
      await dependencies.branchStateGateway.writeActiveBranch(branchName);

      const projectId = await dependencies.projectStateGateway.readRememberedProjectId();
      const projectName = resolveProjectName(dependencies.projectGateway, projectId);

      return {
        projectId,
        projectName,
        branch: buildBranchDetail(
          dependencies.branchGateway,
          projectId,
          branchName,
        ),
      };
    },
  };
}

function resolveProjectName(projectGateway: ProjectGateway, projectId: string | null): string | null {
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
  activeBranch: string,
  remoteBranches: RemoteBranchRecord[],
): BranchSummary[] {
  const byName = new Map<string, BranchSummary>();

  for (const branch of remoteBranches) {
    byName.set(branch.name, {
      id: branch.id,
      name: branch.name,
      kind: branch.kind,
      active: activeBranch === branch.name,
      remoteState: true,
    });
  }

  if (!byName.has(activeBranch)) {
    byName.set(activeBranch, {
      id: activeBranch,
      name: activeBranch,
      kind: toBranchKind(activeBranch),
      active: true,
      remoteState: false,
    });
  }

  return sortBranches([...byName.values()]);
}

function buildBranchDetail(
  branchGateway: BranchGateway,
  projectId: string | null,
  branchName: string,
): BranchDetail {
  const kind = toBranchKind(branchName);
  const remoteBranch =
    projectId ? branchGateway.getBranchForProject(projectId, branchName) : undefined;

  return {
    name: branchName,
    kind,
    active: true,
    remoteState: Boolean(remoteBranch),
    liveDeployment:
      remoteBranch && remoteBranch.currentDeploymentId
        ? toLiveDeployment(branchGateway.getDeployment(remoteBranch.currentDeploymentId))
        : null,
  };
}

function toBranchKind(name: string): BranchKind {
  if (name === "production") {
    return "production";
  }

  return "preview";
}

function sortBranches(branches: BranchSummary[]): BranchSummary[] {
  return branches
    .slice()
    .sort((left, right) => {
      const leftRank = branchOrder(left);
      const rightRank = branchOrder(right);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.name.localeCompare(right.name);
    });
}

function branchOrder(branch: BranchSummary): number {
  if (branch.name === "production") {
    return 0;
  }

  return 1;
}

function toLiveDeployment(deployment: DeploymentRecord | undefined) {
  if (!deployment) {
    return null;
  }

  return {
    id: deployment.id,
    status: deployment.status,
    url: deployment.url,
  };
}
