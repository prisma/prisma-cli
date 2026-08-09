/**
 * The definition-surface leaf shared by index, execution, and
 * config-loader: types, constructors, flag/positional builders, and
 * symbols. Internal — products import @prisma/cli-engine, which
 * re-exports all of this.
 *
 * Normative source: .drive/projects/prisma-cli-v8/assets/engine/
 * engine-interface-draft.ts (v8).
 */
import type {
  CliStructuredError,
  Diagnostic,
  NextAction,
  Result,
} from "@prisma/cli-engine/protocol";

/**
 * The commentary severity scale; also the log-level axis. Distinct from
 * Diagnostic severity: 'verbose' grades commentary, which never enters
 * the envelope.
 */
export type Severity = "error" | "warn" | "info" | "verbose";
export type LogLevel = Severity;

export type Format = "human" | "json";

// —————————————————————————————————————————————————————————————————————
// §1 Events — one engine vocabulary, product extensions in `data` (R14)
// —————————————————————————————————————————————————————————————————————

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders (human mode) and streams (json mode);
 * `data` is the product extension, passed through untouched. Events are
 * transcript, not aggregated into the envelope — the one exception is
 * `remediation` → nextActions.
 */
export type EngineEvent =
  | {
      readonly kind: "step-started";
      readonly step: string;
      readonly id?: string;
      readonly parentId?: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "step-finished";
      readonly step: string;
      readonly id?: string;
      readonly outcome: "ok" | "failed" | "skipped" | "warning";
      readonly data?: unknown;
    }
  | {
      readonly kind: "progress";
      readonly step?: string;
      readonly completed: number;
      readonly total?: number;
      readonly data?: unknown;
    }
  /**
   * Commentary at a severity; display-filtered by log level. 'error' is
   * not valid here: fatal problems are the Result's error;
   * envelope-worthy findings are diagnostics.
   */
  | {
      readonly kind: "message";
      readonly severity: Exclude<Severity, "error">;
      readonly text: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "output";
      readonly source: string;
      readonly channel: "data" | "diagnostic";
      readonly line: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "remediation";
      readonly action: NextAction;
      readonly data?: unknown;
    }
  | {
      readonly kind: "endpoint";
      readonly name: string;
      readonly url: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "status";
      readonly subject: string;
      readonly status: string;
      readonly from?: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "artifact";
      readonly path: string;
      readonly description?: string;
      readonly data?: unknown;
    };

// —————————————————————————————————————————————————————————————————————
// §2 Outcomes and presented results
// —————————————————————————————————————————————————————————————————————

/**
 * What a command concluded, stated at the return site. `exitCode` is
 * required at every return site iff the command documents exit codes,
 * and forbidden otherwise. `diagnostics` may be omitted at the call
 * site; the presented result always carries an array.
 */
export type Outcome<T, TCode extends number = never> = [TCode] extends [never]
  ? {
      readonly data: T;
      readonly diagnostics?: readonly Diagnostic[];
    }
  : {
      readonly data: T;
      readonly exitCode: TCode | 0;
      readonly diagnostics?: readonly Diagnostic[];
    };

export const PRESENTED: unique symbol = Symbol.for(
  "prisma.cli-engine.presented",
);

/**
 * What a completed command's handler returns inside `ok(...)`: the
 * outcome plus the presentation the active format already materialized.
 * Built exclusively by ctx.present — the brand makes hand-construction
 * a type error.
 */
export interface PresentedResult<T> {
  readonly [PRESENTED]: true;
  readonly data: T;
  /** 0 unless the outcome selected a documented code. */
  readonly exitCode: number;
  /** Never undefined; empty when the outcome recorded no findings. */
  readonly diagnostics: readonly Diagnostic[];
  readonly presentation: {
    readonly human?: readonly Block[];
    readonly stdout?: readonly string[];
    readonly json?: unknown;
    readonly next?: readonly NextAction[];
  };
}

/**
 * The per-format presentation functions a handler supplies to
 * ctx.present. Only the active format's functions are invoked, at the
 * return site.
 */
export interface Presentations {
  readonly human: (ui: Ui) => readonly Block[];
  readonly stdout?: () => readonly string[];
  readonly json?: () => unknown;
  readonly next?: () => readonly NextAction[];
}

// —————————————————————————————————————————————————————————————————————
// §3 Config sections — a product-level fact (one product, one section)
// —————————————————————————————————————————————————————————————————————

