/**
 * The execution engine — internal machinery behind createCli/createTestCli.
 * Mounts the definition tree on @stricli/core (fully internal: no stricli
 * type appears in the public surface, stricli never owns process lifetime)
 * and runs the pipeline: parse → needs → lazy handler load → context →
 * handler → envelope → exit code.
 */
import {
  type ApplicationText,
  buildApplication,
  buildCommand,
  buildRouteMap,
  run as runStricli,
  type CommandContext as StricliBaseContext,
  type Command as StricliCommand,
  type RouteMap as StricliRouteMap,
  type TypedCommandParameters,
  text_en,
} from "@stricli/core";
import {
  type AnyCommand,
  type Block,
  type CommandContext,
  type CompletedEnvelope,
  type Credentials,
  type EngineEvent,
  type ErroredEnvelope,
  type FlagSpec,
  type Format,
  type LogLevel,
  type MountedTree,
  type PositionalSpec,
  PRESENTED,
  type Presentations,
  type PresentedResult,
  type ProductManifest,
  type Runtime,
  type StreamEvent,
  type TestCli,
  type Ui,
} from "./index";
import {
  CliStructuredError,
  type Diagnostic,
  type NextAction,
  type Result,
} from "./protocol";

// —————————————————————————————————————————————————————————————————————
// Runtime shapes of the builder outputs (index.ts brands these onto the
// phantom FlagSpec/PositionalSpec types)
// —————————————————————————————————————————————————————————————————————

interface FlagRuntime {
  readonly type:
    | "string"
    | "requiredString"
    | "number"
    | "boolean"
    | "enum"
    | "repeated";
  readonly brief: string;
  readonly placeholder?: string;
  readonly alias?: string;
  readonly default?: unknown;
  readonly values?: readonly string[];
}

interface PositionalRuntime {
  readonly type: "string" | "optionalString" | "variadic";
  readonly brief: string;
  readonly placeholder: string;
}

function flagRuntime(spec: FlagSpec<unknown>): FlagRuntime {
  return spec as unknown as FlagRuntime;
}

function positionalRuntime(spec: PositionalSpec<unknown>): PositionalRuntime {
  return spec as unknown as PositionalRuntime;
}

// —————————————————————————————————————————————————————————————————————
// The engine-injected shared flag family. Products cannot declare these
// names or aliases; handlers never see their values.
// —————————————————————————————————————————————————————————————————————

const RESERVED_FLAG_NAMES: ReadonlySet<string> = new Set([
  "format",
  "json",
  "logLevel",
  "verbose",
  "quiet",
  "yes",
  "interactive",
  "color",
  "help",
  "helpAll",
]);

const RESERVED_ALIASES: ReadonlySet<string> = new Set(["v", "q", "y", "h"]);

const SHARED_FLAG_PARAMETERS = {
  format: {
    kind: "enum",
    values: ["human", "json"],
    optional: true,
    brief: "Output format",
  },
  json: {
    kind: "boolean",
    default: false,
    brief: "Shorthand for --format json",
  },
  logLevel: {
    kind: "enum",
    values: ["error", "warn", "info", "verbose"],
    optional: true,
    brief: "Commentary verbosity",
  },
  verbose: {
    kind: "boolean",
    default: false,
    brief: "Shorthand for --log-level verbose",
  },
  quiet: {
    kind: "boolean",
    default: false,
    brief: "Only write machine-consumable data lines",
  },
  yes: {
    kind: "boolean",
    default: false,
    brief: "Accept prompt defaults without asking",
  },
  interactive: {
    kind: "boolean",
    optional: true,
    withNegated: true,
    brief: "Force interactive prompts on or off",
  },
  color: {
    kind: "boolean",
    optional: true,
    withNegated: true,
    brief: "Force ANSI color on or off",
  },
} as const;

const SHARED_ALIASES = { v: "verbose", q: "quiet", y: "yes" } as const;

interface SharedFlags {
  readonly format?: Format;
  readonly json?: boolean;
  readonly logLevel?: LogLevel;
  readonly verbose?: boolean;
  readonly quiet?: boolean;
  readonly yes?: boolean;
  readonly interactive?: boolean;
  readonly color?: boolean;
}

