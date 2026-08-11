import type { BucketKeyDeleteResult } from "../../types/bucket";
import type { BucketProvider } from "./provider";

export interface DeleteBucketKeyInput {
  readonly bucketId: string;
  readonly keyId: string;
  readonly signal?: AbortSignal;
}

export async function deleteBucketKey(
  buckets: BucketProvider,
  input: DeleteBucketKeyInput,
): Promise<BucketKeyDeleteResult> {
  await buckets.deleteKey(input.bucketId, input.keyId, {
    signal: input.signal,
  });
  return { key: { id: input.keyId } };
}
