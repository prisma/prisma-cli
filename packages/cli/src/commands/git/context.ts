/** Workspace, project and the source-repository client for the
 *  `git *` commands. */
import { type CommandContext, flag } from "@prisma/cli-engine";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import type { ResolvedProjectTarget } from "../../lib/project/resolution";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";

export type GitCommandContext = CommandContext<undefined, never>;

export const projectFlag = flag.string({
  brief:
    "Project id or name (default: the project this directory is linked to)",
  placeholder: "id-or-name",
});

export interface GitContext {
  readonly api: ManagementApiClient;
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

  // The legacy source-repository helpers take a narrower client than
  // ctx.api: the same methods, typed to the handful of paths they call.
  // Structurally compatible, but neither type is declared in terms of
  // the other, so the compiler needs the cast spelled out.
  return { api: ctx.api, target };
}
