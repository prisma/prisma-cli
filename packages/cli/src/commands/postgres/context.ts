/** Workspace, project and provider for the `postgres *` commands. */
import { type CommandContext, flag, positional } from "@prisma/cli-engine";
import { resolveDatabase } from "../../controllers/database";
import {
  type AddressMatch,
  resolveBranchScopedSubject,
} from "../../lib/address/address";
import {
  createManagementDatabaseProvider,
  type DatabaseProvider,
} from "../../lib/database/provider";
import type { ResolvedProjectTarget } from "../../lib/project/resolution";
import type { DatabaseSummary } from "../../types/database";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";

export type PostgresCommandContext = CommandContext<undefined, never>;

export const projectFlag = flag.string({
  brief:
    "Project id or name (default: the project this directory is linked to)",
  placeholder: "id-or-name",
});

export const branchFlag = flag.string({
  brief: "Branch git name; use to target one branch's environment",
  placeholder: "git-name",
});

export const databasePositional = positional.string({
  brief:
    "Database id or name, or its address: @shop.db (production) or @pr-42:shop.db (environment pr-42)",
  placeholder: "database",
});

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

export interface PostgresDatabaseContext extends PostgresContext {
  readonly database: DatabaseSummary;
  /** The branch git name the database was looked up on, from --branch
   *  or the address. */
  readonly branchName: string | undefined;
  /** Set when the database was named by an address. */
  readonly address: AddressMatch | undefined;
}

/** The project, then the database the subject names. A database
 *  address stands in for the database id, `--project` and `--branch`
 *  together. */
export async function resolvePostgresDatabase(
  ctx: PostgresCommandContext,
  flags: { project?: string; branch?: string },
  databaseRef: string,
  commandName: string,
): Promise<PostgresDatabaseContext> {
  const subject = await resolveBranchScopedSubject(
    ctx.api,
    "database",
    databaseRef.trim(),
    ctx.signal,
    flags,
  );
  const context = await resolvePostgresContext(
    ctx,
    {
      ...(subject.project !== undefined ? { project: subject.project } : {}),
      ...(subject.branch !== undefined ? { branch: subject.branch } : {}),
    },
    commandName,
  );
  const database = await resolveDatabase(
    context.provider,
    context.target,
    subject.ref,
    subject.branch,
    ctx.signal,
  );
  return {
    ...context,
    database,
    branchName: subject.branch,
    address: subject.match,
  };
}

/** `connection rotate` and `connection delete` address a connection
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
