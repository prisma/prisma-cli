import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  userCancelledError,
} from "./errors";
import { versionDeletePresentations } from "./presentation";
import type { ServiceVersionDeleteResult } from "./results";
import { resolveVersionSubject, toServiceSummary } from "./target";

export const serviceVersionDeleteCommand = defineCommand({
  help: {
    summary: "Delete a service version and the artifact it holds",
    examples: [
      "service version delete cpv_123",
      "service version delete cpv_123 --confirm cpv_123",
    ],
  },
  args: {
    positionals: {
      version: positional.string({
        brief: "Version id to delete",
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

    const granted = await ctx.prompt.consent(
      `Delete version "${version.id}" from Service "${service.name}"?`,
      { token: version.id },
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
        deploymentId: version.id,
        signal: ctx.signal,
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: "delete", outcome: "failed" });
      throw deployFailedError("Failed to delete version", error, [
        runCommandAction(
          "List versions",
          `service version list ${service.name}`,
        ),
      ]);
    }
    ctx.report({ kind: "step-finished", step: "delete", outcome: "ok" });

    const result: ServiceVersionDeleteResult = {
      service: toServiceSummary(service),
      versionId: version.id,
      deleted: true,
    };
    return ok(
      ctx.present({ data: result }, versionDeletePresentations(result)),
    );
  },
});
