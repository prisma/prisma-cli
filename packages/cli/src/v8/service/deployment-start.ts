import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { deploymentStartPresentations } from "./presentation";
import {
  requireDeploymentForService,
  resolveServiceReleaseState,
} from "./release";
import type { ServiceDeploymentRunStateResult } from "./results";
import { rememberSelectedService, toServiceSummary } from "./target";

export const serviceDeploymentStartCommand = defineCommand({
  help: {
    summary: "Start a stopped deployment",
    examples: [
      "service deployment start dep_123",
      "service deployment start dep_123 --service my-service",
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
        brief: "Deployment id to start",
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
      command: "start",
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
    const alreadyInState = targetDeployment.status === "running";

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    if (!alreadyInState) {
      ctx.report({ kind: "step-started", step: "start" });
      try {
        // The API requires the deployment's artifact to be uploaded
        // before it will start. That refusal is the API's to make and
        // its message is carried through, rather than the CLI guessing
        // at the precondition itself.
        await state.provider.startDeployment({
          deploymentId: targetDeployment.id,
          signal: ctx.signal,
        });
      } catch (error) {
        ctx.report({ kind: "step-finished", step: "start", outcome: "failed" });
        throw deployFailedError("Failed to start deployment", error, [
          runCommandAction(
            "Show the deployment",
            `service deployment show ${targetDeployment.id}`,
          ),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "start", outcome: "ok" });
    }

    const result: ServiceDeploymentRunStateResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deployment: { ...targetDeployment, status: "running" },
      alreadyInState,
    };
    const diagnostics: Diagnostic[] = alreadyInState
      ? [
          {
            code: "SERVICE.DEPLOYMENT_ALREADY_RUNNING",
            severity: "warn",
            summary: "The selected deployment is already running.",
            nextActions: [],
          },
        ]
      : [];
    return ok(
      ctx.present(
        { data: result, diagnostics },
        deploymentStartPresentations(result),
      ),
    );
  },
});
