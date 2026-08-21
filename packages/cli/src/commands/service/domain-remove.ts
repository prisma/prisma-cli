import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { domainTargetArgs } from "./domain-shared";
import { domainCommandError, userCancelledError } from "./errors";
import { domainRemovePresentations } from "./presentation";
import type { ServiceDomainRemoveResult } from "./results";
import {
  normalizeDomainHostname,
  resolveDomainByHostname,
  resolveServiceDomainTarget,
} from "./target";

export const serviceDomainRemoveCommand = defineCommand({
  help: {
    summary: "Detach a custom domain from the service",
    examples: [
      "service domain remove shop.acme.com",
      "service domain remove shop.acme.com --confirm shop.acme.com",
    ],
  },
  args: domainTargetArgs(),
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const hostname = normalizeDomainHostname(args.positionals.hostname);
    const target = await resolveServiceDomainTarget(ctx, {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      branchName: args.flags.branch,
      commandName: `service domain remove ${hostname}`,
    });
    const domain = await resolveDomainByHostname(
      target.provider,
      target.service.id,
      hostname,
      "remove",
      ctx.signal,
    );

    const granted = await ctx.prompt.consent(
      `Detach ${hostname} from Service "${target.resultTarget.service.name}"?`,
      { token: hostname },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Custom domain removal canceled");
    }

    await target.provider
      .removeDomain(domain.id, { signal: ctx.signal })
      .catch((error) => {
        throw domainCommandError("remove", error, hostname);
      });

    const result: ServiceDomainRemoveResult = {
      ...target.resultTarget,
      hostname,
      removed: true,
    };
    return ok(ctx.present({ data: result }, domainRemovePresentations(result)));
  },
});
