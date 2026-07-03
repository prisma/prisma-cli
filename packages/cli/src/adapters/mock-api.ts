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

interface DatabaseBackupRecord {
  id: string;
  databaseId: string;
  backupType: string;
  status: string;
  size?: number;
  createdAt: string;
}

interface DatabaseUsageRecord {
  databaseId: string;
  period: { start: string; end: string };
  metrics: {
    operations: { used: number; unit: string };
    storage: { used: number; unit: string };
  };
  generatedAt: string;
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
  databaseBackups?: DatabaseBackupRecord[];
  databaseUsage?: DatabaseUsageRecord[];
  databaseBackupRetentionDays?: number;
}

export class MockApi {
  private readonly data: MockApiData;

  private constructor(data: MockApiData) {
    this.data = data;
  }

  static async load(
    fixturePath: string,
    signal?: AbortSignal,
  ): Promise<MockApi> {
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
    return this.data.users.filter((user) =>
      user.providerIds.includes(providerId),
    );
  }

  getUser(userId: string): UserRecord | undefined {
    return this.data.users.find((user) => user.id === userId);
  }

  getUserForProvider(
    providerId: AuthProviderId,
    userId: string,
  ): UserRecord | undefined {
    return this.listUsersForProvider(providerId).find(
      (user) => user.id === userId,
    );
  }

  listUserWorkspaces(userId: string): WorkspaceRecord[] {
    const workspaceIds = this.data.memberships
      .filter((membership) => membership.userId === userId)
      .map((membership) => membership.workspaceId);

    return this.data.workspaces.filter((workspace) =>
      workspaceIds.includes(workspace.id),
    );
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.data.workspaces;
  }

  getWorkspace(workspaceId: string): WorkspaceRecord | undefined {
    return this.data.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
  }

  getUserWorkspace(
    userId: string,
    workspaceId: string,
  ): WorkspaceRecord | undefined {
    return this.listUserWorkspaces(userId).find(
      (workspace) => workspace.id === workspaceId,
    );
  }

  listProjectsForWorkspace(workspaceId: string): ProjectRecord[] {
    return this.data.projects.filter(
      (project) => project.workspaceId === workspaceId,
    );
  }

  getProject(projectId: string): ProjectRecord | undefined {
    return this.data.projects.find((project) => project.id === projectId);
  }

  getProjectForWorkspace(
    workspaceId: string,
    projectId: string,
  ): ProjectRecord | undefined {
    return this.listProjectsForWorkspace(workspaceId).find(
      (project) => project.id === projectId,
    );
  }

  renameProject(projectId: string, name: string): ProjectRecord | undefined {
    const project = this.getProject(projectId);
    if (!project) {
      return undefined;
    }

    project.name = name;
    return project;
  }

  removeProject(
    projectId: string,
  ):
    | { outcome: "removed"; project: ProjectRecord }
    | { outcome: "not-found" }
    | { outcome: "blocked" } {
    const project = this.getProject(projectId);
    if (!project) {
      return { outcome: "not-found" };
    }

    // Mirrors the platform rule: removal is blocked while the project still
    // has active deployments.
    const hasDeployments = this.data.deployments.some(
      (deployment) => deployment.projectId === projectId,
    );
    if (hasDeployments) {
      return { outcome: "blocked" };
    }

    const removedDatabaseIds = new Set(
      (this.data.databases ?? [])
        .filter((database) => database.projectId === projectId)
        .map((database) => database.id),
    );

    this.data.projects = this.data.projects.filter(
      (candidate) => candidate.id !== projectId,
    );
    this.data.branches = this.data.branches.filter(
      (branch) => branch.projectId !== projectId,
    );
    this.data.databases = (this.data.databases ?? []).filter(
      (database) => database.projectId !== projectId,
    );
    this.data.databaseConnections = (
      this.data.databaseConnections ?? []
    ).filter((connection) => !removedDatabaseIds.has(connection.databaseId));
    return { outcome: "removed", project };
  }

  transferProject(
    projectId: string,
    targetWorkspaceId: string,
  ):
    | { outcome: "transferred"; project: ProjectRecord }
    | { outcome: "not-found" }
    | { outcome: "workspace-not-found" } {
    const project = this.getProject(projectId);
    if (!project) {
      return { outcome: "not-found" };
    }
    if (!this.getWorkspace(targetWorkspaceId)) {
      return { outcome: "workspace-not-found" };
    }

    project.workspaceId = targetWorkspaceId;
    return { outcome: "transferred", project };
  }

  listBranchesForProject(projectId: string): BranchRecord[] {
    return this.data.branches.filter(
      (branch) => branch.projectId === projectId,
    );
  }

  getBranchForProject(
    projectId: string,
    name: string,
  ): BranchRecord | undefined {
    return this.listBranchesForProject(projectId).find(
      (branch) => branch.name === name,
    );
  }

  removeBranch(
    branchId: string,
  ):
    | { outcome: "removed"; branch: BranchRecord }
    | { outcome: "not-found" }
    | { outcome: "protected" }
    | { outcome: "not-empty" } {
    const branch = this.data.branches.find(
      (candidate) => candidate.id === branchId,
    );
    if (!branch) {
      return { outcome: "not-found" };
    }
    if (branch.role === "production") {
      return { outcome: "protected" };
    }

    // Mirrors the platform rule: removal is refused while the branch still
    // has live member resources.
    const hasDatabases = (this.data.databases ?? []).some(
      (database) => database.branchId === branchId,
    );
    const hasDeployments = this.data.deployments.some(
      (deployment) =>
        deployment.projectId === branch.projectId &&
        deployment.branch === branch.name,
    );
    if (hasDatabases || hasDeployments) {
      return { outcome: "not-empty" };
    }

    this.data.branches = this.data.branches.filter(
      (candidate) => candidate.id !== branchId,
    );
    return { outcome: "removed", branch };
  }

