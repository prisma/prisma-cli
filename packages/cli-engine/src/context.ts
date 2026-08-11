import type { ActiveCredential } from "./credential-manager";
import type { EngineEvent } from "./events";
import type { ManagementApiClient } from "./management-api";
import type { Outcome, Presentations, PresentedResult } from "./presentation";
import type { CliStructuredError, Result } from "./protocol";
import type { ChildResult, SpawnOptions } from "./spawn";

/** The handler context — the whole world arrives as one argument. */
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
   * What this process authenticates as (the manager's pinned
   * credential), or null when signed out. Carries no token material.
   * Read-only and local-only — safe to call anywhere; never touches
   * the network. Throws the same structured errors the needs check
   * raises for broken-but-not-signed-out states (sessions held, none
   * selected).
   */
  readonly activeCredential: () => Promise<ActiveCredential | null>;

  /**
   * The Management API client, constructed and owned by the ENGINE:
   * the pinned credential's client, built on first method call, once
   * per run. A request made while signed out throws the structured
   * CLI.CREDENTIALS_REQUIRED error (the same constructor the
   * needs.credentials check uses).
   */
  readonly api: ManagementApiClient;

  /**
   * Hands the terminal to a child process and resolves when it ends.
   * The child inherits stdio and runs in this process's own group
   * (POSIX) or console (Windows), so Ctrl-C reaches it natively.
   *
   * While a child is live the engine neither aborts nor exits on a
   * delivered signal: it records signals and replays them into its
   * normal ladder once the child has ended, so the engine always
   * outlives the child. SIGTERM, which has no native path to the child,
   * is forwarded to it. A programmatic abort of ctx.signal terminates
   * the child with SIGTERM, a grace period, then SIGKILL.
   *
   * ctx.report is buffered for the duration and flushed in order when
   * the child ends; ctx.present during a live child, and a second
   * concurrent ctx.spawn, are engine-internal errors. A launch failure
   * (no such command) throws CLI.SPAWN_FAILED.
   *
   * Only commands declaring `maySpawn` may call it. Branch on `signal`
   * before `exitCode`: a signal-killed child is an abort, not a
   * failure.
   */
  readonly spawn: (options: SpawnOptions) => Promise<ChildResult>;

  /**
   * How the run's most recent completed child ended, or undefined when
   * none has run. The engine records every child ctx.spawn returns, so
   * a handler whose spawn happens deep in its own layering can still
   * ask "did my child fail?" where it settles, without threading the
   * result back by hand. This is the same record exitWithChildStatus
   * settles from.
   */
  readonly lastChild: () => ChildResult | undefined;

  /** The one way to emit while running. */
  readonly report: (event: EngineEvent) => void;

  /** Interactive input. */
  readonly prompt: PromptSurface;

  /**
   * Shows the user a URL and, in an interactive session, opens it in
   * their browser. Always announces the URL on the commentary channel
   * (an `endpoint` event: a stderr line in human mode, a frame in json
   * mode), so a non-interactive run — which never opens anything — can
   * still be completed by hand. Never fails: a browser that could not
   * be opened reports `opened: false`. To wait for the user to finish
   * something in that browser, use prompt.browserWait.
   */
  readonly openUrl: (request: OpenUrlRequest) => Promise<OpenUrlOutcome>;

  /**
   * Fires on Ctrl-C/SIGTERM (engine-owned; a second signal force-exits
   * through the runtime's exit proxy). Session commands run until it
   * fires.
   *
   * Once it has fired the engine settles the run at 130/143 from its
   * own record of the signal, whatever the handler goes on to return —
   * so cleanup code never states an exit code of its own.
   */
  readonly signal: AbortSignal;

  /** Where the user invoked the CLI. Handlers never read process.cwd(). */
  readonly cwd: string;

  /**
   * The invocation's environment, from Runtime.env. Handlers read env
   * via ctx.env, never process.env.
   */
  readonly env: Readonly<Record<string, string | undefined>>;

  /**
   * Conditional optional-dependency need. Resolves when the
   * optional peer dependency is importable from the user's project;
   * otherwise returns the engine's structured missing-dependency error
   * for the handler to pass to notOk.
   */
  readonly requireDependency: (
    specifier: string,
  ) => Promise<Result<void, CliStructuredError>>;
}

export interface OpenUrlRequest {
  readonly url: string;
  /** The announcement label — what the URL is for, in the user's
   *  terms ("Finish signing in"). */
  readonly message: string;
}

export interface OpenUrlOutcome {
  /** False whenever the browser was not launched: a non-interactive
   *  session, a host with no opener wired, or an opener that failed. */
  readonly opened: boolean;
}

export interface BrowserWaitRequest {
  readonly url: string;
  /** The announcement label — what the user is being sent to do. */
  readonly message: string;
  /**
   * Asks whether the user has finished. The engine calls it on its own
   * interval and passes ctx.signal, so a poll that makes a request can
   * abort with the command.
   */
  readonly poll: (signal: AbortSignal) => Promise<boolean>;
  /** Milliseconds to keep polling before giving up. */
  readonly timeout: number;
  /** Milliseconds between polls. Defaults to the engine's own
   *  interval; a command with its own configurable cadence passes it. */
  readonly interval?: number;
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
   * Structurally undefaultable: no default parameter exists, so --yes
   * and Enter-through can never satisfy it.
   *
   * `token` is the natural noun of what is being consented to — an app
   * name, a hostname. Supplying one changes both halves of the prompt:
   * interactively the user must type the token exactly instead of
   * answering yes/no, and non-interactively the consent is granted by
   * `--confirm <token>` on the command line (one `--confirm` value per
   * consent). Without a token there is no non-interactive way to
   * consent at all.
   */
  readonly consent: (
    question: string,
    opts?: { readonly token?: string },
  ) => Promise<boolean>;
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<T>;
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<string>;
  /**
   * Sends the user to a URL and waits for them to finish there:
   * announces the URL, opens the browser, then polls until `poll`
   * returns true. Resolves when it does; throws the structured timeout
   * error when `timeout` elapses first, and the usual prompt-cancelled
   * error (exit 3) on Ctrl-C.
   *
   * Non-interactively it throws the interaction-required error before
   * opening or polling anything, with the URL in the message so the
   * user can finish by hand. A command that cannot do anything useful
   * without an interactive terminal should declare `needs.interaction`
   * instead and fail before it starts.
   */
  readonly browserWait: (request: BrowserWaitRequest) => Promise<void>;
}
