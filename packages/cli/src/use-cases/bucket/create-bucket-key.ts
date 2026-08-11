import type { BucketKeyCreateResult } from "../../types/bucket";
import type { BucketKeyRole, BucketProvider } from "./provider";

/** The role a key gets when the caller names none. */
const DEFAULT_ROLE: BucketKeyRole = "read_write";

export interface CreateBucketKeyInput {
  readonly bucketId: string;
  readonly name?: string;
  readonly role?: BucketKeyRole;
  readonly signal?: AbortSignal;
}

export async function createBucketKey(
  buckets: BucketProvider,
  input: CreateBucketKeyInput,
): Promise<BucketKeyCreateResult> {
  const created = await buckets.createKey({
    bucketId: input.bucketId,
    name: input.name,
    role: input.role ?? DEFAULT_ROLE,
    signal: input.signal,
  });
  return { bucketId: input.bucketId, ...created };
}