/**
 * A product's named slice of prisma.config.ts. The token couples the
 * section name, its validated type, and its total validator. The
 * validator owns absence: its input is the raw section value, or
 * undefined when the config file has no such section. It returns
 * findings; it never throws (R10).
 */
export interface ConfigSection<T> {
  readonly name: string;
  readonly validate: (raw: unknown | undefined) => SectionValidation<T>;
}

/**
 * Diagnostics on an OK validation are warnings: the engine writes them
 * to stderr as commentary (log-level filtered, human and json alike);
 * they never enter the stream or the envelope.
 */
export type SectionValidation<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function defineConfigSection<T>(spec: {
  readonly name: string;
  readonly validate: (raw: unknown | undefined) => SectionValidation<T>;
}): ConfigSection<T> {
  return Object.freeze({ name: spec.name, validate: spec.validate });
}

// —————————————————————————————————————————————————————————————————————
// §4 The handler context — the whole world arrives as one argument (R4)
// —————————————————————————————————————————————————————————————————————

export interface CommandContext<
  TConfig = undefined,
  TCode extends number = never,
> {
  /**
   * The validated value of the command's needed config section —
   * exactly TConfig; absence semantics belong to the product's
   * validator (§3). Commands with no config need get undefined.
   */
  readonly config: TConfig;

  /**
   * Builds the PresentedResult for the active format. The only
   * constructor of PresentedResult.
   */
  readonly present: <T>(
    outcome: Outcome<T, TCode>,
    presentations: Presentations,
  ) => PresentedResult<T>;

  /**
   * Management-API credentials, resolved at call time. Undefined when
   * unauthenticated; commands with needs.credentials never see
   * undefined — the engine fails them early.
   */
  readonly getCredentials: () => Promise<Credentials | undefined>;

  /** The one way to emit while running (§1). */
  readonly report: (event: EngineEvent) => void;

  /** Interactive input (§4a). */
  readonly prompt: PromptSurface;

  /**
   * Fires on Ctrl-C/SIGTERM (engine-owned; second signal force-exits).
   * Session commands run until it fires.
   */
  readonly signal: AbortSignal;

  /** Where the user invoked the CLI. Products never read process.cwd(). */
  readonly cwd: string;

  /**
   * Conditional optional-dependency need (R13). Resolves when the
   * optional peer dependency is importable from the user's project;
   * otherwise returns the engine's structured missing-dependency error
   * for the handler to pass to notOk.
   */
  readonly requireDependency: (
    specifier: string,
  ) => Promise<Result<void, CliStructuredError>>;
}

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud product's auth library. */
  readonly token: string;
}

/**
 * §4a Prompts. Every prompt except `consent` may carry a
 * product-specified `default`. Under --yes and in non-interactive
 * contexts a prompt with a default resolves to it; one without a
 * default halts the invocation with a structured error.
 */
export interface PromptSurface {
  readonly confirm: (
    question: string,
    opts?: { readonly default?: boolean },
  ) => Promise<Result<boolean, CliStructuredError>>;
  /**
   * A question requiring explicit consent — never inferable.
   * Structurally undefaultable: no default parameter exists, so --yes,
   * Enter-through, and non-interactive contexts can never satisfy it.
   */
  readonly consent: (
    question: string,
  ) => Promise<Result<boolean, CliStructuredError>>;
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<Result<T, CliStructuredError>>;
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<Result<string, CliStructuredError>>;
}

// —————————————————————————————————————————————————————————————————————
// §5 Flags and positionals — directly executable, typed by inference (R1)
// —————————————————————————————————————————————————————————————————————

/**
 * Single-character alias, enforced at the type level: `Char<'q'>` is
 * 'q'; `Char<'ab'>` is never.
 */
export type Char<S extends string> = S extends `${string}${infer Rest}`
  ? Rest extends ""
    ? S
    : never
  : never;

export const FLAG: unique symbol = Symbol("prisma.cli-engine.flag");

export interface FlagSpec<T> {
  /** Phantom carrier for inference; exported so declaration emit works. */
  readonly [FLAG]: T;
}

