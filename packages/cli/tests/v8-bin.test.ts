import { describe, expect, it } from "vitest";

import { CLIENT_ID, DEFAULT_REDIRECT_URI } from "../src/auth";
import { buildCli } from "../src/v8/cli";
import { main } from "../src/v8/main";
import {
  assembleRuntime,
  detectPackageManager,
  type HostProcess,
  makeOnSignal,
} from "../src/v8/runtime";

function makeProcess(overrides?: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
}): HostProcess & {
  listeners: Map<string, Array<() => void>>;
  exitedWith: number[];
  stderrText: string;
  stdoutText: string;
} {
  const listeners = new Map<string, Array<() => void>>();
  const exitedWith: number[] = [];
  const proc = {
    argv: overrides?.argv ?? ["node", "bin.js"],
    // Telemetry env opt-out so main()'s gating resolution stays inert
    // (no first-run notice on stderr, no dependence on the developer's
    // real user config).
    env: { PRISMA_NEXT_DISABLE_TELEMETRY: "1", ...overrides?.env },
    cwd: () => "/tmp/v8-bin-test-cwd",
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

describe("detectPackageManager", () => {
  it.each([
    ["pnpm/9.0.0 npm/? node/v22", "pnpm"],
    ["yarn/4.0.0 npm/? node/v22", "yarn"],
    ["bun/1.1.0 npm/? node/v22", "bun"],
    ["npm/10.0.0 node/v22", "npm"],
    ["deno/2.0.0", "unknown"],
  ])("maps user agent %s to %s", (userAgent, expected) => {
    expect(detectPackageManager({ npm_config_user_agent: userAgent })).toBe(
      expected,
    );
  });

  it("is unknown when no user agent is set", () => {
    expect(detectPackageManager({})).toBe("unknown");
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

    expect(runtime.cwd).toBe("/tmp/v8-bin-test-cwd");
    expect(runtime.isTty).toEqual({ stdin: true, stdout: true, stderr: false });
    expect(runtime.packageManager).toBe("pnpm");
    expect(runtime.config).toEqual({ sections: {}, diagnostics: [] });
    expect(runtime.managementApi).toEqual({ baseUrl: "https://api.prisma.io" });

    runtime.stdout.write("out");
    runtime.stderr.write("err");
    expect(proc.stdoutText).toBe("out");
    expect(proc.stderrText).toBe("err");
  });

  it("wires the credential manager, the SDK client config, and the browser opener", async () => {
    const proc = makeProcess({
      env: {
        PRISMA_AUTH_FILE: "/tmp/v8-bin-test-auth.json",
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

  it("warns once when the credentials file is named by the deprecated variable", async () => {
    const proc = makeProcess({
      env: { PRISMA_COMPUTE_AUTH_FILE: "/tmp/v8-bin-test-legacy-auth.json" },
    });
    await assembleRuntime(proc);

    expect(proc.stderrText).toContain("PRISMA_COMPUTE_AUTH_FILE is deprecated");
    expect(proc.stderrText).toContain("PRISMA_AUTH_FILE");
  });

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
    expect(proc.stdoutText).toContain("USAGE");
    expect(proc.stdoutText).toContain("auth");
  });

  it("runs --version through the real tree, printing the version with exit 0", async () => {
    const proc = makeProcess({
      argv: ["node", "bin.js", "--version"],
      isTty: { stdout: true },
    });

    const exitCode = await main(proc);

    expect(exitCode).toBe(0);
    expect(proc.stdoutText).toMatch(/^\d+\.\d+\.\d+/);
    expect(proc.stderrText).toBe("");
  });
});
