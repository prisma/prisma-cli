import type { BucketKeyListResult } from "../../types/bucket";
import type { BucketProvider } from "./provider";

export interface ListBucketKeysInput {
  readonly bucketId: string;
  readonly signal?: AbortSignal;
}

export async function listBucketKeys(
  buckets: BucketProvider,
  input: ListBucketKeysInput,
): Promise<BucketKeyListResult> {
  const keys = await buckets.listKeys(input.bucketId, {
    signal: input.signal,
  });
  return { bucketId: input.bucketId, keys };
}
