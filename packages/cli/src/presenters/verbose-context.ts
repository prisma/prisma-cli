import type { ShellUi, VerboseRow } from "../shell/ui";
import { renderVerboseBlock } from "../shell/ui";
import type { AuthWorkspace } from "../types/auth";
import type { BranchKind } from "../types/branch";
import type { ProjectResolution, ProjectSummary } from "../types/project";

export interface ResolvedProjectContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
  branch?: {
    id: string | null;
    name: string;
    kind: BranchKind;
  };
}

export function renderResolvedProjectContextBlock(
  ui: ShellUi,
  context: ResolvedProjectContext | undefined,
  options: { title?: string; extraRows?: VerboseRow[] } = {},
): string[] {
  if (!context) {
    return [];
  }

  return renderVerboseBlock(
    ui,
    [...projectResolutionRows(context), ...(options.extraRows ?? [])],
    { title: options.title ?? "Resolved context" },
  );
}

export function projectResolutionRows(
  context: ResolvedProjectContext,
): VerboseRow[] {
  return [
    { key: "workspace", value: context.workspace.name },
    { key: "workspace id", value: context.workspace.id, tone: "dim" },
    { key: "project", value: context.project.name },
    { key: "project id", value: context.project.id, tone: "dim" },
    {
      key: "project source",
      value: formatProjectSource(context.resolution.projectSource),
    },
    ...(context.resolution.targetName
      ? [{ key: "target name", value: formatTargetName(context.resolution) }]
      : []),
    ...(context.branch
      ? [
          {
            key: "branch",
            value: `${context.branch.name} (${context.branch.kind})`,
          },
          ...(context.branch.id
            ? [
                {
                  key: "branch id",
                  value: context.branch.id,
                  tone: "dim" as const,
                },
              ]
            : []),
        ]
      : []),
  ];
}

export function stripVerboseContext<T extends { verboseContext?: unknown }>(
  result: T,
): Omit<T, "verboseContext"> {
  const { verboseContext: _verboseContext, ...serialized } = result;
  return serialized;
}

function formatProjectSource(
  source: ProjectResolution["projectSource"],
): string {
  switch (source) {
    case "explicit":
      return "--project";
    case "env":
      return "environment";
    case "local-pin":
      return ".prisma/local.json";
    case "platform-mapping":
      return "platform mapping";
    case "created":
      return "created";
    case "prompt":
      return "prompt";
    case "unbound":
      return "unbound";
  }
}

function formatTargetName(resolution: ProjectResolution): string {
  return resolution.targetNameSource
    ? `${resolution.targetName} (${resolution.targetNameSource})`
    : String(resolution.targetName);
}
