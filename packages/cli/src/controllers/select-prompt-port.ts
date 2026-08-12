import { selectPrompt } from "../shell/prompt";
import type { CommandContext } from "../shell/runtime";

export interface SelectChoice<T> {
  label: string;
  value: T;
}

/** The narrow prompting capability a controller needs, so that the
 *  controllers which prompt do not each reach into the shell's prompt
 *  implementation. It lived in the use-case contracts until fixture mode
 *  was retired, and is kept here because two controllers still prompt. */
export interface SelectPromptPort {
  select<T>(options: {
    message: string;
    choices: SelectChoice<T>[];
  }): Promise<T>;
}

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
