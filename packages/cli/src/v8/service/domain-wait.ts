import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import type { DomainRecord } from "../../lib/app/app-provider";
import { domainTargetArgs } from "./domain-shared";
import {
  domainCommandError,
  domainVerificationFailedError,
  domainVerificationTimeoutError,
  timeoutInvalidError,
} from "./errors";
import { domainWaitPresentations } from "./presentation";
import type { ServiceDomainWaitResult } from "./results";
import type { ServiceContext } from "./target";
import {
  normalizeDomainHostname,
  resolveDomainByHostname,
  resolveServiceDomainTarget,
} from "./target";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const UNIT_MULTIPLIER_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

function parseWaitTimeout(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "0") {
    return 0;
  }
  const match = DURATION.exec(trimmed);
  if (!match) {
    throw timeoutInvalidError(value);
  }
  const amount = Number.parseInt(match[1] as string, 10);
  const multiplier = UNIT_MULTIPLIER_MS[match[2] as string] ?? 1;
  return amount * multiplier;
}

function pollIntervalMs(ctx: ServiceContext): number {
  const raw = ctx.env.PRISMA_CLI_DOMAIN_WAIT_POLL_MS;
  if (!raw) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_POLL_INTERVAL_MS;
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
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

const DURATION = /^(\d+)(ms|s|m|h)$/;

export const serviceDomainWaitCommand = defineCommand({
  help: {
    summary: "Wait until a custom domain is active or failed",
    examples: [
      "service domain wait shop.acme.com",
      "service domain wait shop.acme.com --timeout 30m",
    ],
  },
  args: {
    flags: {
      ...domainTargetArgs().flags,
      timeout: flag.string({
        brief: "Maximum time to wait",
        placeholder: "duration",
        default: "15m",
      }),
    },
    positionals: domainTargetArgs().positionals,
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const hostname = normalizeDomainHostname(args.positionals.hostname);
    const timeoutMs = parseWaitTimeout(args.flags.timeout);
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      configTarget: args.positionals.service,
      commandName: `service domain wait ${hostname}`,
    });
    const domain = await resolveDomainByHostname(
      target.provider,
      target.service.id,
      hostname,
      "wait",
      ctx.signal,
    );

    const start = Date.now();
    const deadline = start + timeoutMs;
    const interval = pollIntervalMs(ctx);
    let previousStatus: DomainRecord["status"] | null = null;
    let current = domain;

    for (;;) {
      if (previousStatus !== current.status) {
        ctx.report({
          kind: "status",
          subject: hostname,
          status: current.status,
          ...(previousStatus === null ? {} : { from: previousStatus }),
          data: {
            domainId: current.id,
            elapsedMs: Date.now() - start,
          },
        });
      }
      previousStatus = current.status;

      if (current.status === "active") {
        const result: ServiceDomainWaitResult = {
          ...target.resultTarget,
          hostname,
          status: current.status,
          liveUrl: `https://${hostname}`,
        };
        return ok(
          ctx.present({ data: result }, domainWaitPresentations(result)),
        );
      }

      if (current.status === "failed") {
        throw domainVerificationFailedError(hostname, current);
      }

      if (timeoutMs === 0 || Date.now() >= deadline) {
        throw domainVerificationTimeoutError(hostname, current.status);
      }

      // biome-ignore lint/performance/noAwaitInLoops: this polls one domain until it settles, reporting each status change in the order it happened; the sleep between reads keeps the management API request rate down.
      await sleep(
        Math.min(interval, Math.max(deadline - Date.now(), 0)),
        ctx.signal,
      );
      current = await target.provider
        .showDomain(current.id, { signal: ctx.signal })
        .catch((error) => {
          throw domainCommandError("wait", error, hostname);
        });
    }
  },
});
