import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { promotePresentations } from "./presentation";
import {
  promoteProgressReporter,
  requireDeploymentForService,
} from "./release";
import type { ServicePromoteResult } from "./results";
import {
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  toServiceSummary,
} from "./target";

export const serviceDeploymentPromoteCommand = defineCommand({
  help: {
    summary:
      "Promote a deployment to production by rebuilding with production env vars",
    examples: [
      "service deployment promote dep_123 --service my-service",
      "service deployment promote dep_123 --service my-service --branch feature-x",
    ],
  },
  args: {
    flags: {
      service: flag.string({ brief: "Service name", placeholder: "name" }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch the service lives on (default: the default branch)",
        placeholder: "name",
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
    const state = await resolveServiceReadState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: "service deployment promote",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to list service deployments", error, [
          runCommandAction(
            "List deployments",
            `service deployment list --service ${state.service.name}`,
          ),
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
          runCommandAction(
            "List deployments",
            `service deployment list --service ${state.service.name}`,
          ),
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
