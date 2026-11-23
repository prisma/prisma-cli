import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { DomainApiError } from "../../lib/app/app-provider";
import { domainTargetArgs } from "./domain-shared";
import { domainCommandError, domainRetryRateLimitedError } from "./errors";
import { domainRetryPresentations } from "./presentation";
import type { ServiceDomainRetryResult } from "./results";
import {
  normalizeDomainHostname,
  resolveDomainByHostname,
  resolveServiceDomainTarget,
  toServiceDomainSummary,
} from "./target";

export const serviceDomainRetryCommand = defineCommand({
  help: {
    summary: "Check a custom domain's DNS again and retry a failed certificate",
    description:
      "Run it after publishing or fixing the DNS records that 'service domain show' reports. It looks the records up again, and when the TLS certificate failed it orders a new one. When the API answers that a limit is reached, the command fails and says when to run it again.",
    examples: ["service domain retry shop.acme.com --service my-service"],
  },
  args: domainTargetArgs(),
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const hostname = normalizeDomainHostname(
      args.positionals.hostname,
      args.flags.branch,
    );
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: `service domain retry ${hostname}`,
    });
    const domain = await resolveDomainByHostname(
      target.provider,
      target.resultTarget,
      hostname,
      "retry",
      ctx.signal,
    );
    const retried = await target.provider
      .checkDomain(domain.id, { signal: ctx.signal })
      .catch((error) => {
        if (error instanceof DomainApiError && error.status === 429) {
          throw domainRetryRateLimitedError(
            hostname,
            error,
            target.resultTarget,
          );
        }
        throw domainCommandError("retry", error, hostname, target.resultTarget);
      });

    const result: ServiceDomainRetryResult = {
      ...target.resultTarget,
      domain: toServiceDomainSummary(retried),
    };
    return ok(ctx.present({ data: result }, domainRetryPresentations(result)));
  },
});
