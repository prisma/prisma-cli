import { usageError } from "../shell/errors";
import type { AuthProviderId, AuthStateResult } from "../types/auth";
import type { AuthUseCases, IdentityGateway, LoginSelection, ProjectConfigGateway, SessionGateway } from "./contracts";

interface AuthUseCaseDependencies {
  identityGateway: IdentityGateway;
  projectConfigGateway: ProjectConfigGateway;
  sessionGateway: SessionGateway;
}

export function createAuthUseCases(dependencies: AuthUseCaseDependencies): AuthUseCases {
  return {
    whoami: () => resolveCurrentAuthState(dependencies),
    login: async (selection: LoginSelection) => {
      await dependencies.sessionGateway.writeAuthSession({
        provider: selection.provider,
        userId: selection.userId,
        workspaceId: selection.workspaceId,
      });

      return resolveCurrentAuthState(dependencies);
    },
    logout: async () => {
      await dependencies.sessionGateway.clearAuthSession();
      return resolveCurrentAuthState(dependencies);
    },
    listProviders: async () => dependencies.identityGateway.listProviders(),
    resolveProvider: async (providerId) => {
      const provider = dependencies.identityGateway.getProvider(providerId);

      if (!provider) {
        throw usageError(
          "Login requires a valid mock provider",
          `The mock provider "${providerId}" does not exist.`,
          "Use --provider github or --provider google.",
          ["prisma-cli auth login"],
          "auth",
        );
      }

      return provider;
    },
    listUsersForProvider: async (providerId: AuthProviderId) => {
      const users = dependencies.identityGateway.listUsersForProvider(providerId);

      if (users.length === 0) {
        throw usageError(
          "Login requires a valid mock user",
          `No mock users support provider "${providerId}".`,
          "Update the fixture data or choose a different provider.",
          ["prisma-cli auth login"],
          "auth",
        );
      }

      return users;
    },
    resolveUserForProvider: async (providerId: AuthProviderId, userId: string) => {
      const user = dependencies.identityGateway.getUserForProvider(providerId, userId);

      if (!user) {
        throw usageError(
          "Login requires a valid mock user",
          `The mock user "${userId}" is not available for provider "${providerId}".`,
          "Choose a user that supports the selected provider.",
          ["prisma-cli auth login"],
          "auth",
        );
      }

      return user;
    },
    listWorkspacesForUser: async (userId: string) => dependencies.identityGateway.listUserWorkspaces(userId),
    resolveWorkspaceForUser: async (userId: string, workspaceId: string) => {
      const workspace = dependencies.identityGateway.getUserWorkspace(userId, workspaceId);

      if (!workspace) {
        throw usageError(
          "Login requires a valid mock workspace",
          `The mock workspace "${workspaceId}" is not available for the selected user.`,
          "Choose a workspace that the selected user can access.",
          ["prisma-cli auth login"],
          "auth",
        );
      }

      return workspace;
    },
  };
}

async function resolveCurrentAuthState(dependencies: AuthUseCaseDependencies): Promise<AuthStateResult> {
  const [session, linkedProjectId] = await Promise.all([
    dependencies.sessionGateway.readAuthSession(),
    dependencies.projectConfigGateway.readLinkedProjectId(),
  ]);

  if (!session) {
    return {
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      linkedProjectId,
    };
  }

  const provider = dependencies.identityGateway.getProvider(session.provider);
  const user = dependencies.identityGateway.getUser(session.userId);
  const workspace = dependencies.identityGateway.getWorkspace(session.workspaceId);

  if (!provider || !user || !workspace) {
    return {
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      linkedProjectId,
    };
  }

  return {
    authenticated: true,
    provider: provider.id,
    user: {
      email: user.email,
    },
    workspace,
    linkedProjectId,
  };
}
