import { unlink } from "node:fs/promises";
import path from "node:path";

import { SERVICE_TOKEN_ENV_VAR } from "@prisma/cli-engine";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { matchError } from "better-result";

import type { GitHubRepositoryReference } from "../adapters/git";
import { authRequiredError, CliError } from "../errors";
import type { CommandContext } from "../legacy/runtime";
import type { PrismaCliPackageCommandFormatter } from "../lib/agent/cli-command";
import {
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  type LocalResolutionPinReadError,
  readLocalResolutionPin,
  writeLocalResolutionPin,
} from "../lib/project/local-pin";
import { projectApiError } from "../lib/project/provider";
import { type ProjectCandidate, sortProjects } from "../lib/project/resolution";
import type {
  GitRepositoryConnection,
  ProjectListResult,
} from "../types/project";

export const GITHUB_INSTALL_POLL_INTERVAL_MS = 2_000;
export const GITHUB_INSTALL_POLL_TIMEOUT_MS = 120_000;

export async function readProjectListLocalBinding(
  cwd: string,
  projects: Array<Pick<ProjectCandidate, "id">>,
  signal: AbortSignal,
): Promise<ProjectListResult["localBinding"]> {
  const pinResult = await readLocalResolutionPin(cwd, signal);
  if (pinResult.isErr()) {
    return localPinReadErrorToInvalidLocalBinding(pinResult.error);
  }

  const pin = pinResult.value;
  if (pin.kind === "present") {
    // Membership in `projects` is the whole test. That list is what the
    // API returned for this credential, so a pinned project found in it
    // is by definition one this credential can use; comparing the pin's
    // workspace id as well only added a second way to answer "invalid"
    // for a directory that was linked perfectly well.
    return projects.some((project) => project.id === pin.pin.projectId)
      ? { status: "linked" }
      : { status: "invalid" };
  }
  return { status: "not-linked" };
}

function localPinReadErrorToInvalidLocalBinding(
  error: LocalResolutionPinReadError,
): ProjectListResult["localBinding"] {
  // Migration bridge: remove in Phase 20 when local-pin read errors are composed before controller output shaping.
  return matchError(error, {
    LocalResolutionPinInvalidJsonError: () => ({ status: "invalid" }),
    LocalResolutionPinInvalidShapeError: () => ({ status: "invalid" }),
    LocalResolutionPinReadAbortedError: (error) => {
      throw error;
    },
    UnhandledException: (error) => {
      throw error;
    },
  });
}

export function transferRecipientRequiredError(
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "TRANSFER_RECIPIENT_REQUIRED",
    domain: "project",
    summary: "Transfer recipient required",
    why: "Project transfer needs the receiving workspace.",
    fix: "Pass --to-workspace <id-or-name> for a locally authenticated workspace, or --recipient-token <token> for a cross-account transfer.",
    exitCode: 2,
    nextSteps: [
      formatCommand(["auth", "workspace", "list"]),
      formatCommand([
        "project",
        "transfer",
        "<project>",
        "--to-workspace",
        "<id-or-name>",
        "--confirm",
        "<project-id>",
      ]),
    ],
  });
}

export function transferRecipientUnavailableError(
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "TRANSFER_RECIPIENT_UNAVAILABLE",
    domain: "project",
    summary: "Local workspace sessions are unavailable",
    why: `--to-workspace resolves locally stored OAuth sessions, but ${SERVICE_TOKEN_ENV_VAR} is set and service-token mode does not read them.`,
    fix: "Pass --recipient-token <token> with an access token for the receiving workspace, or unset the service token.",
    exitCode: 1,
    nextSteps: [
      formatCommand([
        "project",
        "transfer",
        "<project>",
        "--recipient-token",
        "<token>",
        "--confirm",
        "<project-id>",
      ]),
    ],
  });
}

