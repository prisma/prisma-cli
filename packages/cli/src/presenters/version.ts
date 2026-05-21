import { renderShow } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type { VersionResult } from "../types/version";

export function renderVersionSuccess(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: VersionResult,
): string[] {
  return renderShow(
    {
      title: "Showing CLI build and environment.",
      descriptor,
      fields: [
        { key: result.cli.name, value: result.cli.version },
        { key: "node", value: result.node.version },
        { key: "os", value: `${result.os.platform} ${result.os.arch}` },
        { key: "invocation", value: result.invocation, tone: result.invocation === "unknown" ? "dim" : "default" },
      ],
    },
    context.ui,
  );
}
