import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { changeDeploymentRunState } from "./deployment-run-state";

export const serviceDeploymentStartCommand = defineCommand({
  help: {
    summary: "Start a stopped deployment",
    examples: ["service deployment start dep_123"],
  },
  args: {
    positionals: {
      deployment: positional.string({
        brief: "Deployment id to start",
        placeholder: "deployment",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { result, diagnostics, presentations } =
      await changeDeploymentRunState(ctx, args.positionals.deployment, "start");
    return ok(ctx.present({ data: result, diagnostics }, presentations));
  },
});