interface FlagRuntimeSpec {
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

function brandFlag<T>(spec: FlagRuntimeSpec): FlagSpec<T> {
  return Object.freeze(spec) as unknown as FlagSpec<T>;
}

/**
 * Product-declared flags. The shared family (--format/--json,
 * --log-level/--verbose, --quiet, --yes, --interactive, --color) is
 * engine-injected and reserved. Flags are optional by default
 * (requiredString is the exception); positionals are required by
 * default (optionalString is the exception).
 */
export const flag = {
  string<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
    default?: string;
  }): FlagSpec<string | undefined> {
    return brandFlag<string | undefined>({ type: "string", ...spec });
  },
  requiredString<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
  }): FlagSpec<string> {
    return brandFlag<string>({ type: "requiredString", ...spec });
  },
  number<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
    default?: number;
  }): FlagSpec<number | undefined> {
    return brandFlag<number | undefined>({ type: "number", ...spec });
  },
  boolean<A extends string = never>(spec: {
    brief: string;
    alias?: A & Char<A>;
  }): FlagSpec<boolean> {
    return brandFlag<boolean>({ type: "boolean", ...spec });
  },
  enum<const T extends readonly string[], A extends string = never>(spec: {
    brief: string;
    values: T;
    alias?: A & Char<A>;
    default?: T[number];
  }): FlagSpec<T[number] | undefined> {
    return brandFlag<T[number] | undefined>({ type: "enum", ...spec });
  },
  repeated<A extends string = never>(spec: {
    brief: string;
    placeholder?: string;
    alias?: A & Char<A>;
  }): FlagSpec<readonly string[]> {
    return brandFlag<readonly string[]>({ type: "repeated", ...spec });
  },
};

export const POSITIONAL: unique symbol = Symbol("prisma.cli-engine.positional");

export interface PositionalSpec<T> {
  /** Phantom carrier for inference; exported so declaration emit works. */
  readonly [POSITIONAL]: T;
}

interface PositionalRuntimeSpec {
  readonly type: "string" | "optionalString" | "variadic";
  readonly brief: string;
  readonly placeholder: string;
}

function brandPositional<T>(spec: PositionalRuntimeSpec): PositionalSpec<T> {
  return Object.freeze(spec) as unknown as PositionalSpec<T>;
}

export const positional = {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string> {
    return brandPositional<string>({ type: "string", ...spec });
  },
  optionalString(spec: {
    brief: string;
    placeholder: string;
  }): PositionalSpec<string | undefined> {
    return brandPositional<string | undefined>({
      type: "optionalString",
      ...spec,
    });
  },
  /**
   * Zero or more trailing values; at most one, declared last (order =
   * declaration order; keys must not be integer-like).
   */
  variadic(spec: {
    brief: string;
    placeholder: string;
  }): PositionalSpec<readonly string[]> {
    return brandPositional<readonly string[]>({ type: "variadic", ...spec });
  },
};

/** The parse SPI: a command's argument surface, one property. */
export interface ArgsSpec<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags?: TFlags;
  readonly positionals?: TPositionals;
}

/**
 * What a handler receives: separate namespaces, symmetric access —
 * `args.flags.to`, `args.positionals.name`. Product flag keys are
 * camelCase and transliterate to --kebab-case on the CLI.
 */
export interface Args<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags: {
    readonly [K in keyof TFlags]: TFlags[K] extends FlagSpec<infer T>
      ? T
      : never;
  };
  readonly positionals: {
    readonly [K in keyof TPositionals]: TPositionals[K] extends PositionalSpec<
      infer T
    >
      ? T
      : never;
  };
}

// —————————————————————————————————————————————————————————————————————
// §6 Command definitions — light at startup (R9), path-free (R12),
// runtime-discriminated by `kind`
// —————————————————————————————————————————————————————————————————————

/** The help SPI: words only — the engine formats. */
export interface HelpSpec {
  /** One line, imperative, shown in listings. */
  readonly summary: string;
  readonly description?: string;
  /** Copy-pastable invocations, shown verbatim. */
  readonly examples?: readonly string[];
}

/**
 * The preconditions SPI: everything the engine enforces BEFORE the
 * handler runs. Each unmet need fails the command early with the
 * engine's own structured error.
 */
