// biome-ignore-all lint/performance/noAwaitInLoops: Bucket pagination requests must run sequentially.
import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { CLI_NAME } from "../../cli-name";
import type { BucketKeySummary, BucketSummary } from "../../types/bucket";

export interface BucketCreateInput {
  projectId: string;
  name?: string;
  branchGitName?: string;
  signal?: AbortSignal;
}

export interface BucketKeyCreateInput {
  bucketId: string;
  name?: string;
  role: "read" | "read_write";
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

interface RawApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface RawBucketRecord {
  id: string;
  name: string;
  status: string;
  branchId: string | null;
  createdAt: string;
  project?: {
    id: string;
  } | null;
}

interface RawBucketKeyRecord {
  id: string;
  name: string;
  role: "read" | "read_write";
  valueHint: string;
  createdAt: string;
  secretAccessKey?: string;
  accessKeyId?: string;
  endpoint?: string;
  bucketName?: string;
}

export function createManagementBucketProvider(
  client: ManagementApiClient,
): BucketProvider {
  return {
    async listBuckets(options) {
      const buckets: RawBucketRecord[] = [];
      let cursor: string | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await client.GET("/v1/buckets", {
          params: {
            query: {
              projectId: options.projectId,
              branchGitName: options.branchName,
              cursor,
            },
          },
          signal: options.signal,
        });
        if (result.error || !result.data) {
          throw bucketApiError(
            "Failed to list buckets",
            result.response,
            result.error as RawApiErrorBody | undefined,
          );
        }

        const data = result.data as {
          data: RawBucketRecord[];
          pagination: { hasMore: boolean; nextCursor: string | null };
        };
        buckets.push(...data.data);

        if (!data.pagination.hasMore || !data.pagination.nextCursor) {
          break;
        }
        cursor = data.pagination.nextCursor;
      }

      return buckets.map(normalizeBucket);
    },

    async createBucket(options) {
      const result = await client.POST("/v1/buckets", {
        body: {
          projectId: options.projectId,
          ...(options.name ? { name: options.name } : {}),
          ...(options.branchGitName
            ? { branchGitName: options.branchGitName }
            : {}),
        },
        signal: options.signal,
      });
      if (result.error || !result.data) {
        throw bucketApiError(
          "Failed to create bucket",
          result.response,
          result.error as RawApiErrorBody | undefined,
        );
      }

      const data = result.data as { data: RawBucketRecord };
      return normalizeBucket(data.data);
    },

    async deleteBucket(bucketId, options) {
      const result = await client.DELETE("/v1/buckets/{bucketId}", {
        params: {
          path: { bucketId },
        },
        signal: options?.signal,
      });
      if (result.error) {
        throw bucketApiError(
          "Failed to delete bucket",
          result.response,
          result.error as RawApiErrorBody | undefined,
        );
      }
    },

    async listKeys(bucketId, options) {
      const keys: RawBucketKeyRecord[] = [];
      let cursor: string | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await client.GET("/v1/buckets/{bucketId}/keys", {
          params: {
            path: { bucketId },
            query: { cursor },
          },
          signal: options?.signal,
        });
        if (result.error || !result.data) {
          throw bucketApiError(
            "Failed to list bucket keys",
            result.response,
            result.error as RawApiErrorBody | undefined,
          );
        }

        const data = result.data as {
          data: RawBucketKeyRecord[];
          pagination: { hasMore: boolean; nextCursor: string | null };
        };
        keys.push(...data.data);

        if (!data.pagination.hasMore || !data.pagination.nextCursor) {
          break;
        }
        cursor = data.pagination.nextCursor;
      }

      return keys.map(normalizeKey);
    },

    async createKey(options) {
      const result = await client.POST("/v1/buckets/{bucketId}/keys", {
        params: {
          path: { bucketId: options.bucketId },
        },
        body: {
          role: options.role,
          ...(options.name ? { name: options.name } : {}),
        },
        signal: options.signal,
      });
      if (result.error || !result.data) {
        throw bucketApiError(
          "Failed to create bucket key",
          result.response,
          result.error as RawApiErrorBody | undefined,
        );
      }

      const data = result.data as { data: RawBucketKeyRecord };
      const raw = data.data;

      const secretAccessKey = raw.secretAccessKey;
      const accessKeyId = raw.accessKeyId;
      const endpoint = raw.endpoint;
      const bucketName = raw.bucketName;

      if (!secretAccessKey || !accessKeyId || !endpoint || !bucketName) {
        throw bucketKeySecretMissingError(options.bucketId);
      }

      return {
        key: normalizeKey(raw),
        secretAccessKey,
        accessKeyId,
        endpoint,
        bucketName,
      };
    },

