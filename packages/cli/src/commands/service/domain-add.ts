import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { domainTargetArgs } from "./domain-shared";
import { domainCommandError } from "./errors";
import { domainAddPresentations } from "./presentation";
import type { ServiceDomainAddResult } from "./results";
import {
  normalizeDomainHostname,
  resolveServiceDomainTarget,
  toServiceDomainSummary,
} from "./target";

export const serviceDomainAddCommand = defineCommand({
  help: {
    summary: "Register a custom domain on the service's production branch",
    description:
      "Points a hostname you own at the service instead of its generated URL. After registering, create the DNS record the platform asks for, then 'service domain wait' blocks until verification and TLS provisioning finish.",
    examples: ["service domain add shop.acme.com --service my-service"],
  },
  args: domainTargetArgs(),
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const hostname = normalizeDomainHostname(args.positionals.hostname);
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: `service domain add ${hostname}`,
    });

    const added = await target.provider
      .addDomain({
        appId: target.service.id,
        hostname,
        signal: ctx.signal,
      })
      .catch((error) => {
        throw domainCommandError("add", error, hostname);
      });

    const result: ServiceDomainAddResult = {
      ...target.resultTarget,
      domain: toServiceDomainSummary(added.domain),
      existing: added.existing,
    };
    return ok(ctx.present({ data: result }, domainAddPresentations(result)));
  },
});
