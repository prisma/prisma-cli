/** The `bucket create` command. */
import { defineCommand, flag } from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import type { BucketCreateResult } from "../../types/bucket";
import { branchFlag, projectFlag, resolveBucketContext } from "./context";
import { mapBucketOperationError } from "./errors";
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
    examples: [
      "bucket create",
      "bucket create --name my-store",
      "bucket create --branch preview --json",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
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
                tone: "ok",
                text: `Created bucket "${bucket.name}" in ${bucketTargetLabel(projectName, bucket.branchId)}.`,
              },
            ],
            stdout: () => [],
            json: () => result,
            next: () => [],
          },
        ),
      );
    } catch (error) {
      const mapped = mapBucketOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
