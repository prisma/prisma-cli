/** The `bucket delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { usageError } from "../../shell/errors";
import type { BucketDeleteResult } from "../../types/bucket";
import { bucketPositional, resolveBucketProviderOnly } from "./context";
import { mapBucketOperationError } from "./errors";

const CONSENT_QUESTION =
  "Deleting this bucket permanently removes all objects and access keys.";

function deletePresentations(result: BucketDeleteResult): Presentations {
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "ok", text: "Deleting object-store bucket." },
      { kind: "fields", rows: [{ label: "bucket", value: result.bucket.id }] },
      {
        kind: "list",
        items: ["Bucket and all its access keys were removed."],
      },
    ],
  };
}

export const bucketDeleteCommand = defineCommand({
  args: { positionals: { bucketId: bucketPositional } },
  help: {
    summary: "Delete a bucket and all its access keys",
    examples: ["bucket delete bkt_123 --confirm bkt_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const bucketId = args.positionals.bucketId.trim();
      if (!bucketId) {
        throw usageError(
          "Bucket id required",
          "Bucket deletion needs a bucket id.",
          "Pass the bucket id to delete.",
          [`${CLI_NAME} bucket list`],
          "bucket",
        );
      }

      await ctx.prompt.consent(CONSENT_QUESTION, { token: bucketId });

      await resolveBucketProviderOnly(ctx).deleteBucket(bucketId, {
        signal: ctx.signal,
      });

      const result: BucketDeleteResult = { bucket: { id: bucketId } };
      return ok(ctx.present({ data: result }, deletePresentations(result)));
    } catch (error) {
      const mapped = mapBucketOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
