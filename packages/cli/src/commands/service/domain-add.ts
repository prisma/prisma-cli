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
    summary: "Register a custom domain on the selected service branch",
    description:
      "Points a hostname you own at the service instead of its generated URL. Add the routing CNAME and workspace TXT record shown by Console or the verification error, then rerun this command. Keep the TXT record for future attachments in this workspace. Use 'service domain wait' to wait for TLS provisioning.",
    examples: [
      "service domain add shop.acme.com --service my-service",
      "service domain add staging.acme.com --service my-service --branch staging",
    ],
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
      commandName: `service domain add ${hostname}`,
    });

    const added = await target.provider
      .addDomain({
        appId: target.service.id,
        hostname,
        signal: ctx.signal,
      })
      .catch((error) => {
        throw domainCommandError("add", error, hostname, target.resultTarget);
      });

    const result: ServiceDomainAddResult = {
      ...target.resultTarget,
      domain: toServiceDomainSummary(added.domain),
      existing: added.existing,
    };
    return ok(ctx.present({ data: result }, domainAddPresentations(result)));
  },
});
