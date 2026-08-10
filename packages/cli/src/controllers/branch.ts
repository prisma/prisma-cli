// biome-ignore-all lint/performance/noAwaitInLoops: Branch pagination requests must run sequentially.
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { authenticatedManagementApiClient } from "../auth/guard";
import {
  projectResolutionErrorToCliError,
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
  BranchListResult,
  BranchRole,
  BranchSummary,
} from "../types/branch";
import { createBranchUseCases } from "../use-cases/branch";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { requireAuthenticatedAuthState } from "./auth";
import { listRealWorkspaceProjects } from "./project";

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

export interface RawBranchRecord {
  id: string;
  gitName: string;
  role: BranchRole;
}

export async function runBranchList(
  context: CommandContext,
): Promise<CommandSuccess<BranchListResult>> {
  if (isRealMode(context)) {
    return {
      command: "branch.list",
      result: await listRealBranches(context),
      warnings: [],
      nextSteps: [],
    };
  }

  const useCases = createBranchUseCases(createCliUseCaseGateways(context));
  const result = await useCases.list();

  return {
    command: "branch.list",
    result,
    warnings: [],
    nextSteps: [],
  };
}

async function listRealBranches(
  context: CommandContext,
): Promise<BranchListResult> {
  const authState = await requireAuthenticatedAuthState(context);
  const client = await authenticatedManagementApiClient(
    context.runtime.env,
    context.runtime.signal,
  );
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const targetResult = await resolveProjectTarget({
    context,
    workspace,
    listProjects: () =>
      listRealWorkspaceProjects(client, workspace, context.runtime.signal),
  });
  if (targetResult.isErr()) {
    throw projectResolutionErrorToCliError(targetResult.error);
  }
  const target = targetResult.value;

  const branches = await listBranches(
    client,
    target.project.id,
    context.runtime.signal,
  );

  return {
    projectId: target.project.id,
    projectName: target.project.name,
    verboseContext: {
      workspace,
      project: target.project,
      resolution: target.resolution,
    },
    branches: sortBranches(branches.map(toBranchSummary)),
  };
}

export function sortBranches(branches: BranchSummary[]): BranchSummary[] {
  return branches.slice().sort((left, right) => {
    const leftRank = branchOrder(left);
    const rightRank = branchOrder(right);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.name.localeCompare(right.name);
  });
}

function branchOrder(branch: BranchSummary): number {
  return branch.role === "production" ? 0 : 1;
}

export async function listBranches(
  client: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<RawBranchRecord[]> {
  const collected: RawBranchRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query: Record<string, string | undefined> = {};
    if (cursor !== undefined) {
      query.cursor = cursor;
    }

    const { data, error, response } = await client.GET(
      "/v1/projects/{projectId}/branches",
      {
        params: { path: { projectId }, query },
        signal,
      },
    );
    if (error || !data) {
      throw branchApiError("Failed to list branches", response, error);
    }

    collected.push(...(data.data as RawBranchRecord[]));

    if (!data.pagination.hasMore || !data.pagination.nextCursor) {
      break;
    }
    cursor = data.pagination.nextCursor;
  }

  return collected;
}

export function toBranchSummary(branch: RawBranchRecord): BranchSummary {
  return {
    id: branch.id,
    name: branch.gitName,
    role: branch.role,
    envMap: branch.role,
  };
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

function branchApiError(
  summary: string,
  response: Response | undefined,
  error: ApiErrorBody | undefined,
): CliError {
  const status = response?.status ?? 0;
  return new CliError({
    code: error?.error?.code ?? "BRANCH_API_ERROR",
    domain: "branch",
    summary,
    why:
      error?.error?.message ??
      `The Management API returned status ${status || "unknown"}.`,
    fix:
      error?.error?.hint ??
      "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}
