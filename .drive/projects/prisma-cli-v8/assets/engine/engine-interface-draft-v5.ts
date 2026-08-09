/**
 * DRAFT v5 — the unified CLI engine's public interface.
 * v1 initial · v2 round-1 fixes · v3 return-site presentation ·
 * v4 completed/errored semantics, --format, log levels, prompt defaults ·
 * v5 round-3 closure: diagnostics declared once at ctx.present, typed
 * outcome codes, prompt.consent, byte-capable raw stdin.
 * Prior versions preserved as -v1…-v4.ts; review artifacts in ./reviews/.
 *
 * THE MODEL, in one analogy (operator, 2026-08-09): commands settle like
 * promises. A command can COMPLETE — and its completion can be
 * successful or unsuccessful, both presented through the same machinery,
 * distinguished by outcome code and diagnostics — or it can ERROR, which
 * aborts out of the normal process and gets its own special handling.
 *
 * Implementation prerequisite: ADR 239 (prisma/prisma) is amended so
 * completed-but-unsuccessful command results (verify/check/runner
 * findings) are carried as diagnostics with their dotted codes inside a
 * completed envelope with a catalogued exit code — not as structured
 * failures with exit 2, as it classifies them today.
 *
 * Everything a product package imports for CLI purposes lives here (R3).
 * Requirement references (R1–R14) point at docs/architecture/
 * cli-engine-requirements.md in prisma-cli. Nothing from stricli appears —
 * it is an internal of the engine package.
 *
 * EXECUTION PROTOCOL. A handler receives (args, context), emits zero or
 * more events through context.report, and finishes one of two ways:
 *
 *   COMPLETED — it returns ok(ctx.present(data, presentations)): the
 *   command executed to its end and has a result. A completed result may
 *   still be bad news; it carries an outcome code from the command's
 *   documented catalogue (`migration check` completes, presents its
 *   findings like any result, and exits 4). Presentation always runs for
 *   completed results.
 *
 *   ERRORED — it returns notOk(structuredError): the command did not
 *   complete. The engine renders the error envelope (code, summary, why,
 *   fix); there is no product presentation on the error path.
 *   `remediation` events emitted before the error are aggregated into
 *   the error envelope's nextActions, as `warn` messages are into
 *   warnings — so guidance survives without a second presentation system.
 *
 * Session commands (defineSessionCommand) keep emitting until
 * context.signal fires, then clean up and return. Stdio protocol servers
 * (defineRawCommand) bypass the protocol by declaration. Liveness display
 * is the engine's (shown when a command runs quietly past a threshold).
 * Nothing product-authored executes after the handler resolves — the
 * engine receives values, never callbacks.
 *
 * FORMATS AND LEVELS. The output format is an engine mode:
 * `--format <human|json>`, auto-selected when unspecified (human on a
 * TTY stdout, json otherwise — deliberate agent-facing behavior);
 * `--json` is shorthand for `--format json`. In json mode the engine
 * suppresses prompts (they fail structurally) and frames every event as
 * one NDJSON line. Commentary is filtered by `--log-level
 * <error|warn|info|verbose>` (default info); `--verbose` is shorthand
 * for `--log-level verbose`. The engine injects the shared flag family
 * on every non-raw command: --format/--json, --log-level/-v/--verbose,
 * -q/--quiet, -y/--yes, --interactive/--no-interactive,
 * --color/--no-color. Products cannot declare flags with those names.
 * Product flag keys are camelCase and transliterate to --kebab-case.
 *
 * EXIT CODES (R6): 0 completed; 1 bug only; 2 errored (expected,
 * structured); 3 user abort (Ctrl-C, or cancelling a prompt the command
 * cannot proceed without); 4–99 outcome codes from the command's
 * catalogue; 130/143 delivered signals. The engine owns signal wiring:
 * first signal fires context.signal and awaits handler teardown; a
 * second signal exits immediately with the signal's code.
 */

// ————————————————————————————————————————————————————————————————————————
// Foundation types (from the zero-dependency foundation package — which
// also owns NextAction, so the engine and the error envelope share it
// without a package cycle). Shown for reading convenience.
// ————————————————————————————————————————————————————————————————————————

import type { CliStructuredError, NextAction, Result } from '@prisma/cli-foundation'

