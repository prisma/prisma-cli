import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  userCancelledError,
} from "./errors";
import { deploymentDeletePresentations } from "./presentation";
import type { ServiceDeploymentDeleteResult } from "./results";
import { resolveDeploymentSubject, toServiceSummary } from "./target";

export const serviceDeploymentDeleteCommand = defineCommand({
  help: {
    summary: "Delete a deployment and the artifact it holds",
    examples: [
      "service deployment delete dep_123",
      "service deployment delete dep_123 --confirm dep_123",
    ],
  },
  args: {
    positionals: {
      deployment: positional.string({
        brief: "Deployment id to delete",
        placeholder: "deployment",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, service, deployment } = await resolveDeploymentSubject(
      ctx,
      args.positionals.deployment,
    );

    const granted = await ctx.prompt.consent(
      `Delete deployment "${deployment.id}" from Service "${service.name}"?`,
      { token: deployment.id },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Deployment deletion canceled");
    }

    ctx.report({ kind: "step-started", step: "delete" });
    try {
      await provider.deleteDeployment({
        deploymentId: deployment.id,
        signal: ctx.signal,
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: "delete", outcome: "failed" });
      throw deployFailedError("Failed to delete deployment", error, [
        runCommandAction(
          "List deployments",
          `service deployment list ${service.name}`,
        ),
      ]);
    }
    ctx.report({ kind: "step-finished", step: "delete", outcome: "ok" });

    const result: ServiceDeploymentDeleteResult = {
      service: toServiceSummary(service),
      deploymentId: deployment.id,
      deleted: true,
    };
    return ok(
      ctx.present({ data: result }, deploymentDeletePresentations(result)),
    );
  },
});
