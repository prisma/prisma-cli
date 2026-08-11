import { authenticatedManagementApiClient } from "../auth/guard";
import {
  type BucketProvider,
  createManagementBucketProvider,
  normalizeBucket,
  normalizeKey,
} from "../lib/bucket/provider";
import {
  projectResolutionErrorToCliError,
  type ResolvedProjectTarget,
  resolveProjectTarget,
} from "../lib/project/resolution";
import {
  authRequiredError,
  CliError,
  workspaceRequiredError,
} from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type {
  BucketCreateResult,
  BucketDeleteResult,
  BucketKeyCreateResult,
  BucketKeyDeleteResult,
  BucketKeyListResult,
  BucketListResult,
} from "../types/bucket";
import { requireAuthenticatedAuthState } from "./auth";
import {
  listFixtureWorkspaceProjects,
  listRealWorkspaceProjects,
} from "./project";

interface BucketCommandFlags {
  projectRef?: string;
  branchName?: string;
}

interface BucketCreateFlags extends BucketCommandFlags {
  name?: string;
}

interface BucketDeleteFlags {
  confirm?: string;
}

interface BucketKeyCreateFlags {
  role?: string;
  name?: string;
}

interface ResolvedBucketContext {
  provider: BucketProvider;
  target: ResolvedProjectTarget;
}

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