/** The one severity scale for commentary; also the log-level axis
 *  (ADR 239's error|warn|info, extended with verbose for detail
 *  commentary). Step outcomes are completion states, not severities. */
export type Severity = 'error' | 'warn' | 'info' | 'verbose'
export type LogLevel = Severity

export type Format = 'human' | 'json'

// ————————————————————————————————————————————————————————————————————————
// §1 Events — R14: one engine vocabulary, product extensions in `data`
// ————————————————————————————————————————————————————————————————————————

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders consistently (human mode) and frames
 * (json mode). `data` is the product extension: passed through to
 * machine consumers untouched, never interpreted by the engine,
 * documented and versioned by the product as its own public API. A
 * structure recurring inside `data` across commands is the promotion
 * signal (R14).
 *
 * Rendering, human mode: `output` events with channel 'data' are the
 * command's data and go to OUR stdout (what `log tail > file` captures);
 * everything else is commentary on stderr, filtered by the active log
 * level (`message` events by their severity; other kinds display at
 * info). In json mode everything is framed on stdout (§9).
 *
 * report() is synchronous fire-and-forget; the engine buffers and writes
 * asynchronously (no backpressure signal — accepted trade). Calling it
 * after the handler has resolved is a bug (InternalError). Events during
 * teardown (after the signal, before resolution) are normal.
 */
export type EngineEvent =
  /** A named phase began. `id`/`parentId` express nesting; omitted for
   *  flat steps. */
  | {
      readonly kind: 'step-started'
      readonly step: string
      readonly id?: string
      readonly parentId?: string
      readonly data?: unknown
    }
  /** The phase ended. `outcome` is a completion state and drives the
   *  ✔/✘/⚠/− glyph; it is not a severity. */
  | {
      readonly kind: 'step-finished'
      readonly step: string
      readonly id?: string
      readonly outcome: 'ok' | 'failed' | 'skipped' | 'warning'
      readonly data?: unknown
    }
  /** Progress inside a phase (counts, not percentages). */
  | {
      readonly kind: 'progress'
      readonly step?: string
      readonly completed: number
      readonly total?: number
      readonly data?: unknown
    }
  /**
   * A line of commentary at a severity. 'warn' messages are additionally
   * aggregated into the envelope's `warnings`; 'verbose' messages render
   * only at --log-level verbose. 'error' is not valid here: fatal
   * problems are the Result's error.
   */
  | {
      readonly kind: 'message'
      readonly severity: Exclude<Severity, 'error'>
      readonly text: string
      readonly data?: unknown
    }
  /**
   * Line-oriented output from a child process or remote stream.
   * `channel` is semantic: 'data' = the command's own output (our
   * stdout); 'diagnostic' = commentary about the run (stderr). `source`
   * names the emitter, not a pipe.
   */
  | {
      readonly kind: 'output'
      readonly source: string
      readonly channel: 'data' | 'diagnostic'
      readonly line: string
      readonly data?: unknown
    }
  /** A user-actionable follow-up surfaced mid-run. Aggregated into the
   *  final envelope's nextActions (completed OR errored). */
  | { readonly kind: 'remediation'; readonly action: NextAction; readonly data?: unknown }
  /** A reachable endpoint became available. */
  | {
      readonly kind: 'endpoint'
      readonly name: string
      readonly url: string
      readonly data?: unknown
    }
  /** A state transition in a watched external process; `from` carries
   *  the prior state when known. */
  | {
      readonly kind: 'status'
      readonly subject: string
      readonly status: string
      readonly from?: string
      readonly data?: unknown
    }
  /** A file or directory this run wrote that the user may care about. */
  | {
      readonly kind: 'artifact'
      readonly path: string
      readonly description?: string
      readonly data?: unknown
    }

// ————————————————————————————————————————————————————————————————————————
// §2 Presented results — presentation materializes at the return site
// ————————————————————————————————————————————————————————————————————————

declare const PRESENTED: unique symbol

/**
 * What a completed command's handler returns inside `ok(...)`: pure data
 * plus the presentation the ACTIVE FORMAT already materialized. Built
 * exclusively by ctx.present (the brand makes hand-construction a type
 * error) — the context knows the format, calls only the presentation
 * functions it needs, and the value crossing the product→engine boundary
 * is data all the way down.
 *
 * `data` is always present and is what the envelope's `result`
 * serializes (json presentation overrides when supplied). Materialization
 * by format: human → human + stdout + next; human+--quiet → stdout;
 * json → json + next.
 */
