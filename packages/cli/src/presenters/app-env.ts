import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  EnvAddResult,
  EnvListResult,
  EnvRmResult,
  EnvScopeDescriptor,
  EnvUpdateResult,
} from "../types/app-env";
import { renderList, renderShow, serializeList } from "../output/patterns";

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

export function renderEnvAdd(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvAddResult,
): string[] {
  return renderShow(
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
}

export function serializeEnvAdd(result: EnvAddResult) {
  return result;
}

export function renderEnvUpdate(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvUpdateResult,
): string[] {
  return renderShow(
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
}

export function serializeEnvUpdate(result: EnvUpdateResult) {
  return result;
}

export function renderEnvList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvListResult,
): string[] {
  return renderList(
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
}

export function serializeEnvList(result: EnvListResult) {
  return {
    projectId: result.projectId,
    scope: result.scope,
    target: result.target,
    ...serializeList({
      context: {
        target: listTargetLabel(result),
      },
      items: result.variables.map((variable) => ({
        noun: "variable",
        label: `${variable.key} (${variable.source})`,
        id: variable.id,
        status: variable.isManagedBySystem ? "default" : null,
      })),
    }),
    variables: result.variables,
  };
}

export function renderEnvRm(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: EnvRmResult,
): string[] {
  return renderShow(
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
}

export function serializeEnvRm(result: EnvRmResult) {
  return result;
}
