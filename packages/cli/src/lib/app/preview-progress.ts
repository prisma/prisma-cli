import type { DeployProgress, PromoteProgress, UpdateEnvProgress } from "@prisma/compute-sdk";
import type { Writable } from "node:stream";

export interface PreviewDeployProgressState {
  buildStarted: boolean;
  buildCompleted: boolean;
  archiveReady: boolean;
  uploadCompleted: boolean;
  versionId: string | null;
  startRequested: boolean;
  containerLive: boolean;
  deploymentUrl: string | null;
  promotedUrl: string | null;
}

export function createPreviewDeployProgressState(): PreviewDeployProgressState {
  return {
    buildStarted: false,
    buildCompleted: false,
    archiveReady: false,
    uploadCompleted: false,
    versionId: null,
    startRequested: false,
    containerLive: false,
    deploymentUrl: null,
    promotedUrl: null,
  };
}

export function createPreviewDeployProgress(
  output: Writable,
  enabled: boolean,
  state: PreviewDeployProgressState = createPreviewDeployProgressState(),
): DeployProgress | undefined {
  const write = (line: string) => {
    if (!enabled) {
      return;
    }

    output.write(`${line}\n`);
  };

  return {
    onBuildStart() {
      state.buildStarted = true;
      write("Building locally...");
    },
    onBuildComplete() {
      state.buildCompleted = true;
      write("Building locally. Done.");
    },
    onArchiveCreating() {
      write("Packaging artifact...");
    },
    onArchiveReady(byteLength) {
      state.archiveReady = true;
      write(`Packaging artifact. ${formatArtifactSize(byteLength)}.`);
    },
    onUploadStart() {
      write("Uploading...");
    },
    onVersionCreated(versionId) {
      state.versionId = versionId;
    },
    onUploadComplete() {
      state.uploadCompleted = true;
      write("Uploading. Done.");
    },
    onStartRequested() {
      state.startRequested = true;
      write("Starting deployment...");
    },
    onRunning(url) {
      state.containerLive = true;
      state.deploymentUrl = url;
      write("Starting deployment. Container live.");
      // TODO: replace this SDK "running" boundary with the platform health-passed signal.
      write("Checking runtime health...");
    },
    onPromoted(url) {
      state.promotedUrl = url;
    },
  };
}

function formatArtifactSize(byteLength: number): string {
  return `${(byteLength / 1024 / 1024).toFixed(1)} MB`;
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
