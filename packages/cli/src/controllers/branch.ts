// biome-ignore-all lint/performance/noAwaitInLoops: Branch pagination requests must run sequentially.
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import {
  type PrismaCliPackageCommandFormatter,
  resolvePrismaCliPackageCommandFormatterSync,
} from "../lib/agent/cli-command";
import { createAppProvider } from "../lib/app/app-provider";
import { requireComputeAuth } from "../lib/auth/guard";
import { createManagementDatabaseProvider } from "../lib/database/provider";
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
  isDefault?: boolean;
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
  cascade?: boolean;
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

  // Production and default branches are protected outright; --cascade never
  // widens that. The check runs before any member resource is touched.
  if (branch.role === "production" || branch.isDefault) {
    throw branchProtectedError(branch.gitName);
  }

  requireBranchRemoveConfirmation({
    id: branch.id,
    confirm: flags.confirm,
    formatCommand,
  });

  let removed: BranchRemoveResult["removed"];
  if (flags.cascade) {
    removed = client
      ? await cascadeRealBranchResources(
          context,
          client,
          target.project.id,
          branch,
          formatCommand,
        )
      : cascadeFixtureBranchResources(context, branch);
  }

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
      ...(removed ? { removed } : {}),
    },
    warnings: [],
    nextSteps: [],
  };
}

/**
 * Client-orchestrated cascade: the platform's branch delete refuses non-empty
 * branches, so the CLI removes the branch's apps, then its databases, before
 * the branch itself. A failure stops immediately and reports exactly what was
 * already removed, so the partial state is never silent.
 */
async function cascadeRealBranchResources(
  context: CommandContext,
  client: ManagementApiClient,
  projectId: string,
  branch: RawBranchRecord,
  formatCommand: PrismaCliPackageCommandFormatter,
): Promise<NonNullable<BranchRemoveResult["removed"]>> {
  const signal = context.runtime.signal;
  const appProvider = createAppProvider(client);
  const databaseProvider = createManagementDatabaseProvider(client, {
    formatCommand,
  });

  const apps = await appProvider.listApps(projectId, {
    branchName: branch.gitName,
    signal,
  });
  const databases = await databaseProvider.listDatabases({
    projectId,
    branchName: branch.gitName,
    signal,
  });

  const removed: NonNullable<BranchRemoveResult["removed"]> = {
    apps: [],
    databases: [],
  };

  for (const app of apps) {
    try {
      await appProvider.removeApp(app.id, { signal });
    } catch (error) {
      throw branchCascadeIncompleteError(branch.gitName, removed, {
        kind: "app",
        id: app.id,
        name: app.name,
        error,
      });
    }
    removed.apps.push({ id: app.id, name: app.name });
  }

  for (const database of databases) {
    try {
      await databaseProvider.removeDatabase(database.id, { signal });
    } catch (error) {
      throw branchCascadeIncompleteError(branch.gitName, removed, {
        kind: "database",
        id: database.id,
        name: database.name,
        error,
      });
    }
    removed.databases.push({ id: database.id, name: database.name });
  }

  return removed;
}

function cascadeFixtureBranchResources(
  context: CommandContext,
  branch: RawBranchRecord,
): NonNullable<BranchRemoveResult["removed"]> {
  const cascaded = context.api.cascadeBranchResources(branch.id);
  return {
    apps: cascaded.apps,
    databases: cascaded.databases,
  };
}

function branchCascadeIncompleteError(
  branchName: string,
  removed: NonNullable<BranchRemoveResult["removed"]>,
  failed: {
    kind: "app" | "database";
    id: string;
    name: string;
    error: unknown;
  },
): CliError {
  return new CliError({
    code: "BRANCH_CASCADE_INCOMPLETE",
    domain: "branch",
    summary: "Branch cascade stopped before completing",
    why: `Removing ${failed.kind} "${failed.name}" (${failed.id}) on branch "${branchName}" failed: ${failed.error instanceof Error ? failed.error.message.split("\n")[0] : String(failed.error)}. The branch was not removed.`,
    fix: "Resolve the failure and rerun the cascade; already-removed resources are listed in meta and are not restored.",
    exitCode: 1,
    nextSteps: [],
    meta: {
      removedApps: removed.apps,
      removedDatabases: removed.databases,
      failed: { kind: failed.kind, id: failed.id, name: failed.name },
    },
  });
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
  branch: RawBranchRecord,
  formatCommand: PrismaCliPackageCommandFormatter,
): CliError {
  return new CliError({
    code: "BRANCH_NOT_EMPTY",
    domain: "branch",
    summary: "Branch still has live resources",
    why: `"${branch.gitName}" still has live apps or databases; plain branch removal never deletes member resources.`,
    fix: "Rerun with --cascade to remove the branch's apps and databases with it, or remove them individually first.",
    exitCode: 1,
    nextSteps: [
      formatCommand([
        "branch",
        "remove",
        branch.gitName,
        "--confirm",
        branch.id,
        "--cascade",
      ]),
      formatCommand([
        "app",
        "remove",
        "--app",
        "<name>",
        "--branch",
        branch.gitName,
      ]),
      formatCommand(["database", "list", "--branch", branch.gitName]),
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
    throw branchNotEmptyError(branch, formatCommand);
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
    throw branchNotEmptyError(branch, formatCommand);
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
