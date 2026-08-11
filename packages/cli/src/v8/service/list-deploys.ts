import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError } from "./errors";
import { listDeploysPresentations } from "./presentation";
import type { ServiceListDeploysResult } from "./results";
import {
  applyLiveDeploymentHint,
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  sortDeploymentsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceListDeploysCommand = defineCommand({
  help: {
    summary: "List deployments for the service",
    examples: [
      "service list-deploys",
      "service list-deploys --service my-service",
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
    const state = await resolveServiceReadState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      configTarget: args.positionals.service,
      commandName: "service list-deploys",
    });

    if (!state.selected) {
      const result: ServiceListDeploysResult = {
        projectId: state.projectId,
        service: null,
        deployments: [],
      };
      return ok(
        ctx.present({ data: result }, listDeploysPresentations(result)),
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
    const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
      state.stateStore,
      state.projectId,
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

    const result: ServiceListDeploysResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      deployments,
    };
    return ok(ctx.present({ data: result }, listDeploysPresentations(result)));
  },
});
