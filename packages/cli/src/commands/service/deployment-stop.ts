import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { changeDeploymentRunState } from "./deployment-run-state";

export const serviceDeploymentStopCommand = defineCommand({
  help: {
    summary: "Stop a running deployment",
    examples: ["service deployment stop dep_123"],
  },
  args: {
    positionals: {
      deployment: positional.string({
        brief: "Deployment id to stop",
        placeholder: "deployment",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { result, diagnostics, presentations } =
      await changeDeploymentRunState(ctx, args.positionals.deployment, "stop");
    return ok(ctx.present({ data: result, diagnostics }, presentations));
  },
});
