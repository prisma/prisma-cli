import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError } from "./errors";
import { deploymentListPresentations } from "./presentation";
import type { ServiceDeploymentListResult } from "./results";
import {
  applyLiveDeploymentHint,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  sortDeploymentsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceDeploymentListCommand = defineCommand({
  help: {
    summary: "List deployments for the service",
    examples: [
      "service deployment list my-service",
      "service deployment list my-service --branch feature-x",
    ],
  },
  args: {
    flags: {
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
      service: positional.optionalString({
        brief: "Service name",
        placeholder: "service",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const state = await resolveServiceReadState(ctx, {
      serviceName: args.positionals.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: "service deployment list",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
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