// —————————————————————————————————————————————————————————————————————
// Engine spec + per-run state
// —————————————————————————————————————————————————————————————————————

export interface EngineSpec {
  readonly name: string;
  readonly version: string;
  readonly products: readonly ProductManifest[];
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

interface RunState {
  commandId: string;
  prefix: readonly string[];
  format: Format;
  logLevel: LogLevel;
  quiet: boolean;
  colorEnabled: boolean;
  resolved: boolean;
  settledExitCode: number | undefined;
  remediations: NextAction[];
  usageErrorText: string | undefined;
  internalErrorText: string | undefined;
  stricliStderr: string;
}

interface Invocation {
  readonly runtime: Runtime;
  readonly hooks: RunHooks;
  readonly now: () => Date;
  readonly state: RunState;
}

interface EngineRunContext extends StricliBaseContext {
  readonly invocation: Invocation;
}

// —————————————————————————————————————————————————————————————————————
// Construction: validate the mount, build the stricli tree once
// —————————————————————————————————————————————————————————————————————

function constructionError(message: string): Error {
  return new Error(`@prisma/cli-engine: ${message}`);
}

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const INTEGER_LIKE = /^\d+$/;

function validateFlags(path: string, def: AnyCommand): void {
  const flags = def.args?.flags ?? {};
  const seenAliases = new Set<string>();
  for (const [key, spec] of Object.entries(flags)) {
    if (RESERVED_FLAG_NAMES.has(key)) {
      throw constructionError(
        `command '${path}' declares reserved flag '${key}' (the shared flag family is engine-injected)`,
      );
    }
    if (!CAMEL_CASE.test(key)) {
      throw constructionError(
        `command '${path}' flag '${key}' must be camelCase (it transliterates to --kebab-case on the CLI)`,
      );
    }
    const alias = flagRuntime(spec).alias;
    if (alias === undefined) {
      continue;
    }
    if (RESERVED_ALIASES.has(alias)) {
      throw constructionError(
        `command '${path}' flag '${key}' uses reserved alias '-${alias}'`,
      );
    }
    if (seenAliases.has(alias)) {
      throw constructionError(
        `command '${path}' declares alias '-${alias}' twice`,
      );
    }
    seenAliases.add(alias);
  }
}

function validatePositionals(path: string, def: AnyCommand): void {
  const entries = Object.entries<PositionalSpec<unknown>>(
    def.args?.positionals ?? {},
  );
  let sawOptional = false;
  for (const [index, [key, spec]] of entries.entries()) {
    const runtime = positionalRuntime(spec);
    if (INTEGER_LIKE.test(key)) {
      throw constructionError(
        `command '${path}' positional key '${key}' must not be integer-like`,
      );
    }
    if (runtime.type === "variadic" && index !== entries.length - 1) {
      throw constructionError(
        `command '${path}' variadic positional '${key}' must be declared last`,
      );
    }
    if (runtime.type === "optionalString") {
      sawOptional = true;
    }
    if (runtime.type === "string" && sawOptional) {
      throw constructionError(
        `command '${path}' required positional '${key}' may not follow an optional one`,
      );
    }
  }
}

function validateExitCodes(path: string, def: AnyCommand): void {
  if (def.kind !== "result-command" || def.exitCodes === undefined) {
    return;
  }
  for (const key of Object.keys(def.exitCodes)) {
    const code = Number(key);
    if (!Number.isInteger(code) || code < 4 || code > 99) {
      throw constructionError(
        `command '${path}' documents exit code ${key}; documented codes must be integers in 4-99`,
      );
    }
  }
}

interface MountEntry {
  readonly def: AnyCommand;
  readonly id: string;
}

interface MountNode {
  readonly commands: Map<string, MountEntry>;
  readonly children: Map<string, MountNode>;
}

function emptyNode(): MountNode {
  return { commands: new Map(), children: new Map() };
}

function insertMount(root: MountNode, path: string, def: AnyCommand): void {
  const segments = path.split(" ");
  if (segments.some((segment) => segment.length === 0)) {
    throw constructionError(`invalid mount path '${path}'`);
  }
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    if (node.commands.has(segment)) {
      throw constructionError(
        `mount path '${path}' collides with a command mounted at a prefix of it`,
      );
    }
    let child = node.children.get(segment);
    if (child === undefined) {
      child = emptyNode();
      node.children.set(segment, child);
    }
    node = child;
  }
  const leaf = segments[segments.length - 1];
  if (node.commands.has(leaf) || node.children.has(leaf)) {
    throw constructionError(`mount path '${path}' collides with another mount`);
  }
  node.commands.set(leaf, { def, id: segments.join(".") });
}

