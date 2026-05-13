import type { AuthProviderId, AuthStateResult, AuthUser, AuthWorkspace } from "../types/auth";
import type { BranchKind, BranchListResult, BranchShowResult, LiveDeploymentSummary } from "../types/branch";
import type { ProjectSummary } from "../types/project";

export interface ProviderInfo {
  id: AuthProviderId;
  name: string;
}

export interface IdentityUser extends AuthUser {
  id: string;
  name: string;
}

export interface ProjectRecord extends ProjectSummary {
  workspaceId: string;
}

export interface RemoteBranchRecord {
  id: string;
  projectId: string;
  name: string;
  kind: BranchKind;
  currentDeploymentId: string | null;
}

export interface DeploymentRecord extends LiveDeploymentSummary {
  projectId: string;
  branch: string;
}

export interface AuthSessionRecord {
  provider: AuthProviderId;
  userId: string;
  workspaceId: string;
}

export interface IdentityGateway {
  listProviders(): ProviderInfo[];
  getProvider(providerId: string): ProviderInfo | undefined;
  listUsersForProvider(providerId: AuthProviderId): IdentityUser[];
  getUser(userId: string): IdentityUser | undefined;
  getUserForProvider(providerId: AuthProviderId, userId: string): IdentityUser | undefined;
  listUserWorkspaces(userId: string): AuthWorkspace[];
  getWorkspace(workspaceId: string): AuthWorkspace | undefined;
  getUserWorkspace(userId: string, workspaceId: string): AuthWorkspace | undefined;
}

export interface ProjectGateway {
  listProjectsForWorkspace(workspaceId: string): ProjectRecord[];
  getProject(projectId: string): ProjectRecord | undefined;
  getProjectForWorkspace(workspaceId: string, projectId: string): ProjectRecord | undefined;
}

export interface BranchGateway {
  listBranchesForProject(projectId: string): RemoteBranchRecord[];
  getBranchForProject(projectId: string, name: string): RemoteBranchRecord | undefined;
  getDeployment(deploymentId: string): DeploymentRecord | undefined;
}

export interface SessionGateway {
  readAuthSession(): Promise<AuthSessionRecord | null>;
  writeAuthSession(session: AuthSessionRecord): Promise<void>;
  clearAuthSession(): Promise<void>;
}

export interface BranchStateGateway {
  readActiveBranch(): Promise<string>;
  writeActiveBranch(branchName: string): Promise<void>;
}

export interface ProjectConfigGateway {
  readLinkedProjectId(): Promise<string | null>;
  writeLinkedProjectId(projectId: string): Promise<void>;
}

export interface LoginSelection {
  provider: AuthProviderId;
  userId: string;
  workspaceId: string;
}

export interface SelectChoice<T> {
  label: string;
  value: T;
}

export interface SelectPromptPort {
  select<T>(options: {
    message: string;
    choices: SelectChoice<T>[];
  }): Promise<T>;
}

export interface AuthUseCases {
  whoami(): Promise<AuthStateResult>;
  login(selection: LoginSelection): Promise<AuthStateResult>;
  logout(): Promise<AuthStateResult>;
  listProviders(): Promise<ProviderInfo[]>;
  resolveProvider(providerId: string): Promise<ProviderInfo>;
  listUsersForProvider(providerId: AuthProviderId): Promise<IdentityUser[]>;
  resolveUserForProvider(providerId: AuthProviderId, userId: string): Promise<IdentityUser>;
  listWorkspacesForUser(userId: string): Promise<AuthWorkspace[]>;
  resolveWorkspaceForUser(userId: string, workspaceId: string): Promise<AuthWorkspace>;
}

export interface ProjectUseCases {
  list(authState: AuthStateResult): Promise<import("../types/project").ProjectListResult>;
  show(authState: AuthStateResult): Promise<import("../types/project").ProjectShowResult>;
  link(authState: AuthStateResult, projectId: string): Promise<import("../types/project").ProjectShowResult>;
  listProjectsForWorkspace(workspaceId: string): Promise<ProjectSummary[]>;
}

export interface BranchUseCases {
  list(): Promise<BranchListResult>;
  show(): Promise<BranchShowResult>;
  use(branchName: string): Promise<BranchShowResult>;
}
