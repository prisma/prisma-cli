import {
  buildApplication,
  run as runStricli,
  type RouteMap as StricliRouteMap,
} from "@stricli/core";
import { type PositionalSpec, positionalRuntime } from "../args";
import type { CommandFamily, MountedTree } from "../command-family";
import type { AnyCommand } from "../commands";
import type { CommandContext } from "../context";
import type { EngineEvent, Severity, StreamEvent } from "../events";
import type { Format, PresentedResult } from "../presentation";
import type { CliStructuredError, Result } from "../protocol";
import type { InputStream, Runtime } from "../runtime";
import { makeContext } from "./command-context";
import { buildCommandTree, type CommandTreeEntry } from "./command-tree";
import { checkNeeds, type NeedsOutcome } from "./needs";
import {
  settleBug,
  settleCompleted,
  settleErrored,
  settleSessionCompleted,
  settleThrown,
  settleUnhandled,
  settleVersion,
} from "./settlement";
import {
  applySharedFlags,
  defaultInteractive,
  type SharedFlags,
  sniffFormat,
} from "./shared-flags";
import {
  buildRoutes,
  capturingText,
  type EngineRunContext,
} from "./stricli-adapter";

export interface EngineSpec {
  readonly name: string;
  readonly version: string;
  readonly commandFamilies: readonly CommandFamily[];
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
  readonly commands: MountedTree;
}

export interface RunHooks {
  readonly onEvent?: (event: EngineEvent) => void;
  readonly onPresented?: (presented: PresentedResult<unknown>) => void;
  readonly onStreamEvent?: (frame: StreamEvent) => void;
  readonly answers?: ReadonlyArray<string | boolean>;
}

export interface Engine {
  execute(
    argv: readonly string[],
    runtime: Runtime,
    hooks: RunHooks,
  ): Promise<number>;
}

export interface RunState {
  commandId: string;
  docsBaseUrl: string | undefined;
  prefix: readonly string[];
  format: Format;
  logLevel: Severity;
  yes: boolean;
  interactive: boolean;
  colorEnabled: boolean;
  resolved: boolean;
  settledExitCode: number | undefined;
  usageErrorText: string | undefined;
  internalErrorText: string | undefined;
  stricliStderr: string;
  /** The stdin iterator a prompt opened, closed when the run settles so
   *  a real process's stdin never keeps the event loop alive. */
  stdinIterator: AsyncIterator<Uint8Array> | undefined;
}

export interface Invocation {
  readonly runtime: Runtime;
  readonly hooks: RunHooks;
  readonly now: () => Date;
  readonly state: RunState;
  /** The engine-owned abort signal behind ctx.signal, fed by the
   *  runtime's signal subscription. */
  readonly signal: AbortSignal;
}

export function buildEngine(
  spec: EngineSpec,
  options?: { readonly now?: () => Date },
): Engine {
  return new EngineImpl(spec, options?.now);
}

type ErasedHandler = (
  args: {
    readonly flags: Record<string, unknown>;
    readonly positionals: Record<string, unknown>;
  },
  ctx: CommandContext<unknown, number>,
) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>;

type ErasedSessionHandler = (
  args: {
    readonly flags: Record<string, unknown>;
    readonly positionals: Record<string, unknown>;
  },
  ctx: CommandContext<unknown, number>,
) => Promise<Result<void, CliStructuredError>>;

type ErasedServerHandler = (
  args: {
    readonly flags: Record<string, unknown>;
    readonly positionals: Record<string, unknown>;
  },
  io: {
    readonly stdin: InputStream;
    readonly stdout: { write(text: string): void };
    readonly stderr: { write(text: string): void };
    readonly signal: AbortSignal;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly config: unknown;
  },
) => Promise<number>;

export class EngineImpl implements Engine {
  private readonly spec: EngineSpec;
  private readonly root: StricliRouteMap<EngineRunContext>;
  private readonly now: () => Date;

  constructor(spec: EngineSpec, now: () => Date = () => new Date()) {
    this.spec = spec;
    this.now = now;
    this.root = buildRoutes(
      spec,
      buildCommandTree(spec),
      "",
      (invocation, entry, flags, values) =>
        this.executeMounted(invocation, entry, flags, values),
    );
  }

  async execute(
    argv: readonly string[],
    runtime: Runtime,
    hooks: RunHooks,
  ): Promise<number> {
    const format = sniffFormat(argv, runtime);
    const state: RunState = {
      commandId: "",
      docsBaseUrl: undefined,
      prefix: [],
      format,
      logLevel: "info",
      yes: false,
      interactive: defaultInteractive(runtime),
      colorEnabled: false,
      resolved: false,
      settledExitCode: undefined,
      usageErrorText: undefined,
      internalErrorText: undefined,
      stricliStderr: "",
      stdinIterator: undefined,
    };
    const controller = new AbortController();
    let signalDelivered = false;
    const unsubscribe = runtime.onSignal((signal) => {
      if (signalDelivered) {
        runtime.exit(signal === "SIGTERM" ? 143 : 130);
        return;
      }
      signalDelivered = true;
      controller.abort(signal);
    });
    const invocation: Invocation = {
      runtime,
      hooks: { ...hooks },
      now: this.now,
      state,
      signal: controller.signal,
    };
    if (versionRequested(argv)) {
      unsubscribe();
      return settleVersion(this.spec, invocation);
    }
    const stricliProcess = {
      /** stricli writes only help text here. In json mode stdout carries
       *  exactly the frame stream, so help prose goes to stderr instead. */
      stdout: {
        write: (text: string) =>
          (state.format === "human" ? runtime.stdout : runtime.stderr).write(
            text,
          ),
      },
      stderr: {
        write: (text: string) => {
          state.stricliStderr += text;
        },
      },
      env: { ...runtime.env, STRICLI_NO_COLOR: "1" },
      exitCode: undefined as number | string | null | undefined,
    };
    const app = buildApplication<EngineRunContext>(this.root, {
      name: this.spec.name,
      scanner: {
        caseStyle: "allow-kebab-for-camel",
        allowArgumentEscapeSequence: true,
      },
      localization: { text: capturingText(state) },
    });
    try {
      await runStricli(app, [...argv], {
        process: stricliProcess,
        forCommand: (info) => {
          state.prefix = info.prefix;
          return { process: stricliProcess, invocation };
        },
      });
    } finally {
      unsubscribe();
      await state.stdinIterator?.return?.();
    }
    if (state.settledExitCode !== undefined) {
      return state.settledExitCode;
    }
    return settleUnhandled(this.spec, invocation, stricliProcess.exitCode);
  }