export interface PresentedResult<T> {
  readonly [PRESENTED]: true
  readonly data: T
  /** The outcome code selected at the return site; typed against the
   *  definition's catalogue keys. Omitted = 0. */
  readonly outcomeCode?: number
  /**
   * Structured findings carried by a COMPLETED result (drift, verify
   * failures) — declared ONCE here; the engine renders them in human
   * mode with the same layout as top-level errors (shown even under
   * --quiet) AND serializes their envelopes into
   * CompletedEnvelope.diagnostics. One declaration, both surfaces,
   * impossible to diverge. Guardrail: any severity-'error' entry
   * requires a non-zero outcomeCode — a genuine could-not-complete
   * belongs in notOk, not here. The test: notOk when the command
   * couldn't do its job; diagnostics when finding these WAS the job.
   */
  readonly diagnostics?: readonly CliStructuredError[]
  readonly presentation: {
    readonly human?: readonly Block[]
    readonly stdout?: readonly string[]
    readonly json?: unknown
    readonly next?: readonly NextAction[]
  }
}
export { PRESENTED }

/**
 * The per-format presentation functions a handler supplies to
 * ctx.present. Only the active format's functions are invoked, at the
 * return site, where the outcome and its context are live. `human`
 * composes engine primitives (R5: Block is the only vocabulary);
 * `stdout` is the machine-consumable data lines the engine writes to
 * stdout — what --quiet leaves, what a pipe receives; `json` overrides
 * the envelope's `result` (default: the data itself); `next` supplies
 * nextActions — the envelope's human nextSteps derive from them.
 */
export interface Presentations {
  readonly human: (ui: Ui) => readonly Block[]
  readonly stdout?: () => readonly string[]
  readonly json?: () => unknown
  readonly next?: () => readonly NextAction[]
}

// ————————————————————————————————————————————————————————————————————————
// §3 Config sections — R10 made structural
// ————————————————————————————————————————————————————————————————————————

/**
 * A product's named slice of prisma.config.ts. The token couples the
 * section name, its validated type, and its never-throwing validator;
 * commands bind to the token, which is how the engine knows which
 * section a command needs — and therefore which diagnostics fail which
 * commands. Keep validators dependency-light: they load with the
 * definition tree at startup (R9), not with the handler.
 */
export interface ConfigSection<T> {
  readonly name: string
  /** Total: any unknown in, diagnostics out. Never throws (R10). */
  readonly validate: (raw: unknown) => SectionValidation<T>
}

export type SectionValidation<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly CliStructuredError[] }
  | { readonly ok: false; readonly diagnostics: readonly CliStructuredError[] }

export declare function defineConfigSection<T>(spec: {
  readonly name: string
  readonly validate: (raw: unknown) => SectionValidation<T>
}): ConfigSection<T>

// ————————————————————————————————————————————————————————————————————————
// §4 The handler context — R4: the whole world arrives as one argument
// ————————————————————————————————————————————————————————————————————————

export interface CommandContext<TConfig = undefined, TCode extends number = never> {
  /** The validated value of the command's declared config section, or
   *  undefined when the config file has no such section. An INVALID
   *  needed section never reaches the handler — the engine already
   *  failed the command with that section's diagnostics. */
  readonly config: TConfig | undefined

  /** Builds the PresentedResult for the active format: calls only the
   *  presentation functions this format needs, at the return site. The
   *  only constructor of PresentedResult. `outcomeCode` is typed against
   *  the definition's catalogue keys — a wrong code is a compile error
   *  at the call site. `diagnostics` are the completed result's
   *  structured findings (see PresentedResult). */
  readonly present: <T>(
    data: T,
    presentations: Presentations,
    opts?: {
      readonly outcomeCode?: TCode
      readonly diagnostics?: readonly CliStructuredError[]
    },
  ) => PresentedResult<T>

  /** Management-API credentials, resolved at call time so long-lived
   *  sessions survive token refresh. Undefined when unauthenticated.
   *  Commands declaring `requiresCredentials` never see undefined — the
   *  engine fails them early with the sign-in error. */
  readonly getCredentials: () => Promise<Credentials | undefined>

  /** The one way to emit while running (§1). */
  readonly report: (event: EngineEvent) => void

