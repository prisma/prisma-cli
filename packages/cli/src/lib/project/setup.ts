import { matchError } from "better-result";
import { CliError, usageError } from "../../errors";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectSummary } from "../../types/project";
import {
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  type LocalResolutionPinGitignoreUpdateError,
  type LocalResolutionPinWriteError,
} from "./local-pin";
import {
  type ProjectCandidate,
  projectAmbiguousError,
  projectNotFoundError,
} from "./resolution";

export type ProjectDirectoryBindingError =
  | LocalResolutionPinWriteError
  | LocalResolutionPinGitignoreUpdateError;

export function isValidProjectSetupName(projectName: string): boolean {
  return projectName.trim().length > 0;
}

export function resolveProjectForSetup(
  projectRef: string,
  projects: ProjectCandidate[],
  workspace: AuthWorkspace,
): ProjectCandidate {
  const matches = projects.filter(
    (project) => project.id === projectRef || project.name === projectRef,
  );
  if (matches.length > 1) {
    throw projectAmbiguousError(projectRef, matches);
  }
  const match = matches[0];
  if (match !== undefined) {
    return match;
  }
  throw projectNotFoundError(projectRef, workspace);
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
  project: Pick<ProjectCandidate, "id" | "name" | "url" | "defaultRegion">,
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    ...(project.url ? { url: project.url } : {}),
    ...(project.defaultRegion != null
      ? { defaultRegion: project.defaultRegion }
      : {}),
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

const HTTP_STATUS_IN_MESSAGE = /\(HTTP (\d{3})\)/;

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
    const match = HTTP_STATUS_IN_MESSAGE.exec(candidate.message);
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