export interface NeedsSpec<TConfig> {
  /**
   * The product's config section token: validate it, fail me on its
   * error diagnostics, hand me the value as ctx.config.
   */
  readonly config?: ConfigSection<TConfig>;
  /** Fail early with the sign-in error when unauthenticated. */
  readonly credentials?: true;
  /**
   * Optional peer dependencies this command cannot run without; the
   * engine probes resolvability and phrases the install error.
   * (Conditional needs use ctx.requireDependency instead.)
   */
  readonly dependencies?: readonly string[];
  /**
   * Fail early in json/non-interactive/CI/non-TTY contexts. This is a
   * MECHANICAL precondition — "an interactive terminal is required" —
   * and deliberately NOT an agent barrier: the client's nature is
   * unverifiable, and a flag claiming to exclude agents would be a
   * false guarantee. Anything requiring a verified human belongs
   * server-side, where identity actually exists.
   */
  readonly interaction?: true;
}

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<
    never,
    FlagSpec<unknown>
  >,
  TPositionals extends Record<string, PositionalSpec<unknown>> = Record<
    never,
    PositionalSpec<unknown>
  >,
  TConfig = undefined,
  TCode extends number = never,
> {
  readonly kind: "result-command";
  readonly help: HelpSpec;
  readonly args?: ArgsSpec<TFlags, TPositionals>;
  readonly needs?: NeedsSpec<TConfig>;

  /**
   * The command's documented exit codes (4–99): code → meaning. The
   * keys type the outcome's exitCode, making it REQUIRED at every
   * return site (`0` or a documented code). Absent = the command only
   * exits 0/1/2/3 and the outcome carries no exitCode.
   */
  readonly exitCodes?: Readonly<Record<TCode, string>>;

  /**
   * The handler function, referenced directly — never a dynamic import
   * (operator ruling, 2026-08-09). A handler that needs heavy
   * dependencies imports them at execution time, inside its body (R9).
   * A handler defined in another file is imported statically and
   * annotated CommandHandler<typeof def>.
   */
  readonly handler: Handler<TFlags, TPositionals, TConfig, TCode>;
}

export type Handler<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TConfig,
  TCode extends number = never,
> = (
  args: Args<TFlags, TPositionals>,
  ctx: CommandContext<TConfig, TCode>,
) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>;

/** For impl files: `const run: CommandHandler<typeof migrateCommand> = …` */
export type CommandHandler<D> =
  D extends CommandDefinition<infer F, infer P, infer C, infer K>
    ? Handler<F, P, C, K>
    : never;

export function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<
    never,
    FlagSpec<unknown>
  >,
  TPositionals extends Record<string, PositionalSpec<unknown>> = Record<
    never,
    PositionalSpec<unknown>
  >,
  TConfig = undefined,
  TCode extends number = never,
>(
  def: Omit<CommandDefinition<TFlags, TPositionals, TConfig, TCode>, "kind">,
): CommandDefinition<TFlags, TPositionals, TConfig, TCode> {
  return Object.freeze({ ...def, kind: "result-command" as const });
}

/**
 * A session command (dev, log tail): runs until the signal fires,
 * speaks entirely through events, returns Result<void>. No
 * presentation, no exit-code set. A session always supports json mode:
 * the event stream is its json surface.
 */
export interface SessionCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<
    never,
    FlagSpec<unknown>
  >,
  TPositionals extends Record<string, PositionalSpec<unknown>> = Record<
    never,
    PositionalSpec<unknown>
  >,
  TConfig = undefined,
> {
  readonly kind: "session-command";
  readonly help: HelpSpec;
  readonly args?: ArgsSpec<TFlags, TPositionals>;
  readonly needs?: NeedsSpec<TConfig>;
  readonly handler: (
    args: Args<TFlags, TPositionals>,
    ctx: CommandContext<TConfig>,
  ) => Promise<Result<void, CliStructuredError>>;
}

export function defineSessionCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<
    never,
    FlagSpec<unknown>
  >,
  TPositionals extends Record<string, PositionalSpec<unknown>> = Record<
    never,
    PositionalSpec<unknown>
  >,
  TConfig = undefined,
>(
  def: Omit<SessionCommandDefinition<TFlags, TPositionals, TConfig>, "kind">,
): SessionCommandDefinition<TFlags, TPositionals, TConfig> {
  return Object.freeze({ ...def, kind: "session-command" as const });
}

/**
 * A server command (lsp): a foreign client on the other end of stdio
 * owns the conversation, so the engine hands over the streams. Events,
 * presentation, formats, and prompts do not apply; the handler returns
 * the exit code directly. The shared flag family is NOT injected.
 */
export interface ServerCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<
    never,
    FlagSpec<unknown>
  >,
  TConfig = undefined,
