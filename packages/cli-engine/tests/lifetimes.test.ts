/**
 * Session and server command lifetimes, the engine-owned signal policy
 * (first signal aborts and settles 130/143; a second exits immediately
 * through the runtime's exit proxy), and the optional-dependency story
 * (needs.dependencies + ctx.requireDependency with the engine-phrased
 * install error).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Block,
  createCli,
  defineCommand,
  defineServerCommand,
  defineSessionCommand,
  type Runtime,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

function signalDone(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("session commands", () => {
  const dev = defineSessionCommand({
    help: { summary: "Runs until the signal fires" },
    handler: async (_args, ctx) => {
      ctx.report({ kind: "status", subject: "server", status: "listening" });
      await signalDone(ctx.signal);
      ctx.report({
        kind: "message",
        severity: "info",
        text: "shutting down",
      });
      return ok(undefined);
    },
  });

  async function runInterrupted(reason?: string) {
    const controller = new AbortController();
    const cli = createTestCli({ commands: { dev }, now: EPOCH });
    return cli.run(["dev", "--format", "human"], {
      abort: controller.signal,
      onEvent: (event) => {
        if (event.kind !== "status") {
          return;
        }
        if (reason === undefined) {
          controller.abort();
        } else {
          controller.abort(reason);
        }
      },
    });
  }

  test("runs until the signal fires; a clean shutdown still settles 130", async () => {
    const result = await runInterrupted();

    expect(result.exitCode).toBe(130);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("server: listening\nshutting down\n");
    expect(result.events.map((event) => event.kind)).toEqual([
      "status",
      "message",
    ]);
  });

  test("a session SIGTERM settles 143 the same way", async () => {
    const result = await runInterrupted("SIGTERM");

    expect(result.exitCode).toBe(143);
    expect(result.stderr).toBe("server: listening\nshutting down\n");
  });

  test("a session that finishes on its own settles 0", async () => {
    const drain = defineSessionCommand({
      help: { summary: "Reaches the end of its own work" },
      handler: async (_args, ctx) => {
        ctx.report({ kind: "message", severity: "info", text: "drained" });
        return ok(undefined);
      },
    });
    const cli = createTestCli({ commands: { drain }, now: EPOCH });

    const result = await cli.run(["drain", "--format", "human"]);

    expect(result.exitCode).toBe(0);
  });

  test("json mode terminates the event stream with one completed result frame", async () => {
    const controller = new AbortController();
    controller.abort();
    const cli = createTestCli({ commands: { dev }, now: EPOCH });
    const result = await cli.run(["dev", "--json"], {
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(130);
    expect(result.json[result.json.length - 1]).toEqual({
      kind: "result",
      envelope: {
        ok: true,
        commandId: "dev",
        result: null,
        exitCode: 130,
        diagnostics: [],
        nextActions: [],
      },
      commandId: "dev",
      timestamp: T0,
    });
  });

  test("a session returning notOk settles as errored with exit 2", async () => {
    const broken = defineSessionCommand({
      help: { summary: "Fails to start" },
      handler: async () =>
        notOk(new CliStructuredError("DEV.PORT_TAKEN", "Port already in use")),
    });
    const cli = createTestCli({ commands: { broken }, now: EPOCH });
    const result = await cli.run(["broken", "--json"]);

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("DEV.PORT_TAKEN");
  });
});

describe("signal exit codes", () => {
  const hang = defineCommand({
    help: { summary: "Aborts in-flight work with the signal" },
    handler: async (_args, ctx) => {
      await signalDone(ctx.signal);
      throw ctx.signal.reason;
    },
  });

  async function runAborted(reason?: string) {
    const controller = new AbortController();
    if (reason === undefined) {
      controller.abort();
    } else {
      controller.abort(reason);
    }
    const cli = createTestCli({ commands: { hang }, now: EPOCH });
    return cli.run(["hang", "--json"], { abort: controller.signal });
  }

  test("SIGINT maps to exit 130", async () => {
    const result = await runAborted("SIGINT");

    expect(result.exitCode).toBe(130);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error,
    ).toEqual({
      code: "CLI.ABORTED",
      severity: "error",
      summary: "The command was aborted before it completed.",
      nextActions: [],
    });
  });

  test("SIGTERM maps to exit 143", async () => {
    const result = await runAborted("SIGTERM");

    expect(result.exitCode).toBe(143);
  });

  test("an abort with no named signal is delivered as SIGINT: exit 130", async () => {
    const result = await runAborted();

    expect(result.exitCode).toBe(130);
  });

  test("a handler that finishes its work after the signal settles 130 too", async () => {
    const graceful = defineCommand({
      help: { summary: "Completes successfully after the signal" },
      handler: async (_args, ctx) => {
        await signalDone(ctx.signal);
        return ok(
          ctx.present(
            { data: { cleanedUp: true } },
            {
              human: () => [],
              stdout: () => [],
              json: () => ({ cleanedUp: true }),
              next: () => [],
            },
          ),
        );
      },
    });
    const controller = new AbortController();
    controller.abort("SIGINT");
    const cli = createTestCli({ commands: { graceful }, now: EPOCH });

    const result = await cli.run(["graceful", "--json"], {
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(130);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && last.envelope.ok && last.envelope.exitCode,
    ).toBe(130);
  });

  test("a documented exit code does not outrank the delivered signal", async () => {
    const findings = defineCommand({
      help: { summary: "Reports findings after the signal" },
      exitCodes: { 4: "findings" },
      handler: async (_args, ctx) => {
        await signalDone(ctx.signal);
        return ok(
          ctx.present(
            { data: null, exitCode: 4 },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        );
      },
    });
    const controller = new AbortController();
    controller.abort("SIGTERM");
    const cli = createTestCli({ commands: { findings }, now: EPOCH });

    const result = await cli.run(["findings"], { abort: controller.signal });

    expect(result.exitCode).toBe(143);
  });
});

describe("the engine owns the double-signal policy", () => {
  function hangingRuntime() {
    let subscriber: ((signal: "SIGINT" | "SIGTERM") => void) | undefined;
    const exited: number[] = [];
    const runtime: Runtime = {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      stdin: {
        async *[Symbol.asyncIterator]() {},
      },
      cwd: "/",
      env: {},
      isTty: { stdin: false, stdout: false, stderr: false },
      exit: (code: number): never => {
        exited.push(code);
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: (cb) => {
        subscriber = cb;
        return () => {
          subscriber = undefined;
        };
      },
      loadConfig: async () => ({
        path: "/prisma.config.ts",
        sections: {},
        diagnostics: [],
      }),
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
    };
    return {
      runtime,
      exited,
      deliver: (signal: "SIGINT" | "SIGTERM") => subscriber?.(signal),
    };
  }

  const stuck = defineCommand({
    help: { summary: "Never resolves, even after the signal" },
    handler: () => new Promise<never>(() => {}),
  });

  function stuckCli() {
    return createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { stuck },
    });
  }

  test("a second SIGINT calls runtime.exit(130) and the run never settles normally", async () => {
    const { runtime, exited, deliver } = hangingRuntime();
    const running = stuckCli().run(["stuck"], runtime);

    deliver("SIGINT");
    expect(exited).toEqual([]);
    expect(() => deliver("SIGINT")).toThrow("runtime.exit(130)");
    expect(exited).toEqual([130]);

    const settled = await Promise.race([
      running.then(() => true),
      Promise.resolve(false),
    ]);
    expect(settled).toBe(false);
  });

  test("a second SIGTERM exits 143", async () => {
    const { runtime, exited, deliver } = hangingRuntime();
    void stuckCli().run(["stuck"], runtime);

    deliver("SIGINT");
    expect(() => deliver("SIGTERM")).toThrow("runtime.exit(143)");
    expect(exited).toEqual([143]);
  });

  test("the engine unsubscribes at settlement: signals after the run reach no subscriber", async () => {
    const quick = defineCommand({
      help: { summary: "Completes immediately" },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        ),
    });
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { quick },
    });
    const { runtime, exited, deliver } = hangingRuntime();

    expect(await cli.run(["quick"], runtime)).toBe(0);

    deliver("SIGINT");
    deliver("SIGINT");
    expect(exited).toEqual([]);
  });

  test("a first signal on a cooperating handler settles the run with the signal exit code", async () => {
    const cooperative = defineCommand({
      help: { summary: "Aborts in-flight work with the signal" },
      handler: async (_args, ctx) => {
        await signalDone(ctx.signal);
        throw ctx.signal.reason;
      },
    });
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { cooperative },
    });
    const { runtime, exited, deliver } = hangingRuntime();
    const running = cli.run(["cooperative"], runtime);

    deliver("SIGTERM");

    expect(await running).toBe(143);
    expect(exited).toEqual([]);
  });
});

describe("optional dependencies", () => {
  const MISSING = "@prisma/definitely-not-installed";

  test("ctx.requireDependency resolves ok for an importable specifier", async () => {
    const command = defineCommand({
      help: { summary: "Probes a dependency" },
      handler: async (_args, ctx) => {
        const probe = await ctx.requireDependency("typescript");
        return ok(
          ctx.present(
            { data: { resolvable: probe.ok } },
            {
              human: (): readonly Block[] => [],
              stdout: () => [],
              json: () => ({ resolvable: probe.ok }),
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({ commands: { command }, now: EPOCH });
    const result = await cli.run(["command", "--json"], {
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ resolvable: true });
  });

  test("a relative runtime cwd still resolves installed dependencies", async () => {
    const command = defineCommand({
      help: { summary: "Probes a dependency" },
      needs: { dependencies: ["typescript"] },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null },
            {
              human: (): readonly Block[] => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        ),
    });
    const cli = createTestCli({ commands: { command }, now: EPOCH });
    const result = await cli.run(["command", "--json"], { cwd: "." });

    expect(result.exitCode).toBe(0);
  });

  test("ctx.requireDependency returns the engine-phrased install error for the handler to pass to notOk", async () => {
    const command = defineCommand({
      help: { summary: "Needs a missing dependency" },
      handler: async (_args, ctx) => {
        const probe = await ctx.requireDependency(MISSING);
        if (!probe.ok) {
          return notOk(probe.failure);
        }
        throw new Error("unreachable");
      },
    });
    const cli = createTestCli({
      commands: { command },
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
      packageManager: "pnpm",
      now: EPOCH,
    });
    const result = await cli.run(["command", "--json"], {
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error,
    ).toEqual({
      code: "CLI.MISSING_DEPENDENCY",
      severity: "error",
      summary: `This command requires the optional dependency '${MISSING}', which is not installed in this project.`,
      nextActions: [
        {
          kind: "run-command",
          label: `Install '${MISSING}'`,
          command: `pnpm add ${MISSING}`,
        },
      ],
      meta: {
        specifier: MISSING,
        installCommand: `pnpm add ${MISSING}`,
      },
    });
  });

  test("needs.dependencies fails early, before the handler runs", async () => {
    let ran = false;
    const command = defineCommand({
      help: { summary: "Unconditionally needs a missing dependency" },
      needs: { dependencies: [MISSING] },
      handler: async (_args, ctx) => {
        ran = true;
        return ok(
          ctx.present(
            { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({
      commands: { command },
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
      packageManager: "npm",
      now: EPOCH,
    });
    const result = await cli.run(["command", "--json"], {
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(ran).toBe(false);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" &&
        !last.envelope.ok &&
        last.envelope.error.nextActions,
    ).toEqual([
      {
        kind: "run-command",
        label: `Install '${MISSING}'`,
        command: `npm add ${MISSING}`,
      },
    ]);
  });

  test("with no host override the install command comes from the project at cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "engine-needs-"));
    try {
      await writeFile(join(dir, "yarn.lock"), "");
      const command = defineCommand({
        help: { summary: "Unconditionally needs a missing dependency" },
        needs: { dependencies: [MISSING] },
        handler: async (_args, ctx) =>
          ok(
            ctx.present(
              { data: null },
              {
                human: () => [],
                stdout: () => [],
                json: () => null,
                next: () => [],
              },
            ),
          ),
      });
      const cli = createTestCli({ commands: { command }, now: EPOCH });
      const result = await cli.run(["command", "--json"], { cwd: dir });

      const last = result.json[result.json.length - 1];
      expect(
        last.kind === "result" &&
          !last.envelope.ok &&
          last.envelope.error.nextActions,
      ).toEqual([
        {
          kind: "run-command",
          label: `Install '${MISSING}'`,
          command: `yarn add ${MISSING}`,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("needs.dependencies passes when every specifier resolves", async () => {
    const command = defineCommand({
      help: { summary: "Needs installed dependencies" },
      needs: { dependencies: ["typescript", "vitest"] },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null },
            {
              human: (): readonly Block[] => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        ),
    });
    const cli = createTestCli({ commands: { command }, now: EPOCH });
    const result = await cli.run(["command", "--json"], {
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
  });
});

describe("server commands", () => {
  const lsp = defineServerCommand({
    help: { summary: "Speaks a foreign protocol over stdio" },
    handler: async (_args, io) => {
      let received = "";
      const decoder = new TextDecoder();
      for await (const chunk of io.stdin) {
        received += decoder.decode(chunk, { stream: true });
      }
      io.stdout.write(`Content-Length: ${received.length}\r\n\r\n${received}`);
      return 0;
    },
  });

  test("the foreign client owns stdio: raw bytes out, no envelope, exit code passthrough", async () => {
    const cli = createTestCli({ commands: { lsp }, now: EPOCH });
    const result = await cli.run(["lsp"], { stdin: "{}" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Content-Length: 2\r\n\r\n{}");
    expect(result.stderr).toBe("");
    expect(result.json).toEqual([]);
  });

  test("the handler reads the invocation's environment from io.env", async () => {
    const echoing = defineServerCommand({
      help: { summary: "Echoes an environment value" },
      handler: async (_args, io) => {
        io.stderr.write(`${io.env.SERVER_MODE}\n`);
        return 0;
      },
    });
    const cli = createTestCli({ commands: { echoing }, now: EPOCH });
    const result = await cli.run(["echoing"], {
      env: { SERVER_MODE: "attached" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("attached\n");
  });

  test("a non-integer exit code settles as an internal error", async () => {
    const broken = defineServerCommand({
      help: { summary: "Returns NaN" },
      handler: async () => Number.NaN,
    });
    const cli = createTestCli({ commands: { broken }, now: EPOCH });
    const result = await cli.run(["broken"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CLI.INTERNAL_ERROR");
    expect(result.stderr).toContain("not an integer in 0-255");
  });

  test("an out-of-range exit code settles as an internal error", async () => {
    const broken = defineServerCommand({
      help: { summary: "Returns 300" },
      handler: async () => 300,
    });
    const cli = createTestCli({ commands: { broken }, now: EPOCH });
    const result = await cli.run(["broken"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CLI.INTERNAL_ERROR");
  });

  test("the handler's returned exit code is the run's exit code", async () => {
    const failing = defineServerCommand({
      help: { summary: "Exits nonzero" },
      handler: async () => 42,
    });
    const cli = createTestCli({ commands: { failing }, now: EPOCH });
    const result = await cli.run(["failing"]);

    expect(result.exitCode).toBe(42);
    expect(result.stdout).toBe("");
  });

  test("the shared flag family is not injected", async () => {
    const cli = createTestCli({ commands: { lsp }, now: EPOCH });
    const result = await cli.run(["lsp", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CLI.INVALID_ARGUMENTS");
  });

  test("a thrown error renders on stderr only, never stdout", async () => {
    const crashing = defineServerCommand({
      help: { summary: "Crashes" },
      handler: async () => {
        throw new Error("protocol violation");
      },
    });
    const cli = createTestCli({ commands: { crashing }, now: EPOCH });
    const result = await cli.run(["crashing"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("protocol violation");
  });
});