  /** Interactive input (§4a). */
  readonly prompt: PromptSurface

  /** Fires on Ctrl-C/SIGTERM (engine-owned; the engine records which
   *  signal for the 130/143 exit, and force-exits on a second signal).
   *  Session commands run until it fires; everything else aborts
   *  in-flight work with it. */
  readonly signal: AbortSignal

  /** Where the user invoked the CLI. Products never read process.cwd(). */
  readonly cwd: string

  /** R13: probe an optional peer dependency's availability from the
   *  user's project. Never throws; never installs. Pair with
   *  `packageManager` to phrase the install command in the structured
   *  error when it's absent. */
  readonly probeDependency: (specifier: string) => Promise<boolean>

  /** The user's detected package manager, for install-command phrasing. */
  readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
}

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud product's auth
   *  library (placeholder pending its design). */
  readonly token: string
  readonly workspaceId?: string
}

/**
 * §4a Prompts. Every prompt may carry a product-specified `default`.
 * Interactively, Enter accepts the default. Under --yes, a prompt WITH a
 * default resolves to it without displaying; a prompt WITHOUT a default
 * cannot be operated and the invocation halts with a structured error
 * (exit 2). Destructive confirmations therefore simply declare no
 * default — --yes can never blast through them; they require their
 * explicit flag (--force / --confirm <id>) per the confirmation rule.
 * In json/non-interactive/CI/non-TTY contexts the same default rule
 * applies as under --yes. User cancellation (Ctrl-C at the prompt) is a
 * distinct structured error the engine maps to exit 3.
 */
export interface PromptSurface {
  readonly confirm: (
    question: string,
    opts?: { readonly default?: boolean },
  ) => Promise<Result<boolean, CliStructuredError>>
  /**
   * A question requiring EXPLICIT consent — not necessarily destructive,
   * but never inferable. Structurally undefaultable: no default
   * parameter exists, so --yes, Enter-through, and non-interactive
   * contexts can never satisfy it; without a TTY it returns the
   * interaction-required structured error, and the command's fix names
   * the explicit flag that grants consent non-interactively.
   */
  readonly consent: (question: string) => Promise<Result<boolean, CliStructuredError>>
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<Result<T, CliStructuredError>>
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<Result<string, CliStructuredError>>
}

// ————————————————————————————————————————————————————————————————————————
// §5 Flags and positionals — R1: directly executable, typed by inference
// ————————————————————————————————————————————————————————————————————————

/**
 * Product-declared flags. The shared family (§header) is engine-injected
 * and reserved; handlers never see those values. Parse-time validation
 * failures become structured errors carrying the allowed values — never
 * framework strings.
 *
 * Deliberate asymmetry, matching CLI convention: flags are optional by
 * default (requiredString is the exception); positionals are required by
 * default (optionalString is the exception).
 */
export declare const flag: {
  string<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
    default?: string
  }): FlagSpec<string | undefined>
  requiredString<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
  }): FlagSpec<string>
  number<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
    default?: number
  }): FlagSpec<number | undefined>
  boolean<A extends string = never>(spec: { brief: string; alias?: A & Char<A> }): FlagSpec<boolean>
  enum<const T extends readonly string[], A extends string = never>(spec: {
    brief: string
    values: T
    alias?: A & Char<A>
    default?: T[number]
  }): FlagSpec<T[number] | undefined>
  repeated<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
  }): FlagSpec<readonly string[]>
}

/** Single-character alias, enforced at the type level: `Char<'q'>` is
 *  'q'; `Char<'ab'>` is never. Builder methods take a const generic so
 *  `alias: 'ab'` is a compile error at the declaration site. */
export type Char<S extends string> = S extends `${string}${infer Rest}`
  ? Rest extends ''
    ? S
    : never
  : never

declare const FLAG: unique symbol
export interface FlagSpec<T> {
  /** Phantom carrier for inference; exported so declaration emit works. */
  readonly [FLAG]: T
}
export { FLAG }

export declare const positional: {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string>
  optionalString(spec: { brief: string; placeholder: string }): PositionalSpec<string | undefined>
  /** Zero or more trailing values; at most one, declared last (order =
   *  declaration order; keys must not be integer-like). */
  variadic(spec: { brief: string; placeholder: string }): PositionalSpec<readonly string[]>
}
declare const POSITIONAL: unique symbol
export interface PositionalSpec<T> {
  readonly [POSITIONAL]: T
}
export { POSITIONAL }

