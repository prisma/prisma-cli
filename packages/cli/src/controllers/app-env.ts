import type { ManagementApiClient } from "@prisma/management-api-sdk";

import {
  formatScopeLabel,
  parseKeyValuePositional,
  resolveEnvScope,
  type EnvScope,
  type EnvVarRole,
} from "../lib/app/env-config";
import { requireComputeAuth } from "../lib/auth/guard";
import { readLocalGitBranch } from "../lib/git/local-branch";
import { authRequiredError, CliError, usageError, workspaceRequiredError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import { resolveProjectTarget } from "../lib/project/resolution";
import type {
  EnvAddResult,
  EnvListTarget,
  EnvListResult,
  EnvRmResult,
  EnvScopeDescriptor,
  EnvUpdateResult,
  EnvVariableMetadata,
} from "../types/app-env";
import { requireAuthenticatedAuthState } from "./auth";
import { listRealWorkspaceProjects } from "./project";

interface ResolvedScope {
  scope: EnvScope;
  descriptor: EnvScopeDescriptor;
  apiTarget: { class: EnvVarRole; branchId: string | null };
}

type ResolvedListScope =
  | {
      kind: "scoped";
      descriptor: EnvScopeDescriptor;
      target: EnvListTarget;
      apiTarget: { class: EnvVarRole; branchId: string | null };
      addScope: EnvScope;
    }
  | {
      kind: "overview";
      descriptor: { kind: "overview" };
      target: EnvListTarget;
      addScope: EnvScope;
    };

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
  role: EnvVarRole;
  isDefault: boolean;
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

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef, "project env add");
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: true,
    signal: context.runtime.signal,
  });

  const existing = await findVariableByNaturalKey(client, projectId, key, resolved, context.runtime.signal);

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
    }, context.runtime.signal))
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
      },
      signal: context.runtime.signal,
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

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef, "project env update");
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: false,
    signal: context.runtime.signal,
  });

  const existing = await findVariableByNaturalKey(client, projectId, key, resolved, context.runtime.signal);

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
      signal: context.runtime.signal,
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

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef, "project env list");
  const resolved = await resolveListScopeToApi(client, projectId, explicit, {
    cwd: context.runtime.cwd,
    signal: context.runtime.signal,
  });
  const variables = resolved.kind === "scoped"
    ? await listVariables(client, projectId, {
        scope: resolved.addScope,
        descriptor: resolved.descriptor,
        apiTarget: resolved.apiTarget,
      }, context.runtime.signal)
    : await listOverviewVariables(client, projectId, context.runtime.signal);

  return {
    command: "project.env.list",
    result: {
      projectId,
      scope: resolved.descriptor,
      target: resolved.target,
      variables: variables.map((row) => toMetadata(row, resolved.descriptor)),
    },
    warnings: [],
    nextSteps: variables.length === 0
      ? [`prisma-cli project env add KEY=value ${formatScopeFlag(resolved.addScope)}`]
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

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef, "project env remove");
  const resolved = await resolveScopeToApi(client, projectId, scope, {
    createBranchIfMissing: false,
    signal: context.runtime.signal,
  });
  const existing = await findVariableByNaturalKey(client, projectId, key, resolved, context.runtime.signal);
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
      signal: context.runtime.signal,
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
  commandName: string,
): Promise<{ client: ManagementApiClient; projectId: string }> {
  const authState = await requireAuthenticatedAuthState(context);
  const client = await requireComputeAuth(context.runtime.env, context.runtime.signal);
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
    listProjects: () => listRealWorkspaceProjects(client, authState.workspace!, context.runtime.signal),
    commandName,
  });

  return { client, projectId: target.project.id };
}

