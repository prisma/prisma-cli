import { defineCommand, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { promotePresentations } from "./presentation";
import { promoteProgressReporter } from "./release";
import type { ServicePromoteResult } from "./results";
import { resolveDeploymentSubject, toServiceSummary } from "./target";

export const serviceDeploymentPromoteCommand = defineCommand({
  help: {
    summary:
      "Promote a deployment to production by rebuilding with production env vars",
    examples: ["service deployment promote dep_123"],
  },
  args: {
    positionals: {
      deployment: positional.string({
        brief: "Deployment id to promote",
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
    const alreadyLive = service.liveDeploymentId === deployment.id;

    if (!alreadyLive) {
      ctx.report({ kind: "step-started", step: "promote" });
      try {
        await provider.promoteDeployment({
          appId: service.id,
          deploymentId: deployment.id,
          signal: ctx.signal,
          progress: promoteProgressReporter(ctx, deployment.id),
        });
      } catch (error) {
        ctx.report({
          kind: "step-finished",
          step: "promote",
          outcome: "failed",
        });
        throw deployFailedError("Failed to promote deployment", error, [
          runCommandAction(
            "List deployments",
            `service deployment list ${service.name}`,
          ),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "promote", outcome: "ok" });
    }

    const result: ServicePromoteResult = {
      service: toServiceSummary(service),
      deployment: { ...deployment, status: "running", live: true },
    };
    const diagnostics: Diagnostic[] = alreadyLive
      ? [
          {
            code: "SERVICE.DEPLOYMENT_ALREADY_LIVE",
            severity: "warn",
            summary:
              "The selected deployment is already live for this service.",
            nextActions: [],
          },
        ]
      : [];
    return ok(
      ctx.present(
        { data: result, diagnostics },
        promotePresentations(result, alreadyLive),
      ),
    );
  },
});
