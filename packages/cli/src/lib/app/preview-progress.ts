import type { DeployProgress, PromoteProgress, UpdateEnvProgress } from "@prisma/compute-sdk";
import type { Writable } from "node:stream";

export function createPreviewDeployProgress(
  output: Writable,
  enabled: boolean,
): DeployProgress | undefined {
  if (!enabled) {
    return undefined;
  }

  const write = (line: string) => {
    output.write(`${line}\n`);
  };

  return {
    onBuildStart() {
      write("Building application...");
    },
    onBuildComplete() {
      write("Build complete.");
    },
    onArchiveCreating() {
      write("Creating deployment artifact...");
    },
    onArchiveReady(byteLength) {
      write(`Artifact ready (${(byteLength / 1024).toFixed(1)} KB).`);
    },
    onVersionCreated(versionId) {
      write(`Deployment ${versionId} created.`);
    },
    onUploadComplete() {
      write("Upload complete.");
    },
    onStartRequested() {
      write("Starting deployment...");
    },
    onStatusChange(status) {
      write(`Status: ${status}`);
    },
    onRunning(url) {
      if (url) {
        write(`Deployment is running at ${url}.`);
        return;
      }

      write("Deployment is running.");
    },
    onPromoteStart() {
      write("Promoting deployment...");
    },
    onPromoted(url) {
      if (url) {
        write(`Promoted to ${url}.`);
        return;
      }

      write("Promotion complete.");
    },
    onPromoteFailed(error) {
      write(`Promotion failed${error?.message ? `: ${error.message}` : "."}`);
    },
    onOldVersionStopping(versionId) {
      write(`Stopping previous deployment ${versionId}...`);
    },
    onOldVersionStopped(versionId) {
      write(`Previous deployment ${versionId} stopped.`);
    },
    onOldVersionStopFailed(versionId) {
      write(`Failed to stop previous deployment ${versionId} (non-fatal).`);
    },
    onOldVersionDeleting(versionId) {
      write(`Deleting previous deployment ${versionId}...`);
    },
    onOldVersionDeleted(versionId) {
      write(`Previous deployment ${versionId} deleted.`);
    },
    onOldVersionDeleteFailed(versionId) {
      write(`Failed to delete previous deployment ${versionId} (non-fatal).`);
    },
    onCleanupDanglingVersion(versionId) {
      write(`Cleaning up deployment ${versionId}...`);
    },
    onCleanupDanglingVersionComplete(versionId) {
      write(`Deployment ${versionId} cleaned up.`);
    },
    onCleanupDanglingVersionFailed(versionId) {
      write(`Failed to clean up deployment ${versionId}.`);
    },
  };
}

export function createPreviewPromoteProgress(
  output: Writable,
  enabled: boolean,
): PromoteProgress | undefined {
  if (!enabled) {
    return undefined;
  }

  const write = (line: string) => {
    output.write(`${line}\n`);
  };

  return {
    onVersionStarting(versionId) {
      write(`Starting deployment ${versionId}...`);
    },
    onVersionStartRequested() {
      write("Requesting deployment start...");
    },
    onStatusChange(status) {
      write(`Status: ${status}`);
    },
    onVersionRunning() {
      write("Deployment is running.");
    },
    onPromoteStart() {
      write("Promoting deployment...");
    },
    onPromoted(url) {
      if (url) {
        write(`Promoted to ${url}.`);
        return;
      }

      write("Promotion complete.");
    },
    onPromoteFailed(error) {
      write(`Promotion failed${error?.message ? `: ${error.message}` : "."}`);
    },
  };
}

export function createPreviewUpdateEnvProgress(
  output: Writable,
  enabled: boolean,
): UpdateEnvProgress | undefined {
  if (!enabled) {
    return undefined;
  }

  const write = (line: string) => {
    output.write(`${line}\n`);
  };

  return {
    onVersionCreated(versionId) {
      write(`Creating updated deployment ${versionId}...`);
    },
    onStartRequested() {
      write("Starting deployment...");
    },
    onStatusChange(status) {
      write(`Status: ${status}`);
    },
    onRunning(url) {
      if (url) {
        write(`Deployment is running at ${url}.`);
        return;
      }

      write("Deployment is running.");
    },
  };
}
