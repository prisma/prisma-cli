import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  userCancelledError,
} from "./errors";
import { rollbackPresentations } from "./presentation";
import {
  promoteProgressReporter,
  requireDeploymentForService,
  resolveRollbackTarget,
  resolveServiceReleaseState,
} from "./release";
import type { ServiceRollbackResult } from "./results";
import {
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  toServiceSummary,
} from "./target";

export const serviceDeploymentRollbackCommand = defineCommand({
  help: {
    summary: "Roll back production to a previous deployment",
    examples: [
      "service deployment rollback",
      "service deployment rollback --to dep_123",
      "service deployment rollback --to dep_123 --confirm dep_123",
    ],
  },
  args: {
    flags: {
      service: flag.string({ brief: "Service name", placeholder: "name" }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      to: flag.string({
        brief:
          "Deployment id to roll back to (default: the deployment before the live one)",
        placeholder: "deployment",
      }),
    },
    positionals: {
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
      command: "rollback",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to list service deployments", error, [
          runCommandAction("List deployments", "service deployment list"),
        ]);
      });
    const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
      deploymentsResult.deployments,
    );
    const targetDeployment = args.flags.to
      ? requireDeploymentForService(
          deploymentsResult.deployments,
          args.flags.to,
          state.service.name,
        )
      : resolveRollbackTarget(
          deploymentsResult.deployments,
          currentLiveDeploymentId,
        );

    const granted = await ctx.prompt.consent(
      `Roll back Service "${state.service.name}" to deployment ${targetDeployment.id} and make it live?`,
      { token: targetDeployment.id },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Service rollback canceled");
    }

    const alreadyLive = currentLiveDeploymentId === targetDeployment.id;

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    if (!alreadyLive) {
      ctx.report({ kind: "step-started", step: "rollback" });
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
          step: "rollback",
          outcome: "failed",
        });
        throw deployFailedError("Failed to roll back deployment", error, [
          runCommandAction("List deployments", "service deployment list"),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "rollback", outcome: "ok" });
    }

    await state.stateStore.setKnownLiveDeployment(
      state.projectId,
      deploymentsResult.app.id,
      targetDeployment.id,
    );

    const result: ServiceRollbackResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deployment: { ...targetDeployment, status: "running", live: true },
      previousLiveDeploymentId: currentLiveDeploymentId,
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
        rollbackPresentations(result, alreadyLive),
      ),
    );
  },
});
