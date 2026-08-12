import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  userCancelledError,
} from "./errors";
import { deploymentDeletePresentations } from "./presentation";
import {
  requireDeploymentForService,
  resolveServiceReleaseState,
} from "./release";
import type { ServiceDeploymentDeleteResult } from "./results";
import { rememberSelectedService, toServiceSummary } from "./target";

export const serviceDeploymentDeleteCommand = defineCommand({
  help: {
    summary: "Delete a deployment and the artifact it holds",
    examples: [
      "service deployment delete dep_123",
      "service deployment delete dep_123 --confirm dep_123",
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
        brief: "Deployment id to delete",
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
      command: "delete",
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

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    const granted = await ctx.prompt.consent(
      `Delete deployment "${targetDeployment.id}" from Service "${state.service.name}"?`,
      { token: targetDeployment.id },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Deployment deletion canceled");
    }

    ctx.report({ kind: "step-started", step: "delete" });
    try {
      await state.provider.deleteDeployment({
        deploymentId: targetDeployment.id,
        signal: ctx.signal,
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: "delete", outcome: "failed" });
      throw deployFailedError("Failed to delete deployment", error, [
        runCommandAction("List deployments", "service deployment list"),
      ]);
    }
    ctx.report({ kind: "step-finished", step: "delete", outcome: "ok" });

    const result: ServiceDeploymentDeleteResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deploymentId: targetDeployment.id,
      deleted: true,
    };
    return ok(
      ctx.present({ data: result }, deploymentDeletePresentations(result)),
    );
  },
});
