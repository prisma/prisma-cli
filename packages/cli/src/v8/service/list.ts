import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { listPresentations } from "./presentation";
import type { ServiceListResult } from "./results";
import {
  listServices,
  resolveComputeManagementContext,
  resolveServiceProjectContext,
  serviceProvider,
  toServiceListEntry,
} from "./target";

export const serviceListCommand = defineCommand({
  help: {
    summary: "List the services in a project",
    examples: ["service list", "service list --project my-app --json"],
  },
  args: {
    flags: {
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch name",
        placeholder: "branch",
      }),
    },
    positionals: {
      service: positional.optionalString({
        brief:
          "Service target from prisma.compute.ts when the config defines multiple services",
        placeholder: "service",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const compute = await resolveComputeManagementContext(
      ctx,
      args.positionals.service,
      "list",
    );
    const target = await resolveServiceProjectContext(ctx, args.flags.project, {
      commandName: "service list",
      projectDir: compute.projectDir,
      ...(args.flags.branch !== undefined
        ? { branchName: args.flags.branch }
        : {}),
    });
    const services = await listServices(
      ctx,
      serviceProvider(ctx),
      target.project.id,
      target.branch.name,
    );

    const result: ServiceListResult = {
      projectId: target.project.id,
      branch: target.branch.name,
      services: services.map(toServiceListEntry),
    };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
