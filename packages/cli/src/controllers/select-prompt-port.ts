import { selectPrompt } from "../shell/prompt";
import type { CommandContext } from "../shell/runtime";
import type { SelectPromptPort } from "../use-cases/contracts";

export function createSelectPromptPort(
  context: CommandContext,
): SelectPromptPort {
  return {
    select: ({ message, choices }) =>
      selectPrompt({
        input: context.runtime.stdin,
        output: context.runtime.stderr,
        signal: context.runtime.signal,
        message,
        choices,
      }),
  };
}
