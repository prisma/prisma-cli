import { matchError, Result } from "better-result";
import { CliError, usageError } from "../../shell/errors";
import type { CommandContext } from "../../shell/runtime";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectSetupResult, ProjectSummary } from "../../types/project";
import {
  ensureLocalResolutionPinGitignore,
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  type LocalResolutionPinGitignoreUpdateError,
  type LocalResolutionPinWriteError,
  writeLocalResolutionPin,
} from "./local-pin";
import {
  type ProjectCandidate,
  projectAmbiguousError,
  projectNotFoundError,
} from "./resolution";

// biome-ignore lint/performance/noBarrelFile: Project setup exposes command formatting for related project flows.
export { formatCommandArgument } from "../../shell/command-arguments";

export type ProjectDirectoryBindingError =
  | LocalResolutionPinWriteError
  | LocalResolutionPinGitignoreUpdateError;

export function isValidProjectSetupName(projectName: string): boolean {
  return projectName.trim().length > 0;
}

export function validateProjectSetupNameText(
  value: string | undefined,
  fallback: string,
): string | undefined {
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
  const matches = projects.filter(
    (project) => project.id === projectRef || project.name === projectRef,
  );
  const match = matches[0];
  if (matches.length === 1 && match) {
    return match;
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
): Promise<Result<ProjectSetupResult, ProjectDirectoryBindingError>> {
  return Result.gen(async function* () {
    yield* Result.await(
      writeLocalResolutionPin(
        context.runtime.cwd,
        {
          workspaceId: workspace.id,
          projectId: project.id,
        },
        context.runtime.signal,
      ),
    );
    yield* Result.await(
      ensureLocalResolutionPinGitignore(
        context.runtime.cwd,
        context.runtime.signal,
      ),
    );

    return Result.ok({
      workspace,
      project,
      directory: formatSetupDirectory(context.runtime.cwd),
      localPin: {
        path: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
        written: true,
      },
      action,
    } satisfies ProjectSetupResult);
  });
}

export function projectDirectoryBindingErrorToCliError(
  error: ProjectDirectoryBindingError,
): CliError {
  // Temporary during the migration to better-result: remove when command boundaries convert Result errors directly.
  return matchError(error, {
    LocalResolutionPinSerializationError: (error) => {
      throw error;
    },
    LocalResolutionPinWriteAbortedError: (error) => {
      throw error;
    },
    LocalResolutionPinWriteFailedError: (error) =>
      localStateWriteFailedError(error, {
        why: `The CLI could not write ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH}.`,
        meta: {
          pinPath: error.pinPath,
          operation: error.operation,
        },
      }),
    LocalResolutionPinGitignoreUpdateAbortedError: (error) => {
      throw error;
    },
    LocalResolutionPinGitignoreUpdateFailedError: (error) =>
      localStateWriteFailedError(error, {
        why: "The CLI could not update .gitignore to keep local Project binding state out of git.",
        meta: {
          gitignorePath: error.gitignorePath,
          operation: error.operation,
        },
      }),
  });
}

function localStateWriteFailedError(
  error: ProjectDirectoryBindingError,
  options: { why: string; meta: Record<string, unknown> },
): CliError {
  return new CliError({
    code: "LOCAL_STATE_WRITE_FAILED",
    domain: "project",
    summary: "Could not save local Project binding",
    why: options.why,
    fix: "Check that this directory is writable and that .prisma/local.json and .gitignore are not blocked by directories or permissions, then retry.",
    debug: formatDebugDetails(error.cause),
    meta: options.meta,
    exitCode: 1,
    nextSteps: [
      "prisma-cli project link <id-or-name>",
      "prisma-cli app deploy --project <id-or-name>",
    ],
  });
}

export function toProjectSummary(
  project: Pick<ProjectCandidate, "id" | "name" | "url">,
): ProjectSummary {
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

  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
  };
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
