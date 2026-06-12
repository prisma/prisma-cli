import { renderList, renderShow, serializeList } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { renderVerboseBlock, type VerboseRow } from "../shell/ui";
import type {
  EnvAddResult,
  EnvListResult,
  EnvResolvedContext,
  EnvRmResult,
  EnvScopeDescriptor,
  EnvUpdateResult,
} from "../types/app-env";
import {
  renderResolvedProjectContextBlock,
  stripVerboseContext,
} from "./verbose-context";

function scopeLabel(scope: EnvScopeDescriptor): string {
  if (scope.kind === "role") {
    return scope.role ?? "unknown";
  }
  if (scope.kind === "overview") {
    return "overview";
  }
  return `branch:${scope.branchName ?? scope.branchId ?? "unknown"}`;
}

function listTargetLabel(result: EnvListResult): string {
  const target = result.target;
  if (target.source === "overview") {
    return "overview";
  }

  if (target.branchName) {
    const suffix = target.branchExists === false ? " (not created yet)" : "";
    return `branch:${target.branchName} -> ${target.envMap}${suffix}`;
  }

  return scopeLabel(result.scope);
}

type EnvPresenterResult =
  | EnvAddResult
  | EnvUpdateResult
  | EnvListResult
  | EnvRmResult;

function renderEnvVerboseBlocks(
  context: CommandContext,
  result: EnvPresenterResult,
): string[] {
  return [
    ...renderEnvResolvedContextBlock(context, result.verboseContext),
    ...renderEnvTargetBlock(context, result),
  ];
}

function renderEnvResolvedContextBlock(
  context: CommandContext,
  verboseContext: EnvResolvedContext | undefined,
): string[] {
  return renderResolvedProjectContextBlock(context.ui, verboseContext);
}

function renderEnvTargetBlock(
  context: CommandContext,
  result: EnvPresenterResult,
): string[] {
  return renderVerboseBlock(context.ui, envTargetRows(result), {
    title: "Env target",
  });
}

function envTargetRows(result: EnvPresenterResult): VerboseRow[] {
  return [
    { key: "project id", value: result.projectId, tone: "dim" },
    { key: "scope", value: scopeLabel(result.scope) },
    ...envListTargetRows(result),
    ...envFileRows(result),
    {
      key: "keys",
      value: formatKeyNames(envResultKeys(result)),
      tone: envResultKeys(result).length > 0 ? "default" : "dim",
    },
  ];
}

function envListTargetRows(result: EnvPresenterResult): VerboseRow[] {
  if (!("target" in result)) {
    return [];
  }

  return [
    { key: "target source", value: result.target.source },
    { key: "env map", value: result.target.envMap },
    ...(result.target.branchName
      ? [{ key: "branch", value: result.target.branchName }]
      : []),
    ...(result.target.branchId
      ? [
          {
            key: "branch id",
            value: result.target.branchId,
            tone: "dim" as const,
          },
        ]
      : []),
    ...(result.target.branchExists === false
      ? [
          {
            key: "branch state",
            value: "not created yet",
            tone: "warning" as const,
          },
        ]
      : []),
  ];
}

function envFileRows(result: EnvPresenterResult): VerboseRow[] {
  if (!("file" in result) || !result.file) {
    return [];
  }

  return [
    { key: "file", value: result.file.path },
    { key: "file count", value: String(result.file.count) },
  ];
}

function envResultKeys(result: EnvPresenterResult): string[] {
  if ("variables" in result && result.variables) {
    return result.variables
      .map((variable) => variable.key)
      .sort((left, right) => left.localeCompare(right));
  }

  if ("variable" in result && result.variable) {
    return [result.variable.key];
  }

  if ("key" in result) {
    return [result.key];
  }

  return [];
}

function formatKeyNames(keys: string[]): string {
  return keys.length > 0 ? keys.join(", ") : "none";
}

