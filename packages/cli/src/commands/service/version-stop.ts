import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { changeVersionRunState } from "./version-run-state";

export const serviceVersionStopCommand = defineCommand({
  help: {
    summary: "Stop a running service version",
    examples: ["service version stop cpv_123"],
  },
  args: {
    positionals: {
      version: positional.string({
        brief: "Version id to stop",
        placeholder: "version",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { result, diagnostics, presentations } = await changeVersionRunState(
      ctx,
      args.positionals.version,
      "stop",
    );
    return ok(ctx.present({ data: result, diagnostics }, presentations));
  },
});
