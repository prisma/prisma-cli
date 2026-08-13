import type { CredentialManager } from "./credential-manager";
import type { ManagementApiClientConfig } from "./management-api";
import type { PackageManagerId, PackageManagerRunner } from "./package-manager";
import type { Diagnostic } from "./protocol";
import type { SpawnChild } from "./spawn";
import type { TelemetryPayload } from "./telemetry/payload";

/** Minimal structural stream types; no NodeJS.* in the public surface. */
export interface OutputStream {
  write(text: string): void;
  /** The stream's terminal width, absent when it is not a terminal.
   *  The engine reads it at render time rather than caching it, so a
   *  terminal resized mid-run is respected by the next thing drawn. */
  readonly columns?: number;
}

/**
 * Byte-oriented, so server commands can implement byte-counted
 * protocols (lsp's Content-Length framing). setRawMode is present
 * where the platform supports keypress input.
 */
export interface InputStream extends AsyncIterable<Uint8Array> {
  readonly setRawMode?: (enabled: boolean) => void;
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
  /**
   * Whether stdout and stderr are the same open device — the case where
   * human blocks and the machine stdout mirror would draw on one screen
   * as visible duplication. Consulted only when both streams are TTYs:
   * `false` there means two separate terminals, so the mirror is kept
   * for whatever is reading stdout. Absent means the host cannot tell,
   * which is treated as "same" — the overwhelmingly common case for two
   * TTYs is one terminal.
   */
  readonly outputStreamsShareDevice?: boolean;
  /**
   * Forces the answer to "is this CI", where telemetry never reports.
   * Absent — the normal case — means the engine detects CI from `env`
   * using ci-info's vendor table, which is why no host has to answer:
   * unlike a TTY, CI-ness is derivable from the environment the host
   * already injects, and every host computing the same boolean was the
   * same detection table forked N ways. Set it only where detection
   * cannot be right — an exotic platform, or a test that needs both
   * sides of the branch. Absence means detected, never false, so a host
   * that says nothing still stays silent in CI.
   */
  readonly isCIOverride?: boolean;
  /**
   * Ends the process. The bin passes process.exit; the engine is the
   * only caller (second-signal force exit, 130/143).
   */
  readonly exit: (code: number) => never;
  /**
   * Subscribes to delivered SIGINT/SIGTERM; returns the unsubscribe.
   * The bin is dumb wiring — the engine owns the whole signal policy:
   * the first signal aborts ctx.signal and awaits teardown; a second
   * calls exit(130|143) immediately.
   */
  readonly onSignal: (cb: (signal: "SIGINT" | "SIGTERM") => void) => () => void;
  /**
   * Reads prisma.config.ts, on demand. The engine calls it only when
   * the command it is about to run declares a config section, so a run
   * that needs no config never touches the file. `configPath` is the
   * file `--config` named: the loader resolves it against the runtime's
   * cwd and reports its absence. Absent means look for prisma.config.ts
   * in cwd, where absence is not an error. The bin wires the real disk
   * loader; tests hand in fixtures.
   */
  readonly loadConfig: (configPath?: string) => Promise<LoadedConfig>;
  /**
   * The credential manager the bin wires. It is the only source of
   * the needs check, ctx.activeCredential, and ctx.api; absent means
   * this host has no credentials at all, and every command that needs
   * them fails as signed out.
   */
  readonly credentialManager?: CredentialManager;
  /**
   * SDK client construction config the bin injects beside the
   * manager; the engine builds ctx.api from it. Required whenever a
   * credentialManager is wired.
   */
  readonly managementApiClientConfig?: ManagementApiClientConfig;
  /**
   * Opens a URL in the user's browser, wired by the bin (the login
   * flow's opener). The engine calls it only for interactive sessions,
   * treats a throw as "did not open", and never fails a command over
   * it. Absent means this host cannot open a browser: the engine
   * announces the URL instead.
   */
  readonly openUrl?: (url: string) => Promise<void> | void;
  /**
   * Starts a child process with inherited stdio, wired by the bin (a
   * node:child_process adapter) so the engine never imports it. Absent
   * means this host cannot hand the terminal to a child: a maySpawn
   * command is refused as an internal error before its needs check and
   * handler run, so ctx.spawn is never reached.
   */
  readonly spawn?: SpawnChild;
  /**
   * Fire-and-forget delivery of one composed telemetry payload. The bin
   * owns the process work and the detachment, which is why the engine
   * imports no child_process and performs no network I/O for telemetry.
   * Absent means this host reports nothing — not an error, and the whole
   * sequence is skipped rather than only the delivery: no config read,
   * no disclosure, no mint.
   */
  readonly spawnTelemetry?: (payload: TelemetryPayload) => void;
  /** Management API endpoint config; the bin derives baseUrl from env. */
  readonly managementApi: { readonly baseUrl: string };
  /**
   * A host that knows its user's package manager better than detection
   * does. Absent — the normal case — means the engine detects it from
   * the project at cwd.
   */
  readonly packageManager?: PackageManagerId;
  /**
   * Spawns the package manager the engine composed. The engine never
   * imports child_process; this is the only way a manager runs. It is
   * optional so a harness can exercise the no-runner path — every
   * shipped host wires it, and a host without it can run no package
   * operation at all.
   */
  readonly runPackageManager?: PackageManagerRunner;
  /** What this process is running on. The bin reads it once; commands
   *  take it from ctx.host rather than from process. */
  readonly host: Host;
}

/**
 * The facts a command may legitimately need about the machine it runs
 * on: what to put in a bug report, and the rare genuine behavioural
 * difference (symlinks need a privilege on Windows).
 *
 * Deliberately not node-shaped. Products are runtime-agnostic (R4), so
 * the runtime names itself rather than the field naming it.
 */
export interface Host {
  readonly runtime: { readonly name: string; readonly version: string };
  readonly platform: string;
  readonly arch: string;
}

/**
 * The minimal process surface a bin adapts a Runtime from — Node's
 * `process` satisfies it structurally. The engine never reads it; it
 * exists so bins and their tests share one adapter shape.
 */
export interface HostProcess {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly version: string;
  readonly versions: Readonly<Record<string, string | undefined>>;
  readonly platform: string;
  readonly arch: string;
  cwd(): string;
  readonly stdout: { write(text: string): unknown; isTTY?: boolean };
  readonly stderr: {
    write(text: string): unknown;
    isTTY?: boolean;
    columns?: number;
  };
  readonly stdin: {
    isTTY?: boolean;
    setRawMode?(enabled: boolean): unknown;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
  };
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): never;
}

export interface LoadedConfig {
  /**
   * The file this config came from, absolute: the one `--config` named,
   * or prisma.config.ts in cwd. A loader that found no file still names
   * the file it looked for — with no file there are no sections, and
   * the engine reads the path only to name the file when it reports a
   * top-level key that is not one of the CLI's sections.
   */
  readonly path: string;
  /**
   * Raw section values by name; validation happens per command via its
   * command family's section token. The engine, not the loader, checks
   * these names against the sections the CLI declares, so the closed
   * set holds whatever loader a host wires.
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
 * anything.
 */
export const PRISMA_CONFIG_VERSION = 1;
