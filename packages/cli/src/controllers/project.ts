import type { ManagementApiClient } from "@prisma/management-api-sdk";
import open from "open";

import {
  parseGitHubRepositoryUrl,
  readGitOriginRemote,
  type GitHubRepositoryReference,
} from "../adapters/git";
import { requireComputeAuth } from "../lib/auth/guard";
import {
  resolveProjectTarget,
  sortProjects,
  type ProjectCandidate,
} from "../lib/project/resolution";
import { authRequiredError, CliError, usageError, workspaceRequiredError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { canPrompt, type CommandContext } from "../shell/runtime";
import type { AuthWorkspace } from "../types/auth";
import type {
  GitRepositoryConnection,
  ProjectListResult,
  ProjectRepositoryConnectionResult,
  ProjectShowResult,
} from "../types/project";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { createProjectUseCases } from "../use-cases/project";
import { requireAuthenticatedAuthState } from "./auth";

export interface ProjectConnectRepoOptions {
  project?: string;
}

export interface ProjectDisconnectRepoOptions {
  project?: string;
}

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

export async function runProjectList(context: CommandContext): Promise<CommandSuccess<ProjectListResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(context.runtime.env);
    if (!client) {
      throw authRequiredError();
    }

    return {
      command: "project.list",
      result: {
        workspace,
        projects: sortProjects(await listRealWorkspaceProjects(client, workspace)).map(toProjectSummary),
      },
      warnings: [],
      nextSteps: [],
    };
  }

  const projectUseCases = createProjectUseCases(createCliUseCaseGateways(context));
  const result = await projectUseCases.list(authState);

  return {
    command: "project.list",
    result,
    warnings: [],
    nextSteps: [],
  };
}

export async function runProjectShow(
  context: CommandContext,
  explicitProject: string | undefined,
): Promise<CommandSuccess<ProjectShowResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const result = isRealMode(context)
    ? await resolveProjectShowInRealMode(context, workspace, explicitProject)
    : await resolveProjectShowInFixtureMode(context, workspace, explicitProject);

  return {
    command: "project.show",
    result,
    warnings: [],
    nextSteps: [],
  };
}

export async function runProjectConnectRepo(
  context: CommandContext,
  gitUrl: string | undefined,
  options: ProjectConnectRepoOptions = {},
): Promise<CommandSuccess<ProjectRepositoryConnectionResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(context.runtime.env);
    if (!client) {
      throw authRequiredError();
    }

    const target = await resolveProjectShowInRealMode(context, workspace, options.project);
    const repository = await resolveRepositoryForConnect(context, gitUrl);
    const api = client as unknown as SourceRepositoryApiClient;
    const resolvedRepository = await resolveInstalledRepository(context, api, workspace.id, repository);
    const { data, error, response } = await api.POST("/v1/source-repositories", {
      body: {
        projectId: target.project.id,
        provider: "github",
        providerRepositoryId: resolvedRepository.repository.id,
        installationId: resolvedRepository.installation.id,
      },
    });

    if (error || !data) {
      throw repoConnectionApiError("Failed to connect GitHub repository", response, error);
    }

    return {
      command: "project.connect-repo",
      result: {
        ...target,
        repositoryConnection: toRepositoryConnection(data.data),
      },
      warnings: [],
      nextSteps: [],
    };
  }

  const target = await resolveProjectShowInFixtureMode(context, workspace, options.project);
  const repository = await resolveRepositoryForConnect(context, gitUrl);
  const connection = createPendingRepositoryConnection(repository);
  await context.stateStore.setRepositoryConnection(target.project.id, connection);

  return {
    command: "project.connect-repo",
    result: {
      ...target,
      repositoryConnection: connection,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runProjectDisconnectRepo(
  context: CommandContext,
  options: ProjectDisconnectRepoOptions = {},
): Promise<CommandSuccess<ProjectRepositoryConnectionResult>> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await requireComputeAuth(context.runtime.env);
    if (!client) {
      throw authRequiredError();
    }

    const target = await resolveProjectShowInRealMode(context, workspace, options.project);
    const api = client as unknown as SourceRepositoryApiClient;
    const existing = await readFirstSourceRepository(api, target.project.id);

    if (!existing) {
      throw repoNotConnectedError();
    }

    const { error, response } = await api.DELETE("/v1/source-repositories/{id}", {
      params: {
        path: {
          id: existing.id,
        },
      },
    });

    if (error) {
      throw repoConnectionApiError("Failed to disconnect GitHub repository", response, error);
    }

    return {
      command: "project.disconnect-repo",
      result: {
        ...target,
        repositoryConnection: toRepositoryConnection(existing),
      },
      warnings: [],
      nextSteps: [],
    };
  }

  const target = await resolveProjectShowInFixtureMode(context, workspace, options.project);
  const existingConnection = await context.stateStore.readRepositoryConnection(target.project.id);

  if (!existingConnection) {
    throw repoNotConnectedError();
  }

  await context.stateStore.clearRepositoryConnection(target.project.id);

  return {
    command: "project.disconnect-repo",
    result: {
      ...target,
      repositoryConnection: existingConnection,
    },
    warnings: [],
    nextSteps: [],
  };
}

