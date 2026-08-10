import { defineSessionCommand, flag, positional } from "@prisma/cli-engine";
import { okVoid } from "@prisma/cli-engine/protocol";
import { CancelledError, streamLogs } from "@prisma/compute-sdk";
import { getApiBaseUrl } from "../../auth";
import type { AppProvider, AppRecord } from "../../lib/app/app-provider";
import {
  deployFailedError,
  deploymentDetachedError,
  deploymentNotFoundError,
  deploymentOutsideProjectError,
  logStreamCredentialsError,
  noDeploymentsError,
  runCommandAction,
} from "./errors";
import { requireDeploymentForService } from "./release";
import type { ServiceDeploymentSummary } from "./results";
import type { ServiceContext, ServiceReadState } from "./target";
import {
  applyLiveDeploymentHint,
  listServices,
  rememberSelectedService,
  resolveCurrentLiveDeploymentId,
  resolveServiceReadState,
} from "./target";

interface LogTarget {
  service: AppRecord;
  deployment: ServiceDeploymentSummary;
}

/** `--deployment <id>`: the id is global, so it is resolved directly and
 *  then checked against the resolved project — a deployment that exists
 *  but belongs elsewhere is reported as its own failure. */
async function resolveExplicitDeployment(
  ctx: ServiceContext,
  state: ServiceReadState,
  serviceName: string | undefined,
  deploymentId: string,
): Promise<LogTarget> {
  if (serviceName) {
    if (!state.selected) {
      throw noDeploymentsError(
        "No deployments available to stream logs",
        "The resolved project does not have any deployed service yet.",
      );
    }
    const deploymentsResult = await listDeployments(
      ctx,
      state.provider,
      state.selected.id,
    );
    const deployment = requireDeploymentForService(
      deploymentsResult.deployments,
      deploymentId,
      state.selected.name,
    );
    await rememberSelectedService(
      state.stateStore,
      state.projectId,
      deploymentsResult.app,
    );
    return { service: deploymentsResult.app, deployment };
  }

  const shown = await state.provider
    .showDeployment(deploymentId, { signal: ctx.signal })
    .catch((error) => {
      throw deployFailedError("Failed to show deployment", error, [
        runCommandAction("List deployments", "service list-deploys"),
      ]);
    });
  if (!shown) {
    throw deploymentNotFoundError(deploymentId);
  }
  if (!shown.app) {
    throw deploymentDetachedError(deploymentId);
  }

  const services = await listServices(
    ctx,
    state.provider,
    state.projectId,
    state.target.branch.name,
  );
  const owning = services.find((service) => service.id === shown.app?.id);
  if (!owning) {
    throw deploymentOutsideProjectError(deploymentId);
  }

  await rememberSelectedService(state.stateStore, state.projectId, owning);
  return { service: owning, deployment: shown.deployment };
}

/** No `--deployment`: stream whatever is live for the selected service. */
async function resolveLiveDeployment(
  ctx: ServiceContext,
  state: ServiceReadState,
): Promise<LogTarget> {
  if (!state.selected) {
    throw noDeploymentsError(
      "No deployments available to stream logs",
      "The resolved project does not have any deployed service yet.",
    );
  }

  const deploymentsResult = await listDeployments(
    ctx,
    state.provider,
    state.selected.id,
  );
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    state.stateStore,
    state.projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const deployments = applyLiveDeploymentHint(
    deploymentsResult.deployments,
    currentLiveDeploymentId,
  );
  const deployment = currentLiveDeploymentId
    ? (deployments.find(
        (candidate) => candidate.id === currentLiveDeploymentId,
      ) ?? null)
    : null;

  await rememberSelectedService(
    state.stateStore,
    state.projectId,
    deploymentsResult.app,
  );

  if (!deployment) {
    throw noDeploymentsError(
      "No deployments available to stream logs",
      `The selected service "${deploymentsResult.app.name}" does not have any deployments yet.`,
    );
  }
  return { service: deploymentsResult.app, deployment };
}

function listDeployments(
  ctx: ServiceContext,
  provider: AppProvider,
  serviceId: string,
) {
  return provider
    .listDeployments(serviceId, { signal: ctx.signal })
    .catch((error): never => {
      throw deployFailedError("Failed to list service deployments", error, [
        runCommandAction("List deployments", "service list-deploys"),
      ]);
    });
}

export const serviceLogsCommand = defineSessionCommand({
  help: {
    summary: "Stream logs for a deployment of the service",
    examples: [
      "service logs",
      "service logs --service my-service",
      "service logs --deployment dep_123",
    ],
  },
  args: {
    flags: {
      service: flag.string({ brief: "Service name", placeholder: "name" }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      deployment: flag.string({
        brief: "Deployment id to stream (default: the live deployment)",
        placeholder: "id",
      }),
    },
    positionals: {
      service: positional.optionalString({
        brief:
          "Service target from prisma.compute.ts when the config defines multiple services",
        placeholder: "service",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    // "A service was named" — by --service or by the config target. It
    // decides whether an explicit deployment id is looked up within that
    // service or resolved globally, and a global lookup needs no service
    // selection at all (so it never prompts for one).
    const serviceNamed = args.flags.service ?? args.positionals.service;
    const resolveGlobally = Boolean(args.flags.deployment) && !serviceNamed;
    const state = await resolveServiceReadState(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      configTarget: args.positionals.service,
      commandName: "service logs",
      skipSelection: resolveGlobally,
    });

    const target = args.flags.deployment
      ? await resolveExplicitDeployment(
          ctx,
          state,
          serviceNamed,
          args.flags.deployment,
        )
      : await resolveLiveDeployment(ctx, state);

    for (const line of [
      `project: ${state.projectId}`,
      `service: ${target.service.name}`,
      `deployment: ${target.deployment.id}`,
    ]) {
      ctx.report({
        kind: "output",
        source: "logs",
        channel: "diagnostic",
        line,
      });
    }

    // The log stream authenticates itself rather than going through the
    // Management API client, so it needs the raw token. ctx.getCredentials
    // is the engine's sanctioned accessor for it.
    const credentials = await ctx.getCredentials();
    if (!credentials) {
      throw logStreamCredentialsError();
    }

    const result = await streamLogs(
      {
        baseUrl: getApiBaseUrl(ctx.env),
        token: credentials.token,
        deploymentId: target.deployment.id,
        signal: ctx.signal,
      },
      (record) => {
        if (record.type === "log") {
          ctx.report({
            kind: "output",
            source: "logs",
            channel: "data",
            line: record.text.replace(/\n$/, ""),
          });
          return;
        }
        // A terminal `end` is the normal close; anything else carries a
        // message the user should see.
        if (record.code !== "end") {
          ctx.report({
            kind: "output",
            source: "logs",
            channel: "diagnostic",
            line: record.message,
          });
        }
      },
    );

    if (result.isErr() && !CancelledError.is(result.error)) {
      // Stopping a log stream is an expected user action, not a failure.
      throw deployFailedError("Failed to stream service logs", result.error, [
        runCommandAction(
          "Show the deployment",
          `service show-deploy ${target.deployment.id}`,
        ),
        runCommandAction("List deployments", "service list-deploys"),
      ]);
    }

    return okVoid();
  },
});
