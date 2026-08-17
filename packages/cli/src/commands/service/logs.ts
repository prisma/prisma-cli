import type { CommandContext } from "@prisma/cli-engine";
import { defineSessionCommand, flag, positional } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import type { AppProvider, AppRecord } from "../../lib/app/app-provider";
import { forEachNdjsonRecord } from "../../lib/ndjson";
import {
  adviceAction,
  deployFailedError,
  deploymentDetachedError,
  deploymentNotFoundError,
  deploymentOutsideProjectError,
  logsRangeConflictError,
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

const TRAILING_NEWLINE = /\n$/;

/** The endpoint's own default page size, restated so `--tail` and the
 *  unflagged run send the same shape of request. */
const DEFAULT_TAIL = 100;

/** Contract: poll every 2s in --follow. Overridable so a test drives the
 *  loop without waiting, the way `service domain wait` does. */
const DEFAULT_POLL_INTERVAL_MS = 2000;

function pollIntervalMs(ctx: ServiceContext): number {
  const raw = ctx.env.PRISMA_CLI_SERVICE_LOGS_POLL_MS;
  if (!raw) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_POLL_INTERVAL_MS;
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
    signal.throwIfAborted();
    return;
  }
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One line of `GET /v1/deployments/{deploymentId}/logs`. A page is a run
 * of `log` records closed by exactly one `terminal`, whose cursor is
 * where the next page starts.
 */
type DeploymentLogRecord =
  | { type: "log"; text: string; byteStart: number; byteEnd: number }
  | {
      type: "terminal";
      kind: "end" | "error";
      code: string;
      message: string;
      retryable: boolean;
      cursor: string | null;
    };

type TerminalRecord = Extract<DeploymentLogRecord, { type: "terminal" }>;

interface LogTarget {
  service: AppRecord;
  deployment: ServiceDeploymentSummary;
}

function logsFailedError(
  deploymentId: string,
  status: number,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.LOGS_FAILED",
    `Failed to read logs for deployment ${deploymentId}`,
    {
      why: `The Management API returned HTTP ${status}.`,
      meta: { status },
      nextActions: [
        adviceAction(
          "Retry the command, or rerun with --log-level verbose for more detail.",
        ),
        runCommandAction(
          "Show the deployment",
          `service deployment show ${deploymentId}`,
        ),
      ],
    },
  );
}

/**
 * The body ended mid-page, without the terminal record that closes one.
 * Distinct from SERVICE.LOGS_NO_CURSOR, which is a page that closed
 * properly and said there is nothing to resume from: this one is an
 * incomplete read, and the lines already printed are not the whole page.
 */
function logsIncompleteError(deploymentId: string): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.LOGS_INCOMPLETE",
    `Incomplete log page for deployment ${deploymentId}`,
    {
      why: "The response ended without the record that closes a page, so the lines shown may be only part of it.",
      nextActions: [adviceAction("Rerun the command to read the page again.")],
    },
  );
}

/** An error terminal record is the platform reporting that the log read
 *  itself failed, so it settles the run rather than printing. */
function logStreamFailedError(
  deploymentId: string,
  record: TerminalRecord,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.LOGS_FAILED",
    `Log stream failed for deployment ${deploymentId}`,
    {
      why: record.message,
      meta: {
        code: record.code,
        retryable: record.retryable,
        ...(record.cursor === null ? {} : { cursor: record.cursor }),
      },
      nextActions: [
        runCommandAction(
          "Show the deployment",
          `service deployment show ${deploymentId}`,
        ),
      ],
    },
  );
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
        runCommandAction("List deployments", "service deployment list"),
      ]);
    });
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
        "No deployments available to read logs from",
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
        runCommandAction("List deployments", "service deployment list"),
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

/** No `--deployment`: read whatever is live for the selected service. */
async function resolveLiveDeployment(
  ctx: ServiceContext,
  state: ServiceReadState,
): Promise<LogTarget> {
  if (!state.selected) {
    throw noDeploymentsError(
      "No deployments available to read logs from",
      "The resolved project does not have any deployed service yet.",
    );
  }

  const deploymentsResult = await listDeployments(
    ctx,
    state.provider,
    state.selected.id,
  );
  const currentLiveDeploymentId = resolveCurrentLiveDeploymentId(
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
      "No deployments available to read logs from",
      `The selected service "${deploymentsResult.app.name}" does not have a live deployment.`,
    );
  }
  return { service: deploymentsResult.app, deployment };
}

/**
 * Reads one page and reports its log records. Returns the terminal
 * record that closed it — the caller decides whether that ends the run
 * or starts the next page.
 *
 * Every page ends with a terminal record, so a body that stops without
 * one was truncated. The lines that did arrive have already been
 * reported, but the run must not settle as though it had read the whole
 * page: the user would have a partial log and no way to tell.
 */
