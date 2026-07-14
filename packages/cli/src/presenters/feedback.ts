import { renderShow } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type { FeedbackResult } from "../types/feedback";

export function renderFeedbackSuccess(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: FeedbackResult,
): string[] {
  return renderShow(
    {
      title: "Feedback sent. Thank you!",
      descriptor,
      fields: [
        ...(result.id ? [{ key: "id", value: result.id }] : []),
        {
          key: "sent as",
          value: result.email ?? "anonymous",
          tone: result.email ? ("default" as const) : ("dim" as const),
        },
        {
          key: "included",
          value: `CLI ${result.context.cliVersion}, node ${result.context.nodeVersion}, ${result.context.platform} ${result.context.arch}`,
          tone: "dim" as const,
        },
      ],
    },
    context.ui,
  );
}
