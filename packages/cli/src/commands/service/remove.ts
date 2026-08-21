import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import type { LocalStateStore } from "../../adapters/local-state";
import {
  branchValueEmptyError,
  removeFailedError,
  userCancelledError,
} from "./errors";
import { removePresentations } from "./presentation";
import { destroyProgressReporter, resolveServiceReleaseState } from "./release";
import type { ServiceRemoveResult } from "./results";
import { toServiceSummary } from "./target";

function cleanupWarning(target: string, error: unknown): Diagnostic {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: "SERVICE.LOCAL_STATE_CLEANUP_FAILED",
    severity: "warn",
    summary: `The service was removed remotely, but the local ${target} state could not be cleared: ${cause}`,
    nextActions: [],
  };
}

async function clearRemovedServiceState(
  stateStore: LocalStateStore,
  projectId: string,
  serviceId: string,
): Promise<Diagnostic[]> {
  const warnings: Diagnostic[] = [];
  try {
    await stateStore.clearSelectedApp(projectId, serviceId);
  } catch (error) {
    warnings.push(cleanupWarning("selected service", error));
  }
  try {
    await stateStore.clearKnownLiveDeployment(projectId, serviceId);
  } catch (error) {
    warnings.push(cleanupWarning("known live deployment", error));
  }
  return warnings;
}

export const serviceRemoveCommand = defineCommand({
  help: {
    summary: "Remove the service from the resolved branch",
    examples: [
      "service remove",
      "service remove --service my-service --confirm my-service",
    ],
  },
  args: {
    flags: {
      service: flag.string({ brief: "Service name", placeholder: "name" }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch the removal is scoped to",
        placeholder: "name",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    if (args.flags.branch !== undefined && args.flags.branch.trim() === "") {
      throw branchValueEmptyError();
    }

    const state = await resolveServiceReleaseState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      command: "remove",
    });

    const granted = await ctx.prompt.consent(
      `Remove Service "${state.service.name}" and every deployment it owns?`,
      { token: state.service.name },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Service removal canceled");
    }

    ctx.report({ kind: "step-started", step: "remove" });
    ctx.report({
      kind: "status",
      subject: state.service.name,
      status: "removing",
    });
    let removedService: { id: string; name: string };
    try {
      removedService = await state.provider.removeApp(state.service.id, {
        signal: ctx.signal,
        progress: destroyProgressReporter(ctx, state.service.name),
      });
    } catch (error) {
      ctx.report({ kind: "step-finished", step: "remove", outcome: "failed" });
      throw removeFailedError("Failed to remove service", error);
    }
    ctx.report({ kind: "step-finished", step: "remove", outcome: "ok" });

    const diagnostics = await clearRemovedServiceState(
      state.stateStore,
      state.projectId,
      removedService.id,
    );

    const result: ServiceRemoveResult = {
      projectId: state.projectId,
      service: toServiceSummary(removedService),
      removed: true,
    };
    return ok(
      ctx.present({ data: result, diagnostics }, removePresentations(result)),
    );
  },
});