export async function runBucketList(
  context: CommandContext,
  flags: BucketCommandFlags,
): Promise<CommandSuccess<BucketListResult>> {
  const { provider, target } = await requireBucketContext(
    context,
    flags,
    "bucket list",
  );
  const buckets = await provider.listBuckets({
    projectId: target.project.id,
    branchName: flags.branchName,
    signal: context.runtime.signal,
  });

  return {
    command: "bucket.list",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      branchName: flags.branchName ?? null,
      verboseContext: target,
      buckets,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBucketCreate(
  context: CommandContext,
  flags: BucketCreateFlags,
): Promise<CommandSuccess<BucketCreateResult>> {
  const { provider, target } = await requireBucketContext(
    context,
    flags,
    "bucket create",
  );
  const bucket = await provider.createBucket({
    projectId: target.project.id,
    name: flags.name?.trim() || undefined,
    branchGitName: flags.branchName,
    signal: context.runtime.signal,
  });

  return {
    command: "bucket.create",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: target,
      bucket,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBucketDelete(
  context: CommandContext,
  bucketId: string,
  flags: BucketDeleteFlags,
): Promise<CommandSuccess<BucketDeleteResult>> {
  const id = bucketId.trim();
  if (!id) {
    throw new CliError({
      code: "USAGE_ERROR",
      domain: "bucket",
      summary: "Bucket id required",
      why: "Bucket deletion needs a bucket id.",
      fix: "Pass the bucket id to delete.",
      exitCode: 2,
      nextSteps: ["prisma-cli bucket list"],
    });
  }

  if (flags.confirm !== id) {
    throw new CliError({
      code: "CONFIRMATION_REQUIRED",
      domain: "bucket",
      summary: "Confirm bucket deletion",
      why: "Deleting this bucket permanently removes all objects and access keys.",
      fix: `Rerun with --confirm ${id}.`,
      exitCode: 2,
      nextSteps: [`prisma-cli bucket delete ${id} --confirm ${id}`],
      meta: { expectedConfirm: id, receivedConfirm: flags.confirm ?? null },
    });
  }

  const provider = await requireBucketProviderOnly(context);
  await provider.deleteBucket(id, { signal: context.runtime.signal });

  return {
    command: "bucket.delete",
    result: {
      bucket: { id },
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBucketKeyList(
  context: CommandContext,
  bucketId: string,
): Promise<CommandSuccess<BucketKeyListResult>> {
  const id = bucketId.trim();
  if (!id) {
    throw new CliError({
      code: "USAGE_ERROR",
      domain: "bucket",
      summary: "Bucket id required",
      why: "Bucket key listing needs a bucket id.",
      fix: "Pass the bucket id.",
      exitCode: 2,
      nextSteps: ["prisma-cli bucket list"],
    });
  }

  const provider = await requireBucketProviderOnly(context);
  const keys = await provider.listKeys(id, { signal: context.runtime.signal });

  return {
    command: "bucket.key.list",
    result: {
      bucketId: id,
      keys,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBucketKeyCreate(
  context: CommandContext,
  bucketId: string,
  flags: BucketKeyCreateFlags,
): Promise<CommandSuccess<BucketKeyCreateResult>> {
  const id = bucketId.trim();
  if (!id) {
    throw new CliError({
      code: "USAGE_ERROR",
      domain: "bucket",
      summary: "Bucket id required",
      why: "Bucket key creation needs a bucket id.",
      fix: "Pass the bucket id.",
      exitCode: 2,
      nextSteps: ["prisma-cli bucket list"],
    });
  }

  const role = resolveKeyRole(flags.role);
  const provider = await requireBucketProviderOnly(context);
  const created = await provider.createKey({
    bucketId: id,
    name: flags.name?.trim() || undefined,
    role,
    signal: context.runtime.signal,
  });

  return {
    command: "bucket.key.create",
    result: {
      bucketId: id,
      key: created.key,
      secretAccessKey: created.secretAccessKey,
      accessKeyId: created.accessKeyId,
      endpoint: created.endpoint,
      bucketName: created.bucketName,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBucketKeyDelete(
  context: CommandContext,
  bucketId: string,
  keyId: string,
): Promise<CommandSuccess<BucketKeyDeleteResult>> {
  const bktId = bucketId.trim();
  const kId = keyId.trim();
  if (!bktId || !kId) {
    throw new CliError({
      code: "USAGE_ERROR",
      domain: "bucket",
      summary: "Bucket id and key id required",
      why: "Bucket key deletion needs both a bucket id and a key id.",
      fix: "Pass the bucket id and key id.",
      exitCode: 2,
      nextSteps: ["prisma-cli bucket key list <bucketId>"],
    });
  }

  const provider = await requireBucketProviderOnly(context);
  await provider.deleteKey(bktId, kId, { signal: context.runtime.signal });

  return {
    command: "bucket.key.delete",
    result: {
      key: { id: kId },
    },
    warnings: [],
    nextSteps: [],
  };
}

async function resolveBucketProvider(
  context: CommandContext,
): Promise<BucketProvider> {
  if (isRealMode(context)) {
    const client = await authenticatedManagementApiClient(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }
    return createManagementBucketProvider(client);
  }
  return createFixtureBucketProvider(context);
}

async function requireBucketContext(
  context: CommandContext,
  flags: BucketCommandFlags,
  commandName: string,
): Promise<ResolvedBucketContext> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  if (isRealMode(context)) {
    const client = await authenticatedManagementApiClient(
      context.runtime.env,
      context.runtime.signal,
    );
    if (!client) {
      throw authRequiredError();
    }

    const targetResult = await resolveProjectTarget({
      context,
      workspace,
      explicitProject: flags.projectRef,
      listProjects: () =>
        listRealWorkspaceProjects(client, context.runtime.signal),
      commandName,
    });
    if (targetResult.isErr()) {
      throw projectResolutionErrorToCliError(targetResult.error);
    }

    return {
      provider: createManagementBucketProvider(client),
      target: targetResult.value,
    };
  }

  const targetResult = await resolveProjectTarget({
    context,
    workspace,
    explicitProject: flags.projectRef,
    listProjects: async () => listFixtureWorkspaceProjects(context, workspace),
    commandName,
  });
  if (targetResult.isErr()) {
    throw projectResolutionErrorToCliError(targetResult.error);
  }

  return {
    provider: createFixtureBucketProvider(context),
    target: targetResult.value,
  };
}

async function requireBucketProviderOnly(
  context: CommandContext,
): Promise<BucketProvider> {
  await requireAuthenticatedAuthState(context);
  return resolveBucketProvider(context);
}

function createFixtureBucketProvider(context: CommandContext): BucketProvider {
  return {
    async listBuckets(options) {
      return context.api
        .listBucketsForProject(options.projectId, options.branchName)
        .map((bucket) => normalizeBucket(bucket));
    },

    async createBucket(options) {
      const created = context.api.createBucket({
        projectId: options.projectId,
        name: options.name,
        branchGitName: options.branchGitName,
      });
      if (!created) {
        throw branchNotFoundError(options.branchGitName ?? "");
      }
      return normalizeBucket(created);
    },

    async deleteBucket(bucketId) {
      const removed = context.api.deleteBucket(bucketId);
      if (!removed) {
        throw bucketNotFoundError(bucketId);
      }
    },

    async listKeys(bucketId) {
      if (!context.api.getBucket(bucketId)) {
        throw bucketNotFoundError(bucketId);
      }
      return context.api
        .listBucketKeys(bucketId)
        .map((key) => normalizeKey(key));
    },

    async createKey(options) {
      const created = context.api.createBucketKey({
        bucketId: options.bucketId,
        name: options.name,
        role: options.role,
      });
      if (!created) {
        throw bucketNotFoundError(options.bucketId);
      }
      return {
        key: normalizeKey(created.key),
        secretAccessKey: created.secretAccessKey,
        accessKeyId: created.accessKeyId,
        endpoint: created.endpoint,
        bucketName: created.bucketName,
      };
    },

    async deleteKey(bucketId, keyId) {
      const removed = context.api.deleteBucketKey(bucketId, keyId);
      if (!removed) {
        throw keyNotFoundError(keyId, bucketId);
      }
    },
  };
}

function resolveKeyRole(role: string | undefined): "read" | "read_write" {
  return role === "read" ? "read" : "read_write";
}

function branchNotFoundError(branchGitName: string): CliError {
  return new CliError({
    code: "BRANCH_NOT_FOUND",
    domain: "bucket",
    summary: "Branch not found",
    why: `No branch matched "${branchGitName}" in the resolved project.`,
    fix: "Pass a branch git name from prisma-cli branch list.",
    exitCode: 1,
    nextSteps: ["prisma-cli branch list"],
  });
}

function bucketNotFoundError(bucketId: string): CliError {
  return new CliError({
    code: "BUCKET_NOT_FOUND",
    domain: "bucket",
    summary: "Bucket not found",
    why: `No bucket matched "${bucketId}".`,
    fix: "Pass a bucket id from prisma-cli bucket list.",
    exitCode: 1,
    nextSteps: ["prisma-cli bucket list"],
  });
}

function keyNotFoundError(keyId: string, bucketId: string): CliError {
  return new CliError({
    code: "BUCKET_KEY_NOT_FOUND",
    domain: "bucket",
    summary: "Bucket key not found",
    why: `No key matched "${keyId}" for bucket "${bucketId}".`,
    fix: "Pass a key id from prisma-cli bucket key list <bucketId>.",
    exitCode: 1,
    nextSteps: [`prisma-cli bucket key list ${bucketId}`],
  });
}
