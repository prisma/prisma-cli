import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  deploymentNotFoundError,
  runCommandAction,
} from "./errors";
import { showDeployPresentations } from "./presentation";
import type { ServiceShowDeployResult } from "./results";
import {
  openServiceStateStore,
  requireWorkspace,
  serviceProvider,
  toServiceSummary,
} from "./target";

export const serviceShowDeployCommand = defineCommand({
  help: {
    summary: "Show a deployment in detail",
    examples: ["service show-deploy dep_123"],
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
          runCommandAction("List deployments", "service list-deploys"),
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
    const providerLiveDeploymentId = deployment.app?.liveDeploymentId ?? null;

    const result: ServiceShowDeployResult = {
      service: deployment.app ? toServiceSummary(deployment.app) : null,
      deployment: {
        ...deployment.deployment,
        live: providerLiveDeploymentId
          ? deployment.deployment.id === providerLiveDeploymentId
          : knownLiveDeploymentId
            ? deployment.deployment.id === knownLiveDeploymentId
            : deployment.deployment.live,
      },
    };
    return ok(ctx.present({ data: result }, showDeployPresentations(result)));
  },
});
