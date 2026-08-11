/** The `git connect` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import type { GitHubRepositoryReference } from "../../adapters/git";
import {
  parseGitHubRepositoryUrl,
  readGitOriginRemote,
} from "../../adapters/git";
import { CLI_NAME } from "../../cli-name";
import {
  createGitHubInstallIntent,
  findRepositoryInInstallations,
  GITHUB_INSTALL_POLL_INTERVAL_MS,
  GITHUB_INSTALL_POLL_TIMEOUT_MS,
  type InstalledRepositoryMatch,
  listScmInstallations,
  readFirstSourceRepository,
  readPositiveIntegerEnv,
  repoAlreadyConnectedError,
  repoConnectionApiError,
  repositoryFullNamesMatch,
  type SourceRepositoryApiClient,
  toRepositoryConnection,
  unsupportedRepositoryProviderError,
} from "../../controllers/project";
import { formatGitConnectionDetail } from "../../presenters/project";
import { usageError } from "../../shell/errors";
import type { ProjectRepositoryConnectionResult } from "../../types/project";
import {
  type GitCommandContext,
  projectFlag,
  resolveGitContext,
} from "./context";
import { installWaitFailedError, mapGitOperationError } from "./errors";

/** The legacy wait line, printed once before the poll loop. */
const WAIT_MESSAGE =
  "Waiting for GitHub App installation or repository access approval...";

/**
 * The legacy `resolveInstalledRepository`: find the repository in the
 * workspace's GitHub App installations, and when it is not there yet,
 * send the user to an install intent and wait for them to finish. The
 * engine owns the announcement, the browser and the polling clock; this
 * only supplies the address, the cadence and the question being polled.
 */
async function resolveInstalledRepository(
  ctx: GitCommandContext,
  api: SourceRepositoryApiClient,
  workspaceId: string,
  repository: GitHubRepositoryReference,
): Promise<InstalledRepositoryMatch> {
  const inspect = async (signal: AbortSignal) =>
    findRepositoryInInstallations(
      api,
      await listScmInstallations(api, workspaceId, signal),
      repository,
      signal,
    );

  const first = await inspect(ctx.signal);
  if (first.match) {
    return first.match;
  }

  const installUrl = await createGitHubInstallIntent(
    api,
    workspaceId,
    ctx.signal,
  );

  let match: InstalledRepositoryMatch | null = null;
  let inspectableInstallationCount = 0;

  try {
    await ctx.prompt.browserWait({
      url: installUrl,
      message: WAIT_MESSAGE,
      timeout: readPositiveIntegerEnv(
        ctx.env.PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS,
        GITHUB_INSTALL_POLL_TIMEOUT_MS,
      ),
      interval: readPositiveIntegerEnv(
        ctx.env.PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS,
        GITHUB_INSTALL_POLL_INTERVAL_MS,
      ),
      poll: async (signal) => {
        const lookup = await inspect(signal);
        match = lookup.match;
        inspectableInstallationCount = lookup.inspectableInstallationCount;
        return lookup.match !== null;
      },
    });
  } catch (error) {
    if (
      CliStructuredError.is(error) &&
      error.code === "CLI.BROWSER_WAIT_TIMEOUT"
    ) {
      throw installWaitFailedError(
        repository,
        installUrl,
        inspectableInstallationCount,
      );
    }
    throw error;
  }

  if (match === null) {
    throw installWaitFailedError(
      repository,
      installUrl,
      inspectableInstallationCount,
    );
  }
  return match;
}

function connectPresentations(
  result: ProjectRepositoryConnectionResult,
): Presentations {
  const connection = result.repositoryConnection;
  return {
    human: (): Block[] => [
      {
        kind: "summary",
        tone: "ok",
        text: "Connecting Git to the resolved project.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.project.name },
          { label: "workspace", value: result.workspace.name },
          { label: "repository", value: connection.repository.fullName },
          { label: "status", value: connection.status },
        ],
      },
      { kind: "list", items: [formatGitConnectionDetail(connection.status)] },
    ],
  };
}

export const gitConnectCommand = defineCommand({
  args: {
    positionals: {
      gitUrl: positional.optionalString({
        brief: "GitHub repository URL",
        placeholder: "git-url",
      }),
    },
    flags: { project: projectFlag },
  },
  help: {
    summary: "Connect the resolved project to a GitHub repository",
    examples: [
      "git connect",
      "git connect git@github.com:prisma/prisma-cli.git",
      "git connect --project proj_123",
    ],
  },
  // Deliberately no `interaction` need. Only the install wait requires a
  // person, and `prompt.browserWait` refuses a non-interactive session
  // itself, naming the URL. Declaring the need here would have failed
  // every scripted run up front, including the ones that never reach the
  // wait: the repository already connected, or the app already installed.
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const { api, target } = await resolveGitContext(
        ctx,
        args.flags.project,
        "git connect",
      );

      const remoteUrl =
        args.positionals.gitUrl ??
        (await readGitOriginRemote(ctx.cwd, ctx.signal));
      if (!remoteUrl) {
        throw usageError(
          "Repository connection requires a GitHub repository URL",
          "No git-url was provided and the local repo does not have an origin remote.",
          `Pass a GitHub repository URL, or add a GitHub origin remote and rerun ${CLI_NAME} git connect.`,
          [`${CLI_NAME} git connect git@github.com:prisma/prisma-cli.git`],
          "project",
        );
      }

      const repository = parseGitHubRepositoryUrl(remoteUrl);
      if (!repository) {
        throw unsupportedRepositoryProviderError();
      }

      const existing = await readFirstSourceRepository(
        api,
        target.project.id,
        ctx.signal,
      );
      if (existing) {
        const existingConnection = toRepositoryConnection(existing);
        if (
          !repositoryFullNamesMatch(
            existingConnection.repository.fullName,
            repository.fullName,
          )
        ) {
          throw repoAlreadyConnectedError(
            existingConnection.repository.fullName,
          );
        }

        const idempotent: ProjectRepositoryConnectionResult = {
          ...target,
          repositoryConnection: existingConnection,
        };
        return ok(
          ctx.present({ data: idempotent }, connectPresentations(idempotent)),
        );
      }

      const installed = await resolveInstalledRepository(
        ctx,
        api,
        target.workspace.id,
        repository,
      );

      const { data, error, response } = await api.POST(
        "/v1/source-repositories",
        {
          body: {
            projectId: target.project.id,
            provider: "github",
            providerRepositoryId: installed.repository.id,
            installationId: installed.installation.id,
          },
          signal: ctx.signal,
        },
      );
      if (error || !data) {
        throw repoConnectionApiError(
          "Failed to connect GitHub repository",
          response,
          error,
        );
      }

      const result: ProjectRepositoryConnectionResult = {
        ...target,
        repositoryConnection: toRepositoryConnection(data.data),
      };
      return ok(ctx.present({ data: result }, connectPresentations(result)));
    } catch (error) {
      const mapped = mapGitOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
