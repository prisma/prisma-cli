/** The `git connect` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import {
  parseGitHubRepositoryUrl,
  readGitOriginRemote,
} from "../../adapters/git";
import {
  createGitHubInstallIntent,
  findRepositoryInInstallations,
  listScmInstallations,
  readFirstSourceRepository,
  repoAlreadyConnectedError,
  repoConnectionApiError,
  repositoryFullNamesMatch,
  toRepositoryConnection,
  unsupportedRepositoryProviderError,
} from "../../controllers/project";
import { formatGitConnectionDetail } from "../../presenters/project";
import { usageError } from "../../shell/errors";
import type { ProjectRepositoryConnectionResult } from "../../types/project";
import { projectFlag, resolveGitContext } from "./context";
import { mapGitOperationError } from "./errors";

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
  needs: { credentials: true, interaction: true },
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
          "Pass a GitHub repository URL, or add a GitHub origin remote and rerun prisma-cli git connect.",
          ["prisma-cli git connect git@github.com:prisma/prisma-cli.git"],
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

      const installations = await listScmInstallations(
        api,
        target.workspace.id,
        ctx.signal,
      );
      const lookup = await findRepositoryInInstallations(
        api,
        installations,
        repository,
        ctx.signal,
      );
      if (!lookup.match) {
        const installUrl = await createGitHubInstallIntent(
          api,
          target.workspace.id,
          ctx.signal,
        );
        // TODO(s2b-D3 step 5): the browser wait is unwritten. Three
        // facts d3-bucket-branch-git.md §3.8 pins cannot be supplied by
        // the landed ctx.prompt.browserWait — the poll interval, the
        // poll event sequence, and whether the browser opened (which
        // selects REPO_INSTALLATION_REQUIRED's fix text and fills
        // meta.opened). They are with the operator; nothing is invented
        // here in the meantime.
        throw new Error(
          `git connect cannot yet wait for the GitHub App installation at ${installUrl}: the browser-wait mapping is pending an operator decision.`,
        );
      }

      const { data, error, response } = await api.POST(
        "/v1/source-repositories",
        {
          body: {
            projectId: target.project.id,
            provider: "github",
            providerRepositoryId: lookup.match.repository.id,
            installationId: lookup.match.installation.id,
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
