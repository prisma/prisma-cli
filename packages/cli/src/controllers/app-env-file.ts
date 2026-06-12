import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { type EnvScope, formatScopeLabel } from "../lib/app/env-config";
import type { EnvFileAssignment } from "../lib/app/env-file";
import { CliError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type {
  EnvAddResult,
  EnvResolvedContext,
  EnvUpdateResult,
  EnvVariableMetadata,
} from "../types/app-env";
import {
  apiCallError,
  findVariableByNaturalKey,
  type RawEnvironmentVariable,
  type ResolvedEnvApiScope,
  toMetadata,
} from "./app-env-api";

export interface ResolvedEnvFileScope extends ResolvedEnvApiScope {
  scope: EnvScope;
}

export async function runEnvAddFile(
  context: CommandContext,
  client: ManagementApiClient,
  projectId: string,
  resolved: ResolvedEnvFileScope,
  filePath: string,
  assignments: EnvFileAssignment[],
  verboseContext: EnvResolvedContext,
): Promise<CommandSuccess<EnvAddResult>> {
  const existing = await findVariablesByNaturalKey(
    client,
    projectId,
    assignments.map((assignment) => assignment.key),
    resolved,
    context.runtime.signal,
  );
  const existingKeys = assignments
    .map((assignment) => assignment.key)
    .filter((key) => existing.has(key));

  if (existingKeys.length > 0) {
    throw new CliError({
      code: "ENV_VARIABLE_ALREADY_EXISTS",
      domain: "app",
      summary: `${existingKeys.length} environment variable(s) already exist in ${formatScopeLabel(resolved.scope)}`,
      why: `Existing keys: ${formatKeyList(existingKeys)}.`,
      fix: "Split the input file by key state: update existing keys and add new keys separately.",
      exitCode: 1,
      nextSteps: splitFileNextSteps(filePath, resolved.scope, {
        existingKeys,
        first: "update-existing",
      }),
      meta: { keys: existingKeys },
    });
  }

  const warnings = await missingPreviewDefaultWarnings(
    client,
    projectId,
    resolved.scope,
    assignments.map((assignment) => assignment.key),
    context.runtime.signal,
  );

  const variables: EnvVariableMetadata[] = [];
  for (const assignment of assignments) {
    try {
      const { data, error, response } = await client.POST(
        "/v1/environment-variables",
        {
          body: {
            projectId,
            class: resolved.apiTarget.class,
            ...(resolved.apiTarget.branchId !== null
              ? { branchId: resolved.apiTarget.branchId }
              : {}),
            key: assignment.key,
            value: assignment.value,
          },
          signal: context.runtime.signal,
        },
      );
      if (error || !data) {
        throw apiCallError(`Failed to add ${assignment.key}`, response, error);
      }
      variables.push(
        toMetadata(data.data as RawEnvironmentVariable, resolved.descriptor),
      );
    } catch (error) {
      throw envFileApplyFailedError(
        "add",
        filePath,
        resolved.scope,
        assignment.key,
        variables,
        error,
      );
    }
  }

  return {
    command: "project.env.add",
    result: {
      projectId,
      verboseContext,
      scope: resolved.descriptor,
      variables,
      file: {
        path: filePath,
        count: variables.length,
      },
    },
    warnings,
    nextSteps: [],
  };
}

export async function runEnvUpdateFile(
  context: CommandContext,
  client: ManagementApiClient,
  projectId: string,
  resolved: ResolvedEnvFileScope,
  filePath: string,
  assignments: EnvFileAssignment[],
  verboseContext: EnvResolvedContext,
): Promise<CommandSuccess<EnvUpdateResult>> {
  const existing = await findVariablesByNaturalKey(
    client,
    projectId,
    assignments.map((assignment) => assignment.key),
    resolved,
    context.runtime.signal,
  );
  const missingKeys = assignments
    .map((assignment) => assignment.key)
    .filter((key) => !existing.has(key));

  if (missingKeys.length > 0) {
    throw new CliError({
      code: "ENV_VARIABLE_NOT_FOUND",
      domain: "app",
      summary: `${missingKeys.length} environment variable(s) not found in ${formatScopeLabel(resolved.scope)}`,
      why: `Missing keys: ${formatKeyList(missingKeys)}.`,
      fix: "Split the input file by key state: add missing keys and update existing keys separately.",
      exitCode: 1,
      nextSteps: splitFileNextSteps(filePath, resolved.scope, {
        missingKeys,
        first: "add-missing",
      }),
      meta: { keys: missingKeys },
    });
  }

  const variables: EnvVariableMetadata[] = [];
  for (const assignment of assignments) {
    const existingVariable = existing.get(assignment.key);
    if (!existingVariable) {
      continue;
    }

    try {
      const { data, error, response } = await client.PATCH(
        "/v1/environment-variables/{envVarId}",
        {
          params: { path: { envVarId: existingVariable.id } },
          body: { value: assignment.value },
          signal: context.runtime.signal,
        },
      );
      if (error || !data) {
        throw apiCallError(
          `Failed to update value for ${assignment.key}`,
          response,
          error,
        );
      }
      variables.push(
        toMetadata(data.data as RawEnvironmentVariable, resolved.descriptor),
      );
    } catch (error) {
      throw envFileApplyFailedError(
        "update",
        filePath,
        resolved.scope,
        assignment.key,
        variables,
        error,
      );
    }
  }

  return {
    command: "project.env.update",
    result: {
      projectId,
      verboseContext,
      scope: resolved.descriptor,
      variables,
      file: {
        path: filePath,
        count: variables.length,
      },
    },
    warnings: [],
    nextSteps: [],
  };
}

async function findVariablesByNaturalKey(
  client: ManagementApiClient,
  projectId: string,
  keys: string[],
  resolved: ResolvedEnvFileScope,
  signal: AbortSignal,
): Promise<Map<string, RawEnvironmentVariable>> {
  const found = new Map<string, RawEnvironmentVariable>();

  for (const key of keys) {
    const row = await findVariableByNaturalKey(
      client,
      projectId,
      key,
      resolved,
      signal,
    );
    if (row) {
      found.set(key, row);
    }
  }

  return found;
}

async function missingPreviewDefaultWarnings(
  client: ManagementApiClient,
  projectId: string,
  scope: EnvScope,
  keys: string[],
  signal: AbortSignal,
): Promise<string[]> {
  if (scope.kind !== "branch") {
    return [];
  }

  const previewScope: ResolvedEnvFileScope = {
    scope: { kind: "role", role: "preview" },
    descriptor: { kind: "role", role: "preview" },
    apiTarget: { class: "preview", branchId: null },
  };
  const missing: string[] = [];

  for (const key of keys) {
    if (
      !(await findVariableByNaturalKey(
        client,
        projectId,
        key,
        previewScope,
        signal,
      ))
    ) {
      missing.push(key);
    }
  }

  if (missing.length === 0) {
    return [];
  }

  if (missing.length === 1) {
    return [
      `Variable "${missing[0]}" does not exist in preview. It will only exist on ${formatScopeLabel(scope)}.`,
    ];
  }

  return [
    `Variables ${formatKeyList(missing)} do not exist in preview. They will only exist on ${formatScopeLabel(scope)}.`,
  ];
}

function envFileApplyFailedError(
  command: "add" | "update",
  filePath: string,
  scope: EnvScope,
  failedKey: string,
  writtenVariables: EnvVariableMetadata[],
  error: unknown,
): CliError {
  const writtenKeys = writtenVariables.map((variable) => variable.key);
  const cause =
    error instanceof CliError
      ? error.summary
      : error instanceof Error
        ? error.message
        : "Unknown error.";

  return new CliError({
    code: "ENV_FILE_APPLY_FAILED",
    domain: "app",
    summary: `Failed to ${command} "${failedKey}" from "${filePath}"`,
    why:
      writtenKeys.length === 0
        ? `No variables were written before ${failedKey} failed. Cause: ${cause}`
        : `Written keys before failure: ${formatKeyList(writtenKeys)}. Cause: ${cause}`,
    fix: "Inspect the target scope, then retry the remaining keys once the API issue is resolved.",
    exitCode: 1,
    nextSteps: [
      `prisma-cli project env list ${formatScopeFlag(scope)}`,
      retryStepForApplyFailure(command, filePath, scope, writtenKeys),
    ],
    meta: {
      file: filePath,
      failedKey,
      writtenKeys,
    },
  });
}

function retryStepForApplyFailure(
  command: "add" | "update",
  filePath: string,
  scope: EnvScope,
  writtenKeys: string[],
): string {
  if (command === "update") {
    return `prisma-cli project env update --file ${filePath} ${formatScopeFlag(scope)}`;
  }

  if (writtenKeys.length === 0) {
    return `prisma-cli project env add --file ${filePath} ${formatScopeFlag(scope)}`;
  }

  return `prisma-cli project env add --file <remaining.env> ${formatScopeFlag(scope)}`;
}

function splitFileNextSteps(
  filePath: string,
  scope: EnvScope,
  options:
    | { first: "update-existing"; existingKeys: string[] }
    | { first: "add-missing"; missingKeys: string[] },
): string[] {
  const scopeFlag = formatScopeFlag(scope);
  const existingFile = `${filePath}.existing`;
  const newFile = `${filePath}.new`;

  if (options.first === "update-existing") {
    return [
      `# existing keys: ${formatKeyList(options.existingKeys)}`,
      `prisma-cli project env update --file ${existingFile} ${scopeFlag}`,
      "# new keys only",
      `prisma-cli project env add --file ${newFile} ${scopeFlag}`,
    ];
  }

  return [
    `# missing keys: ${formatKeyList(options.missingKeys)}`,
    `prisma-cli project env add --file ${newFile} ${scopeFlag}`,
    "# existing keys only",
    `prisma-cli project env update --file ${existingFile} ${scopeFlag}`,
  ];
}

function formatKeyList(keys: string[]): string {
  return keys.map((key) => `"${key}"`).join(", ");
}

function formatScopeFlag(scope: EnvScope): string {
  if (scope.kind === "role") {
    return `--role ${scope.role}`;
  }
  return `--branch ${scope.branchName}`;
}
