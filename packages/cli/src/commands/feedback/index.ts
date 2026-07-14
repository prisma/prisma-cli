import { Command, Option } from "commander";

import { type FeedbackFlags, runFeedback } from "../../controllers/feedback";
import { renderFeedbackSuccess } from "../../presenters/feedback";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import { addGlobalFlags } from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type { FeedbackResult } from "../../types/feedback";

export function createFeedbackCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("feedback"), runtime),
    "feedback",
  );

  command
    .argument("<message>", "Feedback text (up to 4000 characters)")
    .addOption(
      new Option(
        "--email <address>",
        "Contact email if you want a reply; feedback is anonymous without it",
      ),
    );
  addGlobalFlags(command);

  command.action(async (message: string, options) => {
    const flags = options as FeedbackFlags;

    await runCommand<FeedbackResult>(
      runtime,
      "feedback",
      options as Record<string, unknown>,
      (context) => runFeedback(context, message, { email: flags.email }),
      {
        renderHuman: (context, descriptor, result) =>
          renderFeedbackSuccess(context, descriptor, result),
      },
    );
  });

  return command;
}
