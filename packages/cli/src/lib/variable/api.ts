// biome-ignore-all lint/performance/noAwaitInLoops: Variable list pagination requests must run sequentially.
/** Typed wrappers for variable-group endpoints not yet in the published SDK.
 *
 *  The @prisma/management-api-sdk v1.80.0 predates these endpoints.
 *  Rather than cast at every call site, this module holds one typed
 *  boundary: local interfaces match the OpenAPI contract, and each
 *  function casts once to call the raw client.
 */
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { runCommand, userChoice } from "../app/env-errors";

// ---------------------------------------------------------------------------
// Local types that mirror the OpenAPI shapes
// ---------------------------------------------------------------------------

export type VariableGroupClass = "production" | "preview" | "custom";
export type VariableGroupRule = "equals" | "startsWith";

/** A variable group as the API returns it.
 *
 *  The built-in groups, production and preview, are not stored: their `id`
 *  equals their name, `builtIn` is true, and they have no rule. Custom
 *  groups have a `vgrp_`-prefixed id.
 */
export interface RawVariableGroup {
  id: string;
  type: "variable-group";
  url: string;
  projectId: string;
  name: string;
  class: VariableGroupClass;
  builtIn: boolean;
  rule: VariableGroupRule | null;
  ruleValue: string | null;
  matchedBranchIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type ResolvedVariableSource =
  | {
      type: "group";
      groupId: string;
      groupName: string;
      groupClass: VariableGroupClass;
    }
  | { type: "service"; serviceId: string }
  | { type: "override" };

/** An environment variable row. Rows in a built-in group have `groupId: null`. */
export interface RawGroupVariable {
  id: string;
  key: string;
  groupId: string | null;
  isManagedBySystem?: boolean;
  updatedAt: string;
}

export interface ResolvedVariable {
  key: string;
  updatedAt: string;
  isManagedBySystem: boolean;
  source: ResolvedVariableSource;
}

export interface ResolvedVariablesResult {
  group: { id: string; name: string; class: VariableGroupClass };
  data: ResolvedVariable[];
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

function variableApiError(
  summary: string,
  response: Response | undefined,
  error: ApiErrorBody | undefined,
): CliStructuredError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  const apiMessage = error?.error?.message;
  const apiHint = error?.error?.hint;

  if (status === 401 || status === 403) {
    return new CliStructuredError("VARIABLE.API_ERROR", summary, {
      why: "The Management API rejected the request as unauthorized or forbidden.",
      meta: { status },
      nextActions: [runCommand("prisma auth login")],
    });
  }

