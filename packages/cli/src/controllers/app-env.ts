import type { ManagementApiClient } from "@prisma/management-api-sdk";

import {
  formatScopeLabel,
  parseKeyValuePositional,
  resolveEnvScope,
  type EnvScope,
  type EnvVarRole,
} from "../lib/app/env-config";
import { requireComputeAuth } from "../lib/auth/guard";
import { authRequiredError, CliError, usageError, workspaceRequiredError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import { resolveProjectTarget } from "../lib/project/resolution";
import type {
  EnvAddResult,
  EnvListResult,
  EnvRmResult,
  EnvScopeDescriptor,
  EnvUpdateResult,
  EnvVariableMetadata,
} from "../types/app-env";
import { requireAuthenticatedAuthState } from "./auth";
import { createSelectPromptPort } from "./select-prompt-port";
import { listRealWorkspaceProjects } from "./project";

interface ResolvedScope {
  scope: EnvScope;
  descriptor: EnvScopeDescriptor;
  apiTarget: { class: EnvVarRole; branchId: string | null };
}

interface EnvCommandFlags {
  roleName?: string;
  branchName?: string;
  projectRef?: string;
}

interface RawEnvironmentVariable {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
  updatedAt: string;
}

interface RawBranchRecord {
  id: string;
  gitName: string;
  isDefault: boolean;
}

function defaultRoleScope(): EnvScope {
  return { kind: "role", role: "production" };
}

export async function runEnvAdd(
  context: CommandContext,
  rawAssignment: string | undefined,
  flags: EnvCommandFlags,
): Promise<CommandSuccess<EnvAddResult>> {
  const { key, value } = parseKeyValuePositional(rawAssignment, "add", context.runtime.env);
  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "add" });
  if (!scope) {
    throw usageError(
      `prisma-cli project env add requires --role or --branch`,
      "Writing without an explicit scope is rejected.",
      "Pass --role production, --role preview, or --branch <git-name>.",
      [`prisma-cli project env add ${key}=${value} --role production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: true,
  });

  const existing = await findVariableByNaturalKey(client, projectId, key, resolved);

  if (existing) {
    throw new CliError({
      code: "ENV_VARIABLE_ALREADY_EXISTS",
      domain: "app",
      summary: `Variable "${key}" already exists in ${formatScopeLabel(scope)}`,
      why: "A variable with this key already exists in the targeted scope.",
      fix: "Use `prisma-cli project env update` to change an existing variable's value.",
      exitCode: 1,
      nextSteps: [
        `prisma-cli project env update ${key}=<new-value> ${formatScopeFlag(scope)}`,
      ],
    });
  }

  const warnings =
    scope.kind === "branch" &&
    !(await findVariableByNaturalKey(client, projectId, key, {
      scope: { kind: "role", role: "preview" },
      descriptor: { kind: "role", role: "preview" },
      apiTarget: { class: "preview", branchId: null },
    }))
      ? [
          `Variable "${key}" does not exist in preview. It will only exist on ${formatScopeLabel(scope)}.`,
        ]
      : [];

  const { data, error, response } = await client.POST(
    "/v1/environment-variables",
    {
      body: {
        projectId,
        class: resolved.apiTarget.class,
        ...(resolved.apiTarget.branchId !== null
          ? { branchId: resolved.apiTarget.branchId }
          : {}),
        key,
        value,
      } as never,
    },
  );
  if (error || !data) {
    throw apiCallError(`Failed to add ${key}`, response, error);
  }

  return {
    command: "project.env.add",
    result: {
      projectId,
      scope: resolved.descriptor,
      variable: toMetadata(data.data as RawEnvironmentVariable, resolved.descriptor),
    },
    warnings,
    nextSteps: [],
  };
}

export async function runEnvUpdate(
  context: CommandContext,
  rawAssignment: string | undefined,
  flags: EnvCommandFlags,
): Promise<CommandSuccess<EnvUpdateResult>> {
  const { key, value } = parseKeyValuePositional(rawAssignment, "update", context.runtime.env);
  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "update" });
  if (!scope) {
    throw usageError(
      `prisma-cli project env update requires --role or --branch`,
      "Writing without an explicit scope is rejected.",
      "Pass --role production, --role preview, or --branch <git-name>.",
      [`prisma-cli project env update ${key}=${value} --role production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: false,
  });

  const existing = await findVariableByNaturalKey(client, projectId, key, resolved);

  if (!existing) {
    throw new CliError({
      code: "ENV_VARIABLE_NOT_FOUND",
      domain: "app",
      summary: `Variable "${key}" not found in ${formatScopeLabel(scope)}`,
      why: "No variable with this key exists in the targeted scope.",
      fix: "Use `prisma-cli project env add` to create a new variable.",
      exitCode: 1,
      nextSteps: [
        `prisma-cli project env add ${key}=<value> ${formatScopeFlag(scope)}`,
      ],
    });
  }

  const { data, error, response } = await client.PATCH(
    "/v1/environment-variables/{envVarId}",
    {
      params: { path: { envVarId: existing.id } },
      body: { value },
    },
  );
  if (error || !data) {
    throw apiCallError(`Failed to update value for ${key}`, response, error);
  }

  return {
    command: "project.env.update",
    result: {
      projectId,
      scope: resolved.descriptor,
      variable: toMetadata(data.data as RawEnvironmentVariable, resolved.descriptor),
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runEnvList(
  context: CommandContext,
  flags: EnvCommandFlags,
): Promise<CommandSuccess<EnvListResult>> {
  const explicit = resolveEnvScope(flags, { requireExplicit: false, command: "list" });
  const scope = explicit ?? defaultRoleScope();

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: false,
  });
  const variables = await listVariables(client, projectId, resolved);

  return {
    command: "project.env.list",
    result: {
      projectId,
      scope: resolved.descriptor,
      variables: variables.map((row) => toMetadata(row, resolved.descriptor)),
    },
    warnings: [],
    nextSteps: variables.length === 0
      ? [`prisma-cli project env add KEY=value ${formatScopeFlag(scope)}`]
      : [],
  };
}

export async function runEnvRemove(
  context: CommandContext,
  key: string | undefined,
  flags: EnvCommandFlags,
): Promise<CommandSuccess<EnvRmResult>> {
  if (!key) {
    throw usageError(
      "prisma-cli project env remove requires KEY",
      "No KEY positional argument was supplied.",
      "Pass the variable name to remove, e.g. STRIPE_KEY.",
      ["prisma-cli project env remove STRIPE_KEY --role production"],
      "app",
    );
  }

  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "remove" });
  if (!scope) {
    throw usageError(
      "prisma-cli project env remove requires --role or --branch",
      "Writing without an explicit scope is rejected.",
      "Pass --role production, --role preview, or --branch <git-name>.",
      [`prisma-cli project env remove ${key} --role production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: false,
  });
  const existing = await findVariableByNaturalKey(client, projectId, key, resolved);
  if (!existing) {
    throw new CliError({
      code: "ENV_VARIABLE_NOT_FOUND",
      domain: "app",
      summary: `Variable "${key}" not found in ${formatScopeLabel(scope)}`,
      why: "No variable with this key exists in the targeted scope, so there is nothing to remove.",
      fix: "Run prisma-cli project env list with the same scope to see the available variables.",
      exitCode: 1,
      nextSteps: [
        `prisma-cli project env list ${formatScopeFlag(scope)}`,
      ],
    });
  }

  const { error, response } = await client.DELETE(
    "/v1/environment-variables/{envVarId}",
    {
      params: { path: { envVarId: existing.id } },
    },
  );
  if (error) {
    throw apiCallError(`Failed to remove ${key}`, response, error);
  }

  return {
    command: "project.env.remove",
    result: {
      projectId,
      scope: resolved.descriptor,
      key,
    },
    warnings: [],
    nextSteps: [],
  };
}

async function requireClientAndProject(
  context: CommandContext,
  explicitProject: string | undefined,
): Promise<{ client: ManagementApiClient; projectId: string }> {
  const authState = await requireAuthenticatedAuthState(context);
  const client = await requireComputeAuth(context.runtime.env);
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }
  if (!authState.workspace) {
    throw workspaceRequiredError();
  }

  const target = await resolveProjectTarget({
    context,
    workspace: authState.workspace,
    explicitProject,
    listProjects: () => listRealWorkspaceProjects(client, authState.workspace!),
    prompt: createSelectPromptPort(context),
    remember: true,
  });

  return { client, projectId: target.project.id };
}

async function resolveScopeToApi(
  client: ManagementApiClient,
  projectId: string,
  scope: EnvScope,
  options: { createBranchIfMissing: boolean },
): Promise<ResolvedScope> {
  if (scope.kind === "role") {
    return {
      scope,
      descriptor: { kind: "role", role: scope.role },
      apiTarget: { class: scope.role, branchId: null },
    };
  }

  const branch = options.createBranchIfMissing
    ? await resolveOrCreateBranch(client, projectId, scope.branchName)
    : await resolveExistingBranch(client, projectId, scope.branchName);

  if (branch.isDefault) {
    throw new CliError({
      code: "ENV_BRANCH_SCOPE_IS_PRODUCTION",
      domain: "app",
      summary: `Branch "${scope.branchName}" is the default branch`,
      why: "Production variables are project-level only; branch overrides apply to preview branches.",
      fix: "Use --role production for the default branch.",
      exitCode: 1,
      nextSteps: ["prisma-cli project env list --role production"],
    });
  }

  return {
    scope,
    descriptor: {
      kind: "branch",
      branchName: branch.gitName,
      branchId: branch.id,
    },
    apiTarget: { class: "preview", branchId: branch.id },
  };
}

function formatScopeFlag(scope: EnvScope): string {
  if (scope.kind === "role") {
    return `--role ${scope.role}`;
  }
  return `--branch ${scope.branchName}`;
}

async function listBranchesByName(
  client: ManagementApiClient,
  projectId: string,
  branchName: string,
): Promise<RawBranchRecord[]> {
  const { data, error, response } = await client.GET(
    "/v1/projects/{projectId}/branches",
    {
      params: {
        path: { projectId },
        query: { gitName: branchName },
      },
    },
  );
  if (error || !data) {
    throw apiCallError(`Failed to resolve branch "${branchName}"`, response, error);
  }

  return data.data as RawBranchRecord[];
}

async function resolveExistingBranch(
  client: ManagementApiClient,
  projectId: string,
  branchName: string,
): Promise<RawBranchRecord> {
  const branch = (await listBranchesByName(client, projectId, branchName))[0];
  if (!branch) {
    throw new CliError({
      code: "ENV_BRANCH_NOT_FOUND",
      domain: "app",
      summary: `Branch "${branchName}" not found`,
      why: "Branch update, list, and remove commands only target existing preview branches.",
      fix: "Create the branch by deploying it, or use `project env add --branch` to create its first override.",
      exitCode: 1,
      nextSteps: [`prisma-cli project env add KEY=value --branch ${branchName}`],
    });
  }
  return branch;
}

async function resolveOrCreateBranch(
  client: ManagementApiClient,
  projectId: string,
  branchName: string,
): Promise<RawBranchRecord> {
  const existing = (await listBranchesByName(client, projectId, branchName))[0];
  if (existing) {
    return existing;
  }

  if (!(await projectHasDefaultBranch(client, projectId))) {
    throw new CliError({
      code: "ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH",
      domain: "app",
      summary: `Cannot create branch "${branchName}" from project env`,
      why: "Creating the first branch would make it the project default, but branch overrides are preview-only.",
      fix: "Create or deploy the default branch first, then add the branch override.",
      exitCode: 1,
      nextSteps: ["prisma-cli app deploy --branch main"],
    });
  }

  const { data, error, response } = await client.POST(
    "/v1/projects/{projectId}/branches",
    {
      params: { path: { projectId } },
      body: { gitName: branchName, isDefault: false },
    },
  );
  if (error || !data) {
    if (response.status === 409) {
      const raced = (await listBranchesByName(client, projectId, branchName))[0];
      if (raced) {
        return raced;
      }
    }

    throw apiCallError(`Failed to create branch "${branchName}"`, response, error);
  }

  return data.data as RawBranchRecord;
}

async function projectHasDefaultBranch(
  client: ManagementApiClient,
  projectId: string,
): Promise<boolean> {
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query: Record<string, string | undefined> = {};
    if (cursor !== undefined) {
      query.cursor = cursor;
    }

    const result = await client.GET(
      "/v1/projects/{projectId}/branches",
      {
        params: {
          path: { projectId },
          query,
        },
      },
    );
    if (result.error || !result.data) {
      throw apiCallError("Failed to check project default branch", result.response, result.error);
    }

    if ((result.data.data as RawBranchRecord[]).some((branch) => branch.isDefault)) {
      return true;
    }

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      return false;
    }
    cursor = result.data.pagination.nextCursor;
  }
}

async function findVariableByNaturalKey(
  client: ManagementApiClient,
  projectId: string,
  key: string,
  resolved: ResolvedScope,
): Promise<RawEnvironmentVariable | null> {
  const { data, error, response } = await client.GET("/v1/environment-variables", {
    params: {
      query: {
        projectId,
        class: resolved.apiTarget.class,
        key,
      },
    },
  });
  if (error || !data) {
    throw apiCallError(`Failed to look up ${key}`, response, error);
  }

  const matches = (data.data as RawEnvironmentVariable[]).filter((row) =>
    rowMatchesExactScope(row, resolved),
  );
  return matches[0] ?? null;
}

async function listVariables(
  client: ManagementApiClient,
  projectId: string,
  resolved: ResolvedScope,
): Promise<RawEnvironmentVariable[]> {
  const collected: RawEnvironmentVariable[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query: Record<string, string | undefined> = {
      projectId,
      class: resolved.apiTarget.class,
    };
    if (cursor !== undefined) {
      query.cursor = cursor;
    }

    const result = await client.GET("/v1/environment-variables", {
      params: { query },
    });
    if (result.error || !result.data) {
      throw apiCallError(
        `Failed to list environment variables`,
        result.response,
        result.error,
      );
    }

    const page = (result.data.data as RawEnvironmentVariable[]).filter((row) =>
      rowMatchesScope(row, resolved),
    );
    collected.push(...page);

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      break;
    }
    cursor = result.data.pagination.nextCursor;
  }

  return materializeEffectiveRows(collected, resolved);
}

function rowMatchesScope(
  row: RawEnvironmentVariable,
  resolved: ResolvedScope,
): boolean {
  if (row.class !== resolved.apiTarget.class) {
    return false;
  }

  if (resolved.apiTarget.branchId === null) {
    return row.branchId === null;
  }

  return row.branchId === null || row.branchId === resolved.apiTarget.branchId;
}

function rowMatchesExactScope(
  row: RawEnvironmentVariable,
  resolved: ResolvedScope,
): boolean {
  return row.class === resolved.apiTarget.class &&
    row.branchId === resolved.apiTarget.branchId;
}

function materializeEffectiveRows(
  rows: RawEnvironmentVariable[],
  resolved: ResolvedScope,
): RawEnvironmentVariable[] {
  if (resolved.apiTarget.branchId === null) {
    return rows;
  }

  const byKey = new Map<string, RawEnvironmentVariable>();
  for (const row of rows) {
    if (row.branchId === null && !byKey.has(row.key)) {
      byKey.set(row.key, row);
    }
  }
  for (const row of rows) {
    if (row.branchId === resolved.apiTarget.branchId) {
      byKey.set(row.key, row);
    }
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function toMetadata(
  row: RawEnvironmentVariable,
  requestedScope: EnvScopeDescriptor,
): EnvVariableMetadata {
  const rowScope =
    row.branchId === null
      ? ({ kind: "role", role: row.class } satisfies EnvScopeDescriptor)
      : requestedScope;

  return {
    id: row.id,
    key: row.key,
    scope: rowScope,
    source: formatDescriptorLabel(rowScope),
    isManagedBySystem: row.isManagedBySystem,
    updatedAt: row.updatedAt,
  };
}

function formatDescriptorLabel(scope: EnvScopeDescriptor): string {
  if (scope.kind === "role") {
    return scope.role ?? "unknown";
  }
  return `branch:${scope.branchName ?? scope.branchId ?? "unknown"}`;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

function apiCallError(
  summary: string,
  response: Response | undefined,
  error: ApiErrorBody | undefined,
): CliError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  const apiMessage = error?.error?.message;
  const apiHint = error?.error?.hint;

  if (status === 401 || status === 403) {
    return authRequiredError(["prisma auth login"]);
  }

  return new CliError({
    code: apiCode ?? "ENV_API_ERROR",
    domain: "app",
    summary,
    why: apiMessage ?? `The Management API returned status ${status || "unknown"}.`,
    fix: apiHint ?? "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}
