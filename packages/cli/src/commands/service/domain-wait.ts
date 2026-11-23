import { defineCommand, flag } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  type AppProvider,
  DomainApiError,
  type DomainRecord,
} from "../../lib/app/app-provider";
import {
  cannotBecomeActive,
  waitsForUserDns,
} from "../../lib/app/domain-guidance";
import { domainTargetArgs } from "./domain-shared";
import {
  domainCommandError,
  domainVerificationFailedError,
  domainVerificationTimeoutError,
  timeoutInvalidError,
} from "./errors";
import { domainWaitPresentations } from "./presentation";
import type { ServiceDomainTarget, ServiceDomainWaitResult } from "./results";
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

function parseWaitTimeout(
  value: string | undefined,
  branchName?: string,
): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "0") {
    return 0;
  }
  const match = DURATION.exec(trimmed);
  if (!match) {
    throw timeoutInvalidError(value, branchName);
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

/**
 * The platform looks a hostname's DNS up when it is added and when it is
 * checked, not on a timer. So while the hostname waits for records the
 * user publishes, every sixth read is a check; the reads between only
 * fetch what is stored.
 */
const READS_PER_DNS_CHECK = 6;

async function checkOrShow(
  provider: AppProvider,
  domainId: string,
  signal: AbortSignal,
): Promise<DomainRecord> {
  try {
    return await provider.checkDomain(domainId, { signal });
  } catch (error) {
    if (error instanceof DomainApiError && error.status === 429) {
      return provider.showDomain(domainId, { signal });
    }
    throw error;
  }
}

/**
 * Reads the hostname again, as a DNS check when one is due. An entry
 * that another entry holds the hostname from can never become active
 * itself, so the hostname is looked up afresh and the holder followed.
 */
function domainReader(
  provider: AppProvider,
  target: ServiceDomainTarget,
  hostname: string,
  signal: AbortSignal,
): (current: DomainRecord) => Promise<DomainRecord> {
  let readsSinceDnsCheck = READS_PER_DNS_CHECK;
  return (current) => {
    if (current.state === "in_use_elsewhere") {
      return resolveDomainByHostname(
        provider,
        target,
        hostname,
        "wait",
        signal,
      );
    }
    const checksDns =
      waitsForUserDns(current) && readsSinceDnsCheck >= READS_PER_DNS_CHECK;
    readsSinceDnsCheck = checksDns ? 1 : readsSinceDnsCheck + 1;
    return (
      checksDns
        ? checkOrShow(provider, current.id, signal)
        : provider.showDomain(current.id, { signal })
    ).catch((error) => {
      throw domainCommandError("wait", error, hostname, target);
    });
  };
}

export const serviceDomainWaitCommand = defineCommand({
  help: {
    summary: "Wait until a custom domain is active or failed",
    description:
      "Blocks until the hostname's state is 'active', looking its DNS records up again while it waits for them, then exits with the outcome; useful in scripts and CI after 'service domain add'. It fails at once when the TLS certificate failed, and on timeout it says what the hostname still waits on.",
    examples: [
      "service domain wait shop.acme.com --service my-service",
      "service domain wait shop.acme.com --service my-service --timeout 30m",
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
    const hostname = normalizeDomainHostname(
      args.positionals.hostname,
      args.flags.branch,
    );
    const timeoutMs = parseWaitTimeout(args.flags.timeout, args.flags.branch);
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: `service domain wait ${hostname}`,
    });
    const domain = await resolveDomainByHostname(
      target.provider,
      target.resultTarget,
      hostname,
      "wait",
      ctx.signal,
    );

    const start = Date.now();
    const deadline = start + timeoutMs;
    const interval = pollIntervalMs(ctx);
    let previousState: DomainRecord["state"] | null = null;
    const readAgain = domainReader(
      target.provider,
      target.resultTarget,
      hostname,
      ctx.signal,
    );
    let current = domain;

    for (;;) {
      if (previousState !== current.state) {
        ctx.report({
          kind: "status",
          subject: hostname,
          status: current.state,
          ...(previousState === null ? {} : { from: previousState }),
          data: {
            domainId: current.id,
            domainStatus: current.status,
            elapsedMs: Date.now() - start,
          },
        });
      }
      previousState = current.state;

      if (current.state === "active") {
        const result: ServiceDomainWaitResult = {
          ...target.resultTarget,
          hostname,
          status: current.status,
          state: current.state,
          liveUrl: `https://${hostname}`,
        };
        return ok(
          ctx.present({ data: result }, domainWaitPresentations(result)),
        );
      }

      if (cannotBecomeActive(current)) {
        throw domainVerificationFailedError(
          hostname,
          current,
          target.resultTarget,
        );
      }

      if (timeoutMs === 0 || Date.now() >= deadline) {
        throw domainVerificationTimeoutError(
          hostname,
          current,
          target.resultTarget,
        );
      }

      // biome-ignore lint/performance/noAwaitInLoops: this polls one domain until it settles, reporting each status change in the order it happened; the sleep between reads keeps the management API request rate down.
      await sleep(
        Math.min(interval, Math.max(deadline - Date.now(), 0)),
        ctx.signal,
      );
      current = await readAgain(current);
    }
  },
});
