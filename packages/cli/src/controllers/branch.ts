import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { authRequiredError, CliError, featureUnavailableError, usageError, workspaceRequiredError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type { BranchCreateResult, BranchDeleteResult, BranchListResult, BranchRenameResult, BranchRole, BranchSummary } from "../types/branch";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { createBranchUseCases } from "../use-cases/branch";
import { requireComputeAuth } from "../lib/auth/guard";
import { resolveProjectTarget } from "../lib/project/resolution";
import { requireAuthenticatedAuthState } from "./auth";
import { listRealWorkspaceProjects } from "./project";
import { createSelectPromptPort } from "./select-prompt-port";
import { createPreviewAppProvider } from "../lib/app/preview-provider";

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

interface RawBranchRecord {
  id: string;
  gitName: string;
  role: BranchRole;
}

export async function runBranchCreate(
  context: CommandContext,
  branchName: string,
): Promise<CommandSuccess<BranchCreateResult>> {
  if (!isRealMode(context)) {
    throw featureUnavailableError(
      "Branch create is not available in fixture mode",
      "Creating Branches requires live platform integration.",
      "Rerun without fixture mode enabled to create a Branch.",
      ["prisma-cli auth login"],
      "branch",
    );
  }

  if (!branchName.trim()) {
    throw usageError(
      "Branch create requires a name",
      "The branch name must be a non-empty value.",
      "Pass a branch name explicitly.",
      ["prisma-cli branch create feat-login"],
      "branch",
    );
  }

  const authState = await requireAuthenticatedAuthState(context);
  const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const target = await resolveProjectTarget({
    context,
    workspace,
    listProjects: () => listRealWorkspaceProjects(client, workspace, context.runtime.signal),
    prompt: createSelectPromptPort(context),
    remember: true,
  });

  const provider = createPreviewAppProvider(client);
  const branch = await provider.createBranch({
    projectId: target.project.id,
    name: branchName.trim(),
    signal: context.runtime.signal,
  }).catch((error) => {
    throw new CliError({
      code: "BRANCH_CREATE_FAILED",
      domain: "branch",
      summary: `Could not create Branch "${branchName}"`,
      why: error instanceof Error ? error.message : String(error),
      fix: "Retry the command, or check that the Branch does not already exist.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  });

  return {
    command: "branch.create",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: {
        workspace,
        project: target.project,
        resolution: target.resolution,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        role: branch.role,
        envMap: branch.role,
      },
    },
    warnings: [],
    nextSteps: ["prisma-cli app deploy"],
  };
}

export async function runBranchDelete(
  context: CommandContext,
  branchName: string,
): Promise<CommandSuccess<BranchDeleteResult>> {
  if (!isRealMode(context)) {
    throw featureUnavailableError(
      "Branch delete is not available in fixture mode",
      "Deleting Branches requires live platform integration.",
      "Rerun without fixture mode enabled to delete a Branch.",
      ["prisma-cli auth login"],
      "branch",
    );
  }

  if (!branchName.trim()) {
    throw usageError(
      "Branch delete requires a name",
      "The branch name must be a non-empty value.",
      "Pass a branch name explicitly.",
      ["prisma-cli branch delete feat-login"],
      "branch",
    );
  }

  const authState = await requireAuthenticatedAuthState(context);
  const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const target = await resolveProjectTarget({
    context,
    workspace,
    listProjects: () => listRealWorkspaceProjects(client, workspace, context.runtime.signal),
    prompt: createSelectPromptPort(context),
    remember: true,
  });

  const branches = await listBranches(client, target.project.id, context.runtime.signal);
  const matched = branches.find((b) => b.gitName === branchName.trim());
  if (!matched) {
    throw new CliError({
      code: "BRANCH_NOT_FOUND",
      domain: "branch",
      summary: `Branch "${branchName}" not found`,
      why: `The resolved project does not have a Branch named "${branchName}".`,
      fix: "List available Branches and try again with an existing Branch name.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  }

  if (matched.role === "production") {
    throw new CliError({
      code: "BRANCH_DELETE_FAILED",
      domain: "branch",
      summary: `Cannot delete the production Branch`,
      why: `The Branch "${branchName}" has role "production" and cannot be deleted.`,
      fix: "Production Branches are protected. Promote a different Branch to production first, or use the platform dashboard.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  }

  const provider = createPreviewAppProvider(client);
  await provider.deleteBranch({
    projectId: target.project.id,
    branchId: matched.id,
    signal: context.runtime.signal,
  }).catch((error) => {
    throw new CliError({
      code: "BRANCH_DELETE_FAILED",
      domain: "branch",
      summary: `Could not delete Branch "${branchName}"`,
      why: error instanceof Error ? error.message : String(error),
      fix: "Retry the command.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  });

  return {
    command: "branch.delete",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      branchName: branchName.trim(),
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBranchRename(
  context: CommandContext,
  oldName: string,
  newName: string,
): Promise<CommandSuccess<BranchRenameResult>> {
  if (!isRealMode(context)) {
    throw featureUnavailableError(
      "Branch rename is not available in fixture mode",
      "Renaming Branches requires live platform integration.",
      "Rerun without fixture mode enabled to rename a Branch.",
      ["prisma-cli auth login"],
      "branch",
    );
  }

  if (!oldName.trim() || !newName.trim()) {
    throw usageError(
      "Branch rename requires old and new names",
      "Both the old branch name and new branch name must be non-empty.",
      "Pass the old and new branch names.",
      ["prisma-cli branch rename feat-login feat-auth"],
      "branch",
    );
  }

  const authState = await requireAuthenticatedAuthState(context);
  const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const target = await resolveProjectTarget({
    context,
    workspace,
    listProjects: () => listRealWorkspaceProjects(client, workspace, context.runtime.signal),
    prompt: createSelectPromptPort(context),
    remember: true,
  });

  const branches = await listBranches(client, target.project.id, context.runtime.signal);
  const matched = branches.find((b) => b.gitName === oldName.trim());
  if (!matched) {
    throw new CliError({
      code: "BRANCH_NOT_FOUND",
      domain: "branch",
      summary: `Branch "${oldName}" not found`,
      why: `The resolved project does not have a Branch named "${oldName}".`,
      fix: "List available Branches and try again with an existing Branch name.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  }

  if (matched.role === "production") {
    throw new CliError({
      code: "BRANCH_RENAME_FAILED",
      domain: "branch",
      summary: `Cannot rename the production Branch`,
      why: `The Branch "${oldName}" has role "production" and cannot be renamed.`,
      fix: "Production Branches are protected and cannot be renamed.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  }

  const provider = createPreviewAppProvider(client);
  const branch = await provider.renameBranch({
    projectId: target.project.id,
    branchId: matched.id,
    newName: newName.trim(),
    signal: context.runtime.signal,
  }).catch((error) => {
    throw new CliError({
      code: "BRANCH_RENAME_FAILED",
      domain: "branch",
      summary: `Could not rename Branch "${oldName}" to "${newName}"`,
      why: error instanceof Error ? error.message : String(error),
      fix: "Retry the command, or check that the new Branch name does not already exist.",
      exitCode: 1,
      nextSteps: ["prisma-cli branch list"],
    });
  });

  return {
    command: "branch.rename",
    result: {
      projectId: target.project.id,
      projectName: target.project.name,
      verboseContext: {
        workspace,
        project: target.project,
        resolution: target.resolution,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        role: branch.role,
        envMap: branch.role,
      },
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runBranchList(context: CommandContext): Promise<CommandSuccess<BranchListResult>> {
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

async function listRealBranches(context: CommandContext): Promise<BranchListResult> {
  const authState = await requireAuthenticatedAuthState(context);
  const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const target = await resolveProjectTarget({
    context,
    workspace,
    listProjects: () => listRealWorkspaceProjects(client, workspace, context.runtime.signal),
    prompt: createSelectPromptPort(context),
    remember: true,
  });

  const branches = await listBranches(client, target.project.id, context.runtime.signal);

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

    const { data, error, response } = await client.GET("/v1/projects/{projectId}/branches", {
      params: { path: { projectId }, query },
      signal,
    });
    if (error || !data) {
      throw branchApiError("Failed to list branches", response, error);
    }

    collected.push(...data.data as RawBranchRecord[]);

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
    why: error?.error?.message ?? `The Management API returned status ${status || "unknown"}.`,
    fix: error?.error?.hint ?? "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}
