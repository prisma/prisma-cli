import { defineCommand, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { changeVersionRunState } from "./version-run-state";

export const serviceVersionStartCommand = defineCommand({
  help: {
    summary: "Start a stopped service version",
    examples: ["service version start cpv_123"],
  },
  args: {
    positionals: {
      version: positional.string({
        brief: "Version id to start",
        placeholder: "version",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const { result, diagnostics, presentations } = await changeVersionRunState(
      ctx,
      args.positionals.version,
      "start",
    );
    return ok(ctx.present({ data: result, diagnostics }, presentations));
  },
});