async function resolveProjectShowInRealMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
): Promise<ProjectShowResult> {
  const client = await requireComputeAuth(context.runtime.env);
  if (!client) {
    throw authRequiredError();
  }

  return resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects: () => listRealWorkspaceProjects(client, workspace),
    remember: false,
  });
}

async function resolveProjectShowInFixtureMode(
  context: CommandContext,
  workspace: AuthWorkspace,
  explicitProject: string | undefined,
): Promise<ProjectShowResult> {
  return resolveProjectTarget({
    context,
    workspace,
    explicitProject,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    remember: false,
  });
}

export async function listRealWorkspaceProjects(
  client: ManagementApiClient,
  workspace: AuthWorkspace,
): Promise<ProjectCandidate[]> {
  const { data } = await client.GET("/v1/projects", {});
  return sortProjects(
    (data?.data ?? [])
      .filter((project) => project.workspace.id === workspace.id)
      .map((project) => ({
        id: project.id,
        name: project.name,
        slug: "slug" in project && typeof project.slug === "string" ? project.slug : null,
        workspace: {
          id: project.workspace.id,
          name: project.workspace.name,
        },
      })),
  );
}

export function listFixtureWorkspaceProjects(
  context: CommandContext,
  workspace: AuthWorkspace,
): ProjectCandidate[] {
  return sortProjects(
    context.api.listProjectsForWorkspace(workspace.id).map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      workspace,
    })),
  );
}

interface SourceRepositoryResponse {
  id: string;
  type?: "source-repository";
  url?: string;
  repoId: number;
  provider: "github";
  repoFullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  status: "active" | "archived";
  installationId: string;
  createdAt: string;
  updatedAt: string;
}

