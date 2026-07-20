import type { AuthWorkspace } from "./auth";
import type { ProjectResolution, ProjectSummary } from "./project";

export interface BucketResolvedContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export interface BucketSummary {
  id: string;
  name: string;
  status: string;
  branchId: string | null;
  createdAt: string;
}

export interface BucketKeySummary {
  id: string;
  name: string;
  role: "read" | "read_write";
  valueHint: string;
  createdAt: string;
}

export interface BucketListResult {
  projectId: string;
  projectName: string;
  branchName: string | null;
  verboseContext?: BucketResolvedContext;
  buckets: BucketSummary[];
}

export interface BucketCreateResult {
  projectId: string;
  projectName: string;
  verboseContext?: BucketResolvedContext;
  bucket: BucketSummary;
}

export interface BucketDeleteResult {
  bucket: {
    id: string;
  };
}

export interface BucketKeyListResult {
  bucketId: string;
  keys: BucketKeySummary[];
}

export interface BucketKeyCreateResult {
  bucketId: string;
  key: BucketKeySummary;
  secretAccessKey: string;
  accessKeyId: string;
  endpoint: string;
  bucketName: string;
}

export interface BucketKeyDeleteResult {
  key: {
    id: string;
  };
}
