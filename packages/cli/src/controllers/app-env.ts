// biome-ignore-all lint/performance/noAwaitInLoops: API pagination loops are intentionally sequential.
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { CliError, usageError } from "../errors";
import type { CommandContext } from "../legacy/runtime";
import {
  type EnvScope,
  type EnvVarRole,
  parseKeyValuePositional,
} from "../lib/app/env-config";
import {
  type EnvFileAssignment,
  readEnvFileAssignments,
} from "../lib/app/env-file";
import type { EnvListTarget, EnvScopeDescriptor } from "../types/app-env";
import {
  apiCallError,
  type RawEnvironmentVariable,
  type ResolvedEnvApiScope,
} from "./app-env-api";

interface ResolvedScope extends ResolvedEnvApiScope {
  scope: EnvScope;
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

type EnvWriteSource =
  | { kind: "single"; rawAssignment: string | undefined }
  | { kind: "file"; filePath: string };

type ResolvedEnvWriteInput =
  | { kind: "single"; key: string; value: string }
  | { kind: "file"; filePath: string; assignments: EnvFileAssignment[] };

interface RawBranchRecord {
  id: string;
  gitName: string;
  role: EnvVarRole;
  isDefault: boolean;
}

export function resolveEnvWriteSource(
  rawAssignment: string | undefined,
  filePath: string | undefined,
  command: "add" | "update",
): EnvWriteSource {
  if (filePath !== undefined && rawAssignment !== undefined) {
    throw usageError(
      `prisma project env ${command} accepts either KEY=VALUE or --file`,
      "The command received both a positional assignment and a dotenv file path.",
      "Pass one input source.",
      [
        `prisma project env ${command} KEY=value --role preview`,
        `prisma project env ${command} --file .env --role preview`,
      ],
      "app",
    );
  }

  if (filePath !== undefined) {
    if (filePath.length === 0) {
      throw usageError(
        `prisma project env ${command} --file requires a path`,
        "The --file flag was passed without a file path.",
        "Pass a readable dotenv file path.",
        [`prisma project env ${command} --file .env --role preview`],
        "app",
      );
    }
    return { kind: "file", filePath };
  }

  if (rawAssignment === undefined) {
    throw usageError(
      `prisma project env ${command} requires KEY=VALUE or --file`,
      "No environment variable input was supplied.",
      "Pass a single KEY=VALUE assignment or a dotenv file path.",
      [
        `prisma project env ${command} KEY=value --role preview`,
        `prisma project env ${command} --file .env --role preview`,
      ],
      "app",
    );
  }

  return { kind: "single", rawAssignment };
}

export async function resolveEnvWriteInput(
  context: CommandContext,
  source: EnvWriteSource,
  command: "add" | "update",
): Promise<ResolvedEnvWriteInput> {
  if (source.kind === "file") {
    return {
      kind: "file",
      filePath: source.filePath,
      assignments: await readEnvFileAssignments(
        context.runtime.cwd,
        source.filePath,
        command,
      ),
    };
  }

  return {
    kind: "single",
    ...parseKeyValuePositional(
      source.rawAssignment,
      command,
      context.runtime.env,
    ),
  };
}

export async function resolveScopeToApi(
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
    ? await resolveOrCreateBranch(
        client,
        projectId,
        scope.branchName,
        options.signal,
      )
    : await resolveExistingBranch(
        client,
        projectId,
        scope.branchName,
        options.signal,
      );

  if (branch.role === "production") {
    throw new CliError({
      code: "ENV_BRANCH_SCOPE_IS_PRODUCTION",
      domain: "app",
      summary: `Branch "${scope.branchName}" is the production branch`,
      why: "Production variables are project-level only; branch overrides apply to preview branches.",
      fix: "Use --role production for the production branch.",
      exitCode: 1,
      nextSteps: ["prisma project env list --role production"],
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

/** No explicit scope lists the overview of every scope. Nothing is
 *  inferred from ambient context: what runs is what was named. */
export async function resolveListScopeToApi(
  client: ManagementApiClient,
  projectId: string,
  explicit: EnvScope | undefined,
  options: { signal: AbortSignal },
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

export function formatScopeFlag(scope: EnvScope): string {
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
    throw apiCallError(
      `Failed to resolve branch "${branchName}"`,
      response,
      error,
    );
  }

  return data.data as RawBranchRecord[];
}

async function resolveExistingBranch(
  client: ManagementApiClient,
  projectId: string,
  branchName: string,
  signal: AbortSignal,
): Promise<RawBranchRecord> {
  const branch = (
    await listBranchesByName(client, projectId, branchName, signal)
  )[0];
  if (!branch) {
    throw new CliError({
      code: "ENV_BRANCH_NOT_FOUND",
      domain: "app",
      summary: `Branch "${branchName}" not found`,
      why: "Branch update, list, and delete commands only target existing preview branches.",
      fix: "Create the branch by deploying it, or use `project env add --branch` to create its first override.",
      exitCode: 1,
      nextSteps: [`prisma project env add KEY=value --branch ${branchName}`],
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
  const existing = (
    await listBranchesByName(client, projectId, branchName, signal)
  )[0];
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
      nextSteps: ["prisma git connect <repository-url>"],
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
      const raced = (
        await listBranchesByName(client, projectId, branchName, signal)
      )[0];
      if (raced) {
        return raced;
      }
    }

    throw apiCallError(
      `Failed to create branch "${branchName}"`,
      response,
      error,
    );
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

    const result = await client.GET("/v1/projects/{projectId}/branches", {
      params: {
        path: { projectId },
        query,
      },
      signal,
    });
    if (result.error || !result.data) {
      throw apiCallError(
        "Failed to check project default branch",
        result.response,
        result.error,
      );
    }

    if (
      (result.data.data as RawBranchRecord[]).some((branch) => branch.isDefault)
    ) {
      return true;
    }

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      return false;
    }
    cursor = result.data.pagination.nextCursor;
  }
}

export async function listVariables(
  client: ManagementApiClient,
  projectId: string,
  resolved: ResolvedScope,
  signal: AbortSignal,
): Promise<RawEnvironmentVariable[]> {
  const collected = await collectEnvironmentVariables(
    client,
    projectId,
    signal,
    {
      className: resolved.apiTarget.class,
      filter: (row) => rowMatchesScope(row, resolved),
    },
  );

  return materializeEffectiveRows(collected, resolved);
}

export async function listOverviewVariables(
  client: ManagementApiClient,
  projectId: string,
  signal: AbortSignal,
): Promise<RawEnvironmentVariable[]> {
  const collected = await collectEnvironmentVariables(
    client,
    projectId,
    signal,
    {
      filter: (row) =>
        row.branchId === null &&
        (row.class === "production" || row.class === "preview"),
    },
  );

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

    const page = (result.data.data as RawEnvironmentVariable[]).filter(
      options.filter,
    );
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

  return [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}
