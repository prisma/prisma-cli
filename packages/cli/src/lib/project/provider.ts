import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { formatPrismaCliCommand } from "../../cli-command";
import type { ProjectSummary } from "../../types/project";

export interface ProjectProvider {
  renameProject(options: {
    projectId: string;
    name: string;
    signal?: AbortSignal;
  }): Promise<ProjectSummary>;
  removeProject(options: {
    projectId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  transferProject(options: {
    projectId: string;
    recipientAccessToken: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

interface RawApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface RawProjectRecord {
  id: string;
  name: string;
  url?: string | null;
}

export function createManagementProjectProvider(
  client: ManagementApiClient,
): ProjectProvider {
  return {
    async renameProject(options) {
      const result = await client.PATCH("/v1/projects/{id}", {
        params: {
          path: { id: options.projectId },
        },
        body: {
          name: options.name,
        },
        signal: options.signal,
      });
      const status = result.response?.status ?? 0;
      if (status === 400 || status === 422) {
        throw projectRenameFailedError(options.name, result.error);
      }
      if (result.error || !result.data) {
        throw projectApiError(
          "Failed to rename project",
          result.response,
          result.error,
        );
      }

      const project = result.data.data as RawProjectRecord;
      return {
        id: project.id,
        name: project.name,
        ...(project.url ? { url: project.url } : {}),
      };
    },

    async removeProject(options) {
      const result = await client.DELETE("/v1/projects/{id}", {
        params: {
          path: { id: options.projectId },
        },
        signal: options.signal,
      });
      if (result.response?.status === 400) {
        throw projectDeleteBlockedError(options.projectId, result.error);
      }
      if (result.error) {
        throw projectApiError(
          "Failed to delete project",
          result.response,
          result.error,
        );
      }
    },

    async transferProject(options) {
      const result = await client.POST("/v1/projects/{id}/transfer", {
        params: {
          path: { id: options.projectId },
        },
        body: {
          recipientAccessToken: options.recipientAccessToken,
        },
        signal: options.signal,
      });
      if (result.response?.status === 400) {
        throw projectTransferRejectedError(options.projectId, result.error);
      }
      if (result.error) {
        throw projectApiError(
          "Failed to transfer project",
          result.response,
          result.error,
        );
      }
    },
  };
}

function userChoice(label: string): NextAction {
  return { kind: "user-choice", label };
}

export function projectRenameFailedError(
  name: string,
  error: RawApiErrorBody | undefined,
): CliStructuredError {
  return new CliStructuredError(
    "PROJECT.RENAME_FAILED",
    "Project rename failed",
    {
      why: error?.error?.message ?? `The platform rejected the name "${name}".`,
      nextActions: [
        userChoice(
          error?.error?.hint ??
            "Pass a different project name and retry the rename.",
        ),
      ],
    },
  );
}

export function projectDeleteBlockedError(
  projectId: string,
  error: RawApiErrorBody | undefined,
): CliStructuredError {
  const deleteServicesCommand = formatPrismaCliCommand([
    "service",
    "delete",
    "--service",
    "<name>",
  ]);
  return new CliStructuredError(
    "PROJECT.DELETE_BLOCKED",
    "Project cannot be deleted yet",
    {
      why:
        error?.error?.message ??
        `Project "${projectId}" still has active deployments.`,
      nextActions: [
        userChoice(
          "Delete the project's services first, then retry the deletion.",
        ),
        {
          kind: "run-command",
          label: deleteServicesCommand,
          command: deleteServicesCommand,
        },
      ],
    },
  );
}

export function projectTransferRejectedError(
  projectId: string,
  error: RawApiErrorBody | undefined,
): CliStructuredError {
  return new CliStructuredError(
    "PROJECT.TRANSFER_REJECTED",
    "Project transfer was rejected",
    {
      why:
        error?.error?.message ??
        `The platform rejected the transfer of project "${projectId}", for example because the recipient token is invalid or expired.`,
      nextActions: [
        userChoice(
          "Check the recipient workspace session or token and retry the transfer.",
        ),
      ],
    },
  );
}

export function projectApiError(
  summary: string,
  response: Response | undefined,
  error: RawApiErrorBody | undefined,
): CliStructuredError {
  const status = response?.status ?? 0;
  const apiCode = error?.error?.code;
  return new CliStructuredError("PROJECT.API_ERROR", summary, {
    why:
      error?.error?.message ??
      `The Management API returned status ${status || "unknown"}.`,
    ...(apiCode !== undefined || status
      ? {
          meta: {
            ...(status ? { status } : {}),
            ...(apiCode !== undefined ? { apiCode } : {}),
          },
        }
      : {}),
    nextActions: [
      userChoice(
        error?.error?.hint ??
          "Re-run with --log-level verbose for the underlying API response details.",
      ),
    ],
  });
}
