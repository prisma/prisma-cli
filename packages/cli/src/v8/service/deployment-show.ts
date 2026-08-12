import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  deploymentNotFoundError,
  runCommandAction,
} from "./errors";
import { deploymentShowPresentations } from "./presentation";
import type { ServiceDeploymentShowResult } from "./results";
import {
  openServiceStateStore,
  requireWorkspace,
  serviceProvider,
  toServiceSummary,
} from "./target";

export const serviceDeploymentShowCommand = defineCommand({
  help: {
    summary: "Show a deployment in detail",
    examples: ["service deployment show dep_123"],
  },
  args: {
    positionals: {
      deployment: positional.string({
        brief: "Deployment id",
        placeholder: "deployment",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const deploymentId = args.positionals.deployment;
    const provider = serviceProvider(ctx);
    const deployment = await provider
      .showDeployment(deploymentId, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to show deployment", error, [
          runCommandAction("List deployments", "service deployment list"),
        ]);
      });

    if (!deployment) {
      throw deploymentNotFoundError(deploymentId);
    }

    let knownLiveDeploymentId: string | null = null;
    if (deployment.app) {
      const stateStore = await openServiceStateStore(ctx);
      const state = await stateStore.read();
      const workspaceId =
        state.auth?.workspaceId ??
        (await requireWorkspace(ctx).then(
          (workspace) => workspace.id,
          () => null,
        ));
      const rememberedProject = workspaceId
        ? await stateStore.readRememberedProject(workspaceId)
        : null;
      knownLiveDeploymentId = rememberedProject
        ? await stateStore.readKnownLiveDeployment(
            rememberedProject.id,
            deployment.app.id,
          )
        : null;
    }
    const liveDeploymentId =
      deployment.app?.liveDeploymentId || knownLiveDeploymentId;

    const result: ServiceDeploymentShowResult = {
      service: deployment.app ? toServiceSummary(deployment.app) : null,
      deployment: {
        ...deployment.deployment,
        live: liveDeploymentId
          ? deployment.deployment.id === liveDeploymentId
          : deployment.deployment.live,
      },
    };
    return ok(
      ctx.present({ data: result }, deploymentShowPresentations(result)),
    );
  },
});
