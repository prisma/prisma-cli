/** Workspace, project and provider for the `bucket *` commands. */
import { type CommandContext, flag, positional } from "@prisma/cli-engine";
import { createManagementBucketProvider } from "../../adapters/bucket/management-provider";
import type { BucketProvider } from "../../use-cases/bucket/provider";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";

export type BucketCommandContext = CommandContext<undefined, never>;

export const projectFlag = flag.string({
  brief: "Project id or name",
  placeholder: "id-or-name",
});

export const branchFlag = flag.string({
  brief: "Branch git name",
  placeholder: "git-name",
});

export const bucketPositional = positional.string({
  brief: "Bucket id",
  placeholder: "bucket-id",
});

export interface BucketContext {
  readonly provider: BucketProvider;
  readonly projectId: string;
  readonly projectName: string;
}

/** The legacy `requireBucketContext`: `bucket list` and `bucket create`
 *  address a project, so they need the workspace and the resolved
 *  project before the provider. */
export async function resolveBucketContext(
  ctx: BucketCommandContext,
  flags: { project?: string },
  commandName: string,
): Promise<BucketContext> {
  const workspace = await resolveActiveWorkspace(ctx);
  const target = await resolvePinnedProject(
    ctx,
    workspace,
    flags.project,
    commandName,
  );

  return {
    provider: createManagementBucketProvider(ctx.api),
    projectId: target.project.id,
    projectName: target.project.name,
  };
}

/** The legacy `requireBucketProviderOnly`: `bucket delete` and every
 *  `bucket key` command address a bucket id directly, with no workspace
 *  requirement and no project resolution. */
export function resolveBucketProviderOnly(
  ctx: BucketCommandContext,
): BucketProvider {
  return createManagementBucketProvider(ctx.api);
}
