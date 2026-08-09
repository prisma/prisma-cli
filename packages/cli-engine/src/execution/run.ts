import {
  type PositionalSpec,
  positionalRuntime,
} from "../definition/args";
import type { AnyCommand } from "../definition/commands";
import type { Cli, Runtime } from "../definition/runtime";
import type {
  CommandFamily,
  MountedTree,
} from "../definition/command-family";
import type { CommandContext } from "../definition/context";
import type { InputStream } from "../definition/streams";
import type { PresentedResult } from "../definition/presentation";
import {
  buildApplication,
  run as runStricli,
  type RouteMap as StricliRouteMap,
} from "@stricli/core";
import type { CliStructuredError, Result } from "../protocol";
import { buildCommandTree, type CommandTreeEntry } from "./command-tree";
import { makeContext } from "./command-context";
import type {
  Engine,
  EngineSpec,
  Invocation,
  RunHooks,
  RunState,
} from "./invocation";
import { firstLine } from "./invocation";
import { checkNeeds, type NeedsOutcome } from "./needs";
import {
  emitErrored,
  settleBug,
  settleCompleted,
  settleErrored,
  settleSessionCompleted,
  settleThrown,
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
  usageErrorCode,
} from "./stricli-adapter";
import type { ErroredEnvelope } from "../definition/envelopes";

export function buildEngine(
  spec: EngineSpec,
  options?: { readonly now?: () => Date },
): Engine {
  const root = buildRoutes(spec, buildCommandTree(spec), "", executeMounted);
  const now = options?.now ?? (() => new Date());
  return {
    execute: (argv, runtime, hooks) =>
      executeRun(spec, root, argv, runtime, { ...hooks }, now),
  };
}

/**
 * Shell-side construction. Group help is declared with the mount.
 * Collisions, unknown groups, reserved-flag violations, grammar
 * violations, and foreign-section references fail construction (build
 * time, not run time).
 */
export function createCli(spec: {
  readonly name: string;
  readonly version: string;
  readonly commandFamilies: readonly CommandFamily[];
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
  readonly commands: MountedTree;
}): Cli {
  const engine = buildEngine(spec);
  return {
    run: (argv, runtime) => engine.execute(argv, runtime, {}),
  };
}

async function executeRun(
  spec: EngineSpec,
  root: StricliRouteMap<EngineRunContext>,
  argv: readonly string[],
  runtime: Runtime,
  hooks: RunHooks,
  now: () => Date,
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
    hooks,
    now,
    state,
    signal: controller.signal,
  };
  const stricliProcess = {
    stdout: { write: (text: string) => runtime.stdout.write(text) },
    stderr: {
      write: (text: string) => {
        state.stricliStderr += text;
      },
    },
    env: { ...runtime.env, STRICLI_NO_COLOR: "1" },
    exitCode: undefined as number | string | null | undefined,
  };
  const app = buildApplication<EngineRunContext>(root, {
    name: spec.name,
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
  }
  if (state.settledExitCode !== undefined) {
    return state.settledExitCode;
  }
  return settleUnhandled(spec, invocation, stricliProcess.exitCode);
}

/** Maps stricli's own settlement (parse/route failures, framework bugs)
 *  onto the engine protocol when the pipeline never settled. A failure
 *  addressed at a server command renders to stderr — a foreign client on
 *  the other end of stdout must never receive an engine envelope. */
function settleUnhandled(
  spec: EngineSpec,
  invocation: Invocation,
  stricliExitCode: number | string | null | undefined,
): number {
  const state = invocation.state;
  const raw = typeof stricliExitCode === "number" ? stricliExitCode : 0;
  if (raw === 0) {
    return 0;
  }
  const segments =
    state.prefix[0] === spec.name ? state.prefix.slice(1) : state.prefix;
  if (spec.commands[segments.join(" ")]?.kind === "server-command") {
    state.format = "human";
  }
  const usage = usageErrorCode(raw) !== undefined;
  const captured = usage
    ? state.stricliStderr.trim()
    : (state.usageErrorText ??
      state.internalErrorText ??
      state.stricliStderr.trim());
  const full =
    captured.length > 0 ? captured : "The command failed unexpectedly";
  const summary = firstLine(full);
  const remainder = full.slice(full.indexOf("\n") + 1).trim();
  const envelope: ErroredEnvelope = {
    ok: false,
    commandId: segments.join("."),
    error: {
      code: usageErrorCode(raw) ?? "CLI.INTERNAL_ERROR",
      severity: "error",
      summary,
      ...(usage && full.includes("\n") && remainder.length > 0
        ? { why: remainder }
        : {}),
    },
    diagnostics: [],
    nextActions: [],
  };
  emitErrored(invocation, envelope);
  return usage ? 2 : 1;
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
    readonly config: unknown;
  },
) => Promise<number>;

async function executeMounted(
  invocation: Invocation,
  entry: CommandTreeEntry,
  rawFlags: Record<string, unknown>,
  values: readonly (string | undefined)[],
): Promise<void> {
  const state = invocation.state;
  state.commandId = entry.id;
  state.docsBaseUrl = entry.docsBaseUrl;
  if (entry.def.kind === "server-command") {
    await executeServer(invocation, entry, rawFlags);
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
async function executeServer(
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
      config: needsOutcome.config,
    });
    state.settledExitCode = exitCode;
  } catch (cause) {
    settleThrown(invocation, cause);
  }
}

function declaredFlags(
  def: AnyCommand,
  rawFlags: Record<string, unknown>,
): Record<string, unknown> {
  const flags: Record<string, unknown> = {};
  for (const key of Object.keys(def.args?.flags ?? {})) {
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
    def.args?.positionals ?? {},
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
