import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { domainTargetArgs } from "./domain-shared";
import { domainCommandError } from "./errors";
import { domainAddPresentations } from "./presentation";
import type { ServiceDomainAddResult } from "./results";
import {
  listDomainEntries,
  normalizeDomainHostname,
  representativeDomain,
  resolveServiceDomainTarget,
  toServiceDomainSummary,
} from "./target";

export const serviceDomainAddCommand = defineCommand({
  help: {
    summary: "Register a custom domain on the selected service branch",
    description:
      "Points a hostname you own at the service, alongside its generated URL. The command succeeds before DNS is set up and prints the records to publish: a TXT record that proves this workspace owns the domain, and a CNAME that routes the hostname. Publish them, then run 'service domain wait'. Adding a hostname also creates the workspace's domain ownership for it, which the TXT record verifies; deleting the hostname leaves the domain ownership in the workspace. Keep the TXT record for other hostnames in this workspace. Adding a hostname the service already has shows it as it stands.",
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

    const existing = representativeDomain(
      await listDomainEntries(
        target.provider,
        target.resultTarget,
        hostname,
        "add",
        ctx.signal,
      ),
    );
    const domain =
      existing ??
      (await target.provider
        .addDomain({
          appId: target.service.id,
          hostname,
          signal: ctx.signal,
        })
        .catch((error) => {
          throw domainCommandError("add", error, hostname, target.resultTarget);
        }));

    const result: ServiceDomainAddResult = {
      ...target.resultTarget,
      domain: toServiceDomainSummary(domain),
      existing: existing !== undefined,
    };
    return ok(ctx.present({ data: result }, domainAddPresentations(result)));
  },
});
