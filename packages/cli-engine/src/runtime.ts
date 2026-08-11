import type { CredentialManager } from "./credential-manager";
import type { ManagementApiClientConfig } from "./management-api";
import type { PackageManagerId, PackageManagerRunner } from "./package-manager";
import type { Diagnostic } from "./protocol";

/** Minimal structural stream types; no NodeJS.* in the public surface. */
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
   * Loaded config + file-level diagnostics; the shell builds this via
   * the unified loader. Tests hand in fixtures.
   */
  readonly config: LoadedConfig;
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
}

/**
 * The minimal process surface a bin adapts a Runtime from — Node's
 * `process` satisfies it structurally. The engine never reads it; it
 * exists so bins and their tests share one adapter shape.
 */
export interface HostProcess {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  cwd(): string;
  readonly stdout: { write(text: string): unknown; isTTY?: boolean };
  readonly stderr: { write(text: string): unknown; isTTY?: boolean };
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
   * Raw section values by name; validation happens per command via its
   * command family's section token.
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
