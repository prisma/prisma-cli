import {
  buildApplication,
  run as runStricli,
  type RouteMap as StricliRouteMap,
} from "@stricli/core";
import { type PositionalSpec, positionalRuntime } from "../args";
import type { CommandFamily, MountedTree } from "../command-family";
import type { AnyCommand } from "../commands";
import type { CommandContext } from "../context";
import type { ActiveCredential } from "../credential-manager";
import type { EngineEvent, Severity, StreamEvent } from "../events";
import type { ManagementApiClient } from "../management-api";
import type { Format, PresentedResult } from "../presentation";
import { CliStructuredError, type Result } from "../protocol";
import type { EngineCommandSnapshot, RunSummary } from "../run-summary";
import type { InputStream, Runtime } from "../runtime";
import { type ChildStatusSettlement, isChildStatusSettlement } from "../spawn";
import { type CommandCapabilities, makeContext } from "./command-context";
import { buildCommandSnapshot } from "./command-snapshot";
import { buildCommandTree, type CommandTreeEntry } from "./command-tree";
import { checkNeeds, type NeedsOutcome } from "./needs";
import {
  settleBug,
  settleChildStatus,
  settleCompleted,
  settleErrored,
  settleSessionCompleted,
  settleThrown,
  settleUnhandled,
  settleVerbatimExitCode,
  settleVersion,
} from "./settlement";
import {
  applySharedFlags,
  defaultInteractive,
  emptyConfigAssignment,
  emptyConfigAssignmentError,
  explicitFormat,
  type SharedFlags,
  sniffFormat,
} from "./shared-flags";
import {
  type DelegatedTerminal,
  endAbandonedChild,
  recordSignalDuringSpawn,
} from "./spawn";
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
  /** Fired exactly once per run, after settlement, for runs that
   *  reached a mounted command. Never fired for --help/--version.
   *  Errors thrown by the hook are swallowed — an observer bug must
   *  not break a command. */
  readonly onSettled?: (summary: RunSummary) => void;
  readonly answers?: ReadonlyArray<string | boolean>;
  /** Test seam: an injected `client` becomes ctx.api verbatim. */
  readonly managementApi?: {
    readonly client?: ManagementApiClient;
  };
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
  /** The run's unconsumed `--confirm` values. A consent prompt with a
   *  token removes the value it matched, so one `--confirm` grants one
   *  consent. */
  confirmValues: string[];
  interactive: boolean;
  colorEnabled: boolean;
  /** The file `--config` named, if the run named one. */
  configPath: string | undefined;
  resolved: boolean;
  settledExitCode: number | undefined;
  usageErrorText: string | undefined;
  internalErrorText: string | undefined;
  stricliStderr: string;
  /** The stdin iterator a prompt opened, closed when the run settles so
   *  a real process's stdin never keeps the event loop alive. */
  stdinIterator: AsyncIterator<Uint8Array> | undefined;
  /** The run's raw argv — consulted only to derive which flag NAMES
   *  were explicitly passed for the settlement snapshot. */
  argv: readonly string[];
  /** The value-free snapshot captured when a command mounted;
   *  undefined for runs that never reached one (help, usage errors). */
  snapshot: EngineCommandSnapshot | undefined;
  /** Set while ctx.spawn is awaiting a child that owns the terminal:
   *  signals are recorded rather than acted on, and commentary is
   *  buffered. */
  delegatedTerminal: DelegatedTerminal | undefined;
  /** How many prompts are reading the terminal. Claimed before a
   *  prompt's first await, so an unawaited prompt still blocks
   *  ctx.spawn from handing the same terminal to a child. */
  activePrompts: number;
  /** A signal past the first delivery recorded during a live child,
   *  replayed as the force exit once the run has settled. */
  pendingForceExit: "SIGINT" | "SIGTERM" | undefined;
  /** The credential the needs check resolved for a
   *  `credentials: "child"` command, carried to the spawn path so it
   *  is never re-resolved. */
  spawnCredential: ActiveCredential | undefined;
}

export interface Invocation {
  readonly runtime: Runtime;
  readonly hooks: RunHooks;
  readonly now: () => Date;
  /** Waits, or returns early when the signal fires. The engine's only
   *  timer, injectable so waiting paths (prompt.browserWait) run
   *  instantly under test. */
  readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly state: RunState;
  /** The engine-owned abort signal behind ctx.signal, fed by the
   *  runtime's signal subscription. */
  readonly signal: AbortSignal;
  /** Every config section name the mounted command families declare —
   *  the closed set of top-level keys prisma.config.ts may contain. */
  readonly configSections: readonly string[];
  /** The engine's whole signal policy, reachable so ctx.spawn can
   *  replay recorded signals through exactly the delivered path. */
  readonly deliverSignal: (signal: "SIGINT" | "SIGTERM") => void;
}

