// biome-ignore-all lint/performance/noAwaitInLoops: Branch pagination requests must run sequentially.
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import {
  type PrismaCliPackageCommandFormatter,
  resolvePrismaCliPackageCommandFormatterSync,
} from "../lib/agent/cli-command";
import { requireComputeAuth } from "../lib/auth/guard";
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
  BranchListResult,
  BranchRemoveResult,
  BranchRole,
  BranchSummary,
} from "../types/branch";
import { createBranchUseCases } from "../use-cases/branch";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { requireAuthenticatedAuthState } from "./auth";
import {
  listFixtureWorkspaceProjects,
  listRealWorkspaceProjects,
} from "./project";

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

interface RawBranchRecord {
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
  const client = await requireComputeAuth(
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

export interface BranchRemoveFlags {
  projectRef?: string;
  confirm?: string;
}

export async function runBranchRemove(
  context: CommandContext,
  branchRef: string,
  flags: BranchRemoveFlags,
): Promise<CommandSuccess<BranchRemoveResult>> {
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const realMode = isRealMode(context);
  const client = realMode
    ? await requireComputeAuth(context.runtime.env, context.runtime.signal)
    : null;
  if (realMode && !client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  const targetResult = await resolveProjectTarget({
    context,
    workspace,
    explicitProject: flags.projectRef,
    listProjects: () =>
      client
        ? listRealWorkspaceProjects(client, workspace, context.runtime.signal)
        : Promise.resolve(listFixtureWorkspaceProjects(context, workspace)),
    commandName: "branch remove",
  });
  if (targetResult.isErr()) {
    throw projectResolutionErrorToCliError(targetResult.error);
  }
  const target = targetResult.value;

  const branches = client
    ? await listBranches(client, target.project.id, context.runtime.signal)
    : context.api.listBranchesForProject(target.project.id).map((branch) => ({
        id: branch.id,
        gitName: branch.name,
        role: branch.role,
      }));
  const branch = resolveBranchForRemoval(branchRef, branches, target);

  if (branch.role === "production") {
    throw branchProtectedError(branch.gitName);
  }

  requireBranchRemoveConfirmation({
    id: branch.id,
    confirm: flags.confirm,
    formatCommand,
  });

  if (client) {
    await deleteBranch(client, branch, context.runtime.signal, formatCommand);
  } else {
    removeFixtureBranch(context, branch, formatCommand);
  }

  return {
    command: "branch.remove",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: {
        workspace,
        project: target.project,
        resolution: target.resolution,
      },
      branch: toBranchSummary(branch),
    },
    warnings: [],
    nextSteps: [],
  };
}

function resolveBranchForRemoval(
  branchRef: string,
  branches: RawBranchRecord[],
  target: ResolvedProjectTarget,
): RawBranchRecord {
  const ref = branchRef.trim();
  const match = branches.find(
    (branch) => branch.id === ref || branch.gitName === ref,
  );
  if (!match) {
    throw new CliError({
      code: "BRANCH_NOT_FOUND",
      domain: "branch",
      summary: "Branch not found",
      why: `No branch matched "${branchRef}" in project "${target.project.name}".`,
      fix: "Pass a branch id or git name from prisma-cli branch list.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  }
  return match;
}

function requireBranchRemoveConfirmation(options: {
  id: string;
  confirm: string | undefined;
  formatCommand: PrismaCliPackageCommandFormatter;
}): void {
  if (options.confirm === options.id) {
    return;
  }

  throw new CliError({
    code: "CONFIRMATION_REQUIRED",
    domain: "branch",
    summary: "Confirm branch removal",
    why: "Removing a branch is destructive and requires the exact branch id.",
    fix: `Rerun with --confirm ${options.id}.`,
    exitCode: 2,
    nextSteps: [
      options.formatCommand([
        "branch",
        "remove",
        options.id,
        "--confirm",
        options.id,
      ]),
    ],
    meta: {
      expectedConfirm: options.id,
      receivedConfirm: options.confirm ?? null,
    },
  });
}

function branchProtectedError(branchName: string): CliError {
  return new CliError({
    code: "BRANCH_PROTECTED",
    domain: "branch",
    summary: "Branch is protected",
    why: `"${branchName}" is the project's production or default branch; protected branches cannot be removed.`,
    fix: "Only preview branches can be removed.",
    exitCode: 1,
    nextSteps: ["prisma-cli branch list"],
  });
}

function branchNotEmptyError(
  branchName: string,
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "BRANCH_NOT_EMPTY",
    domain: "branch",
    summary: "Branch still has live resources",
    why: `"${branchName}" still has live apps or databases; branch removal never deletes member resources.`,
    fix: "Remove the branch's apps and databases first, then retry.",
    exitCode: 1,
    nextSteps: [
      formatCommand([
        "app",
        "remove",
        "--app",
        "<name>",
        "--branch",
        branchName,
      ]),
      formatCommand(["database", "list", "--branch", branchName]),
    ],
  });
}

async function deleteBranch(
  client: ManagementApiClient,
  branch: RawBranchRecord,
  signal: AbortSignal,
  formatCommand: PrismaCliPackageCommandFormatter,
): Promise<void> {
  const { error, response } = await client.DELETE("/v1/branches/{branchId}", {
    params: { path: { branchId: branch.id } },
    signal,
  });
  if (response?.status === 422) {
    throw branchProtectedError(branch.gitName);
  }
  if (response?.status === 409) {
    throw branchNotEmptyError(branch.gitName, formatCommand);
  }
  if (error) {
    throw branchApiError("Failed to remove branch", response, error);
  }
}

function removeFixtureBranch(
  context: CommandContext,
  branch: RawBranchRecord,
  formatCommand: PrismaCliPackageCommandFormatter,
): void {
  const removed = context.api.removeBranch(branch.id);
  if (removed.outcome === "protected") {
    throw branchProtectedError(branch.gitName);
  }
  if (removed.outcome === "not-empty") {
    throw branchNotEmptyError(branch.gitName, formatCommand);
  }
}

function sortBranches(branches: BranchSummary[]): BranchSummary[] {
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

async function listBranches(
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

function toBranchSummary(branch: RawBranchRecord): BranchSummary {
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
