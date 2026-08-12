import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  liveUrlUnavailableError,
  noDeploymentsError,
  runCommandAction,
} from "./errors";
import { openPresentations } from "./presentation";
import type { ServiceOpenResult } from "./results";
import {
  applyLiveDeploymentHint,
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
  sortDeploymentsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceOpenCommand = defineCommand({
  help: {
    summary: "Open the service's live URL",
    examples: ["service open", "service open --service my-service"],
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
      commandName: "service open",
    });

    if (!state.selected) {
      throw noDeploymentsError(
        "No deployments available to open",
        "The resolved project does not have any deployed service yet.",
      );
    }

    const deploymentsResult = await state.provider
      .listDeployments(state.selected.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to resolve service URL", error, [
          runCommandAction("Inspect the service", "service show"),
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

    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );

    if (!liveDeployment) {
      throw noDeploymentsError(
        "No deployments available to open",
        `The selected service "${deploymentsResult.app.name}" does not have any deployments yet.`,
      );
    }
    if (!deploymentsResult.app.liveUrl) {
      throw liveUrlUnavailableError();
    }

    const url = deploymentsResult.app.liveUrl;
    // The engine announces the URL as an endpoint event and opens the
    // browser when the session is interactive; a run that cannot open one
    // reports opened: false rather than failing.
    // The engine renders `message: url` on stderr and carries the same
    // string as the endpoint event's `name`, so it has to read as a human
    // label rather than a slug.
    const { opened } = await ctx.openUrl({ url, message: "Live URL" });

    const result: ServiceOpenResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      url,
      opened,
    };
    return ok(
      ctx.present(
        { data: result },
        openPresentations(result, liveDeployment.id),
      ),
    );
  },
});
