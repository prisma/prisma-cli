import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import {
  deploymentStartPresentations,
  deploymentStopPresentations,
} from "./presentation";
import {
  requireDeploymentForService,
  resolveServiceReleaseState,
} from "./release";
import type { ServiceDeploymentRunStateResult } from "./results";
import type { ServiceContext } from "./target";
import { rememberSelectedService, toServiceSummary } from "./target";

/**
 * `start` and `stop` are the same command with the direction reversed,
 * so the verb decides every value that differs between them. Spelling
 * that out here keeps the two from drifting apart, which is the risk
 * with a body this long duplicated.
 */
const VERBS = {
  start: {
    /** The status the API reports once the deployment is up. */
    settledStatus: "running",
    diagnosticCode: "SERVICE.DEPLOYMENT_ALREADY_RUNNING",
    diagnosticSummary: "The selected deployment is already running.",
    failureSummary: "Failed to start deployment",
    presentations: deploymentStartPresentations,
  },
  stop: {
    settledStatus: "stopped",
    diagnosticCode: "SERVICE.DEPLOYMENT_ALREADY_STOPPED",
    diagnosticSummary: "The selected deployment is already stopped.",
    failureSummary: "Failed to stop deployment",
    presentations: deploymentStopPresentations,
  },
} as const;

export type RunStateVerb = keyof typeof VERBS;

export interface RunStateArgs {
  deployment: string;
  service?: string | undefined;
  project?: string | undefined;
}

export interface RunStateOutcome {
  result: ServiceDeploymentRunStateResult;
  diagnostics: Diagnostic[];
  presentations: ReturnType<typeof deploymentStartPresentations>;
}

export async function changeDeploymentRunState(
  ctx: ServiceContext,
  args: RunStateArgs,
  verb: RunStateVerb,
): Promise<RunStateOutcome> {
  const spec = VERBS[verb];
  const state = await resolveServiceReleaseState(ctx, {
    ...(args.service !== undefined ? { serviceName: args.service } : {}),
    ...(args.project !== undefined ? { projectRef: args.project } : {}),
    command: verb,
  });

  const deploymentsResult = await state.provider
    .listDeployments(state.service.id, { signal: ctx.signal })
    .catch((error) => {
      throw deployFailedError("Failed to list service deployments", error, [
        runCommandAction("List deployments", "service deployment list"),
      ]);
    });
  const targetDeployment = requireDeploymentForService(
    deploymentsResult.deployments,
    args.deployment,
    state.service.name,
  );
  const alreadyInState = targetDeployment.status === spec.settledStatus;

  await rememberSelectedService(
    state.stateStore,
    state.projectId,
    deploymentsResult.app,
  );

  let observed = targetDeployment;
  if (!alreadyInState) {
    ctx.report({ kind: "step-started", step: verb });
    try {
      // The API requires a deployment's artifact to be uploaded before
      // it will start. That refusal is the API's to make and its message
      // is carried through, rather than the CLI guessing at the
      // precondition itself.
      await (verb === "start"
        ? state.provider.startDeployment({
            deploymentId: targetDeployment.id,
            signal: ctx.signal,
          })
        : state.provider.stopDeployment({
            deploymentId: targetDeployment.id,
            signal: ctx.signal,
          }));
      // The start and stop endpoints answer with nothing, so the status
      // is read back rather than assumed. A deployment still coming up
      // reports whatever state it is actually in.
      observed = await state.provider.readDeployment({
        deploymentId: targetDeployment.id,
        signal: ctx.signal,
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: verb, outcome: "failed" });
      throw deployFailedError(spec.failureSummary, error, [
        runCommandAction(
          "Show the deployment",
          `service deployment show ${targetDeployment.id}`,
        ),
      ]);
    }
    ctx.report({ kind: "step-finished", step: verb, outcome: "ok" });
  }

  const result: ServiceDeploymentRunStateResult = {
    projectId: state.projectId,
    service: toServiceSummary(deploymentsResult.app),
    deployment: observed,
    alreadyInState,
  };
  const diagnostics: Diagnostic[] = alreadyInState
    ? [
        {
          code: spec.diagnosticCode,
          severity: "warn",
          summary: spec.diagnosticSummary,
          nextActions: [],
        },
      ]
    : [];
  return { result, diagnostics, presentations: spec.presentations(result) };
}
