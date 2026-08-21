import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError } from "./errors";
import { deploymentListPresentations } from "./presentation";
import type { ServiceDeploymentListResult } from "./results";
import {
  applyLiveDeploymentHint,
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  sortDeploymentsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceDeploymentListCommand = defineCommand({
  help: {
    summary: "List deployments for the service",
    examples: [
      "service deployment list",
      "service deployment list --service my-service",
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
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const state = await resolveServiceReadState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      commandName: "service deployment list",
    });

    if (!state.selected) {
      const result: ServiceDeploymentListResult = {
        projectId: state.projectId,
        service: null,
        deployments: [],
      };
      return ok(
        ctx.present({ data: result }, deploymentListPresentations(result)),
      );
    }

    const deploymentsResult = await state.provider
      .listDeployments(state.selected.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError(
          "Failed to list service deployments",
          error,
          [],
        );
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

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    const result: ServiceDeploymentListResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deployments,
    };
    return ok(
      ctx.present({ data: result }, deploymentListPresentations(result)),
    );
  },
});
