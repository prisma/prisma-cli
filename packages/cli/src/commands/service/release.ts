import type { DestroyAppProgress, PromoteProgress } from "@prisma/compute-sdk";
import type { DeploymentRecord } from "../../lib/app/app-provider";
import {
  liveVersionUnknownError,
  noPreviousVersionError,
  versionNotFoundForServiceError,
} from "./errors";
import type { ServiceContext } from "./target";

export function requireVersionForService(
  deployments: DeploymentRecord[],
  deploymentId: string,
  serviceName: string,
): DeploymentRecord {
  const deployment = deployments.find(
    (candidate) => candidate.id === deploymentId,
  );
  if (!deployment) {
    throw versionNotFoundForServiceError(deploymentId, serviceName);
  }
  return deployment;
}

/** The rollback default: the newest deployment that is not the live
 *  one. With nothing naming the live deployment, every deployment
 *  qualifies and the newest one — most likely the one already live — is
 *  what a caller would get, so this refuses instead of guessing. */
export function resolveRollbackTarget(
  deployments: DeploymentRecord[],
  currentLiveDeploymentId: string | null,
  serviceName: string,
): DeploymentRecord {
  if (deployments.length === 0) {
    throw noPreviousVersionError(serviceName);
  }
  if (currentLiveDeploymentId === null) {
    throw liveVersionUnknownError(serviceName);
  }
  const previousDeployment = deployments.find(
    (deployment) => deployment.id !== currentLiveDeploymentId,
  );
  if (!previousDeployment) {
    throw noPreviousVersionError(serviceName);
  }
  return previousDeployment;
}

/**
 * Maps the compute SDK's promote callbacks onto engine events: one
 * `status` event per reported transition of the target deployment, an
 * `endpoint` event for the promoted URL, and a warning message when the
 * SDK reports a promotion failure before rejecting.
 */
export function promoteProgressReporter(
  ctx: Pick<ServiceContext, "report">,
  deploymentId: string,
): PromoteProgress {
  let previousStatus: string | null = null;
  const status = (next: string) => {
    if (previousStatus === next) {
      return;
    }
    ctx.report({
      kind: "status",
      subject: deploymentId,
      status: next,
      ...(previousStatus === null ? {} : { from: previousStatus }),
    });
    previousStatus = next;
  };

  return {
    onDeploymentStarting: () => status("starting"),
    onDeploymentStartRequested: () => status("start-requested"),
    onStatusChange: (next) => status(next),
    onDeploymentRunning: () => status("running"),
    onPromoteStart: () => status("promoting"),
    onPromoted: (appEndpointDomain) => {
      status("promoted");
      if (appEndpointDomain) {
        ctx.report({
          kind: "endpoint",
          name: "live",
          url: `https://${appEndpointDomain}`,
        });
      }
    },
    onPromoteFailed: (error) => {
      ctx.report({
        kind: "message",
        severity: "warn",
        text: `Promotion failed${error?.message ? `: ${error.message}` : "."}`,
      });
    },
  };
}

/**
 * Maps the compute SDK's app-teardown callbacks onto engine events: the
 * SDK polls each deployment down internally, so the deployment stop and
 * delete phases become `progress` counts and the terminal delete becomes
 * a `status` event for the service.
 */
export function destroyProgressReporter(
  ctx: Pick<ServiceContext, "report">,
  serviceName: string,
): DestroyAppProgress {
  let stopping = 0;
  let stopped = 0;
  let deleting = 0;
  let deleted = 0;

  return {
    onStoppingDeployments: (deploymentIds) => {
      stopping = deploymentIds.length;
      ctx.report({
        kind: "progress",
        step: "stop-versions",
        completed: 0,
        total: stopping,
      });
    },
    onDeploymentStopped: () => {
      stopped += 1;
      ctx.report({
        kind: "progress",
        step: "stop-versions",
        completed: stopped,
        total: stopping,
      });
    },
    onDeletingDeployments: (deploymentIds) => {
      deleting = deploymentIds.length;
      ctx.report({
        kind: "progress",
        step: "delete-versions",
        completed: 0,
        total: deleting,
      });
    },
    onDeploymentDeleted: () => {
      deleted += 1;
      ctx.report({
        kind: "progress",
        step: "delete-versions",
        completed: deleted,
        total: deleting,
      });
    },
    onAppDeleted: () => {
      ctx.report({
        kind: "status",
        subject: serviceName,
        status: "deleted",
        from: "deleting",
      });
    },
  };
}
