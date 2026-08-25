import { resolveIsCI } from "../ci";
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
import type { LoadedConfigFile, OutputStream } from "../runtime";
import { buildManagementApiClient } from "./api-client";
import { constructionError } from "./command-tree";
import type { Invocation, RunState } from "./engine";
import { dependencyResolvable, missingDependencyError } from "./needs";
import { announceUrl } from "./open-url";
import { makePackageOperations } from "./package-operations";
import { makePaint } from "./palette";
import { makePromptSurface } from "./prompts";
import { reportEvent } from "./reporting";
import { makeSpawn } from "./spawn";

/** Unbounded off-terminal, so the arithmetic a renderer already does —
 *  Math.min(x, ui.width), ui.width - gutter — stays correct with no
 *  special case. */
function availableWidth(stream: OutputStream): number {
  const columns = stream.columns;
  return columns !== undefined && columns > 0
    ? columns
    : Number.POSITIVE_INFINITY;
}

/** Blocks render to stderr, so both the width and the colour decision
 *  are stderr's. `width` is a getter because the contract reads it per
 *  render rather than caching it. */
export function makeUi(colorEnabled: boolean, stderr: OutputStream): Ui {
  const paint = makePaint(colorEnabled);
  return {
    get width() {
      return availableWidth(stderr);
    },
    emphasize: (text) => paint("emphasis", text),
    dim: (text) => paint("muted", text),
    code: (text) => `\`${text}\``,
    tone: paint,
  };
}

/** Materializes ONLY the active format's presentation functions, at the
 *  return site: human → human + stdout + next; json → json + next.
 *
 *  `stdout` and `next` may be absent at runtime, so both are called with
 *  `?.()`. `Presentations` requires all four, so no command compiled
 *  against this engine can omit one — but `@prisma/orm-toolchain` is
 *  built against engine `0.0.9`, where three of the four were optional,
 *  and its published commands took that up: `migration list` declares
 *  `human` and `json` and neither of the others. Calling them
 *  unconditionally makes it exit 2 — `stdout` in human mode, `next` in
 *  both.
 *
 *  `json` is called unconditionally, and stays that way: a missing json
 *  presentation is the defect this change removes, and every ORM command
 *  already declares one.
 *
 *  This is version skew in our own code, not a foreign contract. The fix
 *  is in prisma/prisma: declare the missing presentations in the ORM
 *  commands and build orm-toolchain against this engine, where the type
 *  refuses to compile without them. Delete both `?.()` when that
 *  version is pinned here. */
function materializePresentation(
  state: RunState,
  ui: Ui,
  presentations: Presentations,
): PresentedResult<unknown>["presentation"] {
  if (state.format === "json") {
    return {
      human: [],
      stdout: [],
      json: presentations.json(),
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
  configFiles: readonly LoadedConfigFile[],
  capabilities: CommandCapabilities,
): CommandContext<unknown, number> {
  const state = invocation.state;
  const ui = makeUi(state.colorEnabled, invocation.runtime.stderr);
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
    configFiles,
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
    lastChild: () => state.lastChild,
    report: (event) => reportEvent(invocation, event),
    prompt: makePromptSurface(invocation),
    openUrl: (request) => announceUrl(invocation, request),
    signal: invocation.signal,
    cwd: invocation.runtime.cwd,
    env: invocation.runtime.env,
    host: invocation.runtime.host,
    isCI: resolveIsCI(invocation.runtime),
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
