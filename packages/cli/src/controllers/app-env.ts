import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { readLinkedProjectId } from "../adapters/config";
import {
  formatScopeLabel,
  parseKeyValuePositional,
  resolveEnvScope,
  type EnvScope,
  type EnvVarClass,
} from "../lib/app/env-config";
import { requireComputeAuth } from "../lib/auth/guard";
import { authRequiredError, CliError, featureUnavailableError, usageError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type {
  AppEnvListResult,
  AppEnvScopeDescriptor,
  AppEnvSetResult,
  AppEnvUnsetResult,
  AppEnvVariableMetadata,
} from "../types/app-env";

interface ResolvedScope {
  scope: EnvScope;
  descriptor: AppEnvScopeDescriptor;
  /** The natural-key tuple used to address API rows for this scope. */
  apiTarget:
    | { class: EnvVarClass; branchId: null }
    | { class: "preview"; branchId: string };
}

interface RawEnvironmentVariable {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
  updatedAt: string;
}

/** Defaults a missing scope to `--class production` per FR21's no-flag rule. */
function defaultClassScope(): EnvScope {
  return { kind: "class", class: "production" };
}

export async function runAppEnvSet(
  context: CommandContext,
  rawAssignment: string | undefined,
  flags: { className?: string; branchName?: string },
): Promise<CommandSuccess<AppEnvSetResult>> {
  const { key, value } = parseKeyValuePositional(rawAssignment, "set");
  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "set" });
  if (!scope) {
    // resolveEnvScope already threw with a focused error in this branch.
    throw usageError(
      `prisma app env set requires --class or --branch`,
      "Writing without an explicit scope is rejected.",
      "Pass --class production, --class preview, or --branch <name>.",
      [`prisma app env set ${key}=${value} --class production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context);
  const resolved = await resolveScopeAgainstApi(client, projectId, scope);

  // Upsert: GET the existing row by natural key, PATCH it if present
  // (only the value is mutable per FR3); otherwise POST a new row. This
  // matches the surface contract — a single `set` always succeeds for a
  // given key regardless of whether it had a prior value.
  const existing = await findVariableByNaturalKey(client, projectId, key, resolved);

  if (existing) {
    const { data, error, response } = await client.PATCH(
      "/v1/environment-variables/{envVarId}",
      {
        params: { path: { envVarId: existing.id } },
        body: { value },
      },
    );
    if (error || !data) {
      throw apiCallError(`Failed to replace value for ${key}`, response, error);
    }

    return successFromVariable({
      projectId,
      resolved,
      variable: data.data as RawEnvironmentVariable,
      command: "app.env.set",
      replaced: true,
    });
  }

  if (resolved.apiTarget.branchId !== null) {
    // Branch-override writes are gated on a follow-up extension to the
    // POST /v1/environment-variables body schema (the current schema
    // rejects unknown fields, so passing branchId here would 422 with
    // a confusing message). Surface a clear feature-unavailable error
    // instead of letting the API decide.
    throw branchWriteUnavailable("set", key);
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
    throw apiCallError(`Failed to set ${key}`, response, error);
  }

  return successFromVariable({
    projectId,
    resolved,
    variable: data.data as RawEnvironmentVariable,
    command: "app.env.set",
    replaced: false,
  });
}

export async function runAppEnvList(
  context: CommandContext,
  flags: { className?: string; branchName?: string },
): Promise<CommandSuccess<AppEnvListResult>> {
  const explicit = resolveEnvScope(flags, { requireExplicit: false, command: "list" });
  const scope = explicit ?? defaultClassScope();

  const { client, projectId } = await requireClientAndProject(context);
  const resolved = await resolveScopeAgainstApi(client, projectId, scope);
  const variables = await listVariables(client, projectId, resolved);

  return {
    command: "app.env.list",
    result: {
      projectId,
      scope: resolved.descriptor,
      variables: variables.map((row) => toMetadata(row, resolved.descriptor)),
    },
    warnings: [],
    nextSteps: variables.length === 0
      ? [`prisma app env set KEY=value --${scope.kind === "class" ? `class ${scope.class}` : `branch ${scope.name}`}`]
      : [],
  };
}

export async function runAppEnvUnset(
  context: CommandContext,
  key: string | undefined,
  flags: { className?: string; branchName?: string },
): Promise<CommandSuccess<AppEnvUnsetResult>> {
  if (!key) {
    throw usageError(
      "prisma app env unset requires KEY",
      "No KEY positional argument was supplied.",
      "Pass the variable name to remove, e.g. STRIPE_KEY.",
      ["prisma app env unset STRIPE_KEY --class production"],
      "app",
    );
  }

  const scope = resolveEnvScope(flags, { requireExplicit: true, command: "unset" });
  if (!scope) {
    throw usageError(
      "prisma app env unset requires --class or --branch",
      "Writing without an explicit scope is rejected.",
      "Pass --class production, --class preview, or --branch <name>.",
      [`prisma app env unset ${key} --class production`],
      "app",
    );
  }

  const { client, projectId } = await requireClientAndProject(context);
  const resolved = await resolveScopeAgainstApi(client, projectId, scope);
  const existing = await findVariableByNaturalKey(client, projectId, key, resolved);
  if (!existing) {
    throw new CliError({
      code: "ENV_VARIABLE_NOT_FOUND",
      domain: "app",
      summary: `Variable "${key}" not found in ${formatScopeLabel(scope)}`,
      why: "No variable with this key exists in the targeted scope, so there is nothing to remove.",
      fix: "Run prisma app env list with the same scope to see the available variables.",
      exitCode: 1,
      nextSteps: [
        `prisma app env list --${scope.kind === "class" ? `class ${scope.class}` : `branch ${scope.name}`}`,
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
    throw apiCallError(`Failed to unset ${key}`, response, error);
  }

  return {
    command: "app.env.unset",
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
): Promise<{ client: ManagementApiClient; projectId: string }> {
  const projectId = await readLinkedProjectId(context.runtime.cwd);
  if (!projectId) {
    throw new CliError({
      code: "PROJECT_NOT_LINKED",
      domain: "project",
      summary: "Project link required",
      why: "prisma app env needs a linked project for the current repo.",
      fix: "Run prisma project link before managing environment variables.",
      exitCode: 1,
      nextSteps: ["prisma project link"],
    });
  }

  const client = await requireComputeAuth(context.runtime.env);
  if (!client) {
    throw authRequiredError(["prisma auth login"]);
  }

  return { client, projectId };
}

async function resolveScopeAgainstApi(
  client: ManagementApiClient,
  projectId: string,
  scope: EnvScope,
): Promise<ResolvedScope> {
  if (scope.kind === "class") {
    return {
      scope,
      descriptor: { kind: "class", class: scope.class },
      apiTarget: { class: scope.class, branchId: null },
    };
  }

  const branchId = await resolveBranchIdByName(client, projectId, scope.name);
  return {
    scope,
    descriptor: { kind: "branch", name: scope.name, id: branchId },
    apiTarget: { class: "preview", branchId },
  };
}

async function resolveBranchIdByName(
  client: ManagementApiClient,
  projectId: string,
  branchName: string,
): Promise<string> {
  const { data, error, response } = await client.GET(
    "/v1/projects/{projectId}/branches",
    {
      params: { path: { projectId }, query: { gitName: branchName } },
    },
  );
  if (error || !data) {
    throw apiCallError(`Failed to resolve branch "${branchName}"`, response, error);
  }

  const matches = data.data;
  if (matches.length === 0) {
    throw new CliError({
      code: "BRANCH_NOT_FOUND",
      domain: "app",
      summary: `Branch "${branchName}" does not exist in this project`,
      why: "The Management API has no Branch with that gitName for the linked project.",
      fix: "Create the Branch first via the Console (or check the spelling) and rerun the command.",
      exitCode: 1,
      nextSteps: ["prisma branch list"],
    });
  }

  // gitName has at most one row server-side, but defensively guard against
  // future surface relaxations by picking the first match deterministically.
  const branch = matches[0];
  if (!branch) {
    throw new CliError({
      code: "BRANCH_NOT_FOUND",
      domain: "app",
      summary: `Branch "${branchName}" does not exist in this project`,
      why: "The Management API returned no Branch with that gitName for the linked project.",
      fix: "Create the Branch first via the Console (or check the spelling) and rerun the command.",
      exitCode: 1,
      nextSteps: ["prisma branch list"],
    });
  }
  return branch.id;
}

async function findVariableByNaturalKey(
  client: ManagementApiClient,
  projectId: string,
  key: string,
  resolved: ResolvedScope,
): Promise<RawEnvironmentVariable | null> {
  // The list endpoint accepts the natural-key tuple as filters, so the
  // collapse to "at most one row" happens server-side and we don't have
  // to scan the full project list.
  const { data, error, response } = await client.GET("/v1/environment-variables", {
    params: {
      query: {
        projectId,
        class: resolved.apiTarget.class,
        key,
        ...(resolved.apiTarget.branchId !== null
          ? { branchId: resolved.apiTarget.branchId }
          : {}),
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
  // Page through results so a project with > 50 variables in a scope still
  // renders the full set. The list endpoint sorts by createdAt asc, so
  // appending pages preserves a stable order.
  const collected: RawEnvironmentVariable[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query: Record<string, string | undefined> = {
      projectId,
      class: resolved.apiTarget.class,
    };
    if (resolved.apiTarget.branchId !== null) {
      query.branchId = resolved.apiTarget.branchId;
    }
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

/**
 * The list endpoint returns rows that match every supplied filter, but a
 * `--class production` listing should never accidentally surface a row
 * with a non-null branchId (which would only ever exist server-side via
 * a future write path). Re-asserting the shape client-side keeps the
 * scope contract honest if the server filter ever loosens.
 */
function rowMatchesScope(
  row: RawEnvironmentVariable,
  resolved: ResolvedScope,
): boolean {
  if (resolved.apiTarget.branchId === null) {
    return row.branchId === null && row.class === resolved.apiTarget.class;
  }
  return row.branchId === resolved.apiTarget.branchId && row.class === "preview";
}

function successFromVariable(input: {
  projectId: string;
  resolved: ResolvedScope;
  variable: RawEnvironmentVariable;
  command: string;
  replaced: boolean;
}): CommandSuccess<AppEnvSetResult> {
  return {
    command: input.command,
    result: {
      projectId: input.projectId,
      scope: input.resolved.descriptor,
      variable: toMetadata(input.variable, input.resolved.descriptor),
      replaced: input.replaced,
    },
    warnings: [],
    nextSteps: [],
  };
}

function toMetadata(
  row: RawEnvironmentVariable,
  scope: AppEnvScopeDescriptor,
): AppEnvVariableMetadata {
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

function branchWriteUnavailable(verb: "set" | "unset", key: string): CliError {
  // Branch-override writes against the platform-managed env-var store will
  // arrive in a follow-up; until the POST/PATCH bodies accept a branchId,
  // surface a clear "not yet" rather than a generic API rejection.
  return featureUnavailableError(
    `Branch-override writes are not available yet`,
    "The Management API does not yet accept --branch on prisma app env writes; the API surface will land in a follow-up.",
    `Until then, set the value on the preview template (--class preview) so every Branch inherits it, or wait for the upcoming branch-override write release.`,
    [`prisma app env ${verb} ${key} --class preview`],
    "app",
  );
}