  getDeployment(deploymentId: string): DeploymentRecord | undefined {
    return this.data.deployments.find(
      (deployment) => deployment.id === deploymentId,
    );
  }

  listDatabasesForProject(
    projectId: string,
    branchName?: string,
  ): DatabaseRecord[] {
    return (this.data.databases ?? []).filter(
      (database) =>
        database.projectId === projectId &&
        (!branchName || database.branchName === branchName),
    );
  }

  getDatabase(databaseId: string): DatabaseRecord | undefined {
    return (this.data.databases ?? []).find(
      (database) => database.id === databaseId,
    );
  }

  createDatabase(input: {
    projectId: string;
    name: string;
    branchName?: string;
    region?: string;
  }): {
    database: DatabaseRecord;
    connection: DatabaseConnectionRecord;
    connectionString: string;
  } {
    this.data.databases ??= [];
    this.data.databaseConnections ??= [];

    const database: DatabaseRecord = {
      id: `db_${this.data.databases.length + 1_000}`,
      projectId: input.projectId,
      branchId: input.branchName
        ? (this.getBranchForProject(input.projectId, input.branchName)?.id ??
          null)
        : null,
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

    this.data.databases = this.data.databases.filter(
      (candidate) => candidate.id !== databaseId,
    );
    this.data.databaseConnections = this.data.databaseConnections.filter(
      (connection) => connection.databaseId !== databaseId,
    );
    return database;
  }

  listDatabaseConnections(databaseId: string): DatabaseConnectionRecord[] {
    return (this.data.databaseConnections ?? []).filter(
      (connection) => connection.databaseId === databaseId,
    );
  }

  getDatabaseConnection(
    connectionId: string,
  ): DatabaseConnectionRecord | undefined {
    return (this.data.databaseConnections ?? []).find(
      (connection) => connection.id === connectionId,
    );
  }

  createDatabaseConnection(input: {
    databaseId: string;
    name: string;
  }):
    | { connection: DatabaseConnectionRecord; connectionString: string }
    | undefined {
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

  removeDatabaseConnection(
    connectionId: string,
  ): DatabaseConnectionRecord | undefined {
    this.data.databaseConnections ??= [];
    const connection = this.getDatabaseConnection(connectionId);
    if (!connection) {
      return undefined;
    }

    this.data.databaseConnections = this.data.databaseConnections.filter(
      (candidate) => candidate.id !== connectionId,
    );
    return connection;
  }

  getDatabaseUsage(
    databaseId: string,
    period?: { from?: string; to?: string },
  ): {
    period: { start: string; end: string };
    metrics: {
      operations: { used: number; unit: string };
      storage: { used: number; unit: string };
    };
    generatedAt: string;
  } {
    const usage = (this.data.databaseUsage ?? []).find(
      (record) => record.databaseId === databaseId,
    );
    const defaults = usage ?? {
      databaseId,
      period: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.999Z",
      },
      metrics: {
        operations: { used: 0, unit: "ops" },
        storage: { used: 0, unit: "GiB" },
      },
      generatedAt: "2026-07-01T00:00:00.000Z",
    };

    return {
      period: {
        start: period?.from ?? defaults.period.start,
        end: period?.to ?? defaults.period.end,
      },
      metrics: defaults.metrics,
      generatedAt: defaults.generatedAt,
    };
  }

  listDatabaseBackups(
    databaseId: string,
    limit?: number,
  ): {
    backups: Array<{
      id: string;
      backupType: string;
      status: string;
      size: number | null;
      createdAt: string;
    }>;
    retentionDays: number | null;
    hasMore: boolean;
  } {
    const backups = (this.data.databaseBackups ?? []).filter(
      (backup) => backup.databaseId === databaseId,
    );
    const limited = limit === undefined ? backups : backups.slice(0, limit);

    return {
      backups: limited.map((backup) => ({
        id: backup.id,
        backupType: backup.backupType,
        status: backup.status,
        size: backup.size ?? null,
        createdAt: backup.createdAt,
      })),
      retentionDays: this.data.databaseBackupRetentionDays ?? null,
      hasMore: limited.length < backups.length,
    };
  }

  restoreDatabase(input: {
    targetDatabaseId: string;
    sourceDatabaseId: string;
    backupId: string;
  }):
    | { outcome: "restored"; database: DatabaseRecord }
    | { outcome: "target-not-found" }
    | { outcome: "backup-not-found" } {
    const target = this.getDatabase(input.targetDatabaseId);
    if (!target) {
      return { outcome: "target-not-found" };
    }

    const backup = (this.data.databaseBackups ?? []).find(
      (candidate) =>
        candidate.id === input.backupId &&
        candidate.databaseId === input.sourceDatabaseId,
    );
    if (!backup) {
      return { outcome: "backup-not-found" };
    }

    target.status = "recovering";
    return { outcome: "restored", database: target };
  }

  rotateDatabaseConnection(
    connectionId: string,
  ):
    | { connection: DatabaseConnectionRecord; connectionString: string }
    | undefined {
    const connection = this.getDatabaseConnection(connectionId);
    if (!connection) {
      return undefined;
    }

    const connectionString = `postgresql://rotated-${connection.databaseId}-${connection.id}.example.prisma.io/postgres`;
    connection.connectionString = connectionString;
    return { connection, connectionString };
  }
}

export type {
  BranchRecord,
  DatabaseConnectionRecord,
  DatabaseRecord,
  DeploymentRecord,
  ProjectRecord,
  ProviderRecord,
  UserRecord,
  WorkspaceRecord,
};
