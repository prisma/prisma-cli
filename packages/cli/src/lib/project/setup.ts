import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";
import { matchError } from "better-result";
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

export function projectDirectoryBindingErrorToStructured(
  error: ProjectDirectoryBindingError,
): CliStructuredError {
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
): CliStructuredError {
  return new CliStructuredError(
    "PROJECT.LOCAL_STATE_WRITE_FAILED",
    "Could not save local Project binding",
    {
      why: options.why,
      meta: options.meta,
      cause: error.cause,
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Check that this directory is writable and that .prisma/local.json and .gitignore are not blocked by directories or permissions, then retry.",
        },
        {
          kind: "run-command",
          label: "prisma project link <id-or-name>",
          command: "prisma project link <id-or-name>",
        },
      ],
    },
  );
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

export function projectSetupNameRequiredError(
  command: string,
): CliStructuredError {
  const example = `prisma ${command} my-app`;
  return new CliStructuredError(
    "PROJECT.USAGE_ERROR",
    "Project create requires a name",
    {
      why: "The project name must be a non-empty value.",
      nextActions: [
        { kind: "user-choice", label: "Pass a Project name explicitly." },
        { kind: "run-command", label: example, command: example },
      ],
    },
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
): CliStructuredError {
  const status = extractHttpStatus(error);
  const permissionRejection = status === 401 || status === 403;
  const message = error instanceof Error ? error.message : String(error);

  const nextActions: NextAction[] = [
    {
      kind: "user-choice",
      label: permissionRejection ? options.permissionFix : options.fallbackFix,
    },
    ...options.nextSteps.map((step) => ({
      kind: "run-command" as const,
      label: step,
      command: step,
    })),
  ];

  return new CliStructuredError(
    "PROJECT.CREATE_FAILED",
    `Could not create Project "${projectName}"`,
    {
      why: permissionRejection
        ? `The platform rejected the Project create in workspace "${workspace.name}" (HTTP ${status}).`
        : message,
      cause: error,
      nextActions,
    },
  );
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
