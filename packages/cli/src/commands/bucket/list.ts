/** The `bucket list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { serializeBucketList } from "../../presenters/bucket";
import type { BucketListResult } from "../../types/bucket";
import { branchFlag, projectFlag, resolveBucketContext } from "./context";
import { bucketRows, bucketStdoutRows } from "./presentation";

const TITLE = "Listing object-store buckets for the resolved project.";

function listPresentations(result: BucketListResult): Presentations {
  const rows = bucketRows(result.buckets);
  const stdoutRows = bucketStdoutRows(result.buckets);
  return {
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectName },
          ...(result.branchName
            ? [{ label: "branch", value: result.branchName }]
            : []),
        ],
      },
      ...(rows.length === 0
        ? [
            {
              kind: "summary" as const,
              status: "info" as const,
              text: "No buckets found.",
            },
          ]
        : [
            {
              kind: "table" as const,
              columns: ["Name", "Id", "Status", "Branch", "Created"],
              rows,
            },
          ]),
    ],
    stdout: () => stdoutRows.map((row) => row.join("\t")),
    json: () => serializeBucketList(result),
  };
}

export const bucketListCommand = defineCommand({
  args: { flags: { project: projectFlag, branch: branchFlag } },
  help: {
    summary: "List a project's object-store buckets",
    description:
      "A bucket is blob storage for files and uploads. Buckets are branch-bound: each belongs to one Branch, the isolated environment for one Git branch.",
    examples: [
      "bucket list",
      "bucket list --branch preview",
      "bucket list --json",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, projectId, projectName } = await resolveBucketContext(
      ctx,
      args.flags,
      "bucket list",
    );
    const buckets = await provider.listBuckets({
      projectId,
      branchName: args.flags.branch,
      signal: ctx.signal,
    });

    const result: BucketListResult = {
      projectId,
      projectName,
      branchName: args.flags.branch ?? null,
      buckets,
    };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
