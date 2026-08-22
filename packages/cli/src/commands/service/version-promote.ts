import { defineCommand, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { deployFailedError, runCommandAction } from "./errors";
import { promotePresentations } from "./presentation";
import { promoteProgressReporter } from "./release";
import type { ServicePromoteResult } from "./results";
import { resolveVersionSubject, toServiceSummary } from "./target";

export const serviceVersionPromoteCommand = defineCommand({
  help: {
    summary:
      "Promote a service version to production by rebuilding with production env vars",
    examples: ["service version promote cpv_123"],
  },
  args: {
    positionals: {
      version: positional.string({
        brief: "Version id to promote",
        placeholder: "version",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { provider, service, version } = await resolveVersionSubject(
      ctx,
      args.positionals.version,
    );
    const alreadyLive = service.liveDeploymentId === version.id;

    if (!alreadyLive) {
      ctx.report({ kind: "step-started", step: "promote" });
      try {
        await provider.promoteDeployment({
          appId: service.id,
          deploymentId: version.id,
          signal: ctx.signal,
          progress: promoteProgressReporter(ctx, version.id),
        });
      } catch (error) {
        ctx.report({
          kind: "step-finished",
          step: "promote",
          outcome: "failed",
        });
        throw deployFailedError("Failed to promote version", error, [
          runCommandAction(
            "List versions",
            `service version list ${service.name}`,
          ),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "promote", outcome: "ok" });
    }

    const result: ServicePromoteResult = {
      service: toServiceSummary(service),
      version: { ...version, status: "running", live: true },
    };
    const diagnostics: Diagnostic[] = alreadyLive
      ? [
          {
            code: "SERVICE.VERSION_ALREADY_LIVE",
            severity: "warn",
            summary: "The selected version is already live for this service.",
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