function buildMountTree(spec: EngineSpec): MountNode {
  const paths = Object.keys(spec.commands);
  if (paths.length === 0) {
    throw constructionError("createCli requires at least one mounted command");
  }
  const root = emptyNode();
  for (const path of paths) {
    const def = spec.commands[path];
    validateFlags(path, def);
    validatePositionals(path, def);
    validateExitCodes(path, def);
    const segments = path.split(" ");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const groupPath = segments.slice(0, depth).join(" ");
      if (spec.groups[groupPath] === undefined) {
        throw constructionError(
          `mount path '${path}' references unknown group '${groupPath}' (declare it in createCli's groups)`,
        );
      }
    }
    insertMount(root, path, def);
  }
  return root;
}

// —————————————————————————————————————————————————————————————————————
// Mapping our definitions onto stricli commands
// —————————————————————————————————————————————————————————————————————

function parseNumberInput(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new Error(`expected a number, received '${input}'`);
  }
  return value;
}

function identity(input: string): string {
  return input;
}

function stricliFlagParameter(spec: FlagRuntime): Record<string, unknown> {
  switch (spec.type) {
    case "boolean":
      return { kind: "boolean", brief: spec.brief, default: false };
    case "enum":
      return {
        kind: "enum",
        brief: spec.brief,
        values: spec.values ?? [],
        ...(spec.default === undefined
          ? { optional: true }
          : { default: spec.default }),
      };
    case "repeated":
      return {
        kind: "parsed",
        parse: identity,
        brief: spec.brief,
        placeholder: spec.placeholder,
        variadic: true,
        optional: true,
      };
    case "number":
      return {
        kind: "parsed",
        parse: parseNumberInput,
        brief: spec.brief,
        placeholder: spec.placeholder,
        ...(spec.default === undefined
          ? { optional: true }
          : { default: String(spec.default) }),
      };
    case "requiredString":
      return {
        kind: "parsed",
        parse: identity,
        brief: spec.brief,
        placeholder: spec.placeholder,
      };
    case "string":
      return {
        kind: "parsed",
        parse: identity,
        brief: spec.brief,
        placeholder: spec.placeholder,
        ...(spec.default === undefined
          ? { optional: true }
          : { default: spec.default }),
      };
  }
}

function stricliPositional(
  entries: ReadonlyArray<readonly [string, PositionalRuntime]>,
): Record<string, unknown> | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const variadic = entries.find(([, spec]) => spec.type === "variadic");
  if (variadic === undefined) {
    return {
      kind: "tuple",
      parameters: entries.map(([, spec]) => ({
        brief: spec.brief,
        placeholder: spec.placeholder,
        parse: identity,
        ...(spec.type === "optionalString" ? { optional: true } : {}),
      })),
    };
  }
  const minimum = entries.filter(([, spec]) => spec.type === "string").length;
  return {
    kind: "array",
    parameter: {
      brief: variadic[1].brief,
      placeholder: variadic[1].placeholder,
      parse: identity,
      optional: true,
    },
    ...(minimum > 0 ? { minimum } : {}),
  };
}

function commandParameters(def: AnyCommand): Record<string, unknown> {
  const productFlags: Record<string, unknown> = {};
  const aliases: Record<string, string> = {};
  for (const [key, spec] of Object.entries(def.args?.flags ?? {})) {
    const runtime = flagRuntime(spec);
    productFlags[key] = stricliFlagParameter(runtime);
    if (runtime.alias !== undefined) {
      aliases[runtime.alias] = key;
    }
  }
  const injectShared = def.kind !== "server-command";
  const positionalEntries = Object.entries<PositionalSpec<unknown>>(
    def.args?.positionals ?? {},
  ).map(([key, spec]) => [key, positionalRuntime(spec)] as const);
  const positional = stricliPositional(positionalEntries);
  return {
    flags: injectShared
      ? { ...SHARED_FLAG_PARAMETERS, ...productFlags }
      : productFlags,
    aliases: injectShared ? { ...SHARED_ALIASES, ...aliases } : aliases,
    ...(positional === undefined ? {} : { positional }),
  };
}

