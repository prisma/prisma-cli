/** The `bucket key create` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { usageError } from "../../shell/errors";
import type { BucketKeyCreateResult } from "../../types/bucket";
import { createBucketKey } from "../../use-cases/bucket/create-bucket-key";
import { bucketPositional, resolveBucketProviderOnly } from "./context";
import { mapBucketOperationError } from "./errors";

function createPresentations(result: BucketKeyCreateResult): Presentations {
  return {
    human: (): Block[] => [
      {
        kind: "summary",
        tone: "ok",
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
    json: () => result,
    next: () => [],
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
    try {
      const bucketId = args.positionals.bucketId.trim();
      if (!bucketId) {
        throw usageError(
          "Bucket id required",
          "Bucket key creation needs a bucket id.",
          "Pass the bucket id.",
          ["prisma-cli bucket list"],
          "bucket",
        );
      }

      const result = await createBucketKey(resolveBucketProviderOnly(ctx), {
        bucketId,
        name: args.flags.name?.trim() || undefined,
        role: args.flags.role,
        signal: ctx.signal,
      });
      return ok(ctx.present({ data: result }, createPresentations(result)));
    } catch (error) {
      const mapped = mapBucketOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