  private async executeMounted(
    invocation: Invocation,
    entry: CommandTreeEntry,
    rawFlags: Record<string, unknown>,
    values: readonly (string | undefined)[],
  ): Promise<void> {
    const state = invocation.state;
    state.commandId = entry.id;
    state.docsBaseUrl = entry.docsBaseUrl;
    if (entry.def.kind === "server-command") {
      await this.executeServer(invocation, entry, rawFlags);
      return;
    }
    let needsOutcome: NeedsOutcome;
    try {
      applySharedFlags(state, rawFlags as SharedFlags, invocation.runtime);
      needsOutcome = await checkNeeds(entry.def, invocation);
    } catch (cause) {
      settleBug(invocation, cause);
      return;
    }
    if (needsOutcome.kind === "errored") {
      settleErrored(invocation, needsOutcome.error, needsOutcome.diagnostics);
      return;
    }
    if (needsOutcome.kind === "bug") {
      settleBug(invocation, needsOutcome.cause);
      return;
    }
    const handler: unknown = entry.def.handler;
    const args = {
      flags: declaredFlags(entry.def, rawFlags),
      positionals: distributePositionals(entry.def, values),
    };
    const ctx = makeContext(invocation, needsOutcome.config);
    if (entry.def.kind === "session-command") {
      try {
        const result = await (handler as ErasedSessionHandler)(args, ctx);
        state.resolved = true;
        if (result.ok) {
          settleSessionCompleted(invocation);
        } else {
          settleErrored(invocation, result.failure);
        }
      } catch (cause) {
        state.resolved = true;
        settleThrown(invocation, cause);
      }
      return;
    }
    try {
      const result = await (handler as ErasedHandler)(args, ctx);
      state.resolved = true;
      if (result.ok) {
        settleCompleted(invocation, entry.def, result.value);
      } else {
        settleErrored(invocation, result.failure);
      }
    } catch (cause) {
      state.resolved = true;
      settleThrown(invocation, cause);
    }
  }

  /** The stdio handoff: a foreign client owns the conversation, so the
   *  engine hands over the streams and stays out of stdout. The handler
   *  returns the exit code directly; there is no envelope. */
  private async executeServer(
    invocation: Invocation,
    entry: CommandTreeEntry,
    rawFlags: Record<string, unknown>,
  ): Promise<void> {
    const state = invocation.state;
    state.format = "human";
    let needsOutcome: NeedsOutcome;
    try {
      needsOutcome = await checkNeeds(entry.def, invocation);
    } catch (cause) {
      settleBug(invocation, cause);
      return;
    }
    if (needsOutcome.kind === "errored") {
      settleErrored(invocation, needsOutcome.error, needsOutcome.diagnostics);
      return;
    }
    if (needsOutcome.kind === "bug") {
      settleBug(invocation, needsOutcome.cause);
      return;
    }
    const handler: unknown = entry.def.handler;
    const runtime = invocation.runtime;
    const args = { flags: declaredFlags(entry.def, rawFlags), positionals: {} };
    try {
      const exitCode = await (handler as ErasedServerHandler)(args, {
        stdin: runtime.stdin,
        stdout: runtime.stdout,
        stderr: runtime.stderr,
        signal: invocation.signal,
        cwd: runtime.cwd,
        env: runtime.env,
        config: needsOutcome.config,
      });
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
        settleBug(
          invocation,
          new Error(
            `@prisma/cli-engine: the '${entry.id}' server command returned exit code ${String(exitCode)}, which is not an integer in 0-255`,
          ),
        );
        return;
      }
      state.settledExitCode = exitCode;
    } catch (cause) {
      settleThrown(invocation, cause);
    }
  }
}

function versionRequested(argv: readonly string[]): boolean {
  for (const argument of argv) {
    if (argument === "--") {
      return false;
    }
    if (argument === "--version") {
      return true;
    }
  }
  return false;
}

function declaredFlags(
  def: AnyCommand,
  rawFlags: Record<string, unknown>,
): Record<string, unknown> {
  const flags: Record<string, unknown> = {};
  for (const key of Object.keys(def.args.flags)) {
    flags[key] = rawFlags[key];
  }
  return flags;
}

function distributePositionals(
  def: AnyCommand,
  values: readonly (string | undefined)[],
): Record<string, unknown> {
  const positionals: Record<string, unknown> = {};
  let cursor = 0;
  for (const [key, spec] of Object.entries<PositionalSpec<unknown>>(
    def.args.positionals,
  )) {
    if (positionalRuntime(spec).type === "variadic") {
      positionals[key] = values
        .slice(cursor)
        .filter((value) => value !== undefined);
      cursor = values.length;
    } else {
      positionals[key] = values[cursor];
      cursor += 1;
    }
  }
  return positionals;
}
