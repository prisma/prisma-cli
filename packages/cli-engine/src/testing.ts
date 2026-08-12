import type { CommandFamily, MountedTree } from "./command-family";
import { CONFIG_FILE_NAME } from "./config-loader";
import type { Credential } from "./credential-manager";
import type { EngineEvent, StreamEvent } from "./events";
import { buildEngine } from "./execution/engine";
import {
  InMemoryCredentialManager,
  type SessionRecord,
} from "./in-memory-credential-manager";
import type {
  ManagementApiClient,
  ManagementApiClientConfig,
} from "./management-api";
import type { PackageManagerId, PackageManagerRunner } from "./package-manager";
import type { PresentedResult } from "./presentation";
import type { RunSummary } from "./run-summary";
import type { Runtime } from "./runtime";
import type { ChildResult, SpawnChild, SpawnRequest } from "./spawn";
import type { TelemetryPayload } from "./telemetry/payload";
import type { TelemetryDeclaration } from "./telemetry/report";

/**
 * What a scripted fake child does. `nextKill` resolves with each signal
 * the engine delivers, so a script can model a child that ignores
 * SIGTERM and only dies on SIGKILL.
 */
export type ScriptedChildProgram = (
  request: SpawnRequest,
  child: { readonly nextKill: () => Promise<"SIGTERM" | "SIGKILL"> },
) => ChildResult | Promise<ChildResult>;

/** One ctx.spawn call, as the harness saw it. */
export interface SpawnRecord {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Environment KEYS only. Values are never recorded: a fixture file
   *  must not be able to carry token material. */
  readonly envKeys: readonly string[];
  /** The signals the engine delivered to the child, in order. */
  readonly kills: readonly ("SIGTERM" | "SIGKILL")[];
}

interface MutableSpawnRecord extends SpawnRecord {
  readonly kills: ("SIGTERM" | "SIGKILL")[];
}

function scriptedSpawn(program: ScriptedChildProgram): SpawnChild {
  return (request) => {
    const delivered: ("SIGTERM" | "SIGKILL")[] = [];
    const waiting: Array<(signal: "SIGTERM" | "SIGKILL") => void> = [];
    return {
      ended: (async () =>
        program(request, {
          nextKill: async () => {
            const queued = delivered.shift();
            return (
              queued ??
              (await new Promise<"SIGTERM" | "SIGKILL">((resolve) => {
                waiting.push(resolve);
              }))
            );
          },
        }))(),
      kill: (signal) => {
        const waiter = waiting.shift();
        if (waiter === undefined) {
          delivered.push(signal);
          return;
        }
        waiter(signal);
      },
    };
  };
}

function recordingSpawn(
  adapter: SpawnChild,
  spawns: MutableSpawnRecord[],
): SpawnChild {
  return (request) => {
    const record: MutableSpawnRecord = {
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      envKeys: Object.keys(request.env),
      kills: [],
    };
    spawns.push(record);
    const child = adapter(request);
    return {
      ended: child.ended,
      kill: (signal) => {
        record.kills.push(signal);
        child.kill(signal);
      },
    };
  };
}