/** What a handler receives: separate namespaces, symmetric access —
 *  `args.flags.to`, `args.positionals.name`. */
export interface Args<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags: { readonly [K in keyof TFlags]: TFlags[K] extends FlagSpec<infer T> ? T : never }
  readonly positionals: {
    readonly [K in keyof TPositionals]: TPositionals[K] extends PositionalSpec<infer T> ? T : never
  }
}

// ————————————————————————————————————————————————————————————————————————
// §6 Command definitions — light at startup (R9), path-free (R12),
// runtime-discriminated by `kind` (stamped by the define* functions)
// ————————————————————————————————————————————————————————————————————————

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
> {
  readonly kind: 'command'
  /** One line, imperative, shown in listings. */
  readonly brief: string
  /** Paragraph(s) for --help. Words only — the engine formats. */
  readonly description?: string
  /** Copy-pastable invocations, shown verbatim in help. */
  readonly examples?: readonly string[]

  readonly flags?: TFlags
  readonly positionals?: TPositionals

  /** Binds the command to its product's config section (§3). */
  readonly configSection?: ConfigSection<TConfig>

  /** Fail early with the sign-in error when unauthenticated; the handler
   *  then always receives credentials. */
  readonly requiresCredentials?: boolean

  /**
   * The command's documented outcome codes (4–99): code → meaning.
   * Rendered in help without executing anything; the catalogue's keys
   * type ctx.present's outcomeCode, so a code outside the catalogue is
   * a compile error at the return site. Absent = the command only exits
   * 0/1/2/3.
   */
  readonly outcomeCodes?: Readonly<Record<TCode, string>>

  /** The heavy part, loaded only at execution (R9). The module's default
   *  export is the handler — annotate it with CommandHandler<typeof def>
   *  (type-only import of the light definition; no runtime cycle). */
  readonly handler: () => Promise<{ default: Handler<TFlags, TPositionals, TConfig, TCode> }>
}

export type Handler<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TConfig,
  TCode extends number = never,
> = (
  args: Args<TFlags, TPositionals>,
  ctx: CommandContext<TConfig, TCode>,
) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>

/** For impl files: `const run: CommandHandler<typeof migrateCommand> = …` */
export type CommandHandler<D> = D extends CommandDefinition<infer F, infer P, infer C, infer K>
  ? Handler<F, P, C, K>
  : never

export declare function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
>(
  def: Omit<CommandDefinition<TFlags, TPositionals, TConfig, TCode>, 'kind'>,
): CommandDefinition<TFlags, TPositionals, TConfig, TCode>

/**
 * Mode 4 — sessions (dev, log tail): the handler runs until the signal
 * fires, speaks entirely through events, and returns Result<void>. No
 * presentation (the engine owns the close-out line), no outcome codes.
 * A session always supports json mode: the event stream is its json
 * surface.
 */
export interface SessionCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'session'
  readonly brief: string
  readonly description?: string
  readonly examples?: readonly string[]
  readonly flags?: TFlags
  readonly positionals?: TPositionals
  readonly configSection?: ConfigSection<TConfig>
  readonly requiresCredentials?: boolean
  readonly handler: () => Promise<{
    default: (
      args: Args<TFlags, TPositionals>,
      ctx: CommandContext<TConfig>,
    ) => Promise<Result<void, CliStructuredError>>
  }>
}

export declare function defineSessionCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
>(
  def: Omit<SessionCommandDefinition<TFlags, TPositionals, TConfig>, 'kind'>,
): SessionCommandDefinition<TFlags, TPositionals, TConfig>

/**
 * Mode 7 — stdio protocol servers (lsp): the command owns stdin/stdout
 * wholesale. Events, presentation, formats, and prompts do not apply;
 * the handler returns the exit code directly. Flags and config are
 * allowed; the shared flag family is NOT injected.
 */
export interface RawCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'raw'
  readonly brief: string
  readonly description?: string
  readonly flags?: TFlags
  readonly configSection?: ConfigSection<TConfig>
  readonly handler: () => Promise<{
    default: (
      args: Args<TFlags, {}>,
      io: {
        readonly stdin: InputStream
        readonly stdout: OutputStream
        readonly stderr: OutputStream
        readonly signal: AbortSignal
        readonly cwd: string
        readonly config: TConfig | undefined
      },
    ) => Promise<number>
  }>
}

