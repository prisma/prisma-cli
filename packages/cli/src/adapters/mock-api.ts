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

interface DatabaseRecord {
  id: string;
  projectId: string;
  branchId: string | null;
  branchName: string | null;
  name: string;
  region: string | null;
  status: string | null;
  isDefault: boolean | null;
  createdAt: string | null;
}

interface DatabaseConnectionRecord {
  id: string;
  databaseId: string;
  name: string;
  createdAt: string | null;
  connectionString?: string;
}

interface MockApiData {
  providers: ProviderRecord[];
  users: UserRecord[];
  workspaces: WorkspaceRecord[];
  memberships: MembershipRecord[];
  projects: ProjectRecord[];
  branches: BranchRecord[];
  deployments: DeploymentRecord[];
  databases?: DatabaseRecord[];
  databaseConnections?: DatabaseConnectionRecord[];
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

  listDatabasesForProject(projectId: string, branchName?: string): DatabaseRecord[] {
    return (this.data.databases ?? []).filter((database) =>
      database.projectId === projectId && (!branchName || database.branchName === branchName)
    );
  }

  getDatabase(databaseId: string): DatabaseRecord | undefined {
    return (this.data.databases ?? []).find((database) => database.id === databaseId);
  }

  createDatabase(input: {
    projectId: string;
    name: string;
    branchName?: string;
    region?: string;
  }): { database: DatabaseRecord; connection: DatabaseConnectionRecord; connectionString: string } {
    this.data.databases ??= [];
    this.data.databaseConnections ??= [];

    const database: DatabaseRecord = {
      id: `db_${this.data.databases.length + 1_000}`,
      projectId: input.projectId,
      branchId: input.branchName ? this.getBranchForProject(input.projectId, input.branchName)?.id ?? null : null,
      branchName: input.branchName ?? null,
      name: input.name,
      region: input.region ?? null,
      status: "ready",
      isDefault: false,
      createdAt: "2026-06-09T00:00:00.000Z",
    };
    const connectionString = `postgresql://${database.id}.example.prisma.io/postgres`;
    const connection: DatabaseConnectionRecord = {
      id: `conn_${this.data.databaseConnections.length + 1_000}`,
      databaseId: database.id,
      name: "primary",
      createdAt: "2026-06-09T00:00:00.000Z",
      connectionString,
    };

    this.data.databases.push(database);
    this.data.databaseConnections.push(connection);

    return { database, connection, connectionString };
  }

  removeDatabase(databaseId: string): DatabaseRecord | undefined {
    this.data.databases ??= [];
    this.data.databaseConnections ??= [];
    const database = this.getDatabase(databaseId);
    if (!database) {
      return undefined;
    }

    this.data.databases = this.data.databases.filter((candidate) => candidate.id !== databaseId);
    this.data.databaseConnections = this.data.databaseConnections.filter((connection) => connection.databaseId !== databaseId);
    return database;
  }

  listDatabaseConnections(databaseId: string): DatabaseConnectionRecord[] {
    return (this.data.databaseConnections ?? []).filter((connection) => connection.databaseId === databaseId);
  }

  getDatabaseConnection(connectionId: string): DatabaseConnectionRecord | undefined {
    return (this.data.databaseConnections ?? []).find((connection) => connection.id === connectionId);
  }

  createDatabaseConnection(input: {
    databaseId: string;
    name: string;
  }): { connection: DatabaseConnectionRecord; connectionString: string } | undefined {
    const database = this.getDatabase(input.databaseId);
    if (!database) {
      return undefined;
    }

    this.data.databaseConnections ??= [];
    const connectionString = `postgresql://${input.databaseId}-${this.data.databaseConnections.length + 1}.example.prisma.io/postgres`;
    const connection: DatabaseConnectionRecord = {
      id: `conn_${this.data.databaseConnections.length + 1_000}`,
      databaseId: input.databaseId,
      name: input.name,
      createdAt: "2026-06-09T00:00:00.000Z",
      connectionString,
    };
    this.data.databaseConnections.push(connection);
    return { connection, connectionString };
  }

  removeDatabaseConnection(connectionId: string): DatabaseConnectionRecord | undefined {
    this.data.databaseConnections ??= [];
    const connection = this.getDatabaseConnection(connectionId);
    if (!connection) {
      return undefined;
    }

    this.data.databaseConnections = this.data.databaseConnections.filter((candidate) => candidate.id !== connectionId);
    return connection;
  }
}

export type {
  DatabaseConnectionRecord,
  DatabaseRecord,
  DeploymentRecord,
  BranchRecord,
  ProjectRecord,
  ProviderRecord,
  UserRecord,
  WorkspaceRecord,
};
