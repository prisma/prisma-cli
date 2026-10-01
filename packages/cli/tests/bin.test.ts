import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Runtime, StreamEvent } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { describe, expect, it } from "vitest";

import { CLIENT_ID, DEFAULT_REDIRECT_URI } from "../src/auth/client";
import { buildCli } from "../src/cli";
import { getCliVersion } from "../src/lib/version";
import { main } from "../src/main";
import {
  assembleRuntime,
  describeHost,
  type HostProcess,
  makeOnSignal,
} from "../src/runtime";

/** A real config file outside any test's cwd, so --config is the only
 *  way to reach it. */
const NAMED_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "config",
  "elsewhere.config.ts",
);

/** A config whose evaluation fails with Node's wording for a missing
 *  `import "prisma/config"`. */
const MISSING_PRISMA_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "config",
  "missing-prisma.config.ts",
);

/** A composer section that still carries the retired `configPath`. */
const COMPOSER_CONFIG_PATH_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "config",
  "composer-config-path.config.ts",
);

/** A composer section built with `@prisma/composer/config`. */
const COMPOSER_VALID_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "config",
  "composer-valid.config.ts",
);

const SEMVER_PREFIX = /^\d+\.\d+\.\d+/;

/** A config home outside any real one, so the telemetry preference
 *  store resolves somewhere harmless. Nothing writes here: telemetry is
 *  opted out below, and `telemetry status` is read-only. */
const CONFIG_HOME = join(tmpdir(), "bin-test-config-home");

function makeProcess(overrides?: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
  columns?: number;
}): HostProcess & {
  listeners: Map<string, Array<() => void>>;
  exitedWith: number[];
  stderrText: string;
  stdoutText: string;
  stderr: { columns?: number };
} {
  const listeners = new Map<string, Array<() => void>>();
  const exitedWith: number[] = [];
  const proc = {
    argv: overrides?.argv ?? ["node", "bin.js"],
    version: "v22.12.0",
    versions: { node: "22.12.0" },
    platform: "linux",
    arch: "x64",
    // Telemetry env opt-out so the engine's gating stays inert (no
    // first-run notice on stderr, nothing sent), and a config home of
    // our own so nothing here resolves the developer's real one.
    env: {
      PRISMA_DISABLE_TELEMETRY: "1",
      XDG_CONFIG_HOME: CONFIG_HOME,
      APPDATA: CONFIG_HOME,
      ...overrides?.env,
    },
    cwd: () => "/tmp/bin-test-cwd",
    listeners,
    exitedWith,
    stdoutText: "",
    stderrText: "",
    stdout: {
      isTTY: overrides?.isTty?.stdout,
      write(text: string) {
        proc.stdoutText += text;
      },
    },
    stderr: {
      isTTY: overrides?.isTty?.stderr,
      /** Node updates this on SIGWINCH, so the test can move it. */
      columns: overrides?.columns,
      write(text: string) {
        proc.stderrText += text;
      },
    },
    stdin: {
      isTTY: overrides?.isTty?.stdin,
      async *[Symbol.asyncIterator]() {},
    } as unknown as HostProcess["stdin"],
    on(event: "SIGINT" | "SIGTERM", listener: () => void) {
      const existing = listeners.get(event) ?? [];
      listeners.set(event, [...existing, listener]);
      return proc;
    },
    off(event: "SIGINT" | "SIGTERM", listener: () => void) {
      const existing = listeners.get(event) ?? [];
      listeners.set(
        event,
        existing.filter((registered) => registered !== listener),
      );
      return proc;
    },
    exit(code: number): never {
      exitedWith.push(code);
      throw new Error(`process.exit(${code})`);
    },
  };
  return proc;
}

function fire(
  proc: ReturnType<typeof makeProcess>,
  event: "SIGINT" | "SIGTERM",
): void {
  for (const listener of proc.listeners.get(event) ?? []) {
    listener();
  }
}

describe("describeHost", () => {
  const base = {
    version: "v22.12.0",
    platform: "darwin",
    arch: "arm64",
  } as const;

  it("names node when nothing else announces itself", () => {
    expect(
      describeHost({ ...base, versions: { node: "22.12.0" } } as never),
    ).toEqual({
      runtime: { name: "node", version: "22.12.0" },
      platform: "darwin",
      arch: "arm64",
    });
  });

  it.each(["bun", "deno"])("names %s when it announces itself", (name) => {
    expect(
      describeHost({
        ...base,
        versions: { node: "22.12.0", [name]: "1.2.3" },
      } as never).runtime,
    ).toEqual({ name, version: "1.2.3" });
  });

  it("falls back to process.version when the runtime reports no version", () => {
    expect(describeHost({ ...base, versions: {} } as never).runtime).toEqual({
      name: "node",
      version: "v22.12.0",
    });
  });
});