    async deleteKey(bucketId, keyId, options) {
      const result = await client.DELETE(
        "/v1/buckets/{bucketId}/keys/{keyId}",
        {
          params: {
            path: { bucketId, keyId },
          },
          signal: options?.signal,
        },
      );
      if (result.error) {
        throw bucketApiError(
          "Failed to delete bucket key",
          result.response,
          result.error as RawApiErrorBody | undefined,
        );
      }
    },
  };
}

export function normalizeBucket(raw: RawBucketRecord): BucketSummary {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    branchId: raw.branchId,
    createdAt: raw.createdAt,
  };
}

export function normalizeKey(raw: RawBucketKeyRecord): BucketKeySummary {
  return {
    id: raw.id,
    name: raw.name,
    role: raw.role,
    valueHint: raw.valueHint,
    createdAt: raw.createdAt,
  };
}

const VERBOSE_LOG_FIX =
  "Re-run with --log-level verbose for the underlying API response details.";

function userChoice(label: string): NextAction {
  return { kind: "user-choice", label };
}

function runCommand(command: string): NextAction {
  return { kind: "run-command", label: command, command };
}

function bucketKeySecretMissingError(bucketId: string): CliStructuredError {
  return new CliStructuredError(
    "BUCKET.KEY_SECRET_MISSING",
    "Created bucket key did not return credentials",
    {
      why: "Bucket key credentials are one-time-view secrets, but the Management API did not include them in this create response.",
      nextActions: [
        userChoice(
          "Create another bucket key and store the returned credentials immediately.",
        ),
        runCommand(`${CLI_NAME} bucket key create ${bucketId}`),
      ],
    },
  );
}

/** A 401 or 403 is the API refusing the caller, not a bucket problem. */
function isRejectedCaller(status: number): boolean {
  return status === 401 || status === 403;
}

function apiErrorWhy(status: number, message: string | undefined): string {
  if (!isRejectedCaller(status)) {
    return (
      message ?? `The Management API returned status ${status || "unknown"}.`
    );
  }
  const rejection = `The Management API rejected the request as ${status === 401 ? "unauthorized" : "forbidden"}.`;
  return message ? `${rejection} ${message}` : rejection;
}

function apiErrorMeta(
  status: number,
  apiCode: string | undefined,
): Record<string, unknown> | undefined {
  if (!status && apiCode === undefined) {
    return undefined;
  }
  return {
    ...(status ? { status } : {}),
    ...(apiCode === undefined ? {} : { apiCode }),
  };
}

function apiErrorActions(
  status: number,
  hint: string | undefined,
): NextAction[] {
  if (!isRejectedCaller(status)) {
    return [userChoice(hint ?? VERBOSE_LOG_FIX)];
  }
  return [
    userChoice(
      hint ??
        `Sign in again with ${CLI_NAME} auth login, then retry the command.`,
    ),
    runCommand(`${CLI_NAME} auth login`),
  ];
}

/**
 * Every bucket Management API failure lands on the one registered code.
 * The response's own error code is data, not an identity: it travels in
 * `meta.apiCode` beside `meta.status` so a consumer can still branch on
 * it without the CLI minting a code it never registered.
 */
function bucketApiError(
  summary: string,
  response: Response | undefined,
  error: RawApiErrorBody | undefined,
): CliStructuredError {
  const status = response?.status ?? 0;
  const meta = apiErrorMeta(status, error?.error?.code);

  return new CliStructuredError("BUCKET.API_ERROR", summary, {
    why: apiErrorWhy(status, error?.error?.message),
    ...(meta === undefined ? {} : { meta }),
    nextActions: apiErrorActions(status, error?.error?.hint),
  });
}
