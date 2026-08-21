import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { showPresentations } from "./presentation";
import type { ServiceShowResult } from "./results";
import {
  applyLiveDeploymentHint,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  sortDeploymentsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceShowCommand = defineCommand({
  help: {
    summary: "Show the service and its current deployment",
    examples: [
      "service show --service my-service",
      "service show --service my-service --branch feature-x",
    ],
  },
  args: {
    flags: {
      service: flag.string({
        brief: "Service name",
        placeholder: "name",
      }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch the service lives on (default: the default branch)",
        placeholder: "name",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const state = await resolveServiceReadState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: "service show",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to inspect service", error, [
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
    const deployments = sortDeploymentsNewestFirst(
      applyLiveDeploymentHint(
        deploymentsResult.deployments,
        currentLiveDeploymentId,
      ),
    );
    const liveDeployment = currentLiveDeploymentId
      ? (deployments.find(
          (deployment) => deployment.id === currentLiveDeploymentId,
        ) ?? null)
      : null;

    const result: ServiceShowResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      liveDeployment,
      // A service that was never promoted still carries an endpoint
      // domain, and that domain does not resolve. Only a service with a
      // live deployment has a URL to show.
      liveUrl: liveDeployment ? deploymentsResult.app.liveUrl : null,
      recentDeployments: deployments.slice(0, 5),
    };
    return ok(ctx.present({ data: result }, showPresentations(result)));
  },
});
