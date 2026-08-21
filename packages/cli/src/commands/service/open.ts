import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  liveUrlUnavailableError,
  noVersionsError,
  runCommandAction,
} from "./errors";
import { openPresentations } from "./presentation";
import type { ServiceOpenResult } from "./results";
import {
  applyLiveVersionHint,
  resolveCurrentLiveVersionId,
  resolveServiceReadState,
  sortVersionsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceOpenCommand = defineCommand({
  help: {
    summary: "Open the service's live URL",
    examples: [
      "service open my-service",
      "service open my-service --branch feature-x",
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
      commandName: "service open",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to resolve service URL", error, [
          runCommandAction(
            "Inspect the service",
            `service show ${state.service.name}`,
          ),
        ]);
      });
    const currentLiveDeploymentId = resolveCurrentLiveVersionId(
      deploymentsResult.app,
      deploymentsResult.deployments,
    );
    const deployments = sortVersionsNewestFirst(
      applyLiveVersionHint(
        deploymentsResult.deployments,
        currentLiveDeploymentId,
      ),
    );
    const liveDeployment = currentLiveDeploymentId
      ? (deployments.find(
          (deployment) => deployment.id === currentLiveDeploymentId,
        ) ?? null)
      : null;

    if (!liveDeployment) {
      throw noVersionsError(
        "No versions available to open",
        `The service "${deploymentsResult.app.name}" does not have any versions yet.`,
        deploymentsResult.app.name,
      );
    }
    if (!deploymentsResult.app.liveUrl) {
      throw liveUrlUnavailableError(deploymentsResult.app.name);
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
