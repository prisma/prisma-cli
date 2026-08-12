/** Workspace, project and provider for the `postgres *` commands. */
import { type CommandContext, flag, positional } from "@prisma/cli-engine";
import { CLI_NAME } from "../../cli-name";
import type { PrismaCliPackageCommandFormatter } from "../../lib/agent/cli-command";
import {
  createManagementDatabaseProvider,
  type DatabaseProvider,
} from "../../lib/database/provider";
import type { ResolvedProjectTarget } from "../../lib/project/resolution";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";

export type PostgresCommandContext = CommandContext<undefined, never>;

export const projectFlag = flag.string({
  brief: "Project id or name",
  placeholder: "id-or-name",
});

export const branchFlag = flag.string({
  brief: "Branch git name",
  placeholder: "git-name",
});

export const databasePositional = positional.string({
  brief: "Database id or name",
  placeholder: "database",
});

/** The legacy helpers build their nextSteps through a command
 *  formatter. This CLI phrases every command string as `${CLI_NAME} …`; the
 *  error mapper rewrites the `database` group name to `postgres`. */
export const legacyCommandFormatter: PrismaCliPackageCommandFormatter = (
  args,
) => [CLI_NAME, ...args].join(" ");

export interface PostgresContext {
  readonly provider: DatabaseProvider;
  readonly target: ResolvedProjectTarget;
  readonly projectId: string;
  readonly projectName: string;
}

export async function resolvePostgresContext(
  ctx: PostgresCommandContext,
  flags: { project?: string; branch?: string },
  commandName: string,
): Promise<PostgresContext> {
  const workspace = await resolveActiveWorkspace(ctx);
  const target = await resolvePinnedProject(
    ctx,
    workspace,
    flags.project,
    commandName,
  );

  return {
    provider: createManagementDatabaseProvider(ctx.api, {
      workspaceId: workspace.id,
    }),
    target,
    projectId: target.project.id,
    projectName: target.project.name,
  };
}

/** `connection rotate` and `connection remove` address a connection
 *  directly: no workspace requirement and no project resolution, so
 *  the workspace is only a plan-limit lookup hint. */
export async function resolvePostgresProviderOnly(
  ctx: PostgresCommandContext,
): Promise<DatabaseProvider> {
  const credential = await ctx.activeCredential();
  const workspaceId = credential?.workspaceId;
  return createManagementDatabaseProvider(ctx.api, {
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
}
