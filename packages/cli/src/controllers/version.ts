import { buildVersionResult } from "../lib/version";
import type { CommandSuccess } from "../shell/output";
import type { CommandContext } from "../shell/runtime";
import type { VersionResult } from "../types/version";

export async function runVersion(
  context: CommandContext,
): Promise<CommandSuccess<VersionResult>> {
  const result = buildVersionResult(context.runtime.env, context.runtime.argv);

  return {
    command: "version",
    result,
    warnings: [],
    nextSteps: [],
  };
}
