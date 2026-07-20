import { renderMutate, serializeList } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { formatColumns, renderSummaryLine } from "../shell/ui";
import type {
  BucketCreateResult,
  BucketDeleteResult,
  BucketKeyCreateResult,
  BucketKeyDeleteResult,
  BucketKeyListResult,
  BucketListResult,
} from "../types/bucket";
import {
  renderResolvedProjectContextBlock,
  stripVerboseContext,
} from "./verbose-context";

export function renderBucketList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BucketListResult,
): string[] {
  const ui = context.ui;
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing object-store buckets for the resolved project.")}`,
    "",
  ];
  const rail = ui.dim("│");
  lines.push(`${rail}  ${ui.accent("project:")}  ${result.projectName}`);
  if (result.branchName) {
    lines.push(`${rail}  ${ui.accent("branch:")}   ${result.branchName}`);
  }
  lines.push(rail);

  if (result.buckets.length === 0) {
    lines.push(`${rail}  ${ui.dim("No buckets found.")}`);
    lines.push(
      ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
    );
    return lines;
  }

  const rows = result.buckets.map((bucket) => [
    bucket.name,
    bucket.id,
    bucket.status,
    bucket.branchId ?? "unscoped",
    bucket.createdAt,
  ]);
  const widths = [
    Math.max("Name".length, ...rows.map((row) => row[0].length)),
    Math.max("Id".length, ...rows.map((row) => row[1].length)),
    Math.max("Status".length, ...rows.map((row) => row[2].length)),
    Math.max("Branch".length, ...rows.map((row) => row[3].length)),
    Math.max("Created".length, ...rows.map((row) => row[4].length)),
  ];

  lines.push(
    `${rail}  ${ui.accent(formatColumns(["Name", "Id", "Status", "Branch", "Created"], widths))}`,
  );
  for (const row of rows) {
    lines.push(`${rail}  ${formatColumns(row, widths)}`);
  }

  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

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

export function renderBucketCreate(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: BucketCreateResult,
): string[] {
  const ui = context.ui;
  return [
    "Creating bucket...",
    renderSummaryLine(
      ui,
      "success",
      `Created bucket "${result.bucket.name}" in ${formatBucketTarget(result.projectName, result.bucket.branchId)}.`,
    ),
  ];
}

export function serializeBucketCreate(result: BucketCreateResult) {
  return stripVerboseContext(result);
}

export function renderBucketDelete(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BucketDeleteResult,
): string[] {
  return renderMutate(
    {
      title: "Deleting object-store bucket.",
      descriptor,
      context: [{ key: "bucket", value: result.bucket.id, tone: "dim" }],
      operationDescription: "Deleting bucket",
      operationCount: 1,
      details: ["Bucket and all its access keys were removed."],
    },
    context.ui,
  );
}

export function serializeBucketDelete(result: BucketDeleteResult) {
  return { bucket: result.bucket };
}

export function renderBucketKeyList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BucketKeyListResult,
): string[] {
  const ui = context.ui;
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing access keys for bucket.")}`,
    "",
  ];
  const rail = ui.dim("│");
  lines.push(`${rail}  ${ui.accent("bucket:")}  ${result.bucketId}`);
  lines.push(rail);

  if (result.keys.length === 0) {
    lines.push(`${rail}  ${ui.dim("No keys found.")}`);
    return lines;
  }

  const rows = result.keys.map((key) => [
    key.name,
    key.id,
    key.role,
    key.valueHint,
    key.createdAt,
  ]);
  const widths = [
    Math.max("Name".length, ...rows.map((row) => row[0].length)),
    Math.max("Id".length, ...rows.map((row) => row[1].length)),
    Math.max("Role".length, ...rows.map((row) => row[2].length)),
    Math.max("Hint".length, ...rows.map((row) => row[3].length)),
    Math.max("Created".length, ...rows.map((row) => row[4].length)),
  ];

  lines.push(
    `${rail}  ${ui.accent(formatColumns(["Name", "Id", "Role", "Hint", "Created"], widths))}`,
  );
  for (const row of rows) {
    lines.push(`${rail}  ${formatColumns(row, widths)}`);
  }

  return lines;
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

export function renderBucketKeyCreateStdout(
  _context: CommandContext,
  _descriptor: CommandDescriptor,
  result: BucketKeyCreateResult,
): string[] {
  return [
    `S3_ENDPOINT=${result.endpoint}`,
    `S3_ACCESS_KEY_ID=${result.accessKeyId}`,
    `S3_SECRET_ACCESS_KEY=${result.secretAccessKey}`,
    `S3_BUCKET=${result.bucketName}`,
  ];
}

export function renderBucketKeyCreate(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: BucketKeyCreateResult,
): string[] {
  const ui = context.ui;
  return [
    "Creating bucket key...",
    renderSummaryLine(
      ui,
      "success",
      `Created key "${result.key.name}" for bucket "${result.bucketName}".`,
    ),
    "  The credentials below are shown once — copy them now.",
    "  Set these environment variables to use this bucket:",
  ];
}

export function serializeBucketKeyCreate(result: BucketKeyCreateResult) {
  return result;
}

export function renderBucketKeyDelete(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BucketKeyDeleteResult,
): string[] {
  return renderMutate(
    {
      title: "Deleting bucket access key.",
      descriptor,
      context: [{ key: "key", value: result.key.id, tone: "dim" }],
      operationDescription: "Deleting bucket key",
      operationCount: 1,
      details: ["The access key was revoked and removed."],
    },
    context.ui,
  );
}

export function serializeBucketKeyDelete(result: BucketKeyDeleteResult) {
  return { key: result.key };
}

function formatBucketTarget(
  projectName: string,
  branchId: string | null,
): string {
  return branchId ? `${projectName} / ${branchId}` : projectName;
}
