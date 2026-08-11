import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { showPresentations } from "./presentation";
import type { ServiceShowResult } from "./results";
import {
  applyLiveDeploymentHint,
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  sortDeploymentsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceShowCommand = defineCommand({
  help: {
    summary: "Show the service and its current deployment",
    examples: ["service show", "service show --service my-service"],
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
      commandName: "service show",
    });

    if (!state.selected) {
      const result: ServiceShowResult = {
        projectId: state.projectId,
        service: null,
        liveDeployment: null,
        liveUrl: null,
        recentDeployments: [],
      };
      return ok(ctx.present({ data: result }, showPresentations(result)));
    }

    const deploymentsResult = await state.provider
      .listDeployments(state.selected.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to inspect service", error, [
          runCommandAction("List deployments", "service list-deploys"),
        ]);
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
    const liveDeployment = currentLiveDeploymentId
      ? (deployments.find(
          (deployment) => deployment.id === currentLiveDeploymentId,
        ) ?? null)
      : null;

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    const result: ServiceShowResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      liveDeployment,
      liveUrl: deploymentsResult.app.liveUrl,
      recentDeployments: deployments.slice(0, 5),
    };
    return ok(ctx.present({ data: result }, showPresentations(result)));
  },
});
