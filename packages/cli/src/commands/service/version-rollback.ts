import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  userCancelledError,
} from "./errors";
import { rollbackPresentations } from "./presentation";
import {
  promoteProgressReporter,
  requireVersionForService,
  resolveRollbackTarget,
} from "./release";
import type { ServiceRollbackResult } from "./results";
import {
  resolveCurrentLiveVersionId,
  resolveServiceReadState,
  toServiceSummary,
} from "./target";

export const serviceVersionRollbackCommand = defineCommand({
  help: {
    summary: "Roll back production to a previous service version",
    examples: [
      "service version rollback my-service",
      "service version rollback my-service --to cpv_123",
      "service version rollback my-service --to cpv_123 --confirm cpv_123",
    ],
  },
  args: {
    flags: {
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch the service lives on (default: the default branch)",
        placeholder: "name",
      }),
      to: flag.string({
        brief:
          "Version id to roll back to (default: the version before the live one)",
        placeholder: "version",
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
      commandName: "service version rollback",
    });

    const deploymentsResult = await state.provider
      .listDeployments(state.service.id, { signal: ctx.signal })
      .catch((error) => {
        throw deployFailedError("Failed to list service versions", error, [
          runCommandAction(
            "List versions",
            `service version list ${state.service.name}`,
          ),
        ]);
      });
    const currentLiveDeploymentId = resolveCurrentLiveVersionId(
      deploymentsResult.app,
      deploymentsResult.deployments,
    );
    const targetVersion = args.flags.to
      ? requireVersionForService(
          deploymentsResult.deployments,
          args.flags.to,
          state.service.name,
        )
      : resolveRollbackTarget(
          deploymentsResult.deployments,
          currentLiveDeploymentId,
          state.service.name,
        );

    const granted = await ctx.prompt.consent(
      `Roll back Service "${state.service.name}" to version ${targetVersion.id} and make it live?`,
      { token: targetVersion.id },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Service rollback canceled");
    }

    const alreadyLive = currentLiveDeploymentId === targetVersion.id;

    if (!alreadyLive) {
      ctx.report({ kind: "step-started", step: "rollback" });
      try {
        await state.provider.promoteDeployment({
          appId: state.service.id,
          deploymentId: targetVersion.id,
          signal: ctx.signal,
          progress: promoteProgressReporter(ctx, targetVersion.id),
        });
      } catch (error) {
        ctx.report({
          kind: "step-finished",
          step: "rollback",
          outcome: "failed",
        });
        throw deployFailedError("Failed to roll back version", error, [
          runCommandAction(
            "List versions",
            `service version list ${state.service.name}`,
          ),
        ]);
      }
      ctx.report({ kind: "step-finished", step: "rollback", outcome: "ok" });
    }

    const result: ServiceRollbackResult = {
      projectId: state.projectId,
      service: toServiceSummary(deploymentsResult.app),
      version: { ...targetVersion, status: "running", live: true },
      previousLiveVersionId: currentLiveDeploymentId,
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
        rollbackPresentations(result, alreadyLive),
      ),
    );
  },
});
