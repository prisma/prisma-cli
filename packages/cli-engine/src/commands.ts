import type {
  Args,
  ArgsSpec,
  CommandArgs,
  FlagSpec,
  PositionalSpec,
} from "./args";
import type { ConfigSection } from "./config-section";
import type { CommandContext } from "./context";
import type { CredentialManager } from "./credential-manager";
import type { PackageOperations } from "./package-manager";
import type { PresentedResult } from "./presentation";
import type {
  CliStructuredError,
  Diagnostic,
  NextAction,
  Result,
} from "./protocol";
import type { InputStream, OutputStream } from "./runtime";
import type { ChildStatusSettlement } from "./spawn";

/**
 * Command definitions carry no mount path and are runtime-discriminated
 * by `kind`. Definitions load their handler's import graph at startup;
 * handler bodies defer heavy work to execution time.
 *
 * The define* constructors accept ergonomic specs (optional help
 * details, args, needs, exitCodes) and normalize them: every definition
 * field is always present, with empty collections and explicit
 * undefined instead of conditional properties.
 */

/** The help SPI: words only — the engine formats. */
export interface HelpSpec {
  /** One line, imperative, shown in listings. */
  readonly summary: string;
  readonly description?: string;
  /**
   * Invocations WITHOUT the binary name: at help render time every
   * `{bin}` is substituted with createCli's `name`; an example
   * containing no `{bin}` gets the name prepended.
   */
  readonly examples?: readonly string[];
}

/** The normalized help a definition carries. */
export interface CommandHelp {
  readonly summary: string;
  readonly description: string | undefined;
  readonly examples: readonly string[];
}

/**
 * The preconditions SPI: everything the engine enforces BEFORE the
 * handler runs. Each unmet need fails the command early with the
 * engine's own structured error.
 */
export interface NeedsSpec<TConfig> {
  /**
   * The command family's config section token: validate it, fail me on
   * its error diagnostics, hand me the value as ctx.config.
   */
  readonly config?: ConfigSection<TConfig>;
  /**
   * Fail early with the sign-in error when unauthenticated. The
   * `"child"` form (S3) additionally makes the engine compose the
   * active credential into every child environment
   * (PRISMA_SERVICE_TOKEN, PRISMA_WORKSPACE_ID). Before the handler it
   * refreshes a stored OAuth session that expires too soon, or refuses
   * an unrefreshable credential — a child cannot refresh the snapshot
   * it is given. It
   * requires `maySpawn` (construction error otherwise) and entails
   * the plain credentials need.
   */
  readonly credentials?: true | "child";
  /**
   * Optional peer dependencies this command cannot run without; the
   * engine probes resolvability and phrases the install error.
   * (Conditional needs use ctx.requireDependency instead.)
   */
  readonly dependencies?: readonly string[];
  /**
   * Fail early in non-interactive contexts (no TTY stdin, CI, or
   * --no-interactive; format never decides interactivity). This is a
   * MECHANICAL precondition — "an interactive terminal is required" —
   * and deliberately NOT an agent barrier: the client's nature is
   * unverifiable, and a flag claiming to exclude agents would be a
   * false guarantee. Anything requiring a verified human belongs
   * server-side, where identity actually exists.
   */
  readonly interaction?: true;
}

/** The normalized preconditions a definition carries. */
export interface CommandNeeds<TConfig> {
  readonly config: ConfigSection<TConfig> | undefined;
  readonly credentials: boolean | "child";
  readonly dependencies: readonly string[];
  readonly interaction: boolean;
}

function normalizeHelp(spec: HelpSpec): CommandHelp {
  return Object.freeze({
    summary: spec.summary,
    description: spec.description,
    examples: spec.examples ?? [],
  });
}

function normalizeArgs<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
>(
  spec: ArgsSpec<TFlags, TPositionals> | undefined,
): CommandArgs<TFlags, TPositionals> {
  return Object.freeze({
    flags: spec?.flags ?? ({} as TFlags),
    positionals: spec?.positionals ?? ({} as TPositionals),
  });
}

/**
 * The terminal-handoff declaration, normalized onto every definition
 * (server commands normalize to false: they own stdio already).
 *
 * `maySpawn` unlocks ctx.spawn. In human mode the child inherits the
 * terminal; in json mode its output is routed to diagnostics so stdout
 * remains framed. Handing credentials to the child is a precondition, declared as
 * `needs: { credentials: "child" }`.
 */