describe("makeOnSignal", () => {
  it("forwards process signals to the subscriber, applying no policy of its own", () => {
    const proc = makeProcess();
    const seen: string[] = [];
    makeOnSignal(proc)((signal) => seen.push(signal));

    fire(proc, "SIGINT");
    fire(proc, "SIGTERM");
    fire(proc, "SIGINT");

    expect(seen).toEqual(["SIGINT", "SIGTERM", "SIGINT"]);
    expect(proc.exitedWith).toEqual([]);
  });

  it("the returned unsubscribe detaches the process listeners", () => {
    const proc = makeProcess();
    const seen: string[] = [];
    const unsubscribe = makeOnSignal(proc)((signal) => seen.push(signal));

    unsubscribe();
    fire(proc, "SIGINT");
    fire(proc, "SIGTERM");

    expect(seen).toEqual([]);
  });
});

describe("assembleRuntime", () => {
  it("assembles the runtime from the process-like host", async () => {
    const proc = makeProcess({
      env: { npm_config_user_agent: "pnpm/9.0.0" },
      isTty: { stdin: true, stdout: true, stderr: false },
    });
    const runtime = await assembleRuntime(proc);

    expect(runtime.cwd).toBe("/tmp/bin-test-cwd");
    expect(runtime.isTty).toEqual({ stdin: true, stdout: true, stderr: false });
    expect(runtime.packageManager).toBeUndefined();
    expect(runtime.managementApi).toEqual({ baseUrl: "https://api.prisma.io" });
    expect(await runtime.loadConfig()).toEqual({
      files: [],
      diagnostics: [],
    });

    runtime.stdout.write("out");
    runtime.stderr.write("err");
    expect(proc.stdoutText).toBe("out");
    expect(proc.stderrText).toBe("err");
  });

  it("unrefs stdin when the engine returns its iterator, and refs it for the next reader", async () => {
    const calls: string[] = [];
    const proc = makeProcess({ isTty: { stdin: true } });
    Object.assign(proc.stdin, {
      ref: () => calls.push("ref"),
      unref: () => calls.push("unref"),
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
        return: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
      }),
    });
    const runtime = await assembleRuntime(proc);

    const iterator = runtime.stdin[Symbol.asyncIterator]();
    void iterator.next();
    const returned = await Promise.race([
      iterator.return?.(),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 200)),
    ]);

    expect(returned).toEqual({ done: true, value: undefined });
    expect(calls).toEqual(["ref", "unref"]);
    runtime.stdin[Symbol.asyncIterator]();
    expect(calls).toEqual(["ref", "unref", "ref"]);
  });

  /**
   * The engine reads stderr's width at render time so a terminal
   * resized mid-run reports its new size. That only holds if the bin
   * forwards the live property instead of copying it once, here, while
   * assembling the runtime — a copy freezes ui.width at process start.
   */
  it("forwards stderr's width live, not as a snapshot", async () => {
    const proc = makeProcess({ isTty: { stderr: true }, columns: 120 });
    const runtime = await assembleRuntime(proc);

    expect(runtime.stderr.columns).toBe(120);
    proc.stderr.columns = 60;
    expect(runtime.stderr.columns).toBe(60);
  });

  it("wires the credential manager, the SDK client config, and the browser opener", async () => {
    const proc = makeProcess({
      env: {
        PRISMA_AUTH_FILE: "/tmp/bin-test-auth.json",
        PRISMA_MANAGEMENT_API_URL: "https://api.example.test",
      },
    });
    const runtime = await assembleRuntime(proc);

    expect(runtime.credentialManager).toBeDefined();
    expect(runtime.managementApiClientConfig).toEqual({
      clientId: CLIENT_ID,
      redirectUri: DEFAULT_REDIRECT_URI,
      apiBaseUrl: "https://api.example.test",
      authBaseUrl: "https://auth.prisma.io",
    });
    expect(typeof runtime.openUrl).toBe("function");
    expect(proc.stderrText).toBe("");
  });

  it("wires a package-manager runner that really spawns", async () => {
    const runtime = await assembleRuntime(makeProcess());

    const chunks: string[] = [];
    const result = await runtime.runPackageManager?.({
      file: process.execPath,
      args: ["-e", `process.stdout.write("ran")`],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      onOutput: (_channel, chunk) => chunks.push(chunk),
    });

    expect(result).toEqual({ exitCode: 0, stderr: "" });
    expect(chunks.join("")).toBe("ran");
  });

  it("warns once when the credentials file is named by the deprecated variable", async () => {
    const proc = makeProcess({
      env: { PRISMA_COMPUTE_AUTH_FILE: "/tmp/bin-test-legacy-auth.json" },
    });
    await assembleRuntime(proc);

    expect(proc.stderrText).toContain("PRISMA_COMPUTE_AUTH_FILE is deprecated");
    expect(proc.stderrText).toContain("PRISMA_AUTH_FILE");
  });

  it("reads the file --config named, and reports its absence rather than returning an empty config", async () => {
    const runtime = await assembleRuntime(makeProcess());

    const found = await runtime.loadConfig(NAMED_CONFIG_PATH);
    expect(found).toEqual({
      files: [
        {
          path: NAMED_CONFIG_PATH,
          sections: { toy: { greeting: "from the named file" } },
        },
      ],
      diagnostics: [],
    });

    const missing = await runtime.loadConfig(`${NAMED_CONFIG_PATH}.gone`);
    expect(missing.files).toEqual([]);
    expect(missing.diagnostics[0]?.diagnostic.code).toBe(
      "CLI.CONFIG_NOT_FOUND",
    );
  }, 60_000);

  it("loads the config once per config path: repeated and concurrent calls share one promise", async () => {
    const runtime = await assembleRuntime(makeProcess());

    const discovered = runtime.loadConfig();
    expect(runtime.loadConfig()).toBe(discovered);

    const named = runtime.loadConfig(`${NAMED_CONFIG_PATH}.gone`);
    expect(named).not.toBe(discovered);
    expect(runtime.loadConfig(`${NAMED_CONFIG_PATH}.gone`)).toBe(named);

    await Promise.all([discovered, named]);
  });

  it("names this CLI's exact version in the install guidance for an unresolvable prisma package", async () => {
    const runtime = await assembleRuntime(makeProcess());

    const loaded = await runtime.loadConfig(MISSING_PRISMA_CONFIG_PATH);
    expect(loaded.diagnostics[0]?.diagnostic.nextActions?.[0]?.label).toContain(
      `npm install --save-dev prisma@${getCliVersion()}`,
    );
  }, 60_000);

  it("derives managementApi.baseUrl from PRISMA_MANAGEMENT_API_URL", async () => {
    const proc = makeProcess({
      env: { PRISMA_MANAGEMENT_API_URL: "https://api.example.test" },
    });
    const runtime = await assembleRuntime(proc);
    expect(runtime.managementApi).toEqual({
      baseUrl: "https://api.example.test",
    });
  });

  it("proxies exit to process.exit and signals to the process listeners", async () => {
    const proc = makeProcess();
    const runtime = await assembleRuntime(proc);

    const seen: string[] = [];
    runtime.onSignal((signal) => seen.push(signal));
    fire(proc, "SIGTERM");
    expect(seen).toEqual(["SIGTERM"]);

    expect(() => runtime.exit(130)).toThrow("process.exit(130)");
    expect(proc.exitedWith).toEqual([130]);
  });
});

