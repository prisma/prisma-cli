import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { deleteFailedError, userCancelledError } from "./errors";
import { deletePresentations } from "./presentation";
import { destroyProgressReporter } from "./release";
import type { ServiceDeleteResult } from "./results";
import { resolveServiceReadState, toServiceSummary } from "./target";

export const serviceDeleteCommand = defineCommand({
  help: {
    summary: "Delete a service from one branch",
    description:
      "Removes the service from the targeted Branch only: its versions stop serving and its URL goes away. The same service on other branches is untouched. Pass the confirmation token with --confirm to run non-interactively.",
    examples: [
      "service delete my-service",
      "service delete my-service --confirm my-service",
    ],
  },
  args: {
    flags: {
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch the deletion is scoped to",
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
      commandName: "service delete",
    });

    const granted = await ctx.prompt.consent(
      `Delete Service "${state.service.name}" and every version it owns?`,
      { token: state.service.name },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Service deletion canceled");
    }

    ctx.report({ kind: "step-started", step: "delete" });
    ctx.report({
      kind: "status",
      subject: state.service.name,
      status: "deleting",
    });
    let deletedService: { id: string; name: string };
    try {
      deletedService = await state.provider.removeApp(state.service.id, {
        signal: ctx.signal,
        progress: destroyProgressReporter(ctx, state.service.name),
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: "delete", outcome: "failed" });
      throw deleteFailedError(
        "Failed to delete service",
        error,
        state.service.name,
      );
    }
    ctx.report({ kind: "step-finished", step: "delete", outcome: "ok" });

    const result: ServiceDeleteResult = {
      projectId: state.projectId,
      service: toServiceSummary(deletedService),
      deleted: true,
    };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
