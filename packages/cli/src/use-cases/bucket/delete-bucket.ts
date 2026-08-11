import type { BucketDeleteResult } from "../../types/bucket";
import type { BucketProvider } from "./provider";

export interface DeleteBucketInput {
  readonly bucketId: string;
  readonly signal?: AbortSignal;
}

export async function deleteBucket(
  buckets: BucketProvider,
  input: DeleteBucketInput,
): Promise<BucketDeleteResult> {
  await buckets.deleteBucket(input.bucketId, { signal: input.signal });
  return { bucket: { id: input.bucketId } };
}
