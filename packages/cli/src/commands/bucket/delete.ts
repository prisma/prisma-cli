/** The `bucket delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import type { BucketDeleteResult } from "../../types/bucket";
import {
  bucketPositional,
  LIST_BUCKETS_COMMAND,
  resolveBucketProviderOnly,
} from "./context";

const CONSENT_QUESTION =
  "Deleting this bucket permanently removes all objects and access keys.";

function deletePresentations(result: BucketDeleteResult): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "ok", text: "Deleting object-store bucket." },
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
    description:
      "Deletion is permanent: the stored objects are destroyed and every access key stops working. The exact bucket id is the consent token; pass it with --confirm to run non-interactively.",
    examples: ["bucket delete bkt_123 --confirm bkt_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const bucketId = args.positionals.bucketId.trim();
    if (!bucketId) {
      throw new CliStructuredError("BUCKET.USAGE_ERROR", "Bucket id required", {
        why: "Bucket deletion needs a bucket id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the bucket id to delete." },
          {
            kind: "run-command",
            label: LIST_BUCKETS_COMMAND,
            command: LIST_BUCKETS_COMMAND,
          },
        ],
      });
    }

    await ctx.prompt.consent(CONSENT_QUESTION, { token: bucketId });

    await resolveBucketProviderOnly(ctx).deleteBucket(bucketId, {
      signal: ctx.signal,
    });

    const result: BucketDeleteResult = { bucket: { id: bucketId } };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
