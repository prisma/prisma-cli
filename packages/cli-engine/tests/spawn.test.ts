/**
 * ctx.spawn against the harness's scripted fake child: structured output,
 * credential injection through both credential origins, the
 * near-expiry refusal, reentrancy, buffered commentary, the abort
 * ladder, and signal record-and-replay.
 */
import {
  createCli,
  defineCommand,
  defineSessionCommand,
  exitWithChildStatus,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  mintTestJwt,
  type ScriptedChildProgram,
  type SpawnRecord,
} from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const NOW = new Date("2030-01-01T00:00:00.000Z");
const CLOCK = () => NOW;

function signalDone(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function jwtExpiringIn(seconds: number, workspaceId: string): string {
  return mintTestJwt({
    workspace_id: workspaceId,
    exp: Math.floor(NOW.getTime() / 1000) + seconds,
  });
}

const converge = defineCommand({
  help: { summary: "Hands the terminal to a child" },
  maySpawn: true,
  handler: async (_args, ctx) => {
    await ctx.spawn({ command: "alchemy", args: ["deploy"] });
    return ok(exitWithChildStatus());
  },
});

describe("structured output for commands that may spawn", () => {
  test("--json keeps stdout framed and marks the child diagnostic", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveLength(1);
    expect(result.json[0]).toMatchObject({
      kind: "result",
      envelope: { ok: true, commandId: "converge", result: null, exitCode: 0 },
    });
    expect(result.spawns[0]?.output).toBe("diagnostic");
  });

  test("--format json selects the same structured handoff", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge", "--format", "json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveLength(1);
    expect(result.spawns[0]?.output).toBe("diagnostic");
  });

  test("a non-TTY caller auto-selects structured output", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveLength(1);
    expect(result.spawns).toHaveLength(1);
    expect(result.spawns[0]?.output).toBe("diagnostic");
  });

  test("a Composer-shaped deployment summary reaches the terminal result", async () => {
    const deploy = defineCommand({
      help: { summary: "Deploys through a child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await ctx.spawn({ command: "alchemy", args: ["deploy"] });
        const summary = {
          app: "my-app",
          nodes: [
            {
              address: "https://my-app.prisma.build",
              entities: [{ kind: "service", id: "web" }],
            },
          ],
        };
        return ok(
          ctx.present(
            { data: { summary } },
            {
              human: () => [],
              stdout: () => [],
              json: () => ({ summary }),
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({ commands: { deploy }, now: CLOCK });

    const result = await cli.run(["deploy"]);

    expect(result.exitCode).toBe(0);
    expect(result.json.at(-1)).toMatchObject({
      kind: "result",
      envelope: {
        ok: true,
        result: {
          summary: {
            nodes: [{ address: "https://my-app.prisma.build" }],
          },
        },
      },
    });
  });

  test("a TTY caller keeps the inherited terminal handoff", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual([]);
    expect(result.spawns[0]?.output).toBe("inherit");
  });

  test("help no longer claims json is unsupported", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge", "--help"]);

    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "does not support --json",
    );
  });
});

describe("the child's status", () => {
  test("exitWithChildStatus settles the child's exit code verbatim, unframed", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 3, signal: null }),
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("a signal-killed child settles 128 + the signal number", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: null, signal: "SIGINT" }),
    });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(130);
    expect(result.json.at(-1)).toMatchObject({
      kind: "result",
      envelope: {
        ok: false,
        error: {
          code: "CLI.CHILD_PROCESS_FAILED",
          meta: { exitCode: null, signal: "SIGINT" },
        },
      },
    });
  });

  test("the settlement summary carries the child's code", async () => {
    const summaries: number[] = [];
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 7, signal: null }),
    });

    await cli.run(["converge"], {
      onSettled: (summary) => summaries.push(summary.exitCode),
    });

    expect(summaries).toEqual([7]);
  });

  test("a session command settles non-zero through the same path", async () => {
    const dev = defineSessionCommand({
      help: { summary: "A session that converges through a child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({
      commands: { dev },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 5, signal: null }),
    });

    const result = await cli.run(["dev"]);

    expect(result.exitCode).toBe(5);
    expect(result.json.at(-1)).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.CHILD_PROCESS_FAILED",
          meta: { exitCode: 5, signal: null },
        },
      },
    });
  });

  test("a launch failure is a structured error, not a crash", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawn: () => {
        throw new Error("spawn alchemy ENOENT");
      },
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.SPAWN_FAILED");
    expect(result.stderr).toContain("ENOENT");
  });
});

/** Composer's shape: the spawn happens down in an operations layer
 *  that hands the handler nothing back, so the only place the child's
 *  status can come from is the engine's own record. */
