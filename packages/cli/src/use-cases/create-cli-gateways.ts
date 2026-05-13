import type { CommandContext } from "../shell/runtime";
import type {
  BranchGateway,
  BranchStateGateway,
  IdentityGateway,
  ProjectGateway,
  ProjectStateGateway,
  SessionGateway,
} from "./contracts";

export interface CliUseCaseGateways {
  identityGateway: IdentityGateway;
  projectGateway: ProjectGateway;
  branchGateway: BranchGateway;
  projectStateGateway: ProjectStateGateway;
  sessionGateway: SessionGateway;
  branchStateGateway: BranchStateGateway;
}

export function createCliUseCaseGateways(context: CommandContext): CliUseCaseGateways {
  return {
    identityGateway: {
      listProviders: () => context.api.listProviders(),
      getProvider: (providerId) => context.api.getProvider(providerId),
      listUsersForProvider: (providerId) => context.api.listUsersForProvider(providerId).map(toAuthUser),
      getUser: (userId) => {
        const user = context.api.getUser(userId);
        return user ? toAuthUser(user) : undefined;
      },
      getUserForProvider: (providerId, userId) => {
        const user = context.api.getUserForProvider(providerId, userId);
        return user ? toAuthUser(user) : undefined;
      },
      listUserWorkspaces: (userId) => context.api.listUserWorkspaces(userId).map(toAuthWorkspace),
      getWorkspace: (workspaceId) => {
        const workspace = context.api.getWorkspace(workspaceId);
        return workspace ? toAuthWorkspace(workspace) : undefined;
      },
      getUserWorkspace: (userId, workspaceId) => {
        const workspace = context.api.getUserWorkspace(userId, workspaceId);
        return workspace ? toAuthWorkspace(workspace) : undefined;
      },
    },
    projectGateway: {
      listProjectsForWorkspace: (workspaceId) => context.api.listProjectsForWorkspace(workspaceId),
      getProject: (projectId) => context.api.getProject(projectId),
      getProjectForWorkspace: (workspaceId, projectId) => context.api.getProjectForWorkspace(workspaceId, projectId),
    },
    branchGateway: {
      listBranchesForProject: (projectId) =>
        context.api.listBranchesForProject(projectId).map((branch) => ({
          ...branch,
          kind: branch.name === "production" ? "production" : "preview",
        })),
      getBranchForProject: (projectId, name) => {
        const branch = context.api.getBranchForProject(projectId, name);
        return branch
          ? {
              ...branch,
              kind: branch.name === "production" ? "production" : "preview",
            }
          : undefined;
      },
      getDeployment: (deploymentId) => context.api.getDeployment(deploymentId),
    },
    projectStateGateway: {
      readRememberedProjectId: async () => {
        const remembered = await context.stateStore.readLastResolvedProject();
        return remembered?.id ?? null;
      },
      rememberProjectId: async (projectId) => {
        await context.stateStore.setRememberedProject({
          id: projectId,
          name: projectId,
          workspaceId: "unknown",
        });
      },
    },
    sessionGateway: {
      readAuthSession: async () => {
        const state = await context.stateStore.read();
        return state.auth;
      },
      writeAuthSession: async (session) => {
        await context.stateStore.setAuthSession(session);
      },
      clearAuthSession: async () => {
        await context.stateStore.clearAuthSession();
      },
    },
    branchStateGateway: {
      readActiveBranch: async () => {
        const state = await context.stateStore.read();
        return state.branch.active;
      },
      writeActiveBranch: async (branchName) => {
        await context.stateStore.setActiveBranch(branchName);
      },
    },
  };
}

function toAuthUser(user: { id: string; name: string; email: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function toAuthWorkspace(workspace: { id: string; name: string }) {
  return {
    id: workspace.id,
    name: workspace.name,
  };
}
