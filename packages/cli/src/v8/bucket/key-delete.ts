/** The `bucket key delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { usageError } from "../../shell/errors";
import type { BucketKeyDeleteResult } from "../../types/bucket";
import { bucketPositional, resolveBucketProviderOnly } from "./context";
import { mapBucketOperationError } from "./errors";

function deletePresentations(result: BucketKeyDeleteResult): Presentations {
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "ok", text: "Deleting bucket access key." },
      { kind: "fields", rows: [{ label: "key", value: result.key.id }] },
      { kind: "list", items: ["The access key was revoked and removed."] },
    ],
  };
}

export const bucketKeyDeleteCommand = defineCommand({
  args: {
    positionals: {
      bucketId: bucketPositional,
      keyId: positional.string({ brief: "Key id", placeholder: "key-id" }),
    },
  },
  help: {
    summary: "Revoke and delete a bucket access key",
    examples: ["bucket key delete bkt_123 bkey_456"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const bucketId = args.positionals.bucketId.trim();
      const keyId = args.positionals.keyId.trim();
      if (!bucketId || !keyId) {
        throw usageError(
          "Bucket id and key id required",
          "Bucket key deletion needs both a bucket id and a key id.",
          "Pass the bucket id and key id.",
          ["prisma-cli bucket key list <bucketId>"],
          "bucket",
        );
      }

      await resolveBucketProviderOnly(ctx).deleteKey(bucketId, keyId, {
        signal: ctx.signal,
      });

      const result: BucketKeyDeleteResult = { key: { id: keyId } };
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