export interface TestCli {
  /**
   * The mutable in-memory credential manager backing the runs — the
   * whole stored state (sessions with their credentials, the
   * selection) is readable back after a run via state().
   */
  readonly credentialManager: InMemoryCredentialManager;
  run(
    argv: readonly string[],
    opts?: {
      readonly stdin?: string;
      /**
       * Scripted prompt answers, consumed in order; a run that prompts
       * past the script fails the test.
       */
      readonly answers?: ReadonlyArray<string | boolean>;
      /**
       * Abort the run (session tests): its firing is delivered to the
       * engine as a signal (SIGTERM when the reason is 'SIGTERM',
       * SIGINT otherwise).
       */
      readonly abort?: AbortSignal;
      /** Live event tap, for asserting mid-session behavior. */
      readonly onEvent?: (event: EngineEvent) => void;
      /** Settlement tap: receives the RunSummary the engine fires
       *  after settlement (once, mounted runs only). */
      readonly onSettled?: (summary: RunSummary) => void;
      readonly cwd?: string;
      readonly isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
      /** Terminal width, as the stream would report it. Absent means
       *  not a terminal, which is what ui.width reads as unbounded. */
      readonly columns?: { stderr?: number };
      readonly env?: Readonly<Record<string, string | undefined>>;
      /** Overrides the CLI-level seed, so one harness can assert both
       *  sides of the CI branch. Absent leaves the engine to detect CI
       *  from `env`, which is how a test asserts detection itself. */
      readonly isCI?: boolean;
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
     * without byte-scraping; undefined when the run never presented.
     */
    readonly presented: PresentedResult<unknown> | undefined;
    /** Every ctx.spawn the run made, in order. */
    readonly spawns: readonly SpawnRecord[];
    /** Every telemetry payload the run handed to the seam, in order.
     *  Empty when the CLI declared no telemetry, when gating disabled
     *  the run, or when the harness wired no seam. */
    readonly telemetry: readonly TelemetryPayload[];
  }>;
}

function runEnv(
  environmentCredential: Credential | undefined,
  env: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string | undefined>> {
  if (environmentCredential === undefined) {
    return env ?? {};
  }
  return { PRISMA_SERVICE_TOKEN: environmentCredential.token, ...env };
}

function relaySignalOnAbort(
  abort: AbortSignal | undefined,
  deliver: (reason: unknown) => void,
): void {
  if (abort === undefined) {
    return;
  }
  if (abort.aborted) {
    deliver(abort.reason);
    return;
  }
  abort.addEventListener("abort", () => deliver(abort.reason), { once: true });
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

/**
 * The test harness: the same engine over in-memory streams. The
 * harness hands the engine no real process access at all — its exit
 * proxy throws and its streams are in-memory — which is how "the engine
 * never touches process globals and writes only to provided streams" is
 * proven by construction.
 */
export function createTestCli(spec: {
  readonly commandFamilies?: readonly CommandFamily[];
  readonly commands: MountedTree;
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>;
  /** Seeds the sections the config file would have held. The engine
   *  asks for them only when the command declares a config section, and
   *  checks them as it would a real file's: a section name no mounted
   *  command declares fails the run. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Replaces the loader outright — to assert what --config asked for,
   *  to return file-level diagnostics, or to prove a run never reads
   *  the config at all. Wins over `config` when both are given. */
  readonly loadConfig?: Runtime["loadConfig"];
  /** Convenience manager seed: createSession runs its real claims
   *  derivation on this credential (mint the token with mintTestJwt). */
  readonly credential?: Credential;
  /** Stored sessions, mirroring the state file's records. */
  readonly sessions?: readonly SessionRecord[];
  /** The stored selection. */
  readonly selectedWorkspaceId?: string;
  /** The credential PRISMA_SERVICE_TOKEN supplies. Its access token is
   *  also exported to each run's env as PRISMA_SERVICE_TOKEN
   *  (overridable per run). */
  readonly environmentCredential?: Credential;
  /** The SDK client construction config; defaults point every
   *  endpoint at test.invalid hosts. */
  readonly managementApiClientConfig?: ManagementApiClientConfig;
  /** baseUrl defaults to "https://test.invalid"; when `client` is
   *  supplied, ctx.api IS that object. */
  readonly managementApi?: {
    readonly baseUrl?: string;
    readonly client?: ManagementApiClient;
  };
  /** Overrides detection, the same way a host's Runtime does; absent
   *  means the engine detects from the run's cwd. */
  readonly packageManager?: PackageManagerId;
  /** The scripted stand-in for the shipped bin's spawner: assert the
   *  composed file/args/cwd, script exit codes and stderr, drive
   *  onOutput. Absent means this host has no runner, which is the
   *  failure every package operation then takes. */
  readonly packageManagerRunner?: PackageManagerRunner;
  /** Fixed clock for deterministic stream timestamps; a clock that
   *  advances also drives prompt.browserWait's timeout. */
  readonly now?: () => Date;
  /** The browser opener behind ctx.openUrl and prompt.browserWait.
   *  Defaults to one that succeeds without doing anything; pass a spy
   *  to assert what was opened, or a thrower to exercise the
   *  could-not-open path. */
  readonly openUrl?: (url: string) => Promise<void> | void;
  /** Waiting is instant under test whatever this does; pass a spy to
   *  assert the interval a poll loop asked for. */
  readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The spawn adapter behind ctx.spawn. Defaults to the scripted fake;
   *  the real-child tests pass a node:child_process adapter, which is
   *  how the engine package itself never imports one. */
  readonly spawn?: SpawnChild;
  /** Scripts the built-in fake child. Defaults to one that exits 0. */
  readonly spawnScript?: ScriptedChildProgram;
  /** Declares telemetry, exactly as `createCli` does. Absent means this
   *  CLI reports nothing, which is what every test that says nothing
   *  about telemetry gets. */
  readonly telemetry?: TelemetryDeclaration;
  /** The seam behind Runtime.spawnTelemetry. Payloads are recorded on
   *  the run result either way; pass a spy to assert ordering, a
   *  thrower to exercise failure isolation, or `null` to model a host
   *  that wires no seam at all. */
  readonly telemetrySpawner?: ((payload: TelemetryPayload) => void) | null;
  /** Forces the CI answer for every run; `run({ isCI })` overrides it.
   *  Absent leaves the engine to detect CI from the run's `env`. */
  readonly isCI?: boolean;
}): TestCli {
  const credentialManager = new InMemoryCredentialManager({
    sessions: spec.sessions,
    selectedWorkspaceId: spec.selectedWorkspaceId,
    credential: spec.credential,
    environmentCredential: spec.environmentCredential,
  });
  const managementApiBaseUrl =
    spec.managementApi?.baseUrl ?? "https://test.invalid";
  const managementApiClientConfig: ManagementApiClientConfig =
    spec.managementApiClientConfig ?? {
      clientId: "test-client-id",
      redirectUri: "https://test.invalid/auth/callback",
      apiBaseUrl: managementApiBaseUrl,
      authBaseUrl: "https://auth.test.invalid",
    };
  const loadConfig: Runtime["loadConfig"] =
    spec.loadConfig ??
    (async (configPath) => ({
      path: configPath ?? CONFIG_FILE_NAME,
      sections: spec.config ?? {},
      diagnostics: [],
    }));
  const spawnChild: SpawnChild =
    spec.spawn ??
    scriptedSpawn(spec.spawnScript ?? (() => ({ exitCode: 0, signal: null })));
  const openUrl = spec.openUrl ?? ((): void => {});
  const engine = buildEngine(
    {
      name: "prisma-test",
      version: "0.0.0",
      commandFamilies: spec.commandFamilies ?? [],
      groups: spec.groups ?? {},
      commands: spec.commands,
      telemetry: spec.telemetry,
    },
    /** Waiting is instant under test: browserWait's polling is driven
     *  by the seeded clock, never by real time. */
    {
      now: spec.now,
      delay: async (ms, signal) => {
        await spec.delay?.(ms, signal);
      },
    },
  );
  return {
    credentialManager,
    async run(argv, opts) {
      let stdoutText = "";
      let stderrText = "";
      const frames: StreamEvent[] = [];
      const events: EngineEvent[] = [];
      let presented: PresentedResult<unknown> | undefined;
      const spawns: MutableSpawnRecord[] = [];
      const telemetry: TelemetryPayload[] = [];
      const signalListeners = new Set<(signal: "SIGINT" | "SIGTERM") => void>();
      const deliverSignal = (reason: unknown): void => {
        const signal = reason === "SIGTERM" ? "SIGTERM" : "SIGINT";
        for (const listener of [...signalListeners]) {
          listener(signal);
        }
      };
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
          columns: opts?.columns?.stderr,
        },
        stdin: inputStreamFromString(opts?.stdin ?? ""),
        cwd: opts?.cwd ?? "/",
        env: runEnv(spec.environmentCredential, opts?.env),
        isTty: {
          stdin: opts?.isTty?.stdin ?? false,
          stdout: opts?.isTty?.stdout ?? false,
          stderr: opts?.isTty?.stderr ?? false,
        },
        isCIOverride: opts?.isCI ?? spec.isCI,
        exit: (code: number): never => {
          throw new Error(
            `@prisma/cli-engine: runtime.exit(${code}) reached the test harness`,
          );
        },
        onSignal: (cb) => {
          signalListeners.add(cb);
          return () => {
            signalListeners.delete(cb);
          };
        },
        loadConfig,
        credentialManager,
        managementApiClientConfig,
        spawn: recordingSpawn(spawnChild, spawns),
        spawnTelemetry:
          spec.telemetrySpawner === null
            ? undefined
            : (payload) => {
                telemetry.push(payload);
                spec.telemetrySpawner?.(payload);
              },
        openUrl,
        managementApi: { baseUrl: managementApiBaseUrl },
        packageManager: spec.packageManager,
        runPackageManager: spec.packageManagerRunner,
      };
      const running = engine.execute(argv, runtime, {
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
        onSettled: opts?.onSettled,
        answers: opts?.answers,
        managementApi:
          spec.managementApi?.client === undefined
            ? undefined
            : { client: spec.managementApi.client },
      });
      relaySignalOnAbort(opts?.abort, deliverSignal);
      const exitCode = await running;
      return {
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        json: frames,
        events,
        presented,
        spawns,
        telemetry,
      };
    },
  };
}
