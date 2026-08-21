import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { promotePresentations } from "./presentation";
import {
  promoteProgressReporter,
  requireDeploymentForService,
  resolveServiceReleaseState,
} from "./release";
import type { ServicePromoteResult } from "./results";
import {
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  toServiceSummary,
} from "./target";

export const serviceDeploymentPromoteCommand = defineCommand({
  help: {
    summary:
      "Promote a deployment to production by rebuilding with production env vars",
    examples: [
      "service deployment promote dep_123",
      "service deployment promote dep_123 --service my-service",
    ],
  },
  args: {
    flags: {
      service: flag.string({ brief: "Service name", placeholder: "name" }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
    },
    positionals: {
      deployment: positional.string({
        brief: "Deployment id to promote",
        placeholder: "deployment",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const state = await resolveServiceReleaseState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      command: "promote",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to list service deployments", error, [
          runCommandAction("List deployments", "service deployment list"),
        ]);
      });
    const currentLiveDeploymentId = resolveCurrentLiveDeploymentId(
      deploymentsResult.app,
      deploymentsResult.deployments,
    );
    const targetDeployment = requireDeploymentForService(
      deploymentsResult.deployments,
      args.positionals.deployment,
      state.service.name,
    );
    const alreadyLive = currentLiveDeploymentId === targetDeployment.id;

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    if (!alreadyLive) {
      ctx.report({ kind: "step-started", step: "promote" });
      try {
        await state.provider.promoteDeployment({
          appId: state.service.id,
          deploymentId: targetDeployment.id,
          signal: ctx.signal,
          progress: promoteProgressReporter(ctx, targetDeployment.id),
        });
      } catch (error) {
        ctx.report({
          kind: "step-finished",
          step: "promote",
          outcome: "failed",
        });
        throw deployFailedError("Failed to promote deployment", error, [
          runCommandAction("List deployments", "service deployment list"),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "promote", outcome: "ok" });
    }

    const result: ServicePromoteResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deployment: { ...targetDeployment, status: "running", live: true },
    };
    const diagnostics: Diagnostic[] = alreadyLive
      ? [
          {
            code: "SERVICE.DEPLOYMENT_ALREADY_LIVE",
            severity: "warn",
            summary:
              "The selected deployment is already live for this service.",
            nextActions: [],
          },
        ]
      : [];
    return ok(
      ctx.present(
        { data: result, diagnostics },
        promotePresentations(result, alreadyLive),
      ),
    );
  },
});