async function readPage(
  ctx: CommandContext,
  deploymentId: string,
  query: { tail?: number; from_start?: "true"; cursor?: string },
): Promise<TerminalRecord> {
  const { data, response } = await ctx.api.GET(
    "/v1/deployments/{deploymentId}/logs",
    {
      params: { path: { deploymentId }, query },
      parseAs: "stream",
      signal: ctx.signal,
    },
  );

  const body = data as ReadableStream<Uint8Array> | null | undefined;
  if (!response.ok || !body) {
    await body?.cancel().catch(() => undefined);
    throw response.status === 404
      ? deploymentNotFoundError(deploymentId)
      : logsFailedError(deploymentId, response.status);
  }

  let terminal: TerminalRecord | null = null;
  await forEachNdjsonRecord<DeploymentLogRecord>(body, (record) => {
    if (record.type === "terminal") {
      terminal = record;
      return;
    }
    ctx.report({
      kind: "output",
      source: "logs",
      channel: "data",
      line: record.text.replace(TRAILING_NEWLINE, ""),
      data: { byteStart: record.byteStart, byteEnd: record.byteEnd },
    });
  });
  if (terminal === null) {
    throw logsIncompleteError(deploymentId);
  }
  return terminal;
}

/**
 * Following needs somewhere to resume from. Without a cursor the next
 * request would carry no range at all, the endpoint would apply its
 * default tail, and the same lines would print again every interval —
 * silent duplication the user cannot act on. So the run stops and says
 * why. It settles as an error rather than a clean end because `--follow`
 * has no successful ending: it runs until interrupted (130) or fails,
 * and an exit 0 here would be a novel outcome meaning "gave up".
 */
function requireResumeCursor(
  deploymentId: string,
  cursor: string | null,
): string {
  if (cursor === null) {
    throw new CliStructuredError(
      "SERVICE.LOGS_NO_CURSOR",
      `Cannot follow logs for deployment ${deploymentId}`,
      {
        why: "The log page ended without a resume cursor, so there is no point to continue reading from.",
        nextActions: [
          adviceAction(
            "Rerun without --follow to read the page, or retry if the deployment is still starting.",
          ),
        ],
      },
    );
  }
  return cursor;
}

/**
 * `--follow`: wait the poll interval, read the next page from the cursor
 * the last one ended on, repeat until the user interrupts. Never
 * returns — the run ends by abort (the engine settles 130) or by throw.
 */
async function followPages(
  ctx: CommandContext,
  deploymentId: string,
  startCursor: string | null,
): Promise<never> {
  const interval = pollIntervalMs(ctx);
  let cursor = requireResumeCursor(deploymentId, startCursor);
  // One retry, not a loop: a retryable error that keeps happening is a
  // persistent failure, and hammering it would hide that. Any page that
  // succeeds restores the budget, so a long follow survives repeated
  // transients without ever looping on a persistent one.
  let retriedAfterError = false;

  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: --follow polls one page at a time; the wait between reads is the point, and each page starts at the cursor the previous one ended on.
    await sleep(interval, ctx.signal);
    const next = await readPage(ctx, deploymentId, { cursor });

    if (next.kind === "error") {
      if (!next.retryable || retriedAfterError) {
        throw logStreamFailedError(deploymentId, next);
      }
      retriedAfterError = true;
      continue;
    }
    retriedAfterError = false;
    cursor = requireResumeCursor(deploymentId, next.cursor);
  }
}

export const serviceLogsCommand = defineSessionCommand({
  help: {
    summary: "Read logs for a deployment of the service",
    examples: [
      "service logs",
      "service logs --tail 500",
      "service logs --follow",
      "service logs --deployment dep_123 --from-start",
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
        brief: "Deployment id to read (default: the live deployment)",
        placeholder: "id",
      }),
      tail: flag.number({
        brief: `Read the last N lines (default ${DEFAULT_TAIL})`,
        placeholder: "n",
      }),
      fromStart: flag.boolean({
        brief: "Read from the beginning instead of the last lines",
      }),
      follow: flag.boolean({
        brief: "Keep polling for new lines until interrupted",
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
    // Refused before any work: the two ask for opposite ends of the log,
    // so a run naming both has no answer to give.
    if (args.flags.fromStart && args.flags.tail !== undefined) {
      throw logsRangeConflictError();
    }

    // "A service was named" — by --service or by the config target. It
    // decides whether an explicit deployment id is looked up within that
    // service or resolved globally, and a global lookup needs no service
    // selection at all (so it never prompts for one).
    const serviceNamed = args.flags.service ?? args.positionals.service;
    const resolveGlobally = Boolean(args.flags.deployment) && !serviceNamed;
    const state = await resolveServiceReadState(ctx, {
      ...(args.flags.service !== undefined
        ? { serviceName: args.flags.service }
        : {}),
      ...(args.flags.project !== undefined
        ? { projectRef: args.flags.project }
        : {}),
      ...(args.positionals.service !== undefined
        ? { configTarget: args.positionals.service }
        : {}),
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
    const deploymentId = target.deployment.id;

    for (const line of [
      `project: ${state.projectId}`,
      `service: ${target.service.name}`,
      `deployment: ${deploymentId}`,
    ]) {
      ctx.report({
        kind: "output",
        source: "logs",
        channel: "diagnostic",
        line,
      });
    }

    const firstPageQuery: { tail?: number; from_start?: "true" } = args.flags
      .fromStart
      ? { from_start: "true" }
      : { tail: args.flags.tail ?? DEFAULT_TAIL };

    const terminal = await readPage(ctx, deploymentId, firstPageQuery);
    if (terminal.kind === "error") {
      throw logStreamFailedError(deploymentId, terminal);
    }
    if (!args.flags.follow) {
      // The routine terminal record ends the page. Its cursor is the
      // CLI's to resume from, not something the user is asked to carry.
      return ok(undefined);
    }

    return followPages(ctx, deploymentId, terminal.cursor);
  },
});