async function resolveScopeToApi(
  client: ManagementApiClient,
  projectId: string,
  scope: EnvScope,
  options: { createBranchIfMissing: boolean; signal: AbortSignal },
): Promise<ResolvedScope> {
  if (scope.kind === "role") {
    return {
      scope,
      descriptor: { kind: "role", role: scope.role },
      apiTarget: { class: scope.role, branchId: null },
    };
  }

  const branch = options.createBranchIfMissing
    ? await resolveOrCreateBranch(client, projectId, scope.branchName, options.signal)
    : await resolveExistingBranch(client, projectId, scope.branchName, options.signal);

  if (branch.role === "production") {
    throw new CliError({
      code: "ENV_BRANCH_SCOPE_IS_PRODUCTION",
      domain: "app",
      summary: `Branch "${scope.branchName}" is the production branch`,
      why: "Production variables are project-level only; branch overrides apply to preview branches.",
      fix: "Use --role production for the production branch.",
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

async function resolveListScopeToApi(
  client: ManagementApiClient,
  projectId: string,
  explicit: EnvScope | undefined,
  options: { cwd: string; signal: AbortSignal },
): Promise<ResolvedListScope> {
  if (explicit) {
    const resolved = await resolveScopeToApi(client, projectId, explicit, {
      createBranchIfMissing: false,
      signal: options.signal,
    });
    return {
      kind: "scoped",
      descriptor: resolved.descriptor,
      target: targetFromExplicitScope(resolved.descriptor),
      apiTarget: resolved.apiTarget,
      addScope: resolved.scope,
    };
  }

  const gitBranch = await readLocalGitBranch(options.cwd, options.signal);
  if (gitBranch) {
    const branch = (await listBranchesByName(client, projectId, gitBranch, options.signal))[0];
    if (!branch) {
      return {
        kind: "scoped",
        descriptor: { kind: "role", role: "preview" },
        target: {
          source: "local-git",
          branchName: gitBranch,
          branchExists: false,
          envMap: "preview",
        },
        apiTarget: { class: "preview", branchId: null },
        addScope: { kind: "branch", branchName: gitBranch },
      };
    }

    if (branch.role === "production") {
      return {
        kind: "scoped",
        descriptor: { kind: "role", role: "production" },
        target: {
          source: "local-git",
          branchName: branch.gitName,
          branchId: branch.id,
          branchRole: branch.role,
          branchExists: true,
          envMap: "production",
        },
        apiTarget: { class: "production", branchId: null },
        addScope: { kind: "role", role: "production" },
      };
    }

    return {
      kind: "scoped",
      descriptor: {
        kind: "branch",
        branchName: branch.gitName,
        branchId: branch.id,
      },
      target: {
        source: "local-git",
        branchName: branch.gitName,
        branchId: branch.id,
        branchRole: branch.role,
        branchExists: true,
        envMap: "preview",
      },
      apiTarget: { class: "preview", branchId: branch.id },
      addScope: { kind: "branch", branchName: branch.gitName },
    };
  }

  return {
    kind: "overview",
    descriptor: { kind: "overview" },
    target: {
      source: "overview",
      envMap: "overview",
    },
    addScope: { kind: "role", role: "preview" },
  };
}

function targetFromExplicitScope(scope: EnvScopeDescriptor): EnvListTarget {
  if (scope.kind === "branch") {
    return {
      source: "explicit",
      branchName: scope.branchName,
      branchId: scope.branchId,
      branchRole: "preview",
      branchExists: true,
      envMap: "preview",
    };
  }

  if (scope.kind === "role") {
    return {
      source: "explicit",
      envMap: scope.role,
    };
  }

  return {
    source: "overview",
    envMap: "overview",
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
  signal: AbortSignal,
): Promise<RawBranchRecord[]> {
  const { data, error, response } = await client.GET(
    "/v1/projects/{projectId}/branches",
    {
      params: {
        path: { projectId },
        query: { gitName: branchName },
      },
      signal,
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
  signal: AbortSignal,
): Promise<RawBranchRecord> {
  const branch = (await listBranchesByName(client, projectId, branchName, signal))[0];
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
  signal: AbortSignal,
): Promise<RawBranchRecord> {
  const existing = (await listBranchesByName(client, projectId, branchName, signal))[0];
  if (existing) {
    return existing;
  }

  if (!(await projectHasDefaultBranch(client, projectId, signal))) {
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
      signal,
    },
  );
  if (error || !data) {
    if (response?.status === 409) {
      const raced = (await listBranchesByName(client, projectId, branchName, signal))[0];
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
  signal: AbortSignal,
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
        signal,
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
  signal: AbortSignal,
): Promise<RawEnvironmentVariable | null> {
  const { data, error, response } = await client.GET("/v1/environment-variables", {
    params: {
      query: {
        projectId,
        class: resolved.apiTarget.class,
        key,
      },
    },
    signal,
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
  signal: AbortSignal,
): Promise<RawEnvironmentVariable[]> {
  const collected = await collectEnvironmentVariables(client, projectId, signal, {
    className: resolved.apiTarget.class,
    filter: (row) => rowMatchesScope(row, resolved),
  });

  return materializeEffectiveRows(collected, resolved);
}

async function listOverviewVariables(
  client: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<RawEnvironmentVariable[]> {
  const collected = await collectEnvironmentVariables(client, projectId, signal, {
    filter: (row) =>
      row.branchId === null && (row.class === "production" || row.class === "preview"),
  });

  return collected.sort((left, right) => {
    const roleOrder = roleSortOrder(left.class) - roleSortOrder(right.class);
    return roleOrder !== 0 ? roleOrder : left.key.localeCompare(right.key);
  });
}

async function collectEnvironmentVariables(
  client: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
  options: {
    className?: EnvVarRole;
    filter(row: RawEnvironmentVariable): boolean;
  },
): Promise<RawEnvironmentVariable[]> {
  const collected: RawEnvironmentVariable[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query: Record<string, string | undefined> = { projectId };
    if (options.className !== undefined) {
      query.class = options.className;
    }
    if (cursor !== undefined) {
      query.cursor = cursor;
    }

    const result = await client.GET("/v1/environment-variables", {
      params: { query },
      signal,
    });
    if (result.error || !result.data) {
      throw apiCallError(
        `Failed to list environment variables`,
        result.response,
        result.error,
      );
    }

    const page = (result.data.data as RawEnvironmentVariable[]).filter(options.filter);
    collected.push(...page);

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      break;
    }
    cursor = result.data.pagination.nextCursor;
  }

  return collected;
}

function roleSortOrder(role: EnvVarRole): number {
  return role === "production" ? 0 : 1;
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
  if (scope.kind === "overview") {
    return "overview";
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
