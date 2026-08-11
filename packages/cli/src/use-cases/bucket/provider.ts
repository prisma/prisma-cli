/** The port the bucket use cases depend on. Its implementations live
 *  under `src/adapters/bucket/`. */
import type { BucketKeySummary, BucketSummary } from "../../types/bucket";

export type BucketKeyRole = "read" | "read_write";

export interface BucketCreateInput {
  projectId: string;
  name?: string;
  branchGitName?: string;
  signal?: AbortSignal;
}

export interface BucketKeyCreateInput {
  bucketId: string;
  name?: string;
  role: BucketKeyRole;
  signal?: AbortSignal;
}

export interface BucketKeyCreateRecord {
  key: BucketKeySummary;
  secretAccessKey: string;
  accessKeyId: string;
  endpoint: string;
  bucketName: string;
}

export interface BucketProvider {
  listBuckets(options: {
    projectId: string;
    branchName?: string;
    signal?: AbortSignal;
  }): Promise<BucketSummary[]>;
  createBucket(options: BucketCreateInput): Promise<BucketSummary>;
  deleteBucket(
    bucketId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  listKeys(
    bucketId: string,
    options?: { signal?: AbortSignal },
  ): Promise<BucketKeySummary[]>;
  createKey(options: BucketKeyCreateInput): Promise<BucketKeyCreateRecord>;
  deleteKey(
    bucketId: string,
    keyId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}
