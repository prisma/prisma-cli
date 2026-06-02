import type { AuthWorkspace } from "../../types/auth";
import type { ProjectSetupResult, ProjectSummary } from "../../types/project";
import { CliError, usageError } from "../../shell/errors";
import type { CommandContext } from "../../shell/runtime";
import {
  ensureLocalResolutionPinGitignore,
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  writeLocalResolutionPin,
} from "./local-pin";
import {
  projectAmbiguousError,
  projectNotFoundError,
  type ProjectCandidate,
} from "./resolution";
export { formatCommandArgument } from "../../shell/command-arguments";

export function isValidProjectSetupName(projectName: string): boolean {
  return projectName.trim().length > 0;
}

export function validateProjectSetupNameText(value: string | undefined, fallback: string): string | undefined {
  if ((value?.trim() || fallback).trim().length > 0) {
    return undefined;
  }

  return "Enter a Project name.";
}

export function resolveProjectForSetup(
  projectRef: string,
  projects: ProjectCandidate[],
  workspace: AuthWorkspace,
): ProjectCandidate {
  const matches = projects.filter((project) => project.id === projectRef || project.name === projectRef);
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw projectAmbiguousError(projectRef, matches);
  }
  throw projectNotFoundError(projectRef, workspace);
}

export async function bindProjectToDirectory(
  context: CommandContext,
  workspace: AuthWorkspace,
  project: ProjectSummary,
  action: ProjectSetupResult["action"],
): Promise<ProjectSetupResult> {
  await writeLocalResolutionPin(context.runtime.cwd, {
    workspaceId: workspace.id,
    projectId: project.id,
  }, context.runtime.signal);
  await ensureLocalResolutionPinGitignore(context.runtime.cwd, context.runtime.signal);

  return {
    workspace,
    project,
    directory: formatSetupDirectory(context.runtime.cwd),
    localPin: {
      path: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
      written: true,
    },
    action,
  };
}

export function toProjectSummary(project: Pick<ProjectCandidate, "id" | "name" | "url">): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    ...(project.url ? { url: project.url } : {}),
  };
}

export function projectSetupNameRequiredError(command: string): CliError {
  return usageError(
    "Project create requires a name",
    "The project name must be a non-empty value.",
    "Pass a Project name explicitly.",
    [`prisma-cli ${command} my-app`],
    "project",
  );
}

export function projectCreateFailedError(
  error: unknown,
  projectName: string,
  workspace: AuthWorkspace,
  options: {
    nextSteps: string[];
    permissionFix: string;
    fallbackFix: string;
  },
): CliError {
  const status = extractHttpStatus(error);

  if (status === 401 || status === 403) {
    return new CliError({
      code: "PROJECT_CREATE_FAILED",
      domain: "project",
      summary: `Could not create Project "${projectName}"`,
      why: `The platform rejected the Project create in workspace "${workspace.name}" (HTTP ${status}).`,
      fix: options.permissionFix,
      debug: formatDebugDetails(error),
      exitCode: 1,
      nextSteps: options.nextSteps,
    });
  }

  return new CliError({
    code: "PROJECT_CREATE_FAILED",
    domain: "project",
    summary: `Could not create Project "${projectName}"`,
    why: error instanceof Error ? error.message : String(error),
    fix: options.fallbackFix,
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps: options.nextSteps,
  });
}

function formatSetupDirectory(cwd: string): string {
  const basename = cwd.split(/[\\/]/).filter(Boolean).pop();
  return basename ? `./${basename}` : ".";
}

function extractHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  if (typeof candidate.status === "number") {
    return candidate.status;
  }

  if (typeof candidate.message === "string") {
    const match = /\(HTTP (\d{3})\)/.exec(candidate.message);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

function formatDebugDetails(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return typeof error === "string" ? error : null;
}
