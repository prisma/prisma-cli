import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { formatPrismaCliCommand } from "../../shell/cli-command";
import { CliError } from "../../shell/errors";
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
        throw projectRemoveBlockedError(options.projectId, result.error);
      }
      if (result.error) {
        throw projectApiError(
          "Failed to remove project",
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

export function projectRenameFailedError(
  name: string,
  error: RawApiErrorBody | undefined,
): CliError {
  return new CliError({
    code: "PROJECT_RENAME_FAILED",
    domain: "project",
    summary: "Project rename failed",
    why: error?.error?.message ?? `The platform rejected the name "${name}".`,
    fix:
      error?.error?.hint ??
      "Pass a different project name and retry the rename.",
    exitCode: 1,
    nextSteps: [],
  });
}

export function projectRemoveBlockedError(
  projectId: string,
  error: RawApiErrorBody | undefined,
): CliError {
  return new CliError({
    code: "PROJECT_REMOVE_BLOCKED",
    domain: "project",
    summary: "Project cannot be removed yet",
    why:
      error?.error?.message ??
      `Project "${projectId}" still has active deployments.`,
    fix: "Remove the project's apps first, then retry the removal.",
    exitCode: 1,
    nextSteps: [formatPrismaCliCommand(["app", "remove", "--app", "<name>"])],
  });
}

export function projectTransferRejectedError(
  projectId: string,
  error: RawApiErrorBody | undefined,
): CliError {
  return new CliError({
    code: "PROJECT_TRANSFER_REJECTED",
    domain: "project",
    summary: "Project transfer was rejected",
    why:
      error?.error?.message ??
      `The platform rejected the transfer of project "${projectId}", for example because the recipient token is invalid or expired.`,
    fix: "Check the recipient workspace session or token and retry the transfer.",
    exitCode: 1,
    nextSteps: [],
  });
}

function projectApiError(
  summary: string,
  response: Response | undefined,
  error: RawApiErrorBody | undefined,
): CliError {
  const status = response?.status ?? 0;
  return new CliError({
    code: error?.error?.code ?? "PROJECT_API_ERROR",
    domain: "project",
    summary,
    why:
      error?.error?.message ??
      `The Management API returned status ${status || "unknown"}.`,
    fix:
      error?.error?.hint ??
      "Re-run with --trace for the underlying API response details.",
    exitCode: 1,
    nextSteps: [],
  });
}
