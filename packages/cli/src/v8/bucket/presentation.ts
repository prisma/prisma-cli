/** Presentation helpers shared by the `bucket *` commands. */
import type { BucketKeySummary, BucketSummary } from "../../types/bucket";

/** Legacy `formatBucketTarget`. */
export function bucketTargetLabel(
  projectName: string,
  branchId: string | null,
): string {
  return branchId ? `${projectName} / ${branchId}` : projectName;
}

export function bucketRows(buckets: readonly BucketSummary[]): string[][] {
  return buckets.map((bucket) => [
    bucket.name,
    bucket.id,
    bucket.status,
    bucket.branchId ?? "unscoped",
    bucket.createdAt,
  ]);
}

/** The stdout rows: an unscoped bucket has an empty branch field, not
 *  the word a reader wants to see there. */
export function bucketStdoutRows(
  buckets: readonly BucketSummary[],
): string[][] {
  return buckets.map((bucket) => [
    bucket.name,
    bucket.id,
    bucket.status,
    bucket.branchId ?? "",
    bucket.createdAt,
  ]);
}

export function bucketKeyRows(keys: readonly BucketKeySummary[]): string[][] {
  return keys.map((key) => [
    key.name,
    key.id,
    key.role,
    key.valueHint,
    key.createdAt,
  ]);
}
