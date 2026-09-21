import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  deployFailedError,
  runCommandAction,
  serviceNameRequiredError,
} from "./errors";
import { createPresentations } from "./presentation";
import type { ServiceCreateResult } from "./results";
import {
  resolveServiceProjectContext,
  serviceProvider,
  toServiceListEntry,
} from "./target";

export const serviceCreateCommand = defineCommand({
  help: {
    summary: "Create a service in a project",
    description:
      "Registers a service on a Branch ahead of its first deploy. Deploying through a connected repository or 'deploy' creates services automatically, so reach for this only when a service must exist before anything has been deployed to it.",
    examples: [
      "service create my-service",
      "service create my-service --region us-east-1 --branch main",
    ],
  },
  args: {
    positionals: {
      name: positional.string({
        brief: "Service name",
        placeholder: "name",
      }),
    },
    flags: {
      project: flag.string({
        brief:
          "Project id or name (default: the project this directory is linked to)",
        placeholder: "id-or-name",
      }),
      region: flag.string({
        brief:
          "Prisma Compute region id; set it when the service must run near a location",
        placeholder: "region",
      }),
      branch: flag.string({
        brief: "Branch to create the service on (default: the default branch)",
        placeholder: "branch",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const name = args.positionals.name.trim();
    if (!name) {
      throw serviceNameRequiredError();
    }

    const target = await resolveServiceProjectContext(ctx, args.flags.project, {
      commandName: "service create",
      ...(args.flags.branch !== undefined
        ? { branchName: args.flags.branch }
        : {}),
    });

    const created = await serviceProvider(ctx)
      .createApp({
        projectId: target.project.id,
        branchName: target.branch.name,
        name,
        ...(args.flags.region !== undefined
          ? { region: args.flags.region }
          : {}),
        signal: ctx.signal,
      })
      .catch((error) => {
        throw deployFailedError("Failed to create service", error, [
          runCommandAction("List services", "service list"),
        ]);
      });

    const result: ServiceCreateResult = {
      projectId: target.project.id,
      branch: target.branch.name,
      service: toServiceListEntry(created.service),
      existing: created.existing,
    };
    return ok(ctx.present({ data: result }, createPresentations(result)));
  },
});
