import type { ManagementApiClient } from "@prisma/management-api-sdk";

import {
  formatScopeLabel,
  parseKeyValuePositional,
  resolveEnvScope,
  type EnvScope,
  type EnvVarRole,
} from "../lib/app/env-config";
import { requireComputeAuth } from "../lib/auth/guard";
import { authRequiredError, CliError, usageError } from "../shell/errors";
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
  apiTarget: { class: EnvVarRole; branchId: null };
}

interface RawEnvironmentVariable {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
  updatedAt: string;
}

function defaultRoleScope(): EnvScope {
  return { kind: "role", role: "production" };
}

export async function runEnvAdd(
  context: CommandContext,
  rawAssignment: string | undefined,
  flags: { roleName?: string; projectRef?: string },
): Promise<CommandSuccess<EnvAddResult>> {
  const { key, value } = parseKeyValuePositional(rawAssignment, "add", context.runtime.env);
  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "add" });
  if (!scope) {
    throw usageError(
      `prisma-cli project env add requires --role`,
      "Writing without an explicit scope is rejected.",
      "Pass --role production or --role preview.",
      [`prisma-cli project env add ${key}=${value} --role production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = resolveScopeToApi(scope);

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
        `prisma-cli project env update ${key}=<new-value> --role ${scope.role}`,
      ],
    });
  }

  const { data, error, response } = await client.POST(
    "/v1/environment-variables",
    {
      body: {
        projectId,
        class: resolved.apiTarget.class,
        key,
        value,
      },
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
    warnings: [],
    nextSteps: [],
  };
}

export async function runEnvUpdate(
  context: CommandContext,
  rawAssignment: string | undefined,
  flags: { roleName?: string; projectRef?: string },
): Promise<CommandSuccess<EnvUpdateResult>> {
  const { key, value } = parseKeyValuePositional(rawAssignment, "update", context.runtime.env);
  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "update" });
  if (!scope) {
    throw usageError(
      `prisma-cli project env update requires --role`,
      "Writing without an explicit scope is rejected.",
      "Pass --role production or --role preview.",
      [`prisma-cli project env update ${key}=${value} --role production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = resolveScopeToApi(scope);

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
        `prisma-cli project env add ${key}=<value> --role ${scope.role}`,
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
  flags: { roleName?: string; projectRef?: string },
): Promise<CommandSuccess<EnvListResult>> {
  const explicit = resolveEnvScope(flags, { requireExplicit: false, command: "list" });
  const scope = explicit ?? defaultRoleScope();

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = resolveScopeToApi(scope);
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
      ? [`prisma-cli project env add KEY=value --role ${scope.role}`]
      : [],
  };
}

export async function runEnvRm(
  context: CommandContext,
  key: string | undefined,
  flags: { roleName?: string; projectRef?: string },
): Promise<CommandSuccess<EnvRmResult>> {
  if (!key) {
    throw usageError(
      "prisma-cli project env rm requires KEY",
      "No KEY positional argument was supplied.",
      "Pass the variable name to remove, e.g. STRIPE_KEY.",
      ["prisma-cli project env rm STRIPE_KEY --role production"],
      "app",
    );
  }

  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "rm" });
  if (!scope) {
    throw usageError(
      "prisma-cli project env rm requires --role",
      "Writing without an explicit scope is rejected.",
      "Pass --role production or --role preview.",
      [`prisma-cli project env rm ${key} --role production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context, flags.projectRef);
  const resolved = resolveScopeToApi(scope);
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
        `prisma-cli project env list --role ${scope.role}`,
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
    command: "project.env.rm",
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
  if (!client || !authState.workspace) {
    throw authRequiredError(["prisma auth login"]);
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

function resolveScopeToApi(scope: EnvScope): ResolvedScope {
  return {
    scope,
    descriptor: { kind: "role", role: scope.role },
    apiTarget: { class: scope.role, branchId: null },
  };
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
    rowMatchesScope(row, resolved),
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

  return collected;
}

function rowMatchesScope(
  row: RawEnvironmentVariable,
  resolved: ResolvedScope,
): boolean {
  return row.branchId === null && row.class === resolved.apiTarget.class;
}

function toMetadata(
  row: RawEnvironmentVariable,
  scope: EnvScopeDescriptor,
): EnvVariableMetadata {
  return {
    id: row.id,
    key: row.key,
    scope,
    isManagedBySystem: row.isManagedBySystem,
    updatedAt: row.updatedAt,
  };
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
