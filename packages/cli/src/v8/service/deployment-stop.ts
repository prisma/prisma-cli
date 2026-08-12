import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { deploymentStopPresentations } from "./presentation";
import {
  requireDeploymentForService,
  resolveServiceReleaseState,
} from "./release";
import type { ServiceDeploymentRunStateResult } from "./results";
import { rememberSelectedService, toServiceSummary } from "./target";

export const serviceDeploymentStopCommand = defineCommand({
  help: {
    summary: "Stop a running deployment",
    examples: [
      "service deployment stop dep_123",
      "service deployment stop dep_123 --service my-service",
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
        brief: "Deployment id to stop",
        placeholder: "deployment",
      }),
      service: positional.optionalString({
        brief:
          "Service target from prisma.compute.ts when the config defines multiple services",
        placeholder: "service",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const state = await resolveServiceReleaseState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      configTarget: args.positionals.service,
      command: "stop",
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
      args.positionals.deployment,
      state.service.name,
    );
    const alreadyInState = targetDeployment.status === "stopped";

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    if (!alreadyInState) {
      ctx.report({ kind: "step-started", step: "stop" });
      try {
        await state.provider.stopDeployment({
          deploymentId: targetDeployment.id,
          signal: ctx.signal,
        });
      } catch (error) {
        ctx.report({ kind: "step-finished", step: "stop", outcome: "failed" });
        throw deployFailedError("Failed to stop deployment", error, [
          runCommandAction(
            "Show the deployment",
            `service deployment show ${targetDeployment.id}`,
          ),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "stop", outcome: "ok" });
    }

    const result: ServiceDeploymentRunStateResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deployment: { ...targetDeployment, status: "stopped" },
      alreadyInState,
    };
    const diagnostics: Diagnostic[] = alreadyInState
      ? [
          {
            code: "SERVICE.DEPLOYMENT_ALREADY_STOPPED",
            severity: "warn",
            summary: "The selected deployment is already stopped.",
            nextActions: [],
          },
        ]
      : [];
    return ok(
      ctx.present(
        { data: result, diagnostics },
        deploymentStopPresentations(result),
      ),
    );
  },
});
