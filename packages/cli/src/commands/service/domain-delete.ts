import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { DomainApiError } from "../../lib/app/app-provider";
import { domainTargetArgs } from "./domain-shared";
import {
  domainCommandError,
  domainNotFoundError,
  userCancelledError,
} from "./errors";
import { domainDeletePresentations } from "./presentation";
import type { ServiceDomainDeleteResult } from "./results";
import {
  listDomainEntries,
  normalizeDomainHostname,
  resolveServiceDomainTarget,
} from "./target";

/** Someone else deleted the entry between the listing and this delete. */
function isAlreadyDeleted(error: unknown): boolean {
  return error instanceof DomainApiError && error.status === 404;
}

export const serviceDomainDeleteCommand = defineCommand({
  help: {
    summary: "Delete a custom domain from the service",
    description:
      "The hostname stops routing to the service; the service itself and its generated URL keep working. Pass the hostname with --confirm to run non-interactively.",
    examples: [
      "service domain delete shop.acme.com --service my-service",
      "service domain delete shop.acme.com --service my-service --confirm shop.acme.com",
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
      commandName: `service domain delete ${hostname}`,
    });
    const entries = await listDomainEntries(
      target.provider,
      target.resultTarget,
      hostname,
      "delete",
      ctx.signal,
    );
    if (entries.length === 0) {
      throw domainNotFoundError(hostname, target.resultTarget);
    }

    const granted = await ctx.prompt.consent(
      `Delete ${hostname} from Service "${target.resultTarget.service.name}"?`,
      { token: hostname },
    );
    // A token consent resolves to true or throws (mismatch, or the
    // engine's consent-required error), so this guard only fires if that
    // contract ever loosens — never proceed with a destructive call on a
    // falsy consent.
    if (!granted) {
      throw userCancelledError("Custom domain deletion canceled");
    }

    for (const entry of entries) {
      // biome-ignore lint/performance/noAwaitInLoops: a service lists a hostname more than once only when entries were added outside the CLI, so this is almost always one request.
      await target.provider
        .removeDomain(entry.id, { signal: ctx.signal })
        .catch((error) => {
          if (isAlreadyDeleted(error)) {
            return;
          }
          throw domainCommandError(
            "delete",
            error,
            hostname,
            target.resultTarget,
          );
        });
    }

    const result: ServiceDomainDeleteResult = {
      ...target.resultTarget,
      hostname,
      deleted: true,
    };
    return ok(ctx.present({ data: result }, domainDeletePresentations(result)));
  },
});
