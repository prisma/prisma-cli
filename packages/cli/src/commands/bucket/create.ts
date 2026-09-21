/** The `bucket create` command. */
import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import type { BucketCreateResult } from "../../types/bucket";
import { branchFlag, projectFlag, resolveBucketContext } from "./context";
import { bucketTargetLabel } from "./presentation";

export const bucketCreateCommand = defineCommand({
  args: {
    flags: {
      name: flag.string({
        brief: "Bucket display name (auto-generated if omitted)",
        placeholder: "name",
      }),
      project: projectFlag,
      branch: branchFlag,
    },
  },
  help: {
    summary: "Create an object-store bucket",
    description:
      "Creates blob storage in a Branch of the project. A bucket holds no credentials of its own: mint them with 'bucket key create', which prints them once.",
    examples: [
      "bucket create",
      "bucket create --name my-store",
      "bucket create --branch preview --json",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, projectId, projectName } = await resolveBucketContext(
      ctx,
      args.flags,
      "bucket create",
    );
    const bucket = await provider.createBucket({
      projectId,
      name: args.flags.name?.trim() || undefined,
      branchGitName: args.flags.branch,
      signal: ctx.signal,
    });

    const result: BucketCreateResult = { projectId, projectName, bucket };
    return ok(
      ctx.present(
        { data: result },
        {
          human: () => [
            {
              kind: "summary",
              status: "ok",
              text: `Created bucket "${bucket.name}" in ${bucketTargetLabel(projectName, bucket.branchId)}.`,
            },
          ],
          stdout: () => [],
          json: () => result,
          next: () => [],
        },
      ),
    );
  },
});