type EngineRoutingTarget =
  | StricliCommand<EngineRunContext>
  | StricliRouteMap<EngineRunContext>;

function toStricliCommand(entry: MountEntry): EngineRoutingTarget {
  const parameters = commandParameters(
    entry.def,
  ) as unknown as TypedCommandParameters<
    Record<string, unknown>,
    readonly (string | undefined)[],
    EngineRunContext
  >;
  return buildCommand<
    Record<string, unknown>,
    readonly (string | undefined)[],
    EngineRunContext
  >({
    async func(
      this: EngineRunContext,
      flags: Record<string, unknown>,
      ...values: (string | undefined)[]
    ): Promise<void> {
      await executeMounted(this.invocation, entry, flags, values);
    },
    parameters,
    docs: {
      brief: entry.def.help.summary,
      fullDescription: entry.def.help.description,
    },
  });
}

function buildRoutes(
  spec: EngineSpec,
  node: MountNode,
  groupPath: string,
): StricliRouteMap<EngineRunContext> {
  const routes: Record<string, EngineRoutingTarget> = {};
  for (const [name, entry] of node.commands) {
    routes[name] = toStricliCommand(entry);
  }
  for (const [name, child] of node.children) {
    const childPath = groupPath === "" ? name : `${groupPath} ${name}`;
    routes[name] = buildRoutes(spec, child, childPath);
  }
  const docs =
    groupPath === ""
      ? { brief: spec.name }
      : {
          brief: spec.groups[groupPath].brief,
          fullDescription: spec.groups[groupPath].description,
        };
  return buildRouteMap({ routes, docs });
}

export function buildEngine(
  spec: EngineSpec,
  options?: { readonly now?: () => Date },
): Engine {
  const root = buildRoutes(spec, buildMountTree(spec), "");
  const now = options?.now ?? (() => new Date());
  return {
    execute: (argv, runtime, hooks) =>
      executeRun(spec, root, argv, runtime, { ...hooks }, now),
  };
}

// —————————————————————————————————————————————————————————————————————
// A single run
// —————————————————————————————————————————————————————————————————————

function sniffFormat(argv: readonly string[], runtime: Runtime): Format {
  for (const [index, input] of argv.entries()) {
    if (input === "--json" || input === "--format=json") {
      return "json";
    }
    if (input === "--format=human") {
      return "human";
    }
    if (input === "--format") {
      const value = argv[index + 1];
      if (value === "json" || value === "human") {
        return value;
      }
    }
  }
  return runtime.isTty.stdout ? "human" : "json";
}

function capturingText(state: RunState): ApplicationText {
  return {
    ...text_en,
    exceptionWhileParsingArguments(exc, ansiColor) {
      const message = text_en.exceptionWhileParsingArguments.call(
        text_en,
        exc,
        ansiColor,
      );
      state.usageErrorText = message;
      return message;
    },
    noCommandRegisteredForInput(args) {
      const message = text_en.noCommandRegisteredForInput(args);
      state.usageErrorText = message;
      return message;
    },
    exceptionWhileLoadingCommandFunction(exc, ansiColor) {
      const message = text_en.exceptionWhileLoadingCommandFunction.call(
        text_en,
        exc,
        ansiColor,
      );
      state.internalErrorText = message;
      return message;
    },
    exceptionWhileRunningCommand(exc, ansiColor) {
      const message = text_en.exceptionWhileRunningCommand.call(
        text_en,
        exc,
        ansiColor,
      );
      state.internalErrorText = message;
      return message;
    },
  };
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}