export function renderEnvAdd(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvAddResult,
): string[] {
  if (result.variables !== undefined) {
    const lines = renderList(
      {
        title: "Setting new environment variables from file.",
        descriptor,
        parentContext: {
          key: "target",
          value: `${scopeLabel(result.scope)} from ${result.file.path}`,
        },
        items: result.variables.map((variable) => ({
          noun: "variable",
          label: `${variable.key} (${variable.source})`,
          id: variable.id,
          status: variable.isManagedBySystem ? "default" : null,
        })),
        emptyMessage: "No environment variables imported.",
      },
      context.ui,
    );
    lines.push(...renderEnvVerboseBlocks(context, result));
    return lines;
  }

  const lines = renderShow(
    {
      title: "Setting a new environment variable.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "scope", value: scopeLabel(result.scope) },
        { key: "key", value: result.variable.key },
        { key: "id", value: result.variable.id, tone: "dim" },
        {
          key: "last updated",
          value: result.variable.updatedAt,
          tone: "dim",
        },
      ],
    },
    context.ui,
  );
  lines.push(...renderEnvVerboseBlocks(context, result));
  return lines;
}

export function serializeEnvAdd(result: EnvAddResult) {
  return stripVerboseContext(result);
}

export function renderEnvUpdate(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvUpdateResult,
): string[] {
  if (result.variables !== undefined) {
    const lines = renderList(
      {
        title: "Replacing environment variable values from file.",
        descriptor,
        parentContext: {
          key: "target",
          value: `${scopeLabel(result.scope)} from ${result.file.path}`,
        },
        items: result.variables.map((variable) => ({
          noun: "variable",
          label: `${variable.key} (${variable.source})`,
          id: variable.id,
          status: variable.isManagedBySystem ? "default" : null,
        })),
        emptyMessage: "No environment variables updated.",
      },
      context.ui,
    );
    lines.push(...renderEnvVerboseBlocks(context, result));
    return lines;
  }

  const lines = renderShow(
    {
      title: "Replacing the environment variable's value.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "scope", value: scopeLabel(result.scope) },
        { key: "key", value: result.variable.key },
        { key: "id", value: result.variable.id, tone: "dim" },
        {
          key: "last updated",
          value: result.variable.updatedAt,
          tone: "dim",
        },
      ],
    },
    context.ui,
  );
  lines.push(...renderEnvVerboseBlocks(context, result));
  return lines;
}

export function serializeEnvUpdate(result: EnvUpdateResult) {
  return stripVerboseContext(result);
}

export function renderEnvList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvListResult,
): string[] {
  const lines = renderList(
    {
      title: "Listing environment variables for the selected scope.",
      descriptor,
      parentContext: {
        key: "target",
        value: listTargetLabel(result),
      },
      items: result.variables.map((variable) => ({
        noun: "variable",
        label: `${variable.key} (${variable.source})`,
        id: variable.id,
        status: variable.isManagedBySystem ? "default" : null,
      })),
      emptyMessage: "No environment variables defined in this scope.",
    },
    context.ui,
  );
  lines.push(...renderEnvVerboseBlocks(context, result));
  return lines;
}

export function serializeEnvList(result: EnvListResult) {
  const serializable = stripVerboseContext(result);

  return {
    projectId: serializable.projectId,
    scope: serializable.scope,
    target: serializable.target,
    ...serializeList({
      context: {
        target: listTargetLabel(serializable),
      },
      items: serializable.variables.map((variable) => ({
        noun: "variable",
        label: `${variable.key} (${variable.source})`,
        id: variable.id,
        status: variable.isManagedBySystem ? "default" : null,
      })),
    }),
    variables: serializable.variables,
  };
}

export function renderEnvRm(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvRmResult,
): string[] {
  const lines = renderShow(
    {
      title: "Removing the environment variable from the scope.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "scope", value: scopeLabel(result.scope) },
        { key: "key", value: result.key },
      ],
    },
    context.ui,
  );
  lines.push(...renderEnvVerboseBlocks(context, result));
  return lines;
}

export function serializeEnvRm(result: EnvRmResult) {
  return stripVerboseContext(result);
}
