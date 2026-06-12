import path from "node:path";

import { MockApi } from "../src/adapters/mock-api";
import type { CliUseCaseGateways } from "../src/use-cases/create-cli-gateways";
import type { AuthSessionRecord } from "../src/use-cases/contracts";

const fixturePath = path.resolve("fixtures/mock-api.json");

export async function createUseCaseGateways(options?: {
  authSession?: AuthSessionRecord | null;
  projectId?: string | null;
}): Promise<{
  gateways: CliUseCaseGateways;
  readState: () => {
    authSession: AuthSessionRecord | null;
    projectId: string | null;
  };
}> {
  const api = await MockApi.load(fixturePath);
  let authSession = options?.authSession ?? null;
  let projectId = options?.projectId ?? null;

  return {
    gateways: {
      identityGateway: {
        listProviders: () => api.listProviders(),
        getProvider: (providerId) => api.getProvider(providerId),
        listUsersForProvider: (providerId) =>
          api.listUsersForProvider(providerId).map(toAuthUser),
        getUser: (userId) => {
          const user = api.getUser(userId);
          return user ? toAuthUser(user) : undefined;
        },
        getUserForProvider: (providerId, userId) => {
          const user = api.getUserForProvider(providerId, userId);
          return user ? toAuthUser(user) : undefined;
        },
        listUserWorkspaces: (userId) =>
          api.listUserWorkspaces(userId).map(toAuthWorkspace),
        getWorkspace: (workspaceId) => {
          const workspace = api.getWorkspace(workspaceId);
          return workspace ? toAuthWorkspace(workspace) : undefined;
        },
        getUserWorkspace: (userId, workspaceId) => {
          const workspace = api.getUserWorkspace(userId, workspaceId);
          return workspace ? toAuthWorkspace(workspace) : undefined;
        },
      },
      projectGateway: {
        listProjectsForWorkspace: (workspaceId) =>
          api.listProjectsForWorkspace(workspaceId),
        getProject: (projectId) => api.getProject(projectId),
        getProjectForWorkspace: (workspaceId, projectId) =>
          api.getProjectForWorkspace(workspaceId, projectId),
      },
      branchGateway: {
        listBranchesForProject: (projectId) =>
          api.listBranchesForProject(projectId),
        getBranchForProject: (projectId, name) => {
          return api.getBranchForProject(projectId, name);
        },
        getDeployment: (deploymentId) => api.getDeployment(deploymentId),
      },
      projectStateGateway: {
        readRememberedProjectId: async () => projectId,
      },
      sessionGateway: {
        readAuthSession: async () => authSession,
        writeAuthSession: async (session) => {
          authSession = session;
        },
        clearAuthSession: async () => {
          authSession = null;
        },
      },
    },
    readState: () => ({
      authSession,
      projectId,
    }),
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
