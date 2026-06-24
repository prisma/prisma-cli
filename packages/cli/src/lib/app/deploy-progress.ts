import type { Writable } from "node:stream";
import type {
  DeployProgress,
  PromoteProgress,
  UpdateEnvProgress,
} from "@prisma/compute-sdk";
import type { ShellUi } from "../../shell/ui";
import { renderDeployOutputRows } from "./deploy-output";

export interface DeployProgressState {
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

export function createDeployProgressState(): DeployProgressState {
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

export function createDeployProgress(
  output: Writable,
  ui: ShellUi,
  enabled: boolean,
  state: DeployProgressState = createDeployProgressState(),
): DeployProgress | undefined {
  const write = (line: string) => {
    if (!enabled) {
      return;
    }

    output.write(`${line}\n`);
  };

  const writeRows = (rows: Parameters<typeof renderDeployOutputRows>[1]) => {
    for (const line of renderDeployOutputRows(ui, rows)) {
      write(line);
    }
  };

  return {
    onBuildStart() {
      state.buildStarted = true;
      write("Building locally...");
    },
    onBuildComplete() {
      state.buildCompleted = true;
    },
    onArchiveReady(byteLength) {
      state.archiveReady = true;
      writeRows([{ label: "Built", value: formatArtifactSize(byteLength) }]);
    },
    onUploadStart() {
      write("Uploading...");
    },
    onDeploymentCreated(deploymentId) {
      state.versionId = deploymentId;
    },
    onUploadComplete() {
      state.uploadCompleted = true;
      writeRows([{ label: "Uploaded" }]);
    },
    onStartRequested() {
      state.startRequested = true;
      write("Deploying...");
    },
    onRunning(url) {
      state.containerLive = true;
      state.deploymentUrl = url;
      writeRows([{ label: "Deployed" }]);
    },
    onPromoted(url) {
      state.promotedUrl = url;
    },
  };
}

function formatArtifactSize(byteLength: number): string {
  return `${(byteLength / 1024 / 1024).toFixed(1)} MB`;
}

export function createPromoteProgress(
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
    onDeploymentStarting(deploymentId) {
      write(`Starting deployment ${deploymentId}...`);
    },
    onDeploymentStartRequested() {
      write("Requesting deployment start...");
    },
    onStatusChange(status) {
      write(`Status: ${status}`);
    },
    onDeploymentRunning() {
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

export function createUpdateEnvProgress(
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
    onDeploymentCreated(deploymentId) {
      write(`Creating updated deployment ${deploymentId}...`);
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
