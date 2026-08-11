/** The `bucket key list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { serializeBucketKeyList } from "../../presenters/bucket";
import { usageError } from "../../shell/errors";
import type { BucketKeyListResult } from "../../types/bucket";
import { listBucketKeys } from "../../use-cases/bucket/list-bucket-keys";
import { bucketPositional, resolveBucketProviderOnly } from "./context";
import { mapBucketOperationError } from "./errors";
import { bucketKeyRows } from "./presentation";

const TITLE = "Listing access keys for bucket.";

function listPresentations(result: BucketKeyListResult): Presentations {
  const rows = bucketKeyRows(result.keys);
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows: [{ label: "bucket", value: result.bucketId }] },
      ...(rows.length === 0
        ? [{ kind: "list" as const, items: ["No keys found."] }]
        : [
            {
              kind: "table" as const,
              columns: ["Name", "Id", "Role", "Hint", "Created"],
              rows,
            },
          ]),
    ],
    stdout: () => rows.map((row) => row.join("\t")),
    json: () => serializeBucketKeyList(result),
    next: () => [],
  };
}

export const bucketKeyListCommand = defineCommand({
  args: { positionals: { bucketId: bucketPositional } },
  help: {
    summary: "List access keys for a bucket",
    examples: ["bucket key list bkt_123", "bucket key list bkt_123 --json"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const bucketId = args.positionals.bucketId.trim();
      if (!bucketId) {
        throw usageError(
          "Bucket id required",
          "Bucket key listing needs a bucket id.",
          "Pass the bucket id.",
          ["prisma-cli bucket list"],
          "bucket",
        );
      }

      const result = await listBucketKeys(resolveBucketProviderOnly(ctx), {
        bucketId,
        signal: ctx.signal,
      });
      return ok(ctx.present({ data: result }, listPresentations(result)));
    } catch (error) {
      const mapped = mapBucketOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
