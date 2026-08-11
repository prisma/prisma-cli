/**
 * ctx.spawn against the harness's scripted fake child: the --json
 * refusal, credential injection through both credential origins, the
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
    const child = await ctx.spawn({ command: "alchemy", args: ["deploy"] });
    return ok(exitWithChildStatus(child));
  },
});

describe("--json is refused for commands that may spawn", () => {
  test("--json settles 2 with a structured refusal and no frames", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([]);
    expect(result.stderr).toContain("does not support json output");
    expect(result.spawns).toEqual([]);
  });

  test("--format json is refused the same way", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge", "--format", "json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([]);
  });

  test("an auto-selected json format falls back to human instead of failing", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual([]);
    expect(result.spawns).toHaveLength(1);
  });

  test("help states the refusal", async () => {
    const cli = createTestCli({ commands: { converge }, now: CLOCK });

    const result = await cli.run(["converge", "--help"]);

    expect(`${result.stdout}${result.stderr}`).toContain(
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

    const result = await cli.run(["converge"]);

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

    expect((await cli.run(["converge"])).exitCode).toBe(130);
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
      handler: async (_args, ctx) =>
        ok(exitWithChildStatus(await ctx.spawn({ command: "alchemy" }))),
    });
    const cli = createTestCli({
      commands: { dev },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 5, signal: null }),
    });

    expect((await cli.run(["dev"])).exitCode).toBe(5);
  });

  test("a launch failure is a structured error, not a crash", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawn: () => {
        throw new Error("spawn alchemy ENOENT");
      },
    });

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.SPAWN_FAILED");
    expect(result.stderr).toContain("ENOENT");
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
        return ok(ctx.present({ data: second }, { human: () => [] }));
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
        return ok(ctx.present({ data: null }, { human: () => [] }));
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
        ok(ctx.present({ data: null }, { human: () => [] })),
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
        return ok(exitWithChildStatus(await ctx.spawn({ command: "alchemy" })));
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
        return ok(ctx.present({ data: null }, { human: () => [] }));
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

    await cli.run(["chatty"], {
      onEvent: (event) => {
        if (event.kind === "message") {
          events.push(event.text);
        }
      },
    });

    expect(eventsAtChildExit).toBe(0);
    expect(events).toEqual(["during-1", "during-2", "after"]);
  });

  test("ctx.present while a child is live is a construction error", async () => {
    const presenting = defineCommand({
      help: { summary: "Presents mid-child" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = ctx.spawn({ command: "alchemy" });
        const failure = (() => {
          try {
            ctx.present({ data: null }, { human: () => [] });
            return "no error";
          } catch (cause) {
            return String(cause);
          }
        })();
        await child;
        return ok(ctx.present({ data: failure }, { human: () => [] }));
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
        return ok(ctx.present({ data: null }, { human: () => [] }));
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

    await cli.run(["watcher"], { abort: controller.signal });

    expect(abortedInsideChild).toBe(false);
    expect(abortedAfterChild).toBe(true);
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
        const child = await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus(child));
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
    const child = await ctx.spawn({ command: "alchemy", args: ["deploy"] });
    return ok(exitWithChildStatus(child));
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
        const child = await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus(child));
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

    const result = await cli.run(["converge"]);

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

    const result = await cli.run(["converge"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
    expect(result.stderr).toContain("expires too soon");
    expect(result.stderr).toContain("Sign in");
    expect(result.spawns).toEqual([]);
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

    const result = await cli.run(["converge"]);

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
      handler: async () =>
        ok(exitWithChildStatus({ exitCode: 7, signal: null })),
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
      handler: async () =>
        ok(exitWithChildStatus({ exitCode: 7, signal: null })),
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
      handler: async () =>
        ok(exitWithChildStatus({ exitCode: 7, signal: null })),
    });
    const cli = createTestCli({ commands: { undeclared }, now: CLOCK });

    const result = await cli.run(["undeclared"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without declaring maySpawn");
  });
});

describe("next actions on a child-status settlement", () => {
  test("they render to stderr before the run exits with the child's code", async () => {
    const failing = defineCommand({
      help: { summary: "A converge that fails with a reproduce hint" },
      maySpawn: true,
      handler: async (_args, ctx) => {
        const child = await ctx.spawn({ command: "alchemy" });
        return ok(
          exitWithChildStatus(child, {
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
    const cli = createTestCli({
      commands: { failing },
      now: CLOCK,
      spawnScript: () => ({ exitCode: 3, signal: null }),
    });

    const result = await cli.run(["failing"]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "→ Reproduce the failed converge: alchemy deploy ./entry.ts",
    );
  });
});

describe("unknown terminations are never success", () => {
  test("an adapter that cannot say how the child ended settles 1", async () => {
    const cli = createTestCli({
      commands: { converge },
      now: CLOCK,
      spawnScript: () => ({ exitCode: null, signal: null }),
    });

    expect((await cli.run(["converge"])).exitCode).toBe(1);
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

    const result = await cli.run(["abandoning"]);
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

    const result = await cli.run(["throwing"]);
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

    const result = await cli.run(["abandoning"]);

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
        const child = await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus(child));
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
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const messages: string[] = [];
    const cli = createTestCli({ commands: { chatty }, now: CLOCK });

    const result = await cli.run(["chatty"], {
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
        return ok(ctx.present({ data: failure }, { human: () => [] }));
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
        return ok(ctx.present({ data: failure }, { human: () => [] }));
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
        const child = await ctx.spawn({ command: "alchemy" });
        return ok(exitWithChildStatus(child));
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
      path: "/prisma.config.ts",
      sections: {},
      diagnostics: [],
    }),
    managementApi: { baseUrl: "https://test.invalid" },
    packageManager: "unknown",
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
