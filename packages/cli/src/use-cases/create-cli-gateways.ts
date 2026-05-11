import { UnsafeConfigWriteError, readLinkedProjectId, writeLinkedProjectId } from "../adapters/config";
import type { CommandContext } from "../shell/runtime";
import { usageError } from "../shell/errors";
import type {
  BranchGateway,
  BranchStateGateway,
  IdentityGateway,
  ProjectConfigGateway,
  ProjectGateway,
  SessionGateway,
} from "./contracts";

export interface CliUseCaseGateways {
  identityGateway: IdentityGateway;
  projectGateway: ProjectGateway;
  branchGateway: BranchGateway;
  projectConfigGateway: ProjectConfigGateway;
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
    projectConfigGateway: {
      readLinkedProjectId: () => readLinkedProjectId(context.runtime.cwd),
      writeLinkedProjectId: async (projectId) => {
        try {
          await writeLinkedProjectId(context.runtime.cwd, projectId);
        } catch (error) {
          if (error instanceof UnsafeConfigWriteError) {
            throw usageError(
              "Project link requires a writable Prisma config",
              error.message,
              "Update prisma.config.ts to use a recognizable project field, or remove it and rerun prisma-cli project link.",
              ["prisma-cli project link proj_123"],
              "project",
            );
          }

          throw error;
        }
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