> {
  readonly kind: "server-command";
  readonly help: HelpSpec;
  readonly args?: ArgsSpec<TFlags, Record<never, PositionalSpec<unknown>>>;
  readonly needs?: NeedsSpec<TConfig>;
  readonly handler: (
    args: Args<TFlags, Record<never, PositionalSpec<unknown>>>,
    io: {
      readonly stdin: InputStream;
      readonly stdout: OutputStream;
      readonly stderr: OutputStream;
      readonly signal: AbortSignal;
      readonly cwd: string;
      readonly config: TConfig;
    },
  ) => Promise<number>;
}

export function defineServerCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<
    never,
    FlagSpec<unknown>
  >,
  TConfig = undefined,
>(
  def: Omit<ServerCommandDefinition<TFlags, TConfig>, "kind">,
): ServerCommandDefinition<TFlags, TConfig> {
  return Object.freeze({ ...def, kind: "server-command" as const });
}

/**
 * Erased union for manifests and mount maps; `kind` discriminates.
 * Handler functions are erased to `unknown` here — the concrete types
 * travel through each definition's generics, not through this union.
 */
export type AnyCommand =
  | (Omit<
      CommandDefinition<
        Record<string, FlagSpec<unknown>>,
        Record<string, PositionalSpec<unknown>>,
        unknown,
        number
      >,
      "handler"
    > & { readonly handler: unknown })
  | (Omit<
      SessionCommandDefinition<
        Record<string, FlagSpec<unknown>>,
        Record<string, PositionalSpec<unknown>>,
        unknown
      >,
      "handler"
    > & { readonly handler: unknown })
  | (Omit<
      ServerCommandDefinition<Record<string, FlagSpec<unknown>>, unknown>,
      "handler"
    > & { readonly handler: unknown });

// —————————————————————————————————————————————————————————————————————
// §7 Presentation primitives — the R5 vocabulary
// —————————————————————————————————————————————————————————————————————

/**
 * Deliberately small; grows by the same evidence rule as events.
 * Recorded findings are NOT a Block — they are the outcome's
 * diagnostics; the engine renders them and carries them into the
 * envelope, so the two surfaces cannot diverge.
 */
export type Block =
  | {
      readonly kind: "summary";
      readonly tone: "ok" | "error" | "warn" | "info";
      readonly text: string;
    }
  | {
      readonly kind: "fields";
      readonly rows: ReadonlyArray<{
        label: string;
        value: string;
        sensitive?: boolean;
      }>;
    }
  | {
      readonly kind: "table";
      readonly columns: readonly string[];
      readonly rows: ReadonlyArray<readonly string[]>;
    }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "tree"; readonly roots: readonly TreeNode[] };

export interface TreeNode {
  readonly label: string;
  readonly children?: readonly TreeNode[];
}

/** Styling helpers usable inside block text; no direct writing. */
export interface Ui {
  readonly emphasize: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly code: (text: string) => string;
}

// —————————————————————————————————————————————————————————————————————
// §8 Streams — minimal structural types; no NodeJS.* in the public
// surface
// —————————————————————————————————————————————————————————————————————

export interface OutputStream {
  write(text: string): void;
}

/**
 * Byte-oriented, so server commands can implement byte-counted
 * protocols (lsp's Content-Length framing). setRawMode is present
 * where the platform supports keypress input.
 */
export interface InputStream extends AsyncIterable<Uint8Array> {
  readonly setRawMode?: (enabled: boolean) => void;
}

// —————————————————————————————————————————————————————————————————————
// §9 Envelopes and the json stream
// —————————————————————————————————————————————————————————————————————

export interface CompletedEnvelope<T = unknown> {
  /**
   * ok = COMPLETED (the command executed to its end). A completed
   * result may still carry findings and a non-zero exit code — bad
   * news is a result, not an error.
   */
  readonly ok: true;
  /**
   * The command's stable dotted identity — its full mount path
   * ('project.env.add'). The schema-dispatch key for machine consumers.
   */
  readonly commandId: string;
  readonly result: T;
  readonly exitCode: number;
  /** The recorded findings, verbatim from the presented outcome. */
  readonly diagnostics: readonly Diagnostic[];
  readonly nextActions: readonly NextAction[];
}