async function executeRun(
  spec: EngineSpec,
  root: StricliRouteMap<EngineRunContext>,
  argv: readonly string[],
  runtime: Runtime,
  hooks: RunHooks,
  now: () => Date,
): Promise<number> {
  const state: RunState = {
    commandId: "",
    prefix: [],
    format: sniffFormat(argv, runtime),
    logLevel: "info",
    quiet: false,
    colorEnabled: false,
    resolved: false,
    settledExitCode: undefined,
    remediations: [],
    usageErrorText: undefined,
    internalErrorText: undefined,
    stricliStderr: "",
  };
  const invocation: Invocation = { runtime, hooks, now, state };
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
    scanner: { caseStyle: "allow-kebab-for-camel" },
    localization: { text: capturingText(state) },
  });
  await runStricli(app, [...argv], {
    process: stricliProcess,
    forCommand: (info) => {
      state.prefix = info.prefix;
      return { process: stricliProcess, invocation };
    },
  });
  if (state.settledExitCode !== undefined) {
    return state.settledExitCode;
  }
  return settleUnhandled(invocation, stricliProcess.exitCode);
}

function usageErrorCode(
  stricliExitCode: number,
): `${string}.${string}` | undefined {
  if (stricliExitCode === -5) {
    return "CLI.UNKNOWN_COMMAND";
  }
  if (stricliExitCode === -4) {
    return "CLI.INVALID_ARGUMENTS";
  }
  return undefined;
}

/** Maps stricli's own settlement (parse/route failures, framework bugs)
 *  onto the engine protocol when the pipeline never settled. */
function settleUnhandled(
  invocation: Invocation,
  stricliExitCode: number | string | null | undefined,
): number {
  const state = invocation.state;
  const raw = typeof stricliExitCode === "number" ? stricliExitCode : 0;
  if (raw === 0) {
    return 0;
  }
  const usage = usageErrorCode(raw) !== undefined;
  const summary =
    state.usageErrorText ??
    state.internalErrorText ??
    state.stricliStderr.trim();
  const envelope: ErroredEnvelope = {
    ok: false,
    commandId: state.prefix.join("."),
    error: {
      code: usageErrorCode(raw) ?? "CLI.INTERNAL_ERROR",
      severity: "error",
      summary: firstLine(
        summary.length > 0 ? summary : "The command failed unexpectedly",
      ),
    },
    diagnostics: [],
    nextActions: [],
  };
  emitErrored(invocation, envelope);
  return usage ? 2 : 1;
}

// —————————————————————————————————————————————————————————————————————
// The pipeline for a mounted command
// —————————————————————————————————————————————————————————————————————

function applySharedFlags(
  state: RunState,
  shared: SharedFlags,
  runtime: Runtime,
): void {
  state.format = shared.format ?? resolveAutoFormat(shared, runtime);
  state.quiet = shared.quiet === true;
  state.logLevel = resolveLogLevel(state.quiet, shared);
  state.colorEnabled =
    shared.color ??
    (runtime.isTty.stdout && runtime.env.NO_COLOR === undefined);
}

function resolveAutoFormat(shared: SharedFlags, runtime: Runtime): Format {
  if (shared.json === true) {
    return "json";
  }
  return runtime.isTty.stdout ? "human" : "json";
}

function resolveLogLevel(quiet: boolean, shared: SharedFlags): LogLevel {
  if (quiet) {
    return "error";
  }
  if (shared.verbose === true) {
    return "verbose";
  }
  return shared.logLevel ?? "info";
}

type LooseHandler = (
  args: {
    readonly flags: Record<string, unknown>;
    readonly positionals: Record<string, unknown>;
  },
  ctx: CommandContext<undefined, number>,
) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>;

async function executeMounted(
  invocation: Invocation,
  entry: MountEntry,
  rawFlags: Record<string, unknown>,
  values: readonly (string | undefined)[],
): Promise<void> {
  const state = invocation.state;
  state.commandId = entry.id;
  applySharedFlags(state, rawFlags as SharedFlags, invocation.runtime);
  if (entry.def.kind !== "result-command") {
    settleBug(
      invocation,
      new Error(
        `@prisma/cli-engine: ${entry.def.kind} execution is not implemented yet (it lands in D4)`,
      ),
    );
    return;
  }
  const needsError = await checkNeeds(entry.def, invocation.runtime);
  if (needsError !== undefined) {
    settleErrored(invocation, needsError);
    return;
  }
  let handler: LooseHandler;
  try {
    const module = await entry.def.handler();
    handler = module.default as LooseHandler;
  } catch (cause) {
    settleBug(invocation, cause);
    return;
  }
  const args = {
    flags: productFlags(entry.def, rawFlags),
    positionals: distributePositionals(entry.def, values),
  };
  const ctx = makeContext(invocation);
  try {
    const result = await handler(args, ctx);
    state.resolved = true;
    if (result.ok) {
      settleCompleted(invocation, result.value);
    } else {
      settleErrored(invocation, result.failure);
    }
  } catch (cause) {
    state.resolved = true;
    if (CliStructuredError.is(cause)) {
      settleErrored(invocation, cause);
    } else {
      settleBug(invocation, cause);
    }
  }
}

