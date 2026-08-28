import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { showPresentations } from "./presentation";
import type { ServiceShowResult } from "./results";
import {
  applyLiveVersionHint,
  resolveCurrentLiveVersionId,
  resolveServiceReadState,
  sortVersionsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceShowCommand = defineCommand({
  help: {
    summary: "Show a service and the version currently serving traffic",
    description:
      "Shows the version currently serving traffic, its status, and the service's live URL. Inspect other versions with 'service version list' and 'service version show'.",
    examples: [
      "service show my-service",
      "service show my-service --branch feature-x",
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
        brief: "Service id or name",
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
      commandName: "service show",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to inspect service", error, [
          runCommandAction(
            "List versions",
            `service version list ${state.service.name}`,
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
    const liveVersion = currentLiveDeploymentId
      ? (deployments.find(
          (deployment) => deployment.id === currentLiveDeploymentId,
        ) ?? null)
      : null;

    const result: ServiceShowResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      liveVersion,
      // A service that was never promoted still carries an endpoint
      // domain, and that domain does not resolve. Only a service with a
      // live deployment has a URL to show.
      liveUrl: liveVersion ? deploymentsResult.app.liveUrl : null,
      recentVersions: deployments.slice(0, 5),
    };
    return ok(ctx.present({ data: result }, showPresentations(result)));
  },
});
