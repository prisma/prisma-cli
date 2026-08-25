/** The `bucket key list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { serializeBucketKeyList } from "../../presenters/bucket";
import type { BucketKeyListResult } from "../../types/bucket";
import {
  bucketPositional,
  LIST_BUCKETS_COMMAND,
  resolveBucketProviderOnly,
} from "./context";
import { bucketKeyRows } from "./presentation";

const TITLE = "Listing access keys for bucket.";

function listPresentations(result: BucketKeyListResult): Presentations {
  const rows = bucketKeyRows(result.keys);
  return {
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      { kind: "fields", rows: [{ label: "bucket", value: result.bucketId }] },
      ...(rows.length === 0
        ? [
            {
              kind: "summary" as const,
              status: "info" as const,
              text: "No keys found.",
            },
          ]
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
    const bucketId = args.positionals.bucketId.trim();
    if (!bucketId) {
      throw new CliStructuredError("BUCKET.USAGE_ERROR", "Bucket id required", {
        why: "Bucket key listing needs a bucket id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the bucket id." },
          {
            kind: "run-command",
            label: LIST_BUCKETS_COMMAND,
            command: LIST_BUCKETS_COMMAND,
          },
        ],
      });
    }

    const keys = await resolveBucketProviderOnly(ctx).listKeys(bucketId, {
      signal: ctx.signal,
    });

    const result: BucketKeyListResult = { bucketId, keys };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
