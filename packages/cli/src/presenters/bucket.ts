import { serializeList } from "../output/patterns";
import type { BucketKeyListResult, BucketListResult } from "../types/bucket";

export function serializeBucketList(result: BucketListResult) {
  return {
    context: {
      project: result.projectName,
      ...(result.branchName ? { branch: result.branchName } : {}),
    },
    items: result.buckets.map((bucket) => ({
      name: bucket.name,
      id: bucket.id,
      status: bucket.status,
    })),
    count: result.buckets.length,
    projectId: result.projectId,
    branchName: result.branchName,
    buckets: result.buckets,
  };
}

export function serializeBucketKeyList(result: BucketKeyListResult) {
  return {
    ...serializeList({
      context: { bucket: result.bucketId },
      items: result.keys.map((key) => ({
        noun: "key",
        label: key.name,
        id: key.id,
        status: null,
      })),
    }),
    bucketId: result.bucketId,
    keys: result.keys,
  };
}
