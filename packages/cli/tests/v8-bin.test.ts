import { describe, expect, it, vi } from "vitest";

import {
  assembleRuntime,
  detectPackageManager,
  main,
  makeGetCredentials,
  type ProcessLike,
  wireSignals,
} from "../src/v8/main";

vi.mock("../src/adapters/token-storage", () => ({
  FileTokenStorage: class {
    getTokens() {
      return Promise.resolve({
        accessToken: "stored_token",
        workspaceId: "ws_1",
      });
    }
  },
}));

function makeProcess(overrides?: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
}): ProcessLike & {
  listeners: Map<string, Array<() => void>>;
  exitedWith: number[];
  stderrText: string;
  stdoutText: string;
} {
  const listeners = new Map<string, Array<() => void>>();
  const exitedWith: number[] = [];
  const proc = {
    argv: overrides?.argv ?? ["node", "bin.js"],
    env: overrides?.env ?? {},
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
    } as unknown as ProcessLike["stdin"],
    on(event: "SIGINT" | "SIGTERM", listener: () => void) {
      const existing = listeners.get(event) ?? [];
      listeners.set(event, [...existing, listener]);
      return proc;
    },
    exit(code: number) {
      exitedWith.push(code);
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

describe("wireSignals", () => {
  it("aborts the controller with the signal name on the first signal", () => {
    const proc = makeProcess();
    const controller = new AbortController();
    wireSignals(proc, controller);

    fire(proc, "SIGINT");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("SIGINT");
    expect(proc.exitedWith).toEqual([]);
  });

  it("force-exits 130 on a second SIGINT", () => {
    const proc = makeProcess();
    wireSignals(proc, new AbortController());

    fire(proc, "SIGINT");
    fire(proc, "SIGINT");

    expect(proc.exitedWith).toEqual([130]);
  });

  it("force-exits 143 when the second signal is SIGTERM", () => {
    const proc = makeProcess();
    wireSignals(proc, new AbortController());

    fire(proc, "SIGINT");
    fire(proc, "SIGTERM");

    expect(proc.exitedWith).toEqual([143]);
  });
});

describe("makeGetCredentials", () => {
  it("prefers a non-empty PRISMA_SERVICE_TOKEN over stored tokens", async () => {
    const getCredentials = makeGetCredentials({
      PRISMA_SERVICE_TOKEN: " svc_token ",
    } as NodeJS.ProcessEnv);

    expect(await getCredentials()).toEqual({ token: "svc_token" });
  });

  it("reads the stored token even after the run signal aborted", async () => {
    const controller = new AbortController();
    controller.abort("SIGINT");
    const getCredentials = makeGetCredentials({} as NodeJS.ProcessEnv);

    expect(await getCredentials()).toEqual({ token: "stored_token" });
  });
});

describe("assembleRuntime", () => {
  it("assembles the runtime from the process-like host", async () => {
    const proc = makeProcess({
      env: { npm_config_user_agent: "pnpm/9.0.0" },
      isTty: { stdin: true, stdout: true, stderr: false },
    });
    const controller = new AbortController();

    const runtime = await assembleRuntime(proc, controller.signal);

    expect(runtime.cwd).toBe("/tmp/v8-bin-test-cwd");
    expect(runtime.isTty).toEqual({ stdin: true, stdout: true, stderr: false });
    expect(runtime.signal).toBe(controller.signal);
    expect(runtime.packageManager).toBe("pnpm");
    expect(runtime.config).toEqual({ sections: {}, diagnostics: [] });

    runtime.stdout.write("out");
    runtime.stderr.write("err");
    expect(proc.stdoutText).toBe("out");
    expect(proc.stderrText).toBe("err");
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