export declare function defineRawCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
>(
  def: Omit<RawCommandDefinition<TFlags, TConfig>, 'kind'>,
): RawCommandDefinition<TFlags, TConfig>

/** Erased union for mount maps; `kind` is the runtime discriminant. */
export type AnyCommand =
  | CommandDefinition<any, any, any, any>
  | SessionCommandDefinition<any, any, any>
  | RawCommandDefinition<any, any>

// ————————————————————————————————————————————————————————————————————————
// §7 Presentation primitives — the R5 vocabulary
// ————————————————————————————————————————————————————————————————————————

/** Deliberately small; grows by the same evidence rule as events. */
export type Block =
  | {
      readonly kind: 'summary'
      readonly tone: 'ok' | Exclude<Severity, 'verbose'>
      readonly text: string
    }
  | {
      readonly kind: 'fields'
      readonly rows: ReadonlyArray<{ label: string; value: string; sensitive?: boolean }>
    }
  | {
      readonly kind: 'table'
      readonly columns: readonly string[]
      readonly rows: ReadonlyArray<readonly string[]>
    }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  /** The corpus's most-rendered human structure (migration graphs,
   *  service trees). */
  | { readonly kind: 'tree'; readonly roots: readonly TreeNode[] }
// NOTE: structured findings inside a completed result are NOT a Block —
// they are declared once at ctx.present (diagnostics) and the engine
// renders them with the top-level error layout and serializes them into
// the envelope, so the two surfaces cannot diverge.

export interface TreeNode {
  readonly label: string
  readonly children?: readonly TreeNode[]
}

/** Styling helpers usable inside block text; no direct writing. */
export interface Ui {
  readonly emphasize: (text: string) => string
  readonly dim: (text: string) => string
  readonly code: (text: string) => string
}

// ————————————————————————————————————————————————————————————————————————
// §8 Streams — minimal structural types; no NodeJS.* in the public
// surface (runtime-agnosticism, R4's why)
// ————————————————————————————————————————————————————————————————————————

export interface OutputStream {
  write(text: string): void
}
/** Byte-oriented, so raw commands can implement byte-counted protocols
 *  (lsp's Content-Length framing). Decoding is the consumer's business;
 *  the engine's own prompt machinery decodes internally. setRawMode is
 *  present where the platform supports keypress-driven input. */
export interface InputStream extends AsyncIterable<Uint8Array> {
  readonly setRawMode?: (enabled: boolean) => void
}

// ————————————————————————————————————————————————————————————————————————
// §9 Envelopes and frames — the json contract
// ————————————————————————————————————————————————————————————————————————

export interface CompletedEnvelope<T = unknown> {
  /** ok = COMPLETED (the command executed to its end). A completed
   *  result may still carry a non-zero outcome code — bad news is a
   *  result, not an error. */
  readonly ok: true
  /** Stable dotted command id derived from the mount path ('db.migrate'). */
  readonly command: string
  /** The presented data (json presentation override when supplied). */
  readonly result: T
  /** From the outcome catalogue; 0 when absent. */
  readonly outcomeCode: number
  /** The completed result's structured findings, serialized as error
   *  envelopes (dotted codes intact for machine consumers) — aggregated
   *  by the engine from PresentedResult.diagnostics. */
  readonly diagnostics: readonly unknown[]
  /** Aggregated from severity-'warn' message events. */
  readonly warnings: readonly string[]
  /** Derived from nextActions — the human-string form. */
  readonly nextSteps: readonly string[]
  readonly nextActions: readonly NextAction[]
}

export interface ErroredEnvelope {
  /** ok = false: the command did NOT complete. */
  readonly ok: false
  readonly command: string
  /** The CliErrorEnvelope fields (code, severity, summary, why, fix,
   *  where, meta, docsUrl) — nested, per the settled envelope rule. The
   *  PRIMARY error: what aborted the command. */
  readonly error: unknown
  /** Accompanying structured problems when the abort had several (three
   *  config typos are three diagnostics, not one flattened error) —
   *  symmetric with CompletedEnvelope.diagnostics. */
  readonly diagnostics: readonly unknown[]
  readonly warnings: readonly string[]
  /** Aggregated from remediation events + derived from the error's fix. */
  readonly nextSteps: readonly string[]
  readonly nextActions: readonly NextAction[]
}