export interface ErroredEnvelope {
  /** ok = false: the command did NOT complete. */
  readonly ok: false;
  readonly commandId: string;
  /**
   * The PRIMARY error — what aborted the command. Severity 'error' by
   * definition. A thrown CliStructuredError serializes to exactly this
   * shape.
   */
  readonly error: Diagnostic;
  /** Accompanying findings when the abort had several. */
  readonly diagnostics: readonly Diagnostic[];
  /** Aggregated from remediation events. */
  readonly nextActions: readonly NextAction[];
}

/**
 * json mode emits one StreamEvent per line: the handler's events,
 * flattened with the stream metadata, then exactly one terminal
 * 'result' member carrying the envelope.
 */
export type StreamEvent =
  | (EngineEvent & StreamMeta)
  | ({
      readonly kind: "result";
      readonly envelope: CompletedEnvelope | ErroredEnvelope;
    } & StreamMeta);

export interface StreamMeta {
  readonly commandId: string;
  /** ISO 8601 UTC. Injectable clock in tests (§11). */
  readonly timestamp: string;
}

// —————————————————————————————————————————————————————————————————————
// §10 Product manifests and shell mounting — the shell owns the tree; a
// product owns its section (R12)
// —————————————————————————————————————————————————————————————————————

/**
 * What a product package exports: its config section (declared once —
 * a product-level fact) and its commands by NAME. A command whose
 * needs.config token is not its product's section is a construction
 * error.
 */
export interface ProductManifest {
  readonly configSection?: ConfigSection<unknown>;
  readonly commands: Readonly<Record<string, AnyCommand>>;
  /**
   * The product's documentation base URL. The engine derives each
   * diagnostic's docs link from base + code.
   */
  readonly docsBaseUrl?: string;
}

/** What the shell builds: commands by PATH (space-separated, 'db migrate'). */
export type MountedTree = Readonly<Record<string, AnyCommand>>;

export interface Cli {
  /**
   * Parse, execute, render, return the exit code. Never calls
   * process.exit; never touches streams other than the provided ones.
   */
  run(argv: readonly string[], runtime: Runtime): Promise<number>;
}

/** Everything environmental, injected once by the bin (or by a test). */
export interface Runtime {
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly stdin: InputStream;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTty: {
    readonly stdin: boolean;
    readonly stdout: boolean;
    readonly stderr: boolean;
  };
  readonly signal: AbortSignal;
  /**
   * Loaded config + file-level diagnostics; the shell builds this via
   * the unified loader (R10). Tests hand in fixtures.
   */
  readonly config: LoadedConfig;
  readonly getCredentials: () => Promise<Credentials | undefined>;
  /**
   * Used by the ENGINE to phrase install commands (products never do —
   * see needs.dependencies and ctx.requireDependency).
   */
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
}

export interface LoadedConfig {
  /**
   * Raw section values by name; validation happens per command via its
   * product's section token.
   */
  readonly sections: Readonly<Record<string, unknown>>;
  /**
   * File-level problems (unevaluable module, missing version marker)
   * carry section: null and fail only commands with a needs.config
   * section; commands with no config need run normally.
   */
  readonly diagnostics: ReadonlyArray<{
    readonly section: string | null;
    readonly diagnostic: Diagnostic;
  }>;
}

/**
 * The config contract version defineConfig writes as the structural
 * `$prismaConfig` marker; the loader checks it before interpreting
 * anything (R10).
 */
export const PRISMA_CONFIG_VERSION = 1;

export interface TestCli {
  run(
    argv: readonly string[],
    opts?: {
      readonly stdin?: string;
      /**
       * Scripted prompt answers, consumed in order; a run that prompts
       * past the script fails the test.
       */
      readonly answers?: ReadonlyArray<string | boolean>;
      /** Abort the run (session tests): fires the context signal. */
      readonly abort?: AbortSignal;
      /** Live event tap, for asserting mid-session behavior. */
      readonly onEvent?: (event: EngineEvent) => void;
      readonly cwd?: string;
      readonly isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
      readonly env?: Readonly<Record<string, string | undefined>>;
    },
  ): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    /** Parsed stream (events + the terminal result) when json mode. */
    readonly json: readonly StreamEvent[];
    /** Every EngineEvent the handler emitted, for semantic assertions. */
    readonly events: readonly EngineEvent[];
    /**
     * The PresentedResult the handler returned, for semantic assertions
     * without byte-scraping.
     */
    readonly presented?: PresentedResult<unknown>;
  }>;
}
