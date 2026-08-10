/** Workspace, project and the source-repository client for the
 *  `git *` commands. */
import { type CommandContext, flag } from "@prisma/cli-engine";
import type { SourceRepositoryApiClient } from "../../controllers/project";
import type { ResolvedProjectTarget } from "../../lib/project/resolution";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";

export type GitCommandContext = CommandContext<undefined, never>;

export const projectFlag = flag.string({
  brief: "Project id or name",
  placeholder: "id-or-name",
});

export interface GitContext {
  readonly api: SourceRepositoryApiClient;
  readonly target: ResolvedProjectTarget;
}

export async function resolveGitContext(
  ctx: GitCommandContext,
  explicitProject: string | undefined,
  commandName: string,
): Promise<GitContext> {
  const workspace = await resolveActiveWorkspace(ctx);
  const target = await resolvePinnedProject(
    ctx,
    workspace,
    explicitProject,
    commandName,
  );

  return { api: ctx.api as unknown as SourceRepositoryApiClient, target };
}
