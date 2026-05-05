import type { BranchDetail, BranchKind, BranchSummary, BranchListResult, BranchShowResult } from "../types/branch";
import type {
  DeploymentRecord,
  BranchUseCases,
  BranchGateway,
  BranchStateGateway,
  ProjectGateway,
  ProjectConfigGateway,
  RemoteBranchRecord,
} from "./contracts";

interface BranchUseCaseDependencies {
  branchGateway: BranchGateway;
  branchStateGateway: BranchStateGateway;
  projectGateway: ProjectGateway;
  projectConfigGateway: ProjectConfigGateway;
}

export function createBranchUseCases(dependencies: BranchUseCaseDependencies): BranchUseCases {
  return {
    list: async (): Promise<BranchListResult> => {
      const [linkedProjectId, activeBranch] = await Promise.all([
        dependencies.projectConfigGateway.readLinkedProjectId(),
        dependencies.branchStateGateway.readActiveBranch(),
      ]);
      const remoteBranches = await listRemoteBranches(dependencies.branchGateway, linkedProjectId);
      const projectName = resolveProjectName(dependencies.projectGateway, linkedProjectId);

      return {
        linkedProjectId,
        projectName,
        activeBranch,
        branches: buildBranchSummaries(activeBranch, remoteBranches),
      };
    },
    show: async (): Promise<BranchShowResult> => {
      const [linkedProjectId, activeBranch] = await Promise.all([
        dependencies.projectConfigGateway.readLinkedProjectId(),
        dependencies.branchStateGateway.readActiveBranch(),
      ]);
      const projectName = resolveProjectName(dependencies.projectGateway, linkedProjectId);

      return {
        linkedProjectId,
        projectName,
        branch: buildBranchDetail(
          dependencies.branchGateway,
          linkedProjectId,
          activeBranch,
        ),
      };
    },
    use: async (branchName: string): Promise<BranchShowResult> => {
      await dependencies.branchStateGateway.writeActiveBranch(branchName);

      const linkedProjectId = await dependencies.projectConfigGateway.readLinkedProjectId();
      const projectName = resolveProjectName(dependencies.projectGateway, linkedProjectId);

      return {
        linkedProjectId,
        projectName,
        branch: buildBranchDetail(
          dependencies.branchGateway,
          linkedProjectId,
          branchName,
        ),
      };
    },
  };
}

function resolveProjectName(projectGateway: ProjectGateway, linkedProjectId: string | null): string | null {
  if (!linkedProjectId) {
    return null;
  }

  return projectGateway.getProject(linkedProjectId)?.name ?? null;
}

async function listRemoteBranches(
  branchGateway: BranchGateway,
  linkedProjectId: string | null,
): Promise<RemoteBranchRecord[]> {
  if (!linkedProjectId) {
    return [];
  }

  return branchGateway.listBranchesForProject(linkedProjectId);
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
  linkedProjectId: string | null,
  branchName: string,
): BranchDetail {
  const kind = toBranchKind(branchName);
  const remoteBranch =
    linkedProjectId ? branchGateway.getBranchForProject(linkedProjectId, branchName) : undefined;

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
