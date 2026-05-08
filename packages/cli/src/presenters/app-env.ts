import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  AppEnvListResult,
  AppEnvScopeDescriptor,
  AppEnvSetResult,
  AppEnvUnsetResult,
} from "../types/app-env";
import { renderList, renderShow, serializeList } from "../output/patterns";

function scopeLabel(scope: AppEnvScopeDescriptor): string {
  if (scope.kind === "class") {
    return scope.class;
  }
  return `branch:${scope.name}`;
}

export function renderAppEnvSet(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppEnvSetResult,
): string[] {
  return renderShow(
    {
      title: result.replaced
        ? "Replaced the environment variable's value."
        : "Created a new environment variable.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "scope", value: scopeLabel(result.scope) },
        { key: "key", value: result.variable.key },
        // The value is intentionally omitted: under FR15 the platform
        // never returns stored plaintext, and printing the user-supplied
        // input back would teach a habit we don't want to support once
        // a future "replace from stdin" flow lands.
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

export function serializeAppEnvSet(result: AppEnvSetResult) {
  return result;
}

export function renderAppEnvList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppEnvListResult,
): string[] {
  return renderList(
    {
      title: "Listing environment variables for the selected scope.",
      descriptor,
      parentContext: {
        key: "scope",
        value: scopeLabel(result.scope),
      },
      items: result.variables.map((variable) => ({
        noun: "variable",
        label: variable.key,
        id: variable.id,
        status: variable.isManagedBySystem ? "default" : null,
      })),
      emptyMessage: "No environment variables defined in this scope.",
    },
    context.ui,
  );
}

export function serializeAppEnvList(result: AppEnvListResult) {
  return {
    projectId: result.projectId,
    scope: result.scope,
    ...serializeList({
      context: {
        scope: scopeLabel(result.scope),
      },
      items: result.variables.map((variable) => ({
        noun: "variable",
        label: variable.key,
        id: variable.id,
        status: variable.isManagedBySystem ? "default" : null,
      })),
    }),
    // Surface metadata-only details for automation. The variable list
    // here intentionally never includes a `value` field — FR15.
    variables: result.variables,
  };
}

export function renderAppEnvUnset(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppEnvUnsetResult,
): string[] {
  return renderShow(
    {
      title: "Removed the environment variable.",
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

export function serializeAppEnvUnset(result: AppEnvUnsetResult) {
  return result;
}
