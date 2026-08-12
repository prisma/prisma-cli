import { serializeList } from "../output/patterns";
import type { EnvListResult, EnvScopeDescriptor } from "../types/app-env";
import { stripVerboseContext } from "./verbose-context";

export function scopeLabel(scope: EnvScopeDescriptor): string {
  if (scope.kind === "role") {
    return scope.role ?? "unknown";
  }
  if (scope.kind === "overview") {
    return "overview";
  }
  return `branch:${scope.branchName ?? scope.branchId ?? "unknown"}`;
}

export function listTargetLabel(result: EnvListResult): string {
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