  return new CliStructuredError("VARIABLE.API_ERROR", summary, {
    why:
      apiMessage ??
      `The Management API returned status ${status || "unknown"}.`,
    ...(status || apiCode !== undefined
      ? {
          meta: {
            ...(status ? { status } : {}),
            ...(apiCode !== undefined ? { apiCode } : {}),
          },
        }
      : {}),
    nextActions: [
      userChoice(
        apiHint ??
          "Re-run with --log-level verbose for the underlying API response details.",
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Variable group API calls
// ---------------------------------------------------------------------------

/** List all variable groups for a project. */
export async function listVariableGroups(
  client: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<RawVariableGroup[]> {
  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { data, error, response } = await (client as any).GET(
    "/v1/variable-groups",
    {
      params: { query: { projectId } },
      signal,
    },
  );
  if (error || !data) {
    throw variableApiError("Failed to list variable groups", response, error);
  }
  return (data.data as RawVariableGroup[]) ?? [];
}

/** Create a custom variable group. */
export async function createVariableGroup(
  client: ManagementApiClient,
  input: {
    projectId: string;
    name: string;
    rule: { type: "equals" | "startsWith"; value: string };
  },
  signal: AbortSignal,
): Promise<RawVariableGroup> {
  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { data, error, response } = await (client as any).POST(
    "/v1/variable-groups",
    {
      body: { projectId: input.projectId, name: input.name, rule: input.rule },
      signal,
    },
  );
  if (error || !data) {
    throw variableApiError("Failed to create variable group", response, error);
  }
  return data.data as RawVariableGroup;
}

/** Update a variable group's name and/or rule. */
export async function updateVariableGroup(
  client: ManagementApiClient,
  groupId: string,
  patch: {
    name?: string;
    rule?: { type: "equals" | "startsWith"; value: string } | null;
  },
  signal: AbortSignal,
): Promise<RawVariableGroup> {
  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { data, error, response } = await (client as any).PATCH(
    "/v1/variable-groups/{groupId}",
    {
      params: { path: { groupId } },
      body: patch,
      signal,
    },
  );
  if (error || !data) {
    throw variableApiError("Failed to update variable group", response, error);
  }
  return data.data as RawVariableGroup;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** True for the production and preview groups. Also reads `class`, so a
 *  response without the `builtIn` flag is still handled. */
export function isBuiltInGroup(group: RawVariableGroup): boolean {
  return group.builtIn === true || group.class !== "custom";
}

/** Format a group's rule for display. */
export function formatGroupRule(group: RawVariableGroup): string {
  if (isBuiltInGroup(group)) {
    return group.class === "production"
      ? "production branch"
      : "all other branches";
  }
  if (group.rule === "equals") {
    return `= ${group.ruleValue}`;
  }
  if (group.rule === "startsWith") {
    return `starts-with ${group.ruleValue}`;
  }
  return "";
}

/** Delete a custom variable group and all its variables. */
export async function deleteVariableGroup(
  client: ManagementApiClient,
  groupId: string,
  signal: AbortSignal,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { error, response } = await (client as any).DELETE(
    "/v1/variable-groups/{groupId}",
    {
      params: { path: { groupId } },
      signal,
    },
  );
  if (error) {
    throw variableApiError("Failed to delete variable group", response, error);
  }
}

// ---------------------------------------------------------------------------
// Resolved variables
// ---------------------------------------------------------------------------

/** Get the resolved variable set a branch receives at deploy time. */
export async function getResolvedVariables(
  client: ManagementApiClient,
  projectId: string,
  options: {
    branchId?: string;
    serviceId?: string;
    signal: AbortSignal;
  },
): Promise<ResolvedVariablesResult> {
  const query: Record<string, string | undefined> = {};
  if (options.branchId !== undefined) {
    query.branchId = options.branchId;
  }
  if (options.serviceId !== undefined) {
    query.serviceId = options.serviceId;
  }

  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { data, error, response } = await (client as any).GET(
    "/v1/projects/{projectId}/resolved-variables",
    {
      params: { path: { projectId }, query },
      signal: options.signal,
    },
  );
  if (error || !data) {
    throw variableApiError("Failed to get resolved variables", response, error);
  }
  return data as ResolvedVariablesResult;
}

// ---------------------------------------------------------------------------
// Env var creation with groupId
// ---------------------------------------------------------------------------

export interface CreateEnvVarWithGroupInput {
  projectId: string;
  key: string;
  value: string;
  groupId: string;
}

/** Create an env var in a named group. */
export async function createEnvVarInGroup(
  client: ManagementApiClient,
  input: CreateEnvVarWithGroupInput,
  signal: AbortSignal,
): Promise<RawGroupVariable> {
  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { data, error, response } = await (client as any).POST(
    "/v1/environment-variables",
    {
      body: {
        projectId: input.projectId,
        groupId: input.groupId,
        key: input.key,
        value: input.value,
      },
      signal,
    },
  );
  if (error || !data) {
    throw variableApiError(`Failed to add ${input.key}`, response, error);
  }
  return data.data as RawGroupVariable;
}

/** Find one variable by key in one group, or null when the group has no such key. */
export async function findEnvVarInGroup(
  client: ManagementApiClient,
  input: { projectId: string; groupId: string; key: string },
  signal: AbortSignal,
): Promise<RawGroupVariable | null> {
  // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
  const { data, error, response } = await (client as any).GET(
    "/v1/environment-variables",
    {
      params: {
        query: {
          projectId: input.projectId,
          groupId: input.groupId,
          key: input.key,
        },
      },
      signal,
    },
  );
  if (error || !data) {
    throw variableApiError(`Failed to look up ${input.key}`, response, error);
  }
  return (data.data as RawGroupVariable[])[0] ?? null;
}

/** List env vars in one group by groupId. */
export async function listEnvVarsInGroup(
  client: ManagementApiClient,
  projectId: string,
  groupId: string,
  signal: AbortSignal,
): Promise<RawGroupVariable[]> {
  const collected: RawGroupVariable[] = [];
  let cursor: string | undefined;

  while (true) {
    const query: Record<string, string | undefined> = { projectId, groupId };
    if (cursor !== undefined) {
      query.cursor = cursor;
    }

    // biome-ignore lint/suspicious/noExplicitAny: these API paths and fields are not in the published SDK yet
    const { data, error, response } = await (client as any).GET(
      "/v1/environment-variables",
      {
        params: { query },
        signal,
      },
    );
    if (error || !data) {
      throw variableApiError(
        "Failed to list variables for group",
        response,
        error,
      );
    }

    collected.push(...(data.data as RawGroupVariable[]));

    if (!data.pagination.hasMore || !data.pagination.nextCursor) {
      break;
    }
    cursor = data.pagination.nextCursor;
  }

  return collected;
}
