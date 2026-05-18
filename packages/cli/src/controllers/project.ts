import type { ManagementApiClient } from "@prisma/management-api-sdk";

import {
  parseGitHubRepositoryUrl,
  readGitOriginRemote,
  resolveGitHubRepositoryId,
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
import type { CommandContext } from "../shell/runtime";
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
  providerRepositoryId?: string;
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
    const providerRepositoryId = await resolveProviderRepositoryId(repository, options.providerRepositoryId);
    const api = client as unknown as SourceRepositoryApiClient;
    const { data, error, response } = await api.POST("/v1/source-repositories", {
      body: {
        projectId: target.project.id,
        provider: "github",
        providerRepositoryId,
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

async function resolveProviderRepositoryId(
  repository: GitHubRepositoryReference,
  explicitId: string | undefined,
): Promise<number> {
  if (explicitId !== undefined) {
    const parsed = Number(explicitId);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    throw usageError(
      "GitHub repository id must be a positive integer",
      `Received "${explicitId}" for --provider-repository-id.`,
      "Pass the numeric GitHub repository id, for example --provider-repository-id 123456.",
      [`prisma-cli project connect-repo ${repository.url} --provider-repository-id 123456`],
      "project",
    );
  }

  const resolved = await resolveGitHubRepositoryId(repository);
  if (resolved !== null) {
    return resolved;
  }

  throw new CliError({
    code: "REPO_ID_REQUIRED",
    domain: "project",
    summary: "GitHub repository id required",
    why: "The platform API links repositories by GitHub's numeric repository id, and the CLI could not resolve it automatically.",
    fix: "Pass --provider-repository-id, authenticate the GitHub CLI with gh auth login, or connect the repository in Console.",
    exitCode: 2,
    nextSteps: [
      `gh repo view ${repository.fullName} --json databaseId`,
      `prisma-cli project connect-repo ${repository.url} --provider-repository-id <id>`,
    ],
  });
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
