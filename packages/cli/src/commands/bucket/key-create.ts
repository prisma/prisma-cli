/** The `bucket key create` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import type { BucketKeyCreateResult } from "../../types/bucket";
import {
  bucketPositional,
  LIST_BUCKETS_COMMAND,
  resolveBucketProviderOnly,
} from "./context";

/** Legacy `resolveKeyRole`: anything that is not exactly `read` — the
 *  omitted flag included — is `read_write`. */
function resolveKeyRole(role: string | undefined): "read" | "read_write" {
  return role === "read" ? "read" : "read_write";
}

function createPresentations(result: BucketKeyCreateResult): Presentations {
  return {
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "ok",
        text: `Created key "${result.key.name}" for bucket "${result.bucketName}".`,
      },
      {
        kind: "list",
        items: [
          "The credentials below are shown once — copy them now.",
          "Set these environment variables to use this bucket:",
        ],
      },
      {
        kind: "fields",
        rows: [
          { label: "S3_ENDPOINT", value: result.endpoint },
          {
            label: "S3_ACCESS_KEY_ID",
            value: result.accessKeyId,
            sensitive: true,
          },
          {
            label: "S3_SECRET_ACCESS_KEY",
            value: result.secretAccessKey,
            sensitive: true,
          },
          { label: "S3_BUCKET", value: result.bucketName },
        ],
      },
    ],
    stdout: () => [
      `S3_ENDPOINT=${result.endpoint}`,
      `S3_ACCESS_KEY_ID=${result.accessKeyId}`,
      `S3_SECRET_ACCESS_KEY=${result.secretAccessKey}`,
      `S3_BUCKET=${result.bucketName}`,
    ],
  };
}

export const bucketKeyCreateCommand = defineCommand({
  args: {
    positionals: { bucketId: bucketPositional },
    flags: {
      role: flag.enum({
        brief: "Access role (default: read_write)",
        values: ["read", "read_write"],
      }),
      name: flag.string({
        brief: "Key display name (auto-generated if omitted)",
        placeholder: "name",
      }),
    },
  },
  help: {
    summary: "Create a bucket access key and print its one-time credentials",
    examples: [
      "bucket key create bkt_123",
      "bucket key create bkt_123 --role read",
      "bucket key create bkt_123 --name ci-key --role read_write",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const bucketId = args.positionals.bucketId.trim();
    if (!bucketId) {
      throw new CliStructuredError("BUCKET.USAGE_ERROR", "Bucket id required", {
        why: "Bucket key creation needs a bucket id.",
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

    const created = await resolveBucketProviderOnly(ctx).createKey({
      bucketId,
      name: args.flags.name?.trim() || undefined,
      role: resolveKeyRole(args.flags.role),
      signal: ctx.signal,
    });

    const result: BucketKeyCreateResult = { bucketId, ...created };
    return ok(ctx.present({ data: result }, createPresentations(result)));
  },
});