async function convergeInAnotherLayer(ctx: {
  readonly spawn: (options: { readonly command: string }) => Promise<unknown>;
}): Promise<void> {
  await ctx.spawn({ command: "alchemy" });
}

describe("the run records its most recent child", () => {
  test("ctx.lastChild() is undefined until a child has run", async () => {
    const asking = defineCommand({
      help: { summary: "Asks for a child before running one" },
      maySpawn: true,
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: ctx.lastChild() ?? "none" },
            {
              human: () => [],
              stdout: () => [],
              json: () => ctx.lastChild() ?? "none",
              next: () => [],
            },
          ),
        ),
    });
    const cli = createTestCli({ commands: { asking }, now: CLOCK });

    const result = await cli.run(["asking"]);

    expect(result.presented?.data).toBe("none");
    expect(result.spawns).toEqual([]);
  });

  test("ctx.lastChild() reports how the child ended", async () => {
    const asking = defineCommand({
      help: { summary: "Reads its child off the run" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await ctx.spawn({ command: "alchemy" });
        return ok(
          ctx.present(
            { data: ctx.lastChild() },
            {
              human: () => [],
              stdout: () => [],
              json: () => ctx.lastChild(),
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({
      commands: { asking },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 9, signal: null }),
    });

    const result = await cli.run(["asking"]);

    expect(result.presented?.data).toEqual({ exitCode: 9, signal: null });
  });

  test("after two children it is the LAST one, not the first", async () => {
    const twice = defineCommand({
      help: { summary: "Runs two children in sequence" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await ctx.spawn({ command: "first" });
        const afterFirst = ctx.lastChild();
        await ctx.spawn({ command: "second" });
        return ok(
          ctx.present(
            { data: { afterFirst, afterSecond: ctx.lastChild() } },
            {
              human: () => [],
              stdout: () => [],
              json: () => ({ afterFirst, afterSecond: ctx.lastChild() }),
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({
      commands: { twice },
      now: CLOCK,
      spawnScript: (request) => ({
        exitCode: request.command === "first" ? 4 : 5,
        signal: null,
      }),
    });

    const result = await cli.run(["twice"]);

    expect(result.presented?.data).toEqual({
      afterFirst: { exitCode: 4, signal: null },
      afterSecond: { exitCode: 5, signal: null },
    });
    expect(result.spawns.map((spawn) => spawn.command)).toEqual([
      "first",
      "second",
    ]);
  });

  test("exitWithChildStatus settles from the record, not from the handler", async () => {
    const layered = defineCommand({
      help: { summary: "Spawns through a layer that returns nothing" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await convergeInAnotherLayer(ctx);
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({
      commands: { layered },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 6, signal: null }),
    });

    expect((await cli.run(["layered"])).exitCode).toBe(6);
  });
});

describe("the spawn request", () => {
  test("command, args and cwd reach the adapter; env values are never recorded", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["converge"], {
      cwd: "/work",
      env: { SECRET_VALUE: "s3cret" },
    });

    expect(result.spawns).toHaveLength(1);
    const record: SpawnRecord = result.spawns[0];
    expect(record.command).toBe("alchemy");
    expect(record.args).toEqual(["deploy"]);
    expect(record.cwd).toBe("/work");
    expect(record.envKeys).toContain("SECRET_VALUE");
    expect(JSON.stringify(record)).not.toContain("s3cret");
    expect(seen.SECRET_VALUE).toBe("s3cret");
  });

  test("a second ctx.spawn while one is live is a construction error", async () => {
    const twice = defineCommand({
      help: { summary: "Spawns twice at once" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const first = ctx.spawn({ command: "first" });
        const second = await ctx
          .spawn({ command: "second" })
          .then(() => "no error", String);
        await first;
        return ok(
          ctx.present(
            { data: second },
            {
              human: () => [],
              stdout: () => [],
              json: () => second,
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({ commands: { twice }, now: CLOCK });

    const result = await cli.run(["twice"]);

    expect(result.presented?.data).toContain("one live child per run");
    expect(result.spawns).toHaveLength(1);
  });

  test("ctx.spawn without maySpawn is a construction error", async () => {
    const undeclared = defineCommand({
      help: { summary: "Spawns without declaring it" },
      handler: async (_args, ctx) => {
        await ctx.spawn({ command: "alchemy" });
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
    const cli = createTestCli({ commands: { undeclared }, now: CLOCK });

    const result = await cli.run(["undeclared"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result.json)).toContain("without declaring maySpawn");
  });

  test("needs.credentials 'child' without maySpawn fails construction", () => {
    const wrong = defineCommand({
      help: { summary: "Wants credentials it cannot hand over" },
      needs: { credentials: "child" },
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

    expect(() =>
      createCli({
        name: "t",
        version: "0.0.0",
        commandFamilies: [],
        groups: {},
        commands: { wrong },
      }),
    ).toThrow("needs credentials for a child without declaring maySpawn");
  });

  test("a maySpawn command on a Runtime without a spawn adapter refuses before the handler runs", async () => {
    const { runtime, stderr } = controllableRuntime();
    let handlerRan = false;
    const stranded = defineCommand({
      help: { summary: "Spawns on a host with no adapter" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        handlerRan = true;
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { stranded },
    });

    const exitCode = await cli.run(["stranded"], runtime);

    expect(exitCode).toBe(1);
    expect(handlerRan).toBe(false);
    expect(stderr()).toContain("no spawn adapter");
  });
});

describe("output while a child owns the terminal", () => {
  test("commentary is buffered and flushed in order once the child ends", async () => {
    let eventsAtChildExit = -1;
    const events: string[] = [];
    const chatty = defineCommand({
      help: { summary: "Reports while the child runs" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = ctx.spawn({ command: "alchemy" });
        ctx.report({ kind: "message", severity: "info", text: "during-1" });
        ctx.report({ kind: "message", severity: "info", text: "during-2" });
        await child;
        ctx.report({ kind: "message", severity: "info", text: "after" });
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
      commands: { chatty },
      now: CLOCK,
      spawnScript: () => {
        eventsAtChildExit = events.length;
        return { exitCode: 0, signal: null };
      },
    });

    await cli.run(["chatty", "--format", "human"], {
      onEvent: (event) => {
        if (event.kind === "message") {
          events.push(event.text);
        }
      },
    });

    expect(eventsAtChildExit).toBe(0);
    expect(events).toEqual(["during-1", "during-2", "after"]);
  });

  test("json frames stream live while the child runs", async () => {
    let eventsAtChildExit = -1;
    const events: string[] = [];
    const chatty = defineCommand({
      help: { summary: "Reports while the child runs" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = ctx.spawn({ command: "alchemy" });
        ctx.report({ kind: "message", severity: "info", text: "during-1" });
        ctx.report({ kind: "message", severity: "info", text: "during-2" });
        await child;
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
      commands: { chatty },
      now: CLOCK,
      spawnScript: () => {
        eventsAtChildExit = events.length;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["chatty", "--json"], {
      onEvent: (event) => {
        if (event.kind === "message") {
          events.push(event.text);
        }
      },
    });

    expect(result.exitCode).toBe(0);
    expect(eventsAtChildExit).toBe(2);
    expect(events).toEqual(["during-1", "during-2"]);
  });

  test("ctx.present while a child is live is a construction error", async () => {
    const presenting = defineCommand({
      help: { summary: "Presents mid-child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = ctx.spawn({ command: "alchemy" });
        const failure = (() => {
          try {
            ctx.present(
              { data: null },
              {
                human: () => [],
                stdout: () => [],
                json: () => null,
                next: () => [],
              },
            );
            return "no error";
          } catch (cause) {
            return String(cause);
          }
        })();
        await child;
        return ok(
          ctx.present(
            { data: failure },
            {
              human: () => [],
              stdout: () => [],
              json: () => failure,
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({ commands: { presenting }, now: CLOCK });

    const result = await cli.run(["presenting"]);

    expect(result.presented?.data).toContain(
      "while a child owned the terminal",
    );
  });
});

describe("signals", () => {
  test("a delivered SIGINT is recorded, not acted on, and replayed on child exit", async () => {
    const controller = new AbortController();
    let abortedInsideChild: boolean | undefined;
    let abortedAfterChild: boolean | undefined;
    let abortedNow: () => boolean = () => false;
    const watcher = defineCommand({
      help: { summary: "Observes the signal around the child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        abortedNow = () => ctx.signal.aborted;
        await ctx.spawn({ command: "alchemy" });
        abortedAfterChild = ctx.signal.aborted;
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
      commands: { watcher },
      now: CLOCK,
      spawnScript: () => {
        controller.abort();
        abortedInsideChild = abortedNow();
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["watcher"], { abort: controller.signal });

    expect(abortedInsideChild).toBe(false);
    expect(abortedAfterChild).toBe(true);
    // The replayed signal is a delivered signal like any other: the
    // handler completed successfully after it, and the run still
    // settles as interrupted.
    expect(result.exitCode).toBe(130);
  });

  test("a session interrupted during a child cleans up and settles 130", async () => {
    const controller = new AbortController();
    const dev = defineSessionCommand({
      help: { summary: "Converges, then runs until the signal fires" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await ctx.spawn({ command: "alchemy" });
        await signalDone(ctx.signal);
        ctx.report({ kind: "message", severity: "info", text: "stopped" });
        return ok(undefined);
      },
    });
    const cli = createTestCli({
      commands: { dev },
      now: CLOCK,
      spawnScript: () => {
        controller.abort();
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["dev", "--format", "human"], {
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain("stopped");
  });

  test("a delivered SIGTERM is forwarded to the child during the window", async () => {
    const controller = new AbortController();
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: async (_request, child) => {
        controller.abort("SIGTERM");
        await child.nextKill();
        return { exitCode: null, signal: "SIGTERM" };
      },
    });

    const result = await cli.run(["converge"], { abort: controller.signal });

    expect(result.spawns[0].kills).toEqual(["SIGTERM"]);
    expect(result.exitCode).toBe(143);
  });

  test("two signals during the window abort, then force-exit after the handler resolves", async () => {
    const { runtime, exited, deliver } = controllableRuntime();
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { converge },
    });

    const running = cli.run(["converge"], {
      ...runtime,
      spawn: () => ({
        ended: (async () => {
          deliver("SIGINT");
          deliver("SIGINT");
          return { exitCode: 0, signal: null };
        })(),
        kill: () => {},
      }),
    });

    await expect(running).rejects.toThrow("runtime.exit(130)");
    expect(exited).toEqual([130]);
  });

  test("an already-aborted signal runs the termination ladder", async () => {
    const controller = new AbortController();
    const late = defineCommand({
      help: { summary: "Spawns after the signal already fired" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        ctx.report({ kind: "status", subject: "run", status: "ready" });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({
      commands: { late },
      now: CLOCK,
      spawnScript: async (_request, child) => {
        await child.nextKill();
        await child.nextKill();
        return { exitCode: null, signal: "SIGKILL" };
      },
    });

    const result = await cli.run(["late"], {
      abort: controller.signal,
      onEvent: (event) => {
        if (event.kind === "status") {
          controller.abort();
        }
      },
    });

    expect(result.spawns[0].kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result.exitCode).toBe(137);
  });
});

const credentialedConverge = defineCommand({
  help: { summary: "Hands credentials to a child" },
  maySpawn: true,
  needs: { credentials: "child" },
  handler: async (_args, ctx) => {
    await ctx.spawn({ command: "alchemy", args: ["deploy"] });
    return ok(exitWithChildStatus());
  },
});

describe("credential injection", () => {
  test("a stored session's access token is read at spawn time, not at mount", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const mountToken = jwtExpiringIn(3600, "ws_1");
    const rotatedToken = jwtExpiringIn(7200, "ws_1");
    const record = (token: string) => ({
      workspaceId: "ws_1",
      workspaceName: undefined,
      credential: {
        token,
        refreshToken: "refresh-material",
        expiresAt: undefined,
      },
    });
    const reportThenSpawn = defineCommand({
      help: { summary: "Reports, then hands credentials to a child" },
      maySpawn: true,
      needs: { credentials: "child" },
      handler: async (_args, ctx) => {
        ctx.report({ kind: "status", subject: "run", status: "pre-spawn" });
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({
      commands: { converge: reportThenSpawn },
      now: CLOCK,
      sessions: [record(mountToken)],
      selectedWorkspaceId: "ws_1",
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["converge"], {
      onEvent: (event) => {
        if (event.kind === "status") {
          // Another process rotates the stored token between mount
          // and spawn; the spawn-time read must see the new one.
          cli.credentialManager.overwriteStoredState({
            sessions: [record(rotatedToken)],
          });
        }
      },
    });

    expect(result.exitCode).toBe(0);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(rotatedToken);
    expect(seen.PRISMA_WORKSPACE_ID).toBe("ws_1");
    expect(Object.values(seen)).not.toContain("refresh-material");
  });

  // The spawn-time read refuses only an already-expired token: the
  // near-expiry policy ran at preflight, and a still-valid credential
  // must never be refused after the handler's pre-spawn work.
  test("a token expired by spawn time is refused", async () => {
    const reportThenSpawn = defineCommand({
      help: { summary: "Reports, then hands credentials to a child" },
      maySpawn: true,
      needs: { credentials: "child" },
      handler: async (_args, ctx) => {
        ctx.report({ kind: "status", subject: "run", status: "pre-spawn" });
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({
      commands: { converge: reportThenSpawn },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(3_600, "ws_1"),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    const result = await cli.run(["converge", "--format", "human"], {
      onEvent: (event) => {
        if (event.kind === "status") {
          cli.credentialManager.overwriteStoredState({
            sessions: [
              {
                workspaceId: "ws_1",
                workspaceName: undefined,
                credential: {
                  token: jwtExpiringIn(-60, "ws_1"),
                  refreshToken: undefined,
                  expiresAt: undefined,
                },
              },
            ],
          });
        }
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("expires too soon");
    expect(result.spawns).toEqual([]);
  });

  test("a token that drifts merely near expiry mid-handler still spawns", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const nearExpiryToken = jwtExpiringIn(60, "ws_1");
    const reportThenSpawn = defineCommand({
      help: { summary: "Reports, then hands credentials to a child" },
      maySpawn: true,
      needs: { credentials: "child" },
      handler: async (_args, ctx) => {
        ctx.report({ kind: "status", subject: "run", status: "pre-spawn" });
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({
      commands: { converge: reportThenSpawn },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(3_600, "ws_1"),
        refreshToken: undefined,
        expiresAt: undefined,
      },
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["converge"], {
      onEvent: (event) => {
        if (event.kind === "status") {
          cli.credentialManager.overwriteStoredState({
            sessions: [
              {
                workspaceId: "ws_1",
                workspaceName: undefined,
                credential: {
                  token: nearExpiryToken,
                  refreshToken: undefined,
                  expiresAt: undefined,
                },
              },
            ],
          });
        }
      },
    });

    expect(result.exitCode).toBe(0);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(nearExpiryToken);
  });

  test("an environment credential's token is injected unchanged", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const token = jwtExpiringIn(3600, "ws_env");
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      environmentCredential: {
        token,
        refreshToken: undefined,
        expiresAt: undefined,
      },
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(token);
    expect(seen.PRISMA_WORKSPACE_ID).toBe("ws_env");
  });

  test("a session expiring within the threshold refuses before the handler runs", async () => {
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(60, "ws_1"),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
    expect(result.stderr).toContain("expires too soon");
    expect(result.stderr).toContain("Sign in");
    expect(result.spawns).toEqual([]);
  });

  test("a token without exp uses its explicit expiry for the threshold", async () => {
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: mintTestJwt({ workspace_id: "ws_1" }),
        refreshToken: undefined,
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("expires too soon");
    expect(result.spawns).toEqual([]);
  });

  test("a refreshable near-expiry session is rotated before the child starts", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const rotatedToken = jwtExpiringIn(3600, "ws_1");
    const refreshes: string[] = [];
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(60, "ws_1"),
        refreshToken: "refresh-1",
        expiresAt: undefined,
      },
      refreshCredential: async ({ refreshToken }) => {
        refreshes.push(refreshToken);
        return {
          kind: "success",
          accessToken: rotatedToken,
          refreshToken: "refresh-2",
          expiresAt: new Date(NOW.getTime() + 3_600_000),
        };
      },
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(0);
    expect(refreshes).toEqual(["refresh-1"]);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(rotatedToken);
    expect(Object.values(seen)).not.toContain("refresh-1");
    expect(Object.values(seen)).not.toContain("refresh-2");
    expect(cli.credentialManager.state().sessions[0]?.credential).toEqual({
      token: rotatedToken,
      refreshToken: "refresh-2",
      expiresAt: new Date(NOW.getTime() + 3_600_000),
    });
  });

  test("concurrent delegated runs exchange one refresh token once", async () => {
    const rotatedToken = jwtExpiringIn(3600, "ws_1");
    let refreshes = 0;
    let releaseRefresh: (() => void) | undefined;
    let markRefreshStarted: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(60, "ws_1"),
        refreshToken: "refresh-1",
        expiresAt: undefined,
      },
      refreshCredential: async () => {
        refreshes += 1;
        markRefreshStarted?.();
        await held;
        return {
          kind: "success",
          accessToken: rotatedToken,
          refreshToken: "refresh-2",
          expiresAt: new Date(NOW.getTime() + 3_600_000),
        };
      },
    });

    const first = cli.run(["converge"]);
    const second = cli.run(["converge"]);
    await refreshStarted;
    releaseRefresh?.();

    expect(
      (await Promise.all([first, second])).map((run) => run.exitCode),
    ).toEqual([0, 0]);
    expect(refreshes).toBe(1);
  });

  test("invalid_grant ends the stored session and reports it as expired", async () => {
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(60, "ws_1"),
        refreshToken: "refresh-1",
        expiresAt: undefined,
      },
      refreshCredential: async () => ({ kind: "invalid" }),
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Your session has expired");
    expect(result.spawns).toEqual([]);
    expect(cli.credentialManager.state().sessions).toEqual([]);
  });

  test("a transient refresh failure preserves the session", async () => {
    const token = jwtExpiringIn(60, "ws_1");
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token,
        refreshToken: "refresh-1",
        expiresAt: undefined,
      },
      refreshCredential: async () => {
        throw new Error("endpoint response carrying SECRET material");
      },
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.AUTH_SERVICE_ERROR");
    expect(result.stderr).not.toContain("SECRET");
    expect(cli.credentialManager.state().sessions[0]?.credential.token).toBe(
      token,
    );
  });

  // The threshold is five minutes. Bracketing it at 60 s and 3600 s
  // would pass even with the wrong unit or comparison, so both sides of
  // the boundary are pinned to the second.
  test("a session expiring at exactly five minutes refuses", async () => {
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(300, "ws_1"),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    const result = await cli.run(["converge", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("expires too soon");
    expect(result.spawns).toEqual([]);
  });

  test("a session expiring one second past five minutes runs", async () => {
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(301, "ws_1"),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    expect((await cli.run(["converge"])).exitCode).toBe(0);
  });

  test("a session outside the threshold runs", async () => {
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      credential: {
        token: jwtExpiringIn(3600, "ws_1"),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    expect((await cli.run(["converge"])).exitCode).toBe(0);
  });

  test("a command without the child-credentials need gets no injected credentials", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      sessions: [
        {
          workspaceId: "ws_1",
          workspaceName: undefined,
          credential: {
            token: jwtExpiringIn(3600, "ws_1"),
            refreshToken: undefined,
            expiresAt: undefined,
          },
        },
      ],
      selectedWorkspaceId: "ws_1",
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    await cli.run(["converge"]);

    expect(seen.PRISMA_SERVICE_TOKEN).toBeUndefined();
    expect(seen.PRISMA_WORKSPACE_ID).toBeUndefined();
  });

  test("a credential naming no workspace deletes an inherited PRISMA_WORKSPACE_ID", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const claimlessToken = mintTestJwt({ sub: "user_1" });
    const cli = createTestCli({
      commands: { converge: credentialedConverge },
      now: CLOCK,
      environmentCredential: {
        token: claimlessToken,
        refreshToken: undefined,
        expiresAt: undefined,
      },
      spawnScript: (request) => {
        seen = request.env;
        return { exitCode: 0, signal: null };
      },
    });

    const result = await cli.run(["converge"], {
      env: { PRISMA_WORKSPACE_ID: "ws_stale" },
    });

    expect(result.exitCode).toBe(0);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(claimlessToken);
    expect(seen.PRISMA_WORKSPACE_ID).toBeUndefined();
  });
});

describe("the settlement bypass is fenced to declaring commands", () => {
  test("a result command without maySpawn returning exitWithChildStatus is a construction error", async () => {
    const undeclared = defineCommand({
      help: { summary: "Settles a child status it never earned" },
      handler: async () => ok(exitWithChildStatus()),
    });
    const cli = createTestCli({ commands: { undeclared }, now: CLOCK });

    const result = await cli.run(["undeclared"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without declaring maySpawn");
  });

  test("in json mode the stream still ends with its result frame", async () => {
    const undeclared = defineCommand({
      help: { summary: "Settles a child status it never earned" },
      handler: async () => ok(exitWithChildStatus()),
    });
    const cli = createTestCli({ commands: { undeclared }, now: CLOCK });

    const result = await cli.run(["undeclared", "--json"]);

    expect(result.exitCode).toBe(1);
    const resultFrames = result.json.filter((frame) => frame.kind === "result");
    expect(resultFrames).toHaveLength(1);
    expect(JSON.stringify(resultFrames[0])).toContain("CLI.INTERNAL_ERROR");
  });

  test("a session command without maySpawn is fenced the same way", async () => {
    const undeclared = defineSessionCommand({
      help: { summary: "A session settling a child status it never earned" },
      handler: async () => ok(exitWithChildStatus()),
    });
    const cli = createTestCli({ commands: { undeclared }, now: CLOCK });

    const result = await cli.run(["undeclared"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without declaring maySpawn");
  });

  test("a declaring command that never spawned is a construction error", async () => {
    const empty = defineSessionCommand({
      help: { summary: "Settles a child status without running a child" },
      maySpawn: true,
      handler: async () => ok(exitWithChildStatus()),
    });
    const cli = createTestCli({ commands: { empty }, now: CLOCK });

    const result = await cli.run(["empty"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without a child having run");
    expect(result.spawns).toEqual([]);
  });

  test("the child ctx.spawn ran settles normally", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 7, signal: null }),
    });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(7);
  });
});

describe("next actions on a child-status settlement", () => {
  const hinting = defineCommand({
    help: { summary: "A converge that always asks for a reproduce hint" },
    maySpawn: true,
    handler: async (_args, ctx) => {
      await ctx.spawn({ command: "alchemy" });
      return ok(
        exitWithChildStatus({
          nextActions: [
            {
              kind: "run-command",
              label: "Reproduce the failed converge",
              command: "alchemy deploy ./entry.ts",
            },
          ],
        }),
      );
    },
  });

  test("they render to stderr before the run exits with the child's code", async () => {
    const cli = createTestCli({
      commands: { hinting },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 3, signal: null }),
    });

    const result = await cli.run(["hinting"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "→ Reproduce the failed converge: alchemy deploy ./entry.ts",
    );
  });

  test("a signal-killed child drops them and settles the abort", async () => {
    const cli = createTestCli({
      commands: { hinting },
      now: CLOCK,
      spawnScript: () => ({ exitCode: null, signal: "SIGINT" }),
    });

    const result = await cli.run(["hinting"], { isTty: { stdout: true } });

    // The user stopped the converge, so there is nothing to reproduce:
    // the abort wins over what the handler asked for.
    expect(result.exitCode).toBe(130);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("json carries reproduce guidance in the terminal error envelope", async () => {
    const cli = createTestCli({
      commands: { hinting },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 3, signal: null }),
    });

    const result = await cli.run(["hinting", "--json"]);

    expect(result.exitCode).toBe(3);
    expect(result.json.at(-1)).toMatchObject({
      envelope: {
        ok: false,
        error: { code: "CLI.CHILD_PROCESS_FAILED" },
        nextActions: [
          {
            kind: "run-command",
            command: "alchemy deploy ./entry.ts",
          },
        ],
      },
    });
  });
});

describe("unknown terminations are never success", () => {
  test("an adapter that cannot say how the child ended settles 1", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: null, signal: null }),
    });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(1);
    expect(result.json.at(-1)).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.CHILD_PROCESS_FAILED",
          summary: "The delegated process exited with code unknown.",
        },
      },
    });
  });

  test("a signal outside the portable table settles 1, not 128", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: null, signal: "SIGWEIRD" }),
    });

    expect((await cli.run(["converge"])).exitCode).toBe(1);
  });
});

describe("a handler that abandons the spawn promise", () => {
  /** A child that never ends on its own: only the engine's termination
   *  ladder can end it, so the run settling at all proves the engine
   *  drove that ladder and waited. */
  function childEndingOnlyWhenKilled(order: string[]): ScriptedChildProgram {
    return async (_request, { nextKill }) => {
      const signal = await nextKill();
      order.push("child ended");
      return { exitCode: null, signal };
    };
  }

  test("resolving with a live child ends that child before the run settles", async () => {
    const order: string[] = [];
    const abandoning = defineSessionCommand({
      help: { summary: "Returns while its child is still live" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        void ctx.spawn({ command: "alchemy" }).catch(() => {});
        return ok(undefined);
      },
    });
    const cli = createTestCli({
      commands: { abandoning },
      now: CLOCK,
      spawnScript: childEndingOnlyWhenKilled(order),
    });

    const result = await cli.run(["abandoning", "--format", "human"]);
    order.push("run settled");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("resolved while a child was still live");
    expect(result.spawns[0].kills[0]).toBe("SIGTERM");
    expect(order).toEqual(["child ended", "run settled"]);
  });

  test("throwing with a live child is the same error, naming the throw", async () => {
    const order: string[] = [];
    const throwing = defineCommand({
      help: { summary: "Throws while its child is still live" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        void ctx.spawn({ command: "alchemy" }).catch(() => {});
        throw new Error("boom mid-child");
      },
    });
    const cli = createTestCli({
      commands: { throwing },
      now: CLOCK,
      spawnScript: childEndingOnlyWhenKilled(order),
    });

    const result = await cli.run(["throwing", "--format", "human"]);
    order.push("run settled");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("resolved while a child was still live");
    expect(result.stderr).toContain("boom mid-child");
    expect(order).toEqual(["child ended", "run settled"]);
  });

  test("commentary buffered before the abandonment still reaches stderr", async () => {
    const order: string[] = [];
    const abandoning = defineSessionCommand({
      help: { summary: "Reports, then returns while its child is live" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        void ctx.spawn({ command: "alchemy" }).catch(() => {});
        ctx.report({
          kind: "message",
          severity: "info",
          text: "during-child",
        });
        return ok(undefined);
      },
    });
    const cli = createTestCli({
      commands: { abandoning },
      now: CLOCK,
      spawnScript: childEndingOnlyWhenKilled(order),
    });

    const result = await cli.run(["abandoning", "--format", "human"]);

    expect(result.stderr).toContain("during-child");
  });
});

describe("signal replay routes every force exit after settlement", () => {
  test("a signal recorded after a pre-spawn abort force-exits only after telemetry", async () => {
    const { runtime, exited, deliver } = controllableRuntime();
    const summaries: number[] = [];
    const late = defineCommand({
      help: { summary: "Spawns after the signal already fired" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        deliver("SIGINT");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { late },
    });

    const running = cli.run(
      ["late"],
      {
        ...runtime,
        spawn: () => ({
          ended: (async () => {
            deliver("SIGINT");
            return { exitCode: 0, signal: null };
          })(),
          kill: () => {},
        }),
      },
      { onSettled: (summary) => summaries.push(summary.exitCode) },
    );

    await expect(running).rejects.toThrow("runtime.exit(130)");
    expect(exited).toEqual([130]);
    expect(summaries).toEqual([0]);
  });

  test("a second recorded signal forwards SIGTERM so the child stays reachable", async () => {
    const { runtime, exited, deliver } = controllableRuntime();
    const kills: string[] = [];
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { converge },
    });

    const running = cli.run(["converge"], {
      ...runtime,
      spawn: () => ({
        ended: (async () => {
          deliver("SIGINT");
          deliver("SIGINT");
          return { exitCode: null, signal: "SIGTERM" };
        })(),
        kill: (signal) => {
          kills.push(signal);
        },
      }),
    });

    await expect(running).rejects.toThrow("runtime.exit(130)");
    expect(kills).toEqual(["SIGTERM"]);
    expect(exited).toEqual([130]);
  });
});

describe("the commentary buffer is bounded", () => {
  test("events past the cap are dropped and the flush says how many", async () => {
    const chatty = defineCommand({
      help: { summary: "Reports far past the cap during a child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = ctx.spawn({ command: "alchemy" });
        for (let index = 0; index < 1005; index += 1) {
          ctx.report({
            kind: "message",
            severity: "info",
            text: `event-${index}`,
          });
        }
        await child;
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
    const messages: string[] = [];
    const cli = createTestCli({ commands: { chatty }, now: CLOCK });

    const result = await cli.run(["chatty", "--format", "human"], {
      onEvent: (event) => {
        if (event.kind === "message") {
          messages.push(event.text);
        }
      },
    });

    expect(result.exitCode).toBe(0);
    const dropped = messages.filter((text) => text.includes("dropped"));
    expect(dropped).toEqual([
      "5 buffered events dropped while a child owned the terminal",
    ]);
    expect(messages).toHaveLength(1001);
    expect(messages[999]).toBe("event-999");
  });
});

describe("the terminal has one owner at a time", () => {
  test("ctx.prompt during a live child is a construction error", async () => {
    const prompting = defineCommand({
      help: { summary: "Prompts mid-child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = ctx.spawn({ command: "alchemy" });
        const failure = await ctx.prompt
          .confirm("Proceed?", { default: true })
          .then(() => "no error", String);
        await child;
        return ok(
          ctx.present(
            { data: failure },
            {
              human: () => [],
              stdout: () => [],
              json: () => failure,
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({ commands: { prompting }, now: CLOCK });

    const result = await cli.run(["prompting"]);

    expect(result.presented?.data).toContain(
      "called ctx.prompt while a child owned the terminal",
    );
  });

  test("ctx.spawn during an unawaited prompt is a construction error", async () => {
    const prompting = defineCommand({
      help: { summary: "Spawns while a prompt is reading stdin" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        // Never awaited: the prompt has already started reading stdin
        // by the time the next line asks for the same terminal.
        const answer = ctx.prompt.confirm("Proceed?", { default: true });
        const failure = await ctx
          .spawn({ command: "alchemy" })
          .then(() => "no error", String);
        await answer;
        return ok(
          ctx.present(
            { data: failure },
            {
              human: () => [],
              stdout: () => [],
              json: () => failure,
              next: () => [],
            },
          ),
        );
      },
    });
    const cli = createTestCli({ commands: { prompting }, now: CLOCK });

    const result = await cli.run(["prompting"]);

    expect(result.presented?.data).toContain(
      "called ctx.spawn while a prompt owned the terminal",
    );
    expect(result.spawns).toEqual([]);
  });

  test("a settled prompt releases the terminal for a later spawn", async () => {
    const sequential = defineCommand({
      help: { summary: "Prompts, then spawns" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        await ctx.prompt.confirm("Proceed?", { default: true });
        await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus());
      },
    });
    const cli = createTestCli({ commands: { sequential }, now: CLOCK });

    const result = await cli.run(["sequential"]);

    expect(result.exitCode).toBe(0);
    expect(result.spawns).toHaveLength(1);
  });
});

function controllableRuntime() {
  // A set, like the real runtime's: a second registration must not
  // displace the first, and one unsubscribe must not clear the others.
  const subscribers = new Set<(signal: "SIGINT" | "SIGTERM") => void>();
  const exited: number[] = [];
  const stderrText: string[] = [];
  const runtime: Runtime = {
    stdout: { write: () => {} },
    stderr: {
      write: (text) => {
        stderrText.push(text);
      },
    },
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
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    loadConfig: async () => ({
      files: [],
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
    stderr: () => stderrText.join(""),
    deliver: (signal: "SIGINT" | "SIGTERM") => {
      if (subscribers.size === 0) {
        throw new Error("deliver() ran with no signal subscriber registered");
      }
      for (const cb of [...subscribers]) {
        cb(signal);
      }
    },
  };
}