export interface SpawnDeclarations {
  readonly maySpawn?: boolean;
}

function normalizeNeeds<TConfig>(
  spec: NeedsSpec<TConfig> | undefined,
): CommandNeeds<TConfig> {
  return Object.freeze({
    config: spec?.config,
    credentials: spec?.credentials ?? false,
    dependencies: spec?.dependencies ?? [],
    interaction: spec?.interaction === true,
  });
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
  TManagesCredentials extends boolean = false,
  TInstallsPackages extends boolean = false,
> {
  readonly kind: "result-command";
  readonly help: CommandHelp;
  readonly args: CommandArgs<TFlags, TPositionals>;
  readonly needs: CommandNeeds<TConfig>;

  /**
   * The command's documented exit codes (4–99): code → meaning. The
   * keys type the outcome's exitCode, making it REQUIRED at every
   * return site (`0` or a documented code). Empty = the command only
   * exits 0/1/2/3 and the outcome carries no exitCode.
   */
  readonly exitCodes: Readonly<Record<TCode, string>>;

  /**
   * A CAPABILITY, not a need: when true, ctx.credentialManager appears
   * on the context. Declaring it never fails a run — this is
   * documentation and testability, not enforcement. Declared by
   * exactly the auth commands that operate ON the credential
   * machinery.
   */
  readonly managesCredentials: TManagesCredentials;

  /** See SpawnDeclarations. */
  readonly maySpawn: boolean;

  /**
   * A CAPABILITY, not a need: when true, ctx.packages appears on the
   * context and the command may run the user's package manager in the
   * user's project. Declaring it never fails a run.
   */
  readonly installsPackages: TInstallsPackages;

  /**
   * The handler function, referenced directly — never a dynamic import
   * (operator ruling, 2026-08-09). A handler that needs heavy
   * dependencies imports them at execution time, inside its body. A
   * handler defined in another file is imported statically and
   * annotated CommandHandler<typeof def>.
   */
  readonly handler: Handler<
    TFlags,
    TPositionals,
    TConfig,
    TCode,
    TManagesCredentials,
    TInstallsPackages
  >;
}

export type Handler<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TConfig,
  TCode extends number = never,
  TManagesCredentials extends boolean = false,
  TInstallsPackages extends boolean = false,
> = (
  args: Args<TFlags, TPositionals>,
  ctx: CommandContext<TConfig, TCode> &
    (TManagesCredentials extends true
      ? { readonly credentialManager: CredentialManager }
      : unknown) &
    (TInstallsPackages extends true
      ? { readonly packages: PackageOperations }
      : unknown),
) => Promise<
  Result<PresentedResult<unknown> | ChildStatusSettlement, CliStructuredError>
>;

/** For impl files: `const run: CommandHandler<typeof migrateCommand> = …` */
export type CommandHandler<D> =
  D extends CommandDefinition<
    infer F,
    infer P,
    infer C,
    infer K,
    infer M,
    infer I
  >
    ? Handler<F, P, C, K, M, I>
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
  TManagesCredentials extends boolean = false,
  TInstallsPackages extends boolean = false,
>(
  def: {
    readonly help: HelpSpec;
    readonly args?: ArgsSpec<TFlags, TPositionals>;
    readonly needs?: NeedsSpec<TConfig>;
    readonly exitCodes?: Readonly<Record<TCode, string>>;
    readonly managesCredentials?: TManagesCredentials;
    readonly installsPackages?: TInstallsPackages;
    readonly handler: Handler<
      TFlags,
      TPositionals,
      TConfig,
      TCode,
      TManagesCredentials,
      TInstallsPackages
    >;
  } & SpawnDeclarations,
): CommandDefinition<
  TFlags,
  TPositionals,
  TConfig,
  TCode,
  TManagesCredentials,
  TInstallsPackages
> {
  return Object.freeze({
    kind: "result-command" as const,
    help: normalizeHelp(def.help),
    args: normalizeArgs(def.args),
    needs: normalizeNeeds(def.needs),
    exitCodes: def.exitCodes ?? ({} as Readonly<Record<TCode, string>>),
    managesCredentials: (def.managesCredentials ??
      false) as TManagesCredentials,
    maySpawn: def.maySpawn ?? false,
    installsPackages: (def.installsPackages ?? false) as TInstallsPackages,
    handler: def.handler,
  });
}

/**
 * A session command (dev, log tail): runs until the signal fires,
 * speaks entirely through events, returns Result<void>. No
 * presentation, no exit-code set.
 *
 * A session supports json mode — the event stream is its json surface.
 * When it declares `maySpawn`, child output is routed to diagnostics while
 * the engine retains ownership of structured stdout. A session that returns
 * ok(undefined) exits 0 — or 130/143 when a signal ended the run, which
 * the engine settles from its own record of that signal, not from
 * anything the handler returns; one that returns
 * ok(exitWithChildStatus()) exits with the status of the child it
 * spawned.
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
  readonly help: CommandHelp;
  readonly args: CommandArgs<TFlags, TPositionals>;
  readonly needs: CommandNeeds<TConfig>;
  /** See SpawnDeclarations. */
  readonly maySpawn: boolean;
  readonly handler: (
    args: Args<TFlags, TPositionals>,
    ctx: CommandContext<TConfig>,
  ) => Promise<Result<undefined | ChildStatusSettlement, CliStructuredError>>;
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
  def: {
    readonly help: HelpSpec;
    readonly args?: ArgsSpec<TFlags, TPositionals>;
    readonly needs?: NeedsSpec<TConfig>;
    readonly handler: SessionCommandDefinition<
      TFlags,
      TPositionals,
      TConfig
    >["handler"];
  } & SpawnDeclarations,
): SessionCommandDefinition<TFlags, TPositionals, TConfig> {
  return Object.freeze({
    kind: "session-command" as const,
    help: normalizeHelp(def.help),
    args: normalizeArgs(def.args),
    needs: normalizeNeeds(def.needs),
    maySpawn: def.maySpawn ?? false,
    handler: def.handler,
  });
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
  readonly help: CommandHelp;
  readonly args: CommandArgs<TFlags, Record<never, PositionalSpec<unknown>>>;
  readonly needs: CommandNeeds<TConfig>;
  /** Always false — a server command owns stdio already. Normalized so
   *  every definition carries the field and callers read it directly. */
  readonly maySpawn: false;
  readonly handler: (
    args: Args<TFlags, Record<never, PositionalSpec<unknown>>>,
    io: {
      readonly stdin: InputStream;
      readonly stdout: OutputStream;
      readonly stderr: OutputStream;
      readonly signal: AbortSignal;
      readonly cwd: string;
      readonly env: Readonly<Record<string, string | undefined>>;
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
>(def: {
  readonly help: HelpSpec;
  readonly args?: ArgsSpec<TFlags, Record<never, PositionalSpec<unknown>>>;
  readonly needs?: NeedsSpec<TConfig>;
  readonly handler: ServerCommandDefinition<TFlags, TConfig>["handler"];
}): ServerCommandDefinition<TFlags, TConfig> {
  return Object.freeze({
    kind: "server-command" as const,
    help: normalizeHelp(def.help),
    args: normalizeArgs(def.args),
    needs: normalizeNeeds(def.needs),
    maySpawn: false as const,
    handler: def.handler,
  });
}

/**
 * Erased union for command families and mount maps; `kind`
 * discriminates. Handler functions are erased to `unknown` here — the
 * concrete types travel through each definition's generics, not through
 * this union.
 */
export type AnyCommand =
  | (Omit<
      CommandDefinition<
        Record<string, FlagSpec<unknown>>,
        Record<string, PositionalSpec<unknown>>,
        unknown,
        number,
        boolean,
        boolean
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

export interface CompletedEnvelope<T = unknown> {
  /**
   * ok = COMPLETED (the command executed to its end). A completed
   * result may still carry findings and a non-zero exit code — bad
   * news is a result, not an error.
   */
  readonly ok: true;
  /**
   * The command's stable dotted identity — its full command path
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
  /**
   * Copied from the error's own nextActions — the uniform consumer
   * read path (envelope.nextActions) on both settlement paths.
   */
  readonly nextActions: readonly NextAction[];
}
