import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { changeDeploymentRunState } from "./deployment-run-state";

export const serviceDeploymentStopCommand = defineCommand({
  help: {
    summary: "Stop a running deployment",
    examples: [
      "service deployment stop dep_123",
      "service deployment stop dep_123 --service my-service",
    ],
  },
  args: {
    flags: {
      service: flag.string({ brief: "Service name", placeholder: "name" }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
    },
    positionals: {
      deployment: positional.string({
        brief: "Deployment id to stop",
        placeholder: "deployment",
      }),
      service: positional.optionalString({
        brief:
          "Service target from prisma.compute.ts when the config defines multiple services",
        placeholder: "service",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { result, diagnostics, presentations } =
      await changeDeploymentRunState(
        ctx,
        {
          deployment: args.positionals.deployment,
          service: args.flags.service,
          project: args.flags.project,
          configTarget: args.positionals.service,
        },
        "stop",
      );
    return ok(ctx.present({ data: result, diagnostics }, presentations));
  },
});
