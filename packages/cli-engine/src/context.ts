import type { EngineEvent } from "./events";
import type { Outcome, Presentations, PresentedResult } from "./presentation";
import type { CliStructuredError, Result } from "./protocol";

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud auth library. */
  readonly token: string;
}

/** The handler context — the whole world arrives as one argument (R4). */
export interface CommandContext<
  TConfig = undefined,
  TCode extends number = never,
> {
  /**
   * The validated value of the command's needed config section —
   * exactly TConfig; absence semantics belong to the section's
   * validator. Commands with no config need get undefined.
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

  /** The one way to emit while running. */
  readonly report: (event: EngineEvent) => void;

  /** Interactive input. */
  readonly prompt: PromptSurface;

  /**
   * Fires on Ctrl-C/SIGTERM (engine-owned; a second signal force-exits
   * through the runtime's exit proxy). Session commands run until it
   * fires.
   */
  readonly signal: AbortSignal;

  /** Where the user invoked the CLI. Handlers never read process.cwd(). */
  readonly cwd: string;

  /**
   * The invocation's environment, from Runtime.env. Handlers read env
   * via ctx.env, never process.env (R4).
   */
  readonly env: Readonly<Record<string, string | undefined>>;

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

/**
 * Prompts. Every prompt resolves to its answered value directly.
 * Failures THROW engine-internal structured errors the engine catches
 * and settles: cancellation exits 3; a prompt that cannot be operated
 * (no default under --yes or non-interactive, an invalid answer) exits
 * 2. A handler that does not catch simply propagates; one that catches
 * cannot swallow the settlement — rethrow or return notOk.
 *
 * Every prompt except `consent` may carry a declared `default`. Under
 * --yes and in non-interactive contexts (no TTY stdin, CI,
 * --no-interactive — format never decides interactivity) a prompt with
 * a default resolves to it; one without a default throws. The prompt UI
 * writes to stderr, so an interactive json run prompts without touching
 * the stdout stream.
 */
export interface PromptSurface {
  readonly confirm: (
    question: string,
    opts?: { readonly default?: boolean },
  ) => Promise<boolean>;
  /**
   * A question requiring explicit consent — never inferable.
   * Structurally undefaultable: no default parameter exists, so --yes,
   * Enter-through, and non-interactive contexts can never satisfy it.
   */
  readonly consent: (question: string) => Promise<boolean>;
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<T>;
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<string>;
}