export function buildEngine(
  spec: EngineSpec,
  options?: {
    readonly now?: () => Date;
    readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Engine {
  return new EngineImpl(spec, options?.now, options?.delay);
}

/** Resolves on the timer OR on the signal, whichever comes first — the
 *  caller decides what an abort means, and no timer outlives the run. */
function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

type ErasedHandler = (
  args: {
    readonly flags: Record<string, unknown>;
    readonly positionals: Record<string, unknown>;
  },
  ctx: CommandContext<unknown, number>,
) => Promise<
  Result<PresentedResult<unknown> | ChildStatusSettlement, CliStructuredError>
>;

type ErasedSessionHandler = (
  args: {
    readonly flags: Record<string, unknown>;
    readonly positionals: Record<string, unknown>;
  },
  ctx: CommandContext<unknown, number>,
) => Promise<Result<undefined | ChildStatusSettlement, CliStructuredError>>;

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
  private readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly configSections: readonly string[];

  constructor(
    spec: EngineSpec,
    now: () => Date = () => new Date(),
    delay: (ms: number, signal: AbortSignal) => Promise<void> = waitFor,
  ) {
    this.spec = spec;
    this.now = now;
    this.delay = delay;
    this.configSections = declaredConfigSections(spec);
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
      confirmValues: [],
      interactive: defaultInteractive(runtime),
      colorEnabled: false,
      configPath: undefined,
      resolved: false,
      settledExitCode: undefined,
      usageErrorText: undefined,
      internalErrorText: undefined,
      stricliStderr: "",
      stdinIterator: undefined,
      argv,
      snapshot: undefined,
      delegatedTerminal: undefined,
      activePrompts: 0,
      pendingForceExit: undefined,
      spawnCredential: undefined,
    };
    const startedAtMs = this.now().getTime();
    const controller = new AbortController();
    let signalDelivered = false;
    /** The engine neither aborts nor exits while a child owns the
     *  terminal: it records, and the affordance replays on child exit,
     *  so the engine always outlives the child. */
    const deliverSignal = (signal: "SIGINT" | "SIGTERM"): void => {
      if (state.delegatedTerminal !== undefined) {
        recordSignalDuringSpawn(state.delegatedTerminal, signal);
        return;
      }
      if (signalDelivered) {
        runtime.exit(signal === "SIGTERM" ? 143 : 130);
        return;
      }
      signalDelivered = true;
      controller.abort(signal);
    };
    const unsubscribe = runtime.onSignal(deliverSignal);
    const invocation: Invocation = {
      runtime,
      hooks: { ...hooks },
      now: this.now,
      delay: this.delay,
      state,
      signal: controller.signal,
      configSections: this.configSections,
      deliverSignal,
    };
    if (versionRequested(argv)) {
      unsubscribe();
      return settleVersion(this.spec, invocation);
    }
    if (emptyConfigAssignment(argv)) {
      unsubscribe();
      settleErrored(invocation, emptyConfigAssignmentError());
      return 2;
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
    const exitCode =
      state.settledExitCode !== undefined
        ? state.settledExitCode
        : settleUnhandled(this.spec, invocation, stricliProcess.exitCode);
    this.fireOnSettled(invocation, exitCode, startedAtMs);
    if (state.pendingForceExit !== undefined) {
      runtime.exit(state.pendingForceExit === "SIGTERM" ? 143 : 130);
    }
    return exitCode;
  }

  /** The onSettled delivery: once per run, after the exit code is
   *  final, only for runs that mounted a command (--help, --version,
   *  and pre-mount usage errors leave no snapshot and fire nothing).
   *  A throwing hook is swallowed — observation must not break runs. */
  private fireOnSettled(
    invocation: Invocation,
    exitCode: number,
    startedAtMs: number,
  ): void {
    const { state, hooks } = invocation;
    if (state.snapshot === undefined || hooks.onSettled === undefined) {
      return;
    }
    const summary: RunSummary = {
      commandId: state.commandId,
      exitCode,
      durationMs: this.now().getTime() - startedAtMs,
      snapshot: state.snapshot,
    };
    try {
      hooks.onSettled(summary);
    } catch {
      // Swallowed by contract: a telemetry bug must not break a command.
    }
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
    state.snapshot = buildCommandSnapshot(
      entry.id,
      entry.def,
      state.argv,
      values,
    );
    if (entry.def.kind === "server-command") {
      await this.executeServer(invocation, entry, rawFlags);
      return;
    }
    if (entry.def.maySpawn && explicitFormat(state.argv) === "json") {
      state.format = "human";
      settleErrored(invocation, jsonUnsupportedError(entry.id));
      return;
    }
    if (entry.def.maySpawn && invocation.runtime.spawn === undefined) {
      // A host that mounts a maySpawn command and supplies no adapter
      // is misconfigured; the run is doomed and refuses here, before
      // the needs check, rather than mid-handler after side effects.
      state.format = "human";
      settleBug(
        invocation,
        new Error(
          `@prisma/cli-engine: command '${entry.id}' declares maySpawn but the Runtime supplies no spawn adapter`,
        ),
      );
      return;
    }
    let needsOutcome: NeedsOutcome;
    try {
      applySharedFlags(state, rawFlags as SharedFlags, invocation.runtime);
      if (entry.def.maySpawn) {
        state.format = "human";
      }
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
    state.spawnCredential = needsOutcome.spawnCredential;
    const handler: unknown = entry.def.handler;
    const args = {
      flags: declaredFlags(entry.def, rawFlags),
      positionals: distributePositionals(entry.def, values),
    };
    const ctx = makeContext(
      invocation,
      entry.def,
      needsOutcome.config,
      declaredCapabilities(entry.def),
    );
    if (entry.def.kind === "session-command") {
      try {
        const result = await (handler as ErasedSessionHandler)(args, ctx);
        if (await this.settleAbandonedChild(invocation, false)) {
          return;
        }
        state.resolved = true;
        if (!result.ok) {
          settleErrored(invocation, result.failure);
        } else if (isChildStatusSettlement(result.value)) {
          settleChildStatus(invocation, entry.def, result.value);
        } else {
          settleSessionCompleted(invocation);
        }
      } catch (cause) {
        if (await this.settleAbandonedChild(invocation, true, cause)) {
          return;
        }
        state.resolved = true;
        settleThrown(invocation, cause);
      }
      return;
    }
    try {
      const result = await (handler as ErasedHandler)(args, ctx);
      if (await this.settleAbandonedChild(invocation, false)) {
        return;
      }
      state.resolved = true;
      if (!result.ok) {
        settleErrored(invocation, result.failure);
      } else if (isChildStatusSettlement(result.value)) {
        settleChildStatus(invocation, entry.def, result.value);
      } else {
        settleCompleted(invocation, entry.def, result.value);
      }
    } catch (cause) {
      if (await this.settleAbandonedChild(invocation, true, cause)) {
        return;
      }
      state.resolved = true;
      settleThrown(invocation, cause);
    }
  }

  /** The handler resolved or threw with its child still live. The
   *  engine ends that child — SIGTERM, the ruled grace period, then
   *  SIGKILL — and waits for it to exit before settling the run as a
   *  construction error, so no run finishes under a live child. */
  private async settleAbandonedChild(
    invocation: Invocation,
    threw: boolean,
    cause?: unknown,
  ): Promise<boolean> {
    const state = invocation.state;
    const terminal = state.delegatedTerminal;
    if (terminal === undefined) {
      return false;
    }
    await endAbandonedChild(terminal);
    state.resolved = true;
    const how = threw
      ? ` (the handler threw: ${String(cause instanceof Error ? cause.message : cause).split("\n")[0]})`
      : "";
    settleBug(
      invocation,
      new Error(
        `@prisma/cli-engine: command '${state.commandId}' resolved while a child was still live — a handler must stay suspended on the ctx.spawn promise until the child ends${how}`,
      ),
    );
    return true;
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
      settleVerbatimExitCode(invocation, exitCode);
    } catch (cause) {
      settleThrown(invocation, cause);
    }
  }
}

/** The closed set of config section names. Every mounted command
 *  contributes the section it needs, whether it reaches the tree
 *  through a command family or on its own — the shell mounts its own
 *  commands with no family, and a section the CLI cannot name is a
 *  section its own command could never read. Every other top-level key
 *  in prisma.config.ts is reported by the config needs check. */
function declaredConfigSections(spec: EngineSpec): readonly string[] {
  return [
    ...new Set(
      [
        ...spec.commandFamilies.map(
          (commandFamily) => commandFamily.configSection?.name,
        ),
        ...Object.values(spec.commands).map((def) => def.needs.config?.name),
      ].filter((name): name is string => name !== undefined),
    ),
  ];
}

/** A command that may hand the terminal to a child cannot frame its
 *  output, so json is refused as soon as the command is known — before
 *  the needs check and before anything runs. */
function jsonUnsupportedError(commandId: string): CliStructuredError {
  return new CliStructuredError(
    "CLI.JSON_UNSUPPORTED",
    `The '${commandId.replaceAll(".", " ")}' command does not support json output.`,
    {
      why: "It hands the terminal to another program, whose output cannot be framed as a json stream.",
      nextActions: [
        {
          kind: "user-choice",
          label: "Run it without --json or --format json.",
        },
      ],
    },
  );
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

function declaredCapabilities(def: AnyCommand): CommandCapabilities {
  if (def.kind !== "result-command") {
    return { managesCredentials: false, installsPackages: false };
  }
  return {
    managesCredentials: def.managesCredentials,
    installsPackages: def.installsPackages,
  };
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