interface ScmInstallationResponse {
  id: string;
  type: "scm-installation";
  url: string;
  provider: "github";
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ScmRepositoryResponse {
  id: number;
  type: "scm-repository";
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

interface InstalledRepositoryMatch {
  installation: ScmInstallationResponse;
  repository: ScmRepositoryResponse;
}

interface SourceRepositoryApiError {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface SourceRepositoryApiResult<T> {
  data?: T;
  error?: SourceRepositoryApiError;
  response?: Response;
}

interface SourceRepositoryApiClient {
  POST(
    path: "/v1/source-repositories",
    options: {
      body: {
        projectId: string;
        provider: "github";
        providerRepositoryId: number;
        installationId?: string;
      };
    },
  ): Promise<SourceRepositoryApiResult<{ data: SourceRepositoryResponse }>>;
  GET(
    path: "/v1/source-repositories",
    options: {
      params: {
        query: {
          projectId: string;
          cursor?: string;
          limit?: number;
        };
      };
    },
  ): Promise<SourceRepositoryApiResult<{
    data: SourceRepositoryResponse[];
    pagination: {
      nextCursor: string | null;
      hasMore: boolean;
    };
  }>>;
  GET(
    path: "/v1/scm-installations",
    options: {
      params: {
        query: {
          workspaceId: string;
          cursor?: string;
          limit?: number;
        };
      };
    },
  ): Promise<SourceRepositoryApiResult<{
    data: ScmInstallationResponse[];
    pagination: {
      nextCursor: string | null;
      hasMore: boolean;
    };
  }>>;
  GET(
    path: "/v1/scm-installations/{installationId}/repositories",
    options: {
      params: {
        path: {
          installationId: string;
        };
        query: {
          cursor?: string;
          limit?: number;
        };
      };
    },
  ): Promise<SourceRepositoryApiResult<{
    data: ScmRepositoryResponse[];
    pagination: {
      nextCursor: string | null;
      hasMore: boolean;
    };
  }>>;
  POST(
    path: "/v1/scm-installations/install-intents",
    options: {
      body: {
        provider: "github";
        workspaceId: string;
      };
    },
  ): Promise<SourceRepositoryApiResult<{
    data: {
      type: "install-intent";
      provider: "github";
      workspaceId: string;
      installUrl: string;
    };
  }>>;
  DELETE(
    path: "/v1/source-repositories/{id}",
    options: {
      params: {
        path: {
          id: string;
        };
      };
    },
  ): Promise<SourceRepositoryApiResult<unknown>>;
}

async function resolveRepositoryForConnect(
  context: CommandContext,
  gitUrl: string | undefined,
): Promise<GitHubRepositoryReference> {
  const remoteUrl = gitUrl ?? await readGitOriginRemote(context.runtime.cwd);

  if (!remoteUrl) {
    throw usageError(
      "Repository connection requires a GitHub repository URL",
      "No git-url was provided and the local repo does not have an origin remote.",
      "Pass a GitHub repository URL, or add a GitHub origin remote and rerun prisma-cli project connect-repo.",
      ["prisma-cli project connect-repo git@github.com:prisma/prisma-cli.git"],
      "project",
    );
  }

  const repository = parseGitHubRepositoryUrl(remoteUrl);
  if (!repository) {
    throw unsupportedRepositoryProviderError();
  }

  return repository;
}

async function resolveInstalledRepository(
  context: CommandContext,
  api: SourceRepositoryApiClient,
  workspaceId: string,
  repository: GitHubRepositoryReference,
): Promise<InstalledRepositoryMatch> {
  const installations = await listScmInstallations(api, workspaceId);
  if (installations.length === 0) {
    const installUrl = await createGitHubInstallIntent(api, workspaceId);
    const opened = await openInstallUrlIfInteractive(context, installUrl);
    throw repoInstallationRequiredError(repository, installUrl, opened);
  }

  for (const installation of installations) {
    if (installation.provider !== "github" || installation.suspended) {
      continue;
    }

    const matchedRepository = await findRepositoryInInstallation(api, installation.id, repository);
    if (matchedRepository) {
      return {
        installation,
        repository: matchedRepository,
      };
    }
  }

  throw repoNotAccessibleError(repository);
}

async function listScmInstallations(
  api: SourceRepositoryApiClient,
  workspaceId: string,
): Promise<ScmInstallationResponse[]> {
  const installations: ScmInstallationResponse[] = [];
  let cursor: string | undefined;

  do {
    const { data, error, response } = await api.GET("/v1/scm-installations", {
      params: {
        query: {
          workspaceId,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
      },
    });

    if (error || !data) {
      throw repoConnectionApiError("Failed to inspect GitHub App installations", response, error);
    }

    installations.push(...data.data);
    cursor = data.pagination.hasMore && data.pagination.nextCursor ? data.pagination.nextCursor : undefined;
  } while (cursor);

  return installations;
}

async function findRepositoryInInstallation(
  api: SourceRepositoryApiClient,
  installationId: string,
  repository: GitHubRepositoryReference,
): Promise<ScmRepositoryResponse | null> {
  const expectedFullName = repository.fullName.toLowerCase();
  let cursor: string | undefined;

  do {
    const { data, error, response } = await api.GET("/v1/scm-installations/{installationId}/repositories", {
      params: {
        path: {
          installationId,
        },
        query: {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
      },
    });

    if (error || !data) {
      throw repoConnectionApiError("Failed to inspect GitHub repositories", response, error);
    }

    const matchedRepository = data.data.find((candidate) => candidate.fullName.toLowerCase() === expectedFullName);
    if (matchedRepository) {
      return matchedRepository;
    }

    cursor = data.pagination.hasMore && data.pagination.nextCursor ? data.pagination.nextCursor : undefined;
  } while (cursor);

  return null;
}

async function createGitHubInstallIntent(
  api: SourceRepositoryApiClient,
  workspaceId: string,
): Promise<string> {
  const { data, error, response } = await api.POST("/v1/scm-installations/install-intents", {
    body: {
      provider: "github",
      workspaceId,
    },
  });

  if (error || !data) {
    throw repoConnectionApiError("Failed to create GitHub App installation link", response, error);
  }

  return data.data.installUrl;
}

async function openInstallUrlIfInteractive(
  context: CommandContext,
  installUrl: string,
): Promise<boolean> {
  if (!canPrompt(context)) {
    return false;
  }

  try {
    await open(installUrl);
    return true;
  } catch {
    return false;
  }
}

async function readFirstSourceRepository(
  api: SourceRepositoryApiClient,
  projectId: string,
): Promise<SourceRepositoryResponse | null> {
  const { data, error, response } = await api.GET("/v1/source-repositories", {
    params: {
      query: {
        projectId,
        limit: 1,
      },
    },
  });

  if (error || !data) {
    throw repoConnectionApiError("Failed to inspect GitHub repository connection", response, error);
  }

  return data.data[0] ?? null;
}

function createPendingRepositoryConnection(
  repository: GitHubRepositoryReference,
): GitRepositoryConnection {
  return {
    id: null,
    provider: "github",
    repoId: null,
    repository,
    defaultBranch: null,
    isPrivate: null,
    status: "pending",
    installation: {
      id: null,
      status: "pending",
    },
    automation: {
      branches: false,
      pullRequests: false,
      comments: false,
    },
    connectedAt: new Date().toISOString(),
    updatedAt: null,
  };
}

function toRepositoryConnection(record: SourceRepositoryResponse): GitRepositoryConnection {
  const [owner = "", name = ""] = record.repoFullName.split("/");

  return {
    id: record.id,
    provider: "github",
    repoId: record.repoId,
    repository: {
      owner,
      name,
      fullName: record.repoFullName,
      url: `https://github.com/${record.repoFullName}`,
    },
    defaultBranch: record.defaultBranch,
    isPrivate: record.isPrivate,
    status: record.status,
    installation: {
      id: record.installationId,
      status: "connected",
    },
    automation: {
      branches: record.status === "active",
      pullRequests: false,
      comments: false,
    },
    connectedAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function unsupportedRepositoryProviderError(): CliError {
  return new CliError({
    code: "REPO_PROVIDER_UNSUPPORTED",
    domain: "project",
    summary: "Repository provider is not supported",
    why: "Repository connection supports GitHub repository URLs only.",
    fix: "Pass a GitHub repository URL such as git@github.com:prisma/prisma-cli.git.",
    exitCode: 2,
    nextSteps: ["prisma-cli project connect-repo git@github.com:owner/repo.git"],
  });
}

function repoNotConnectedError(): CliError {
  return new CliError({
    code: "REPO_NOT_CONNECTED",
    domain: "project",
    summary: "No GitHub repository connected",
    why: "The resolved project does not have an active GitHub repository connection.",
    fix: "Run prisma-cli project connect-repo before disconnecting.",
    exitCode: 1,
    nextSteps: ["prisma-cli project connect-repo"],
  });
}

function repoInstallationRequiredError(
  repository: GitHubRepositoryReference,
  installUrl: string,
  opened: boolean,
): CliError {
  return new CliError({
    code: "REPO_INSTALLATION_REQUIRED",
    domain: "project",
    summary: "GitHub App installation required",
    why: `The selected workspace does not have a GitHub App installation that can be used to link ${repository.fullName}.`,
    fix: opened
      ? "Finish installing the GitHub App in the browser, then rerun prisma-cli project connect-repo."
      : "Open the GitHub App installation URL, approve access, then rerun prisma-cli project connect-repo.",
    meta: {
      repository: repository.fullName,
      installUrl,
      opened,
    },
    exitCode: 1,
    nextSteps: [
      installUrl,
      `prisma-cli project connect-repo ${repository.url}`,
    ],
  });
}

function repoNotAccessibleError(repository: GitHubRepositoryReference): CliError {
  return new CliError({
    code: "REPO_NOT_ACCESSIBLE",
    domain: "project",
    summary: "GitHub repository is not accessible",
    why: `The GitHub App installations connected to this workspace do not expose ${repository.fullName}.`,
    fix: "Update the GitHub App installation so it has access to this repository, then rerun prisma-cli project connect-repo.",
    meta: {
      repository: repository.fullName,
    },
    exitCode: 1,
    nextSteps: [`prisma-cli project connect-repo ${repository.url}`],
  });
}

function repoConnectionApiError(
  summary: string,
  response: Response | undefined,
  error: SourceRepositoryApiError | undefined,
): CliError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  const apiMessage = error?.error?.message;
  const apiHint = error?.error?.hint;

  if (status === 401 || status === 403) {
    return authRequiredError(["prisma-cli auth login"]);
  }

  return new CliError({
    code: "REPO_CONNECTION_FAILED",
    domain: "project",
    summary,
    why: apiMessage ?? `The Management API returned status ${status || "unknown"}.`,
    fix: apiHint ?? repoConnectionFixForStatus(status),
    meta: {
      status,
      ...(apiCode ? { apiCode } : {}),
    },
    exitCode: 1,
    nextSteps: ["prisma-cli project show"],
  });
}

function repoConnectionFixForStatus(status: number): string {
  if (status === 404) {
    return "Install the GitHub App for this workspace, then rerun prisma-cli project connect-repo.";
  }

  if (status === 409) {
    return "This project or repository is already linked. Disconnect the old link first, then try again.";
  }

  if (status === 422) {
    return "Make sure the GitHub App installation has access to this repository.";
  }

  return "Re-run with --trace for the underlying API response details.";
}

function toProjectSummary(project: ProjectCandidate) {
  return {
    id: project.id,
    name: project.name,
  };
}
