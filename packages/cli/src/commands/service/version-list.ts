import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError } from "./errors";
import { versionListPresentations } from "./presentation";
import type { ServiceVersionListResult } from "./results";
import {
  applyLiveVersionHint,
  resolveCurrentLiveVersionId,
  resolveServiceReadState,
  sortVersionsNewestFirst,
  toServiceSummary,
} from "./target";

export const serviceVersionListCommand = defineCommand({
  help: {
    summary: "List versions of the service",
    description:
      "Every deploy produces an immutable service version; at most one serves traffic at a time. Use the listed ids with 'service version' promote, rollback, start, stop, and delete.",
    examples: [
      "service version list my-service",
      "service version list my-service --branch feature-x",
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
      commandName: "service version list",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to list service versions", error, []);
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

    const result: ServiceVersionListResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      versions: deployments,
    };
    return ok(ctx.present({ data: result }, versionListPresentations(result)));
  },
});
