import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { domainTargetArgs } from "./domain-shared";
import { domainCommandError } from "./errors";
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
    summary: "Retry custom domain DNS verification and TLS provisioning",
    description:
      "Run it after fixing what made the domain fail, typically a missing or wrong DNS record reported by 'service domain show'.",
    examples: ["service domain retry shop.acme.com --service my-service"],
  },
  args: domainTargetArgs(),
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const hostname = normalizeDomainHostname(args.positionals.hostname);
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: `service domain retry ${hostname}`,
    });
    const domain = await resolveDomainByHostname(
      target.provider,
      target.service.id,
      hostname,
      "retry",
      ctx.signal,
    );
    const retried = await target.provider
      .retryDomain(domain.id, { signal: ctx.signal })
      .catch((error) => {
        throw domainCommandError("retry", error, hostname);
      });

    const result: ServiceDomainRetryResult = {
      ...target.resultTarget,
      domain: toServiceDomainSummary(retried),
    };
    return ok(ctx.present({ data: result }, domainRetryPresentations(result)));
  },
});
