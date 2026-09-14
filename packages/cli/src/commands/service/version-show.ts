import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  versionNotFoundError,
} from "./errors";
import { versionShowPresentations } from "./presentation";
import type { ServiceVersionShowResult } from "./results";
import { serviceProvider, toServiceSummary } from "./target";

export const serviceVersionShowCommand = defineCommand({
  help: {
    summary: "Show a service version in detail",
    description:
      "Version ids are globally unique, so the id alone is the complete target: no --project or --branch scope is needed.",
    examples: ["service version show cpv_123"],
  },
  args: {
    positionals: {
      version: positional.string({
        brief: "Version id",
        placeholder: "version",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const versionId = args.positionals.version;
    const provider = serviceProvider(ctx);
    const shown = await provider
      .showDeployment(versionId, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to show version", error, [
          runCommandAction("List versions", "service version list <service>"),
        ]);
      });

    if (!shown) {
      throw versionNotFoundError(versionId);
    }

    const result: ServiceVersionShowResult = {
      service: shown.app ? toServiceSummary(shown.app) : null,
      version: {
        ...shown.deployment,
        // Without the owning service record there is nothing that names
        // the live version, so the flag stays unknown.
        live: shown.app
          ? shown.app.liveDeploymentId === shown.deployment.id
          : null,
      },
    };
    return ok(ctx.present({ data: result }, versionShowPresentations(result)));
  },
});