/** json mode emits one frame per line: events while running, then
 *  exactly one result frame. */
export type Frame = EventFrame | ResultFrame

export interface EventFrame {
  readonly type: 'event'
  readonly command: string
  /** ISO 8601 UTC. Injectable clock in tests (§11). */
  readonly timestamp: string
  readonly event: EngineEvent
}

export interface ResultFrame {
  readonly type: 'result'
  readonly command: string
  readonly timestamp: string
  readonly envelope: CompletedEnvelope | ErroredEnvelope
}

// ————————————————————————————————————————————————————————————————————————
// §10 Product export and shell mounting — R12: the shell owns the tree
// ————————————————————————————————————————————————————————————————————————

/** What a product package exports: commands by NAME. */
export type CommandSet = Readonly<Record<string, AnyCommand>>

/** What the shell builds: commands by PATH (space-separated,
 *  'db migrate'). Distinct alias so the two maps never read as one. */
export type MountedTree = Readonly<Record<string, AnyCommand>>

/**
 * Shell-side construction. Group help is declared with the mount, since
 * groups belong to the tree, not to products. Collisions, unknown
 * groups, reserved-flag violations, and grammar violations fail
 * construction (build time, not run time).
 */
export declare function createCli(spec: {
  readonly name: string
  readonly version: string
  readonly groups: Readonly<Record<string, { readonly brief: string; readonly description?: string }>>
  readonly commands: MountedTree
}): Cli

export interface Cli {
  /** Parse, execute, render, return the exit code. Never calls
   *  process.exit; never touches streams other than the provided ones. */
  run(argv: readonly string[], runtime: Runtime): Promise<number>
}

/** Everything environmental, injected once by the bin (or by a test). */
export interface Runtime {
  readonly stdout: OutputStream
  readonly stderr: OutputStream
  readonly stdin: InputStream
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly isTty: { readonly stdin: boolean; readonly stdout: boolean; readonly stderr: boolean }
  readonly signal: AbortSignal
  /** Loaded config + per-section diagnostics; the shell builds this via
   *  the unified loader (R10). Tests hand in fixtures. */
  readonly config: LoadedConfig
  readonly getCredentials: () => Promise<Credentials | undefined>
  readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
}

export interface LoadedConfig {
  /** Raw section values by name; validation happens per command via its
   *  ConfigSection token. */
  readonly sections: Readonly<Record<string, unknown>>
  /** File-level problems (unevaluable module, missing version marker) —
   *  section: null fails every command. */
  readonly diagnostics: ReadonlyArray<{
    readonly section: string | null
    readonly error: CliStructuredError
  }>
}

// ————————————————————————————————————————————————————————————————————————
// §11 The product-repo test harness — R7: same machinery, bytes out
// ————————————————————————————————————————————————————————————————————————

export declare function createTestCli(spec: {
  readonly commands: MountedTree
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>
  readonly config?: Readonly<Record<string, unknown>>
  readonly credentials?: Credentials
  readonly packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  /** Fixed clock for deterministic frame timestamps. */
  readonly now?: () => Date
}): TestCli

export interface TestCli {
  run(
    argv: readonly string[],
    opts?: {
      readonly stdin?: string
      /** Scripted prompt answers, consumed in order; a run that prompts
       *  past the script fails the test. */
      readonly answers?: ReadonlyArray<string | boolean>
      /** Abort the run (session tests): fires the context signal. */
      readonly abort?: AbortSignal
      /** Live event tap, for asserting mid-session behavior before
       *  aborting. */
      readonly onEvent?: (event: EngineEvent) => void
      readonly cwd?: string
      readonly isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean }
      readonly env?: Readonly<Record<string, string | undefined>>
    },
  ): Promise<{
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    /** Parsed frames (events + the result frame) when json mode was on. */
    readonly json: readonly Frame[]
    /** Every EngineEvent the handler emitted, for semantic assertions. */
    readonly events: readonly EngineEvent[]
    /** The PresentedResult the handler returned (data + materialized
     *  presentation), for semantic assertions without byte-scraping. */
    readonly presented?: PresentedResult<unknown>
  }>
}
