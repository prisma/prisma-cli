import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { domainTargetArgs } from "./domain-shared";
import { domainCommandError } from "./errors";
import { domainShowPresentations } from "./presentation";
import type { ServiceDomainShowResult } from "./results";
import {
  normalizeDomainHostname,
  resolveDomainByHostname,
  resolveServiceDomainTarget,
  toServiceDomainSummary,
} from "./target";

export const serviceDomainShowCommand = defineCommand({
  help: {
    summary: "Show custom domain status and certificate details",
    examples: ["service domain show shop.acme.com"],
  },
  args: domainTargetArgs(),
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const hostname = normalizeDomainHostname(args.positionals.hostname);
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: `service domain show ${hostname}`,
    });
    const domain = await resolveDomainByHostname(
      target.provider,
      target.service.id,
      hostname,
      "show",
      ctx.signal,
    );
    const detail = await target.provider
      .showDomain(domain.id, { signal: ctx.signal })
      .catch((error) => {
        throw domainCommandError("show", error, hostname);
      });

    const result: ServiceDomainShowResult = {
      ...target.resultTarget,
      domain: toServiceDomainSummary(detail),
    };
    return ok(ctx.present({ data: result }, domainShowPresentations(result)));
  },
});