/** The needs checks the engine enforces before the handler loads. D3
 *  implements credentials; config (D5), dependencies and interaction
 *  (D4) land with their dispatches. */
async function checkNeeds(
  def: AnyCommand,
  runtime: Runtime,
): Promise<CliStructuredError | undefined> {
  if (def.needs?.credentials !== true) {
    return undefined;
  }
  const credentials = await runtime.getCredentials();
  if (credentials !== undefined) {
    return undefined;
  }
  return new CliStructuredError(
    "CLI.CREDENTIALS_REQUIRED",
    "You must be signed in to run this command.",
    { fix: "Sign in, then run the command again." },
  );
}

function productFlags(
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

// —————————————————————————————————————————————————————————————————————
// Context assembly
// —————————————————————————————————————————————————————————————————————

function makeUi(colorEnabled: boolean): Ui {
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

function promptsUnavailable(): never {
  throw new Error(
    "@prisma/cli-engine: prompts are not implemented yet (they land in D4)",
  );
}

function makeContext(
  invocation: Invocation,
): CommandContext<undefined, number> {
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
    config: undefined,
    present: present as CommandContext<undefined, number>["present"],
    getCredentials: (): Promise<Credentials | undefined> =>
      invocation.runtime.getCredentials(),
    report: (event) => reportEvent(invocation, event),
    prompt: {
      confirm: async () => promptsUnavailable(),
      consent: async () => promptsUnavailable(),
      select: async () => promptsUnavailable(),
      text: async () => promptsUnavailable(),
    },
    signal: invocation.runtime.signal,
    cwd: invocation.runtime.cwd,
    requireDependency: async () => {
      throw new Error(
        "@prisma/cli-engine: requireDependency is not implemented yet (it lands in D4)",
      );
    },
  };
}

/** Materializes ONLY the active format's presentation functions, at the
 *  return site: human → human + stdout + next; human+--quiet → stdout;
 *  json → json + next. */
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
  if (state.quiet) {
    return { stdout: presentations.stdout?.() };
  }
  return {
    human: presentations.human(ui),
    stdout: presentations.stdout?.(),
    next: presentations.next?.(),
  };
}

// —————————————————————————————————————————————————————————————————————
// Events
// —————————————————————————————————————————————————————————————————————

const SEVERITY_RANK: Readonly<Record<LogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
};

function reportEvent(invocation: Invocation, event: EngineEvent): void {
  const state = invocation.state;
  if (state.resolved) {
    throw new Error(
      "@prisma/cli-engine: report() was called after the handler resolved",
    );
  }
  invocation.hooks.onEvent?.(event);
  if (event.kind === "remediation") {
    state.remediations.push(event.action);
  }
  if (
    event.kind === "message" &&
    SEVERITY_RANK[event.severity] > SEVERITY_RANK[state.logLevel]
  ) {
    return;
  }
  if (state.format === "json") {
    emitFrame(invocation, {
      ...event,
      commandId: state.commandId,
      timestamp: invocation.now().toISOString(),
    });
    return;
  }
  renderEventHuman(invocation, event);
}

/** Human rendering for the D3 slice of the vocabulary; the rest of the
 *  rendering rules land in D4. */
function renderEventHuman(invocation: Invocation, event: EngineEvent): void {
  if (event.kind === "message") {
    invocation.runtime.stderr.write(`${event.text}\n`);
    return;
  }
  if (event.kind === "output") {
    const stream =
      event.channel === "data"
        ? invocation.runtime.stdout
        : invocation.runtime.stderr;
    stream.write(`${event.line}\n`);
  }
}

function emitFrame(invocation: Invocation, frame: StreamEvent): void {
  invocation.runtime.stdout.write(`${JSON.stringify(frame)}\n`);
  invocation.hooks.onStreamEvent?.(frame);
}

