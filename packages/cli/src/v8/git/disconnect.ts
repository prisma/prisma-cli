/** The `git disconnect` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import {
  readFirstSourceRepository,
  repoConnectionApiError,
  repoNotConnectedError,
  toRepositoryConnection,
} from "../../controllers/project";
import type { ProjectRepositoryConnectionResult } from "../../types/project";
import { projectFlag, resolveGitContext } from "./context";
import { mapGitOperationError } from "./errors";

function disconnectPresentations(
  result: ProjectRepositoryConnectionResult,
): Presentations {
  return {
    human: (): Block[] => [
      {
        kind: "summary",
        tone: "ok",
        text: "Disconnecting Git from the resolved project.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.project.name },
          { label: "workspace", value: result.workspace.name },
          {
            label: "repository",
            value: result.repositoryConnection.repository.fullName,
          },
        ],
      },
      {
        kind: "list",
        items: [
          "GitHub branch automation is no longer active for this project.",
        ],
      },
    ],
    stdout: () => [],
    json: () => result,
    next: () => [],
  };
}

export const gitDisconnectCommand = defineCommand({
  args: { flags: { project: projectFlag } },
  help: {
    summary: "Disconnect the GitHub repository from the resolved project",
    examples: ["git disconnect", "git disconnect --project proj_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const { api, target } = await resolveGitContext(
        ctx,
        args.flags.project,
        "git disconnect",
      );
      const existing = await readFirstSourceRepository(
        api,
        target.project.id,
        ctx.signal,
      );
      if (!existing) {
        throw repoNotConnectedError();
      }

      const { error, response } = await api.DELETE(
        "/v1/source-repositories/{id}",
        { params: { path: { id: existing.id } }, signal: ctx.signal },
      );
      if (error) {
        throw repoConnectionApiError(
          "Failed to disconnect GitHub repository",
          response,
          error,
        );
      }

      const result: ProjectRepositoryConnectionResult = {
        ...target,
        repositoryConnection: toRepositoryConnection(existing),
      };
      return ok(ctx.present({ data: result }, disconnectPresentations(result)));
    } catch (error) {
      const mapped = mapGitOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