export async function cleanupLocalPinForProject(
  context: CommandContext,
  projectId: string,
  hooks: { onError: (message: string) => void },
): Promise<boolean> {
  const pinResult = await readLocalResolutionPin(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (pinResult.isErr()) {
    return false;
  }
  const pin = pinResult.value;
  if (pin.kind !== "present" || pin.pin.projectId !== projectId) {
    return false;
  }

  try {
    await unlink(
      path.join(context.runtime.cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH),
    );
    return true;
  } catch {
    hooks.onError(
      `The local pin ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} points at the removed project but could not be deleted.`,
    );
    return false;
  }
}

export async function rewriteOrClearLocalPinForProject(
  context: CommandContext,
  projectId: string,
  recipientWorkspaceId: string | null,
  hooks: { onError: (message: string) => void },
): Promise<"rewritten" | "cleared" | "none"> {
  const pinResult = await readLocalResolutionPin(
    context.runtime.cwd,
    context.runtime.signal,
  );
  if (pinResult.isErr()) {
    return "none";
  }
  const pin = pinResult.value;
  if (pin.kind !== "present" || pin.pin.projectId !== projectId) {
    return "none";
  }

  if (recipientWorkspaceId) {
    const writeResult = await writeLocalResolutionPin(
      context.runtime.cwd,
      { workspaceId: recipientWorkspaceId, projectId },
      context.runtime.signal,
    );
    if (writeResult.isOk()) {
      return "rewritten";
    }
    hooks.onError(
      `The local pin ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} points at the transferred project but could not be rewritten.`,
    );
    return "none";
  }

  try {
    await unlink(
      path.join(context.runtime.cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH),
    );
    return "cleared";
  } catch {
    hooks.onError(
      `The local pin ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} points at the transferred project but could not be cleared.`,
    );
    return "none";
  }
}

/** The projects the API returns for the active credential, sorted.
 *  Takes no workspace: the credential names one, and the API answers
 *  within it. */
export async function listRealWorkspaceProjects(
  client: ManagementApiClient,
  signal?: AbortSignal,
): Promise<ProjectCandidate[]> {
  const { data, error, response } = await client.GET("/v1/projects", {
    signal,
  });
  // Without this the caller cannot tell a rejected request from a
  // workspace with no projects: both arrived as an empty list, so
  // `project list` reported "No projects found." and exited 0 while the
  // API was refusing it. Every command that resolves a project by name
  // reads through here too.
  if (error || !data) {
    throw projectApiError("Failed to list projects", response, error);
  }
  // No workspace filter: the credential is issued for one workspace and
  // the API answers within it, so this returns what the API returned.
  // The filter that used to be here could only ever remove something it
  // should not have — which it did, discarding every project whenever
  // the credential's bare workspace id met the API's `wksp_`-prefixed
  // one. Were the API ever to return another workspace's project, that
  // would be a server-side scoping fault, and hiding it here would turn
  // it into "you have no projects".
  return sortProjects(
    (data.data ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      ...("url" in project && typeof project.url === "string"
        ? { url: project.url }
        : {}),
      ...("defaultRegion" in project
        ? { defaultRegion: project.defaultRegion }
        : {}),
      slug:
        "slug" in project && typeof project.slug === "string"
          ? project.slug
          : null,
      workspace: {
        id: project.workspace.id,
        name: project.workspace.name,
      },
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

export interface InstalledRepositoryMatch {
  installation: ScmInstallationResponse;
  repository: ScmRepositoryResponse;
}

interface InstallationRepositoryLookup {
  match: InstalledRepositoryMatch | null;
  inspectableInstallationCount: number;
}

export interface SourceRepositoryApiError {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

export async function findRepositoryInInstallations(
  api: ManagementApiClient,
  installations: ScmInstallationResponse[],
  repository: GitHubRepositoryReference,
  signal: AbortSignal,
): Promise<InstallationRepositoryLookup> {
  let inspectableInstallationCount = 0;

  for (const installation of installations) {
    if (installation.provider !== "github" || installation.suspended) {
      continue;
    }

    // biome-ignore lint/performance/noAwaitInLoops: Installation access is inspected in order so we can stop at the first matching repository.
    const matchedRepository = await findRepositoryInInstallationIfAvailable(
      api,
      installation.id,
      repository,
      signal,
    );
    if (matchedRepository === "unavailable") {
      continue;
    }

    inspectableInstallationCount += 1;
    if (matchedRepository) {
      return {
        match: {
          installation,
          repository: matchedRepository,
        },
        inspectableInstallationCount,
      };
    }
  }

  return {
    match: null,
    inspectableInstallationCount,
  };
}

export function readPositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function listScmInstallations(
  api: ManagementApiClient,
  workspaceId: string,
  signal: AbortSignal,
): Promise<ScmInstallationResponse[]> {
  const installations: ScmInstallationResponse[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    // biome-ignore lint/performance/noAwaitInLoops: Cursor pagination is sequential by API contract.
    const { data, error, response } = await api.GET("/v1/scm-installations", {
      params: {
        query: {
          workspaceId,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal,
    });

    if (error || !data) {
      throw repoConnectionApiError(
        "Failed to inspect GitHub App installations",
        response,
        error,
      );
    }

    installations.push(...data.data);
    cursor = readNextPaginationCursor(
      data.pagination,
      seenCursors,
      "Failed to inspect GitHub App installations",
      response,
    );
  } while (cursor);

  return installations;
}

async function findRepositoryInInstallation(
  api: ManagementApiClient,
  installationId: string,
  repository: GitHubRepositoryReference,
  signal: AbortSignal,
): Promise<ScmRepositoryResponse | null> {
  const expectedFullName = repository.fullName.toLowerCase();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    // biome-ignore lint/performance/noAwaitInLoops: Cursor pagination is sequential by API contract.
    const { data, error, response } = await api.GET(
      "/v1/scm-installations/{installationId}/repositories",
      {
        params: {
          path: {
            installationId,
          },
          query: {
            limit: 100,
            ...(cursor ? { cursor } : {}),
          },
        },
        signal,
      },
    );

    if (error || !data) {
      throw repoConnectionApiError(
        "Failed to inspect GitHub repositories",
        response,
        error,
      );
    }

    const matchedRepository = data.data.find(
      (candidate) => candidate.fullName.toLowerCase() === expectedFullName,
    );
    if (matchedRepository) {
      return matchedRepository;
    }

    cursor = readNextPaginationCursor(
      data.pagination,
      seenCursors,
      "Failed to inspect GitHub repositories",
      response,
    );
  } while (cursor);

  return null;
}

function readNextPaginationCursor(
  pagination: { hasMore: boolean; nextCursor: string | null },
  seenCursors: Set<string>,
  summary: string,
  response: Response | undefined,
): string | undefined {
  const nextCursor =
    pagination.hasMore && pagination.nextCursor
      ? pagination.nextCursor
      : undefined;
  if (!nextCursor) {
    return undefined;
  }

  if (seenCursors.has(nextCursor)) {
    throw repoConnectionApiError(summary, response, {
      error: {
        message: "Pagination cursor did not advance.",
      },
    });
  }

  seenCursors.add(nextCursor);
  return nextCursor;
}

async function findRepositoryInInstallationIfAvailable(
  api: ManagementApiClient,
  installationId: string,
  repository: GitHubRepositoryReference,
  signal: AbortSignal,
): Promise<ScmRepositoryResponse | null | "unavailable"> {
  try {
    return await findRepositoryInInstallation(
      api,
      installationId,
      repository,
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    if (isUnavailableScmInstallationError(error)) {
      return "unavailable";
    }

    throw error;
  }
}

function isUnavailableScmInstallationError(error: unknown): boolean {
  if (!(error instanceof CliError) || error.code !== "REPO_CONNECTION_FAILED") {
    return false;
  }

  return error.meta.status === 404 || error.meta.status === 422;
}

export async function createGitHubInstallIntent(
  api: ManagementApiClient,
  workspaceId: string,
  signal: AbortSignal,
): Promise<string> {
  const { data, error, response } = await api.POST(
    "/v1/scm-installations/install-intents",
    {
      body: {
        provider: "github",
        workspaceId,
      },
      signal,
    },
  );

  if (error || !data) {
    throw repoConnectionApiError(
      "Failed to create GitHub App installation link",
      response,
      error,
    );
  }

  return data.data.installUrl;
}

export async function readFirstSourceRepository(
  api: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<SourceRepositoryResponse | null> {
  const { data, error, response } = await api.GET("/v1/source-repositories", {
    params: {
      query: {
        projectId,
        limit: 1,
      },
    },
    signal,
  });

  if (error || !data) {
    throw repoConnectionApiError(
      "Failed to inspect GitHub repository connection",
      response,
      error,
    );
  }

  return data.data[0] ?? null;
}

export function toRepositoryConnection(
  record: SourceRepositoryResponse,
): GitRepositoryConnection {
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

export function unsupportedRepositoryProviderError(): CliError {
  return new CliError({
    code: "REPO_PROVIDER_UNSUPPORTED",
    domain: "project",
    summary: "Repository provider is not supported",
    why: "Repository connection supports GitHub repository URLs only.",
    fix: "Pass a GitHub repository URL such as git@github.com:prisma/prisma-cli.git.",
    exitCode: 2,
    nextSteps: ["prisma-cli git connect git@github.com:owner/repo.git"],
  });
}

export function repoNotConnectedError(): CliError {
  return new CliError({
    code: "REPO_NOT_CONNECTED",
    domain: "project",
    summary: "No GitHub repository connected",
    why: "The resolved project does not have an active GitHub repository connection.",
    fix: "Run prisma-cli git connect before disconnecting.",
    exitCode: 1,
    nextSteps: ["prisma-cli git connect"],
  });
}

export function repoInstallationRequiredError(
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
      ? "Finish installing the GitHub App in the browser, then rerun prisma-cli git connect."
      : "Open the GitHub App installation URL, approve access, then rerun prisma-cli git connect.",
    meta: {
      repository: repository.fullName,
      installUrl,
      opened,
    },
    exitCode: 1,
    nextSteps: [installUrl, `prisma-cli git connect ${repository.url}`],
  });
}

export function repoNotAccessibleError(
  repository: GitHubRepositoryReference,
  installUrl: string,
  opened: boolean,
): CliError {
  return new CliError({
    code: "REPO_NOT_ACCESSIBLE",
    domain: "project",
    summary: "GitHub repository is not accessible",
    why: `The GitHub App installations connected to this workspace do not expose ${repository.fullName}.`,
    fix: "Open the GitHub App installation URL, grant access to this repository, then rerun prisma-cli git connect.",
    meta: {
      repository: repository.fullName,
      installUrl,
      opened,
    },
    exitCode: 1,
    nextSteps: [installUrl, `prisma-cli git connect ${repository.url}`],
  });
}

export function repoAlreadyConnectedError(
  repositoryFullName: string,
): CliError {
  return new CliError({
    code: "REPO_ALREADY_CONNECTED",
    domain: "project",
    summary: "Project already has a GitHub repository connected",
    why: `The resolved project is already connected to ${repositoryFullName}.`,
    fix: "Disconnect the existing repository before connecting a different one.",
    meta: {
      repository: repositoryFullName,
    },
    exitCode: 1,
    nextSteps: ["prisma-cli git disconnect"],
  });
}

export function repositoryFullNamesMatch(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function repoConnectionApiError(
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
    why:
      apiMessage ??
      `The Management API returned status ${status || "unknown"}.`,
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
    return "Install the GitHub App for this workspace, then rerun prisma-cli git connect.";
  }

  if (status === 409) {
    return "This project or repository is already linked. Disconnect the old link first, then try again.";
  }

  if (status === 422) {
    return "Make sure the GitHub App installation has access to this repository.";
  }

  return "Re-run with --trace for the underlying API response details.";
}