// —————————————————————————————————————————————————————————————————————
// Settlement + rendering
// —————————————————————————————————————————————————————————————————————

function settleCompleted(
  invocation: Invocation,
  presented: PresentedResult<unknown>,
): void {
  if (
    typeof presented !== "object" ||
    presented === null ||
    (presented as unknown as Record<symbol, unknown>)[PRESENTED] !== true
  ) {
    settleBug(
      invocation,
      new Error(
        "@prisma/cli-engine: a handler returned ok(...) without a PresentedResult built by ctx.present",
      ),
    );
    return;
  }
  const state = invocation.state;
  invocation.hooks.onPresented?.(presented);
  state.settledExitCode = presented.exitCode;
  if (state.format === "json") {
    const envelope: CompletedEnvelope = {
      ok: true,
      commandId: state.commandId,
      result:
        presented.presentation.json === undefined
          ? presented.data
          : presented.presentation.json,
      exitCode: presented.exitCode,
      diagnostics: presented.diagnostics,
      nextActions: presented.presentation.next ?? [],
    };
    emitFrame(invocation, {
      kind: "result",
      envelope,
      commandId: state.commandId,
      timestamp: invocation.now().toISOString(),
    });
    return;
  }
  renderCompletedHuman(invocation, presented);
}

function renderCompletedHuman(
  invocation: Invocation,
  presented: PresentedResult<unknown>,
): void {
  const { runtime, state } = invocation;
  if (state.quiet) {
    for (const line of presented.presentation.stdout ?? []) {
      runtime.stdout.write(`${line}\n`);
    }
    return;
  }
  for (const block of presented.presentation.human ?? []) {
    renderBlock(block, (line) => runtime.stdout.write(`${line}\n`));
  }
  for (const action of presented.presentation.next ?? []) {
    runtime.stdout.write(`${renderNextAction(action)}\n`);
  }
  for (const diagnostic of presented.diagnostics) {
    writeDiagnostic(runtime.stderr, diagnostic);
  }
}

function diagnosticOf(error: CliStructuredError): Diagnostic {
  const { ok: _ok, ...diagnostic } = error.toEnvelope();
  return diagnostic;
}

function settleErrored(
  invocation: Invocation,
  error: CliStructuredError,
): void {
  const state = invocation.state;
  state.settledExitCode = 2;
  emitErrored(invocation, {
    ok: false,
    commandId: state.commandId,
    error: diagnosticOf(error),
    diagnostics: [],
    nextActions: [...state.remediations],
  });
}

function settleBug(invocation: Invocation, cause: unknown): void {
  const state = invocation.state;
  state.settledExitCode = 1;
  emitErrored(invocation, {
    ok: false,
    commandId: state.commandId,
    error: {
      code: "CLI.INTERNAL_ERROR",
      severity: "error",
      summary: firstLine(
        cause instanceof Error ? cause.message : String(cause),
      ),
    },
    diagnostics: [],
    nextActions: [...state.remediations],
  });
}

function emitErrored(invocation: Invocation, envelope: ErroredEnvelope): void {
  const state = invocation.state;
  if (state.format === "json") {
    emitFrame(invocation, {
      kind: "result",
      envelope,
      commandId: envelope.commandId,
      timestamp: invocation.now().toISOString(),
    });
    return;
  }
  const stderr = invocation.runtime.stderr;
  writeDiagnostic(stderr, envelope.error);
  for (const diagnostic of envelope.diagnostics) {
    writeDiagnostic(stderr, diagnostic);
  }
  for (const action of envelope.nextActions) {
    stderr.write(`${renderNextAction(action)}\n`);
  }
}

// —————————————————————————————————————————————————————————————————————
// Human layout primitives
// —————————————————————————————————————————————————————————————————————

const TONE_SYMBOL: Readonly<Record<string, string>> = {
  ok: "✔",
  error: "✖",
  warn: "⚠",
  info: "ℹ",
};

