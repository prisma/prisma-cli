import type { CommandContext, Credentials } from "../context";
import {
  PRESENTED,
  type Presentations,
  type PresentedResult,
  type Ui,
} from "../presentation";
import { type Diagnostic, notOk, okVoid } from "../protocol";
import { reportEvent } from "./events";
import type { Invocation, RunState } from "./invocation";
import { dependencyResolvable, missingDependencyError } from "./needs";
import { makePromptSurface } from "./prompts";

export function makeUi(colorEnabled: boolean): Ui {
  if (!colorEnabled) {
    return {
      emphasize: (text) => text,
      dim: (text) => text,
      code: (text) => `\`${text}\``,
    };
  }
  return {
    emphasize: (text) => `\u001b[1m${text}\u001b[22m`,
    dim: (text) => `\u001b[2m${text}\u001b[22m`,
    code: (text) => `\`${text}\``,
  };
}

/** Materializes ONLY the active format's presentation functions, at the
 *  return site: human → human + stdout + next; json → json + next. */
function materializePresentation(
  state: RunState,
  ui: Ui,
  presentations: Presentations,
): PresentedResult<unknown>["presentation"] {
  if (state.format === "json") {
    return {
      json: presentations.json?.(),
      next: presentations.next?.(),
    };
  }
  return {
    human: presentations.human(ui),
    stdout: presentations.stdout?.(),
    next: presentations.next?.(),
  };
}

export function makeContext(
  invocation: Invocation,
  config: unknown,
): CommandContext<unknown, number> {
  const state = invocation.state;
  const ui = makeUi(state.colorEnabled);
  const present = <T>(
    outcome: {
      readonly data: T;
      readonly exitCode?: number;
      readonly diagnostics?: readonly Diagnostic[];
    },
    presentations: Presentations,
  ): PresentedResult<T> => {
    const exitCode = outcome.exitCode ?? 0;
    const diagnostics = outcome.diagnostics ?? [];
    if (
      exitCode === 0 &&
      diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ) {
      throw new Error(
        "@prisma/cli-engine: a severity-'error' diagnostic requires a non-zero exitCode; a genuine could-not-complete belongs in notOk",
      );
    }
    return Object.freeze({
      [PRESENTED]: true as const,
      data: outcome.data,
      exitCode,
      diagnostics,
      presentation: materializePresentation(state, ui, presentations),
    });
  };
  return {
    config,
    present: present as CommandContext<unknown, number>["present"],
    getCredentials: (): Promise<Credentials | undefined> =>
      invocation.runtime.getCredentials(),
    report: (event) => reportEvent(invocation, event),
    prompt: makePromptSurface(invocation),
    signal: invocation.signal,
    cwd: invocation.runtime.cwd,
    env: invocation.runtime.env,
    requireDependency: async (specifier) =>
      dependencyResolvable(specifier, invocation.runtime.cwd)
        ? okVoid()
        : notOk(
            missingDependencyError(
              specifier,
              invocation.runtime.packageManager,
            ),
          ),
  };
}
