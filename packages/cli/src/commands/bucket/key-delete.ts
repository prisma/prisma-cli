/** The `bucket key delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { BucketKeyDeleteResult } from "../../types/bucket";
import { bucketPositional, resolveBucketProviderOnly } from "./context";

function deletePresentations(result: BucketKeyDeleteResult): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "ok", text: "Deleting bucket access key." },
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
    description:
      "The key's credentials stop working immediately; anything still using them loses access to the bucket. The bucket and its other keys are untouched.",
    examples: ["bucket key delete bkt_123 bkey_456"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const bucketId = args.positionals.bucketId.trim();
    const keyId = args.positionals.keyId.trim();
    if (!bucketId || !keyId) {
      const listKeysCommand = `${CLI_NAME} bucket key list <bucketId>`;
      throw new CliStructuredError(
        "BUCKET.USAGE_ERROR",
        "Bucket id and key id required",
        {
          why: "Bucket key deletion needs both a bucket id and a key id.",
          nextActions: [
            { kind: "user-choice", label: "Pass the bucket id and key id." },
            {
              kind: "run-command",
              label: listKeysCommand,
              command: listKeysCommand,
            },
          ],
        },
      );
    }

    await resolveBucketProviderOnly(ctx).deleteKey(bucketId, keyId, {
      signal: ctx.signal,
    });

    const result: BucketKeyDeleteResult = { key: { id: keyId } };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