function renderBlock(block: Block, write: (line: string) => void): void {
  switch (block.kind) {
    case "summary":
      write(`${TONE_SYMBOL[block.tone]} ${block.text}`);
      return;
    case "fields":
      for (const row of block.rows) {
        write(`${row.label}: ${row.value}`);
      }
      return;
    case "table":
      write(block.columns.join("  "));
      for (const row of block.rows) {
        write(row.join("  "));
      }
      return;
    case "list":
      for (const item of block.items) {
        write(`- ${item}`);
      }
      return;
    case "tree":
      writeTree(block.roots, 0, write);
      return;
  }
}

function writeTree(
  nodes: ReadonlyArray<{
    readonly label: string;
    readonly children?: ReadonlyArray<{
      readonly label: string;
      readonly children?: readonly unknown[];
    }>;
  }>,
  depth: number,
  write: (line: string) => void,
): void {
  for (const node of nodes) {
    write(`${"  ".repeat(depth)}${node.label}`);
    if (node.children !== undefined) {
      writeTree(
        node.children as Parameters<typeof writeTree>[0],
        depth + 1,
        write,
      );
    }
  }
}

const DIAGNOSTIC_SYMBOL: Readonly<Record<Diagnostic["severity"], string>> = {
  error: "✖",
  warn: "⚠",
  info: "ℹ",
};

function writeDiagnostic(
  stream: { write(text: string): void },
  diagnostic: Diagnostic,
): void {
  stream.write(
    `${DIAGNOSTIC_SYMBOL[diagnostic.severity]} [${diagnostic.code}] ${diagnostic.summary}\n`,
  );
  if (diagnostic.why !== undefined) {
    stream.write(`  why: ${diagnostic.why}\n`);
  }
  if (diagnostic.fix !== undefined) {
    stream.write(`  fix: ${diagnostic.fix}\n`);
  }
}

function renderNextAction(action: NextAction): string {
  return `→ ${action.label}${action.command === undefined ? "" : `: ${action.command}`}`;
}

// —————————————————————————————————————————————————————————————————————
// The test harness — same machinery, in-memory streams (R7)
// —————————————————————————————————————————————————————————————————————

export interface TestCliSpec {
  readonly products?: readonly ProductManifest[];
  readonly commands: MountedTree;
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly credentials?: Credentials;
  readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  readonly now?: () => Date;
}

function inputStreamFromString(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      if (bytes.length > 0) {
        yield bytes;
      }
    },
  };
}

export function createTestCliImpl(spec: TestCliSpec): TestCli {
  const engine = buildEngine(
    {
      name: "prisma-test",
      version: "0.0.0",
      products: spec.products ?? [],
      groups: spec.groups ?? {},
      commands: spec.commands,
    },
    { now: spec.now },
  );
  return {
    async run(argv, opts) {
      let stdoutText = "";
      let stderrText = "";
      const frames: StreamEvent[] = [];
      const events: EngineEvent[] = [];
      let presented: PresentedResult<unknown> | undefined;
      const controller = new AbortController();
      const abort = opts?.abort;
      if (abort !== undefined) {
        if (abort.aborted) {
          controller.abort(abort.reason);
        } else {
          abort.addEventListener(
            "abort",
            () => controller.abort(abort.reason),
            {
              once: true,
            },
          );
        }
      }
      const runtime: Runtime = {
        stdout: {
          write: (text) => {
            stdoutText += text;
          },
        },
        stderr: {
          write: (text) => {
            stderrText += text;
          },
        },
        stdin: inputStreamFromString(opts?.stdin ?? ""),
        cwd: opts?.cwd ?? "/",
        env: opts?.env ?? {},
        isTty: {
          stdin: opts?.isTty?.stdin ?? false,
          stdout: opts?.isTty?.stdout ?? false,
          stderr: opts?.isTty?.stderr ?? false,
        },
        signal: controller.signal,
        config: { sections: spec.config ?? {}, diagnostics: [] },
        getCredentials: async () => spec.credentials,
        packageManager: spec.packageManager ?? "unknown",
      };
      const exitCode = await engine.execute(argv, runtime, {
        onEvent: (event) => {
          events.push(event);
          opts?.onEvent?.(event);
        },
        onPresented: (value) => {
          presented = value;
        },
        onStreamEvent: (frame) => {
          frames.push(frame);
        },
        answers: opts?.answers,
      });
      return {
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        json: frames,
        events,
        presented,
      };
    },
  };
}
