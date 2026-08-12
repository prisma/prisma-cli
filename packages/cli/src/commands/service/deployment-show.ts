import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  deploymentNotFoundError,
  runCommandAction,
} from "./errors";
import { deploymentShowPresentations } from "./presentation";
import type { ServiceDeploymentShowResult } from "./results";
import { serviceProvider, toServiceSummary } from "./target";

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

    const result: ServiceDeploymentShowResult = {
      service: deployment.app ? toServiceSummary(deployment.app) : null,
      deployment: {
        ...deployment.deployment,
        // Without the owning service record there is nothing that names
        // the live deployment, so the flag stays unknown.
        live: deployment.app
          ? deployment.app.liveDeploymentId === deployment.deployment.id
          : null,
      },
    };
    return ok(
      ctx.present({ data: result }, deploymentShowPresentations(result)),
    );
  },
});
