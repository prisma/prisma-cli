/** The `bucket delete` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  type AddressMatch,
  describeEnvironment,
} from "../../lib/address/address";
import type { BucketDeleteResult } from "../../types/bucket";
import {
  bucketPositional,
  LIST_BUCKETS_COMMAND,
  resolveBucket,
  resolveBucketProviderOnly,
} from "./context";

function consentQuestion(
  bucketId: string,
  address: AddressMatch | undefined,
): string {
  return address
    ? `Deleting bucket ${bucketId} ${describeEnvironment(address)} permanently removes all objects and access keys.`
    : "Deleting this bucket permanently removes all objects and access keys.";
}

function deletePresentations(result: BucketDeleteResult): Presentations {
  return {
    stdout: noDataLines("A delete has no data; its exit code is the result."),
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
      "Deletion is permanent: the stored objects are destroyed and every access key stops working. The exact bucket id is the consent token, or the address when you pass one; pass it with --confirm to run non-interactively.",
    examples: [
      "bucket delete bkt_123 --confirm bkt_123",
      "bucket delete @pr-42:shop.files --confirm @pr-42:shop.files",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const bucketRef = args.positionals.bucketId.trim();
    if (!bucketRef) {
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
    const { id: bucketId, address } = await resolveBucket(ctx, bucketRef);

    await ctx.prompt.consent(consentQuestion(bucketId, address), {
      token: address?.text ?? bucketId,
    });

    await resolveBucketProviderOnly(ctx).deleteBucket(bucketId, {
      signal: ctx.signal,
    });

    const result: BucketDeleteResult = { bucket: { id: bucketId } };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