describe("main", () => {
  it("propagates the cli's exit code", async () => {
    const proc = makeProcess({ argv: ["node", "bin.js", "auth", "whoami"] });

    const exitCode = await main(proc, () => ({
      run: async (argv) => (argv.join(" ") === "auth whoami" ? 42 : 0),
    }));

    expect(exitCode).toBe(42);
  });

  it("prints one line and exits 1 when construction fails", async () => {
    const proc = makeProcess();

    const exitCode = await main(proc, () => {
      throw new Error("@prisma/cli-engine: mount path 'x' collides");
    });

    expect(exitCode).toBe(1);
    expect(proc.stderrText).toBe(
      "@prisma/cli-engine: mount path 'x' collides\n",
    );
    expect(proc.stdoutText).toBe("");
  });
});

describe("buildCli", () => {
  it("constructs the shipped command tree without throwing", () => {
    expect(() => buildCli()).not.toThrow();
  });

  it("runs --help through the real tree with a stub process", async () => {
    const proc = makeProcess({
      argv: ["node", "bin.js", "--help"],
      isTty: { stdout: true },
    });

    const exitCode = await main(proc);

    expect(exitCode).toBe(0);
    expect(proc.stdoutText).toContain("The Prisma Developer Platform");
    expect(proc.stdoutText).toContain("auth");
  });

  /** Counts the runs that actually asked for the config file, by
   *  wrapping the runtime main() assembled before it reaches the CLI. */
  async function runCountingConfigReads(argv: string[]): Promise<{
    readonly exitCode: number;
    readonly reads: number;
    readonly proc: ReturnType<typeof makeProcess>;
  }> {
    const proc = makeProcess({ argv: ["node", "bin.js", ...argv] });
    const real = buildCli();
    let reads = 0;
    const exitCode = await main(proc, () => ({
      run: (runArgv, runtime, hooks) => {
        const counting: Runtime = {
          ...runtime,
          loadConfig: (configPath) => {
            reads += 1;
            return runtime.loadConfig(configPath);
          },
        };
        return real.run(runArgv, counting, hooks);
      },
    }));
    return { exitCode, reads, proc };
  }

  it("a command with no config need never reads the config file", async () => {
    const run = await runCountingConfigReads(["telemetry", "status"]);

    expect(run.exitCode).toBe(0);
    expect(run.reads).toBe(0);
  });

  it("accepts --config on a command that needs no config, and still does not read it", async () => {
    const run = await runCountingConfigReads([
      "telemetry",
      "status",
      "--config",
      NAMED_CONFIG_PATH,
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.reads).toBe(0);
  });

  it("rejects --config= — the shape the parser cannot see as a flag", async () => {
    const run = await runCountingConfigReads([
      "telemetry",
      "status",
      "--config=",
    ]);

    expect(run.exitCode).toBe(2);
    expect(run.proc.stdoutText).toContain("CLI.INVALID_ARGUMENTS");
    expect(run.proc.stdoutText).toContain("--config needs a path");
  });

  it("names --config on leaf help and documents it on root help", async () => {
    const leaf = makeProcess({
      argv: ["node", "bin.js", "telemetry", "status", "--help"],
      isTty: { stdout: true },
    });
    expect(await main(leaf)).toBe(0);
    expect(leaf.stdoutText).toContain("--config");

    const root = makeProcess({
      argv: ["node", "bin.js", "--help"],
      isTty: { stdout: true },
    });
    expect(await main(root)).toBe(0);
    expect(root.stdoutText).toContain(
      "Read this config file instead of ./prisma.config.ts",
    );
  });

  /** The error the bin's stream settled on, read from the terminal
   *  result frame. Parsed rather than matched against the raw text:
   *  stdout is not a TTY here, so the stream is JSON, and JSON escapes
   *  every separator in a Windows path — no path the CLI printed is a
   *  substring of the stream that carried it. */
  function resultFailure(stdoutText: string): {
    readonly error: Diagnostic;
    readonly diagnostics: readonly Diagnostic[];
  } {
    const frames = stdoutText
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as StreamEvent);
    const last = frames.at(-1);
    if (last?.kind !== "result" || last.envelope.ok) {
      throw new Error(`expected a failed result frame, got: ${stdoutText}`);
    }
    return {
      error: last.envelope.error,
      diagnostics: last.envelope.diagnostics,
    };
  }

  /** Composer's `dev` through the real bin, reading the given config. */
  async function runComposerDev(configPath: string): Promise<{
    readonly exitCode: number;
    readonly error: Diagnostic;
    readonly diagnostics: readonly Diagnostic[];
  }> {
    const proc = makeProcess({
      argv: ["node", "bin.js", "dev", "--config", configPath, "src/service.ts"],
    });

    const exitCode = await main(proc);
    return { exitCode, ...resultFailure(proc.stdoutText) };
  }

  /**
   * The mount's config wiring, end to end: the section name composer's
   * family declares, read by the bin's real disk loader and checked by
   * composer's own validator before any handler runs, so every
   * platform sees the same refusal.
   */
  it("refuses a composer section that still names a config file", async () => {
    const { exitCode, error, diagnostics } = await runComposerDev(
      COMPOSER_CONFIG_PATH_CONFIG_PATH,
    );

    expect(exitCode).toBe(2);
    expect(error.code).toBe("CLI.CONFIG_SECTION_INVALID");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "CONFIG.FIELD_RETIRED",
        meta: { field: "configPath" },
        where: { path: COMPOSER_CONFIG_PATH_CONFIG_PATH },
      }),
    ]);
  });

  /**
   * `dev --help` never evaluates the config, so a valid section shows
   * only on a run that validates it: composer's validator accepts the
   * section and the command reaches its own handler.
   */
  it("hands a valid composer section to composer's dev", async () => {
    const { exitCode, error } = await runComposerDev(
      COMPOSER_VALID_CONFIG_PATH,
    );

    expect(exitCode).toBe(2);
    expect(error.code).toBe(
      process.platform === "win32"
        ? "DEV.PLATFORM_UNSUPPORTED"
        : "COMPOSE.ENTRY_UNLOADABLE",
    );
  });

  it("runs --version through the real tree, printing the version with exit 0", async () => {
    const proc = makeProcess({
      argv: ["node", "bin.js", "--version"],
      isTty: { stdout: true },
    });

    const exitCode = await main(proc);

    expect(exitCode).toBe(0);
    expect(proc.stdoutText).toMatch(SEMVER_PREFIX);
    expect(proc.stderrText).toBe("");
  });
});
