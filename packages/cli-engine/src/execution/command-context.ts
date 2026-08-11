import type { AnyCommand } from "../commands";
import type { CommandContext } from "../context";
import type {
  ActiveCredential,
  CredentialManager,
} from "../credential-manager";
import type { ManagementApiClient } from "../management-api";
import { resolvePackageManager } from "../package-manager";
import {
  PRESENTED,
  type Presentations,
  type PresentedResult,
  type Ui,
} from "../presentation";
import { type Diagnostic, notOk, okVoid } from "../protocol";
import { buildManagementApiClient } from "./api-client";
import { constructionError } from "./command-tree";
import type { Invocation, RunState } from "./engine";
import { dependencyResolvable, missingDependencyError } from "./needs";
import { announceUrl } from "./open-url";
import { makePackageOperations } from "./package-operations";
import { makePromptSurface } from "./prompts";
import { reportEvent } from "./reporting";
import { makeSpawn } from "./spawn";

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
      human: [],
      stdout: [],
      json: presentations.json?.(),
      next: presentations.next?.() ?? [],
    };
  }
  return {
    human: presentations.human(ui),
    stdout: presentations.stdout?.() ?? [],
    json: undefined,
    next: presentations.next?.() ?? [],
  };
}

/** The capability flags the command declared: each one adds a surface
 *  to the context and nothing else. */
export interface CommandCapabilities {
  readonly managesCredentials: boolean;
  readonly installsPackages: boolean;
}

export function makeContext(
  invocation: Invocation,
  def: AnyCommand,
  config: unknown,
  capabilities: CommandCapabilities,
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
    if (state.delegatedTerminal !== undefined) {
      throw constructionError(
        `command '${state.commandId}' called ctx.present while a child owned the terminal`,
      );
    }
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
  let api: ManagementApiClient | undefined;
  const context: CommandContext<unknown, number> = {
    config,
    present: present as CommandContext<unknown, number>["present"],
    activeCredential: (): Promise<ActiveCredential | null> =>
      invocation.runtime.credentialManager?.activeCredential() ??
      Promise.resolve(null),
    get api(): ManagementApiClient {
      api ??=
        invocation.hooks.managementApi?.client ??
        buildManagementApiClient(invocation);
      return api;
    },
    spawn: makeSpawn(invocation, def),
    report: (event) => reportEvent(invocation, event),
    prompt: makePromptSurface(invocation),
    openUrl: (request) => announceUrl(invocation, request),
    signal: invocation.signal,
    cwd: invocation.runtime.cwd,
    env: invocation.runtime.env,
    requireDependency: async (specifier) => {
      if (dependencyResolvable(specifier, invocation.runtime.cwd)) {
        return okVoid();
      }
      const manager = await resolvePackageManager({
        cwd: invocation.runtime.cwd,
        env: invocation.runtime.env,
        host: invocation.runtime.packageManager,
      });
      return notOk(missingDependencyError(specifier, manager));
    },
  };
  if (capabilities.managesCredentials) {
    Object.defineProperty(context, "credentialManager", {
      enumerable: true,
      get(): CredentialManager {
        const manager = invocation.runtime.credentialManager;
        if (manager === undefined) {
          throw new Error(
            "@prisma/cli-engine: the command declares managesCredentials but the Runtime supplies no credentialManager",
          );
        }
        return manager;
      },
    });
  }
  if (capabilities.installsPackages) {
    // Unlike credentials, a Runtime with no runner is not an error
    // here: the operation is offered, and reports the structured
    // failure when it is called.
    Object.defineProperty(context, "packages", {
      enumerable: true,
      value: makePackageOperations(invocation),
    });
  }
  return context;
}
