import { readFile } from "node:fs/promises";

import type { AuthProviderId } from "../types/auth";

interface ProviderRecord {
  id: AuthProviderId;
  name: string;
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  providerIds: AuthProviderId[];
}

interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
}

interface MembershipRecord {
  userId: string;
  workspaceId: string;
}

interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  url?: string;
  workspaceId: string;
}

interface BranchRecord {
  id: string;
  projectId: string;
  name: string;
  role: "production" | "preview";
  currentDeploymentId: string | null;
}

interface DeploymentRecord {
  id: string;
  projectId: string;
  branch: string;
  status: string;
  url: string | null;
}

interface MockApiData {
  providers: ProviderRecord[];
  users: UserRecord[];
  workspaces: WorkspaceRecord[];
  memberships: MembershipRecord[];
  projects: ProjectRecord[];
  branches: BranchRecord[];
  deployments: DeploymentRecord[];
}

export class MockApi {
  private readonly data: MockApiData;

  private constructor(data: MockApiData) {
    this.data = data;
  }

  static async load(fixturePath: string, signal?: AbortSignal): Promise<MockApi> {
    signal?.throwIfAborted();
    const raw = await readFile(fixturePath, { encoding: "utf8", signal });
    return new MockApi(JSON.parse(raw) as MockApiData);
  }

  listProviders(): ProviderRecord[] {
    return this.data.providers;
  }

  getProvider(providerId: string): ProviderRecord | undefined {
    return this.data.providers.find((provider) => provider.id === providerId);
  }

  listUsersForProvider(providerId: AuthProviderId): UserRecord[] {
    return this.data.users.filter((user) => user.providerIds.includes(providerId));
  }

  getUser(userId: string): UserRecord | undefined {
    return this.data.users.find((user) => user.id === userId);
  }

  getUserForProvider(providerId: AuthProviderId, userId: string): UserRecord | undefined {
    return this.listUsersForProvider(providerId).find((user) => user.id === userId);
  }

  listUserWorkspaces(userId: string): WorkspaceRecord[] {
    const workspaceIds = this.data.memberships
      .filter((membership) => membership.userId === userId)
      .map((membership) => membership.workspaceId);

    return this.data.workspaces.filter((workspace) => workspaceIds.includes(workspace.id));
  }

  getWorkspace(workspaceId: string): WorkspaceRecord | undefined {
    return this.data.workspaces.find((workspace) => workspace.id === workspaceId);
  }

  getUserWorkspace(userId: string, workspaceId: string): WorkspaceRecord | undefined {
    return this.listUserWorkspaces(userId).find((workspace) => workspace.id === workspaceId);
  }

  listProjectsForWorkspace(workspaceId: string): ProjectRecord[] {
    return this.data.projects.filter((project) => project.workspaceId === workspaceId);
  }

  getProject(projectId: string): ProjectRecord | undefined {
    return this.data.projects.find((project) => project.id === projectId);
  }

  getProjectForWorkspace(workspaceId: string, projectId: string): ProjectRecord | undefined {
    return this.listProjectsForWorkspace(workspaceId).find((project) => project.id === projectId);
  }

  listBranchesForProject(projectId: string): BranchRecord[] {
    return this.data.branches.filter((branch) => branch.projectId === projectId);
  }

  getBranchForProject(projectId: string, name: string): BranchRecord | undefined {
    return this.listBranchesForProject(projectId).find((branch) => branch.name === name);
  }

  getDeployment(deploymentId: string): DeploymentRecord | undefined {
    return this.data.deployments.find((deployment) => deployment.id === deploymentId);
  }
}

export type {
  DeploymentRecord,
  BranchRecord,
  ProjectRecord,
  ProviderRecord,
  UserRecord,
  WorkspaceRecord,
};
