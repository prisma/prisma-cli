/**
 * The three engine-owned interaction affordances: consent tokens with
 * the shared `--confirm` flag, ctx.openUrl, and prompt.browserWait.
 * Every one of them is exercised in both an interactive and a
 * non-interactive session, because the whole point is that a handler
 * never reads TTY or CI state itself.
 */
import {
  type Block,
  type CommandContext,
  defineCommand,
  type PromptSurface,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);

/** A clock that moves a second every time it is read — what makes the
 *  browser-wait timeout reachable without real waiting. */
function tickingClock(stepMs = 1000): () => Date {
  let reads = 0;
  return () => {
    reads += 1;
    return new Date(reads * stepMs);
  };
}

const INTERACTIVE = { isTty: { stdin: true, stdout: true } };

function probeCommand(run: (ctx: CommandContext) => Promise<unknown>) {
  return defineCommand({
    help: { summary: "Interaction probe" },
    handler: async (_args, ctx) => {
      const answer = await run(ctx);
      return ok(
        ctx.present(
          { data: { answer } },
          {
            human: (): readonly Block[] => [
              { kind: "summary", status: "ok", text: `answer=${answer}` },
            ],
            stdout: () => [],
            json: () => ({ answer }),
            next: () => [],
          },
        ),
      );
    },
  });
}

function promptProbe(run: (prompt: PromptSurface) => Promise<unknown>) {
  return probeCommand((ctx) => run(ctx.prompt));
}

function errorOf(result: { readonly json: readonly unknown[] }) {
  const last = result.json[result.json.length - 1] as {
    kind: string;
    envelope: { ok: boolean; error: { code: string; summary: string } };
  };
  return last.kind === "result" && !last.envelope.ok
    ? last.envelope.error
    : undefined;
}

describe("consent tokens", () => {
  const dropDatabase = (prompt: PromptSurface) =>
    prompt.consent("Delete the production database?", { token: "prod-db" });

  test("an interactive session must type the token exactly", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });
    const result = await cli.run(["probe"], {
      ...INTERACTIVE,
      stdin: "prod-db\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toContain("type prod-db to confirm");
  });

  test("a wrong answer fails structurally where it cannot be retyped", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });
    const result = await cli.run(["probe", "--json"], {
      ...INTERACTIVE,
      answers: ["yes"],
    });

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.PROMPT_INVALID");
    expect(errorOf(result)?.summary).toContain("exactly prod-db");
  });

  test("--confirm with the token grants the consent non-interactively", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });
    const result = await cli.run(["probe", "--confirm", "prod-db"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
  });

  test("--confirm with the wrong value halts and names the expected one", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });
    const result = await cli.run(["probe", "--confirm", "staging-db"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.CONSENT_REQUIRED");
    expect(errorOf(result)?.summary).toContain("--confirm prod-db");
  });

  test("no --confirm at all halts the same way", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });
    const result = await cli.run(["probe"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.CONSENT_REQUIRED");
  });

  test("--yes still cannot grant it, but --confirm alongside --yes can", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });

    const withoutConfirm = await cli.run(
      ["probe", "--yes", "--json"],
      INTERACTIVE,
    );
    expect(withoutConfirm.exitCode).toBe(2);
    expect(errorOf(withoutConfirm)?.summary).toContain("--yes cannot grant");

    const withConfirm = await cli.run(
      ["probe", "--yes", "--confirm", "prod-db"],
      INTERACTIVE,
    );
    expect(withConfirm.exitCode).toBe(0);
    expect(withConfirm.presented?.data).toEqual({ answer: true });
  });

  test("each --confirm value grants one consent: repeat it to grant two", async () => {
    const twice = promptProbe(async (prompt) => {
      const first = await prompt.consent("Delete it?", { token: "prod-db" });
      const second = await prompt.consent("Really delete it?", {
        token: "prod-db",
      });
      return first && second;
    });

    const once = await createTestCli({
      commands: { probe: twice },
      now: EPOCH,
    }).run(["probe", "--confirm", "prod-db"]);
    expect(once.exitCode).toBe(2);
    expect(errorOf(once)?.code).toBe("CLI.CONSENT_REQUIRED");

    const repeated = await createTestCli({
      commands: { probe: twice },
      now: EPOCH,
    }).run(["probe", "--confirm", "prod-db", "--confirm", "prod-db"]);
    expect(repeated.exitCode).toBe(0);
    expect(repeated.presented?.data).toEqual({ answer: true });
  });

  test("a consent without a token keeps its yes/no rendering and stays ungrantable", async () => {
    const tokenless = promptProbe((prompt) =>
      prompt.consent("Delete everything?"),
    );
    const cli = createTestCli({ commands: { probe: tokenless }, now: EPOCH });

    const interactive = await cli.run(["probe"], {
      ...INTERACTIVE,
      stdin: "yes\n",
    });
    expect(interactive.exitCode).toBe(0);
    expect(interactive.presented?.data).toEqual({ answer: true });
    expect(interactive.stderr).toContain("(y/n)");

    const confirmed = await cli.run([
      "probe",
      "--json",
      "--confirm",
      "Delete everything?",
    ]);
    expect(confirmed.exitCode).toBe(2);
    expect(errorOf(confirmed)?.code).toBe("CLI.CONSENT_REQUIRED");
    expect(errorOf(confirmed)?.summary).not.toContain("--confirm");
  });

  test("--confirm shows up in help as part of the shared flag family", async () => {
    const cli = createTestCli({
      commands: { probe: promptProbe(dropDatabase) },
      now: EPOCH,
    });
    const result = await cli.run(["probe", "--help"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--confirm");
    expect(result.stdout).toContain("--yes");
  });
});

describe("ctx.openUrl", () => {
  const dashboard = probeCommand((ctx) =>
    ctx.openUrl({
      url: "https://console.test.invalid/projects",
      message: "Open your dashboard",
    }),
  );

  test("an interactive session opens the browser and announces the URL", async () => {
    const opened: string[] = [];
    const cli = createTestCli({
      commands: { probe: dashboard },
      now: EPOCH,
      openUrl: (url) => {
        opened.push(url);
      },
    });
    const result = await cli.run(["probe"], INTERACTIVE);

    expect(result.exitCode).toBe(0);
    expect(opened).toEqual(["https://console.test.invalid/projects"]);
    expect(result.presented?.data).toEqual({ answer: { opened: true } });
    expect(result.stderr).toContain(
      "Open your dashboard: https://console.test.invalid/projects",
    );
  });

  test("a non-interactive session prints the URL and opens nothing", async () => {
    const opened: string[] = [];
    const cli = createTestCli({
      commands: { probe: dashboard },
      now: EPOCH,
      openUrl: (url) => {
        opened.push(url);
      },
    });
    const result = await cli.run(["probe"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(opened).toEqual([]);
    expect(result.presented?.data).toEqual({ answer: { opened: false } });
    expect(result.stderr).toContain("https://console.test.invalid/projects");
  });

  test("json mode surfaces the URL as an endpoint frame", async () => {
    const cli = createTestCli({ commands: { probe: dashboard }, now: EPOCH });
    const result = await cli.run(["probe", "--json"], INTERACTIVE);

    expect(result.exitCode).toBe(0);
    expect(result.json[0]).toEqual({
      kind: "endpoint",
      name: "Open your dashboard",
      url: "https://console.test.invalid/projects",
      commandId: "probe",
      timestamp: new Date(0).toISOString(),
    });
    expect(result.stdout).toContain("endpoint");
  });

  test("an opener that fails is never an error: it reports opened false", async () => {
    const cli = createTestCli({
      commands: { probe: dashboard },
      now: EPOCH,
      openUrl: () => {
        throw new Error("no browser on this host");
      },
    });
    const result = await cli.run(["probe"], INTERACTIVE);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: { opened: false } });
  });
});

describe("prompt.browserWait", () => {
  function waitCommand(
    poll: (signal: AbortSignal) => Promise<boolean>,
    timeout = 60_000,
    interval?: number,
  ) {
    return promptProbe(async (prompt) => {
      await prompt.browserWait({
        url: "https://auth.test.invalid/device",
        message: "Finish signing in",
        poll,
        timeout,
        ...(interval === undefined ? {} : { interval }),
      });
      return "done";
    });
  }

  test("it polls on the interval the request asks for, and on its own when the request does not", async () => {
    const intervals: number[] = [];
    const runWith = async (interval?: number) => {
      let polls = 0;
      const cli = createTestCli({
        commands: {
          probe: waitCommand(
            async () => {
              polls += 1;
              return polls > 2;
            },
            60_000,
            interval,
          ),
        },
        now: EPOCH,
        delay: async (ms) => {
          intervals.push(ms);
        },
      });
      return cli.run(["probe"], INTERACTIVE);
    };

    expect((await runWith(2_000)).exitCode).toBe(0);
    expect(intervals).toEqual([2_000, 2_000]);

    intervals.length = 0;
    expect((await runWith()).exitCode).toBe(0);
    expect(intervals).toEqual([1_000, 1_000]);
  });

  test("it opens the browser and resolves when polling says so", async () => {
    const opened: string[] = [];
    let polls = 0;
    const cli = createTestCli({
      commands: {
        probe: waitCommand(async () => {
          polls += 1;
          return polls > 2;
        }),
      },
      now: EPOCH,
      openUrl: (url) => {
        opened.push(url);
      },
    });
    const result = await cli.run(["probe"], INTERACTIVE);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: "done" });
    expect(opened).toEqual(["https://auth.test.invalid/device"]);
    expect(polls).toBe(3);
    expect(result.stderr).toContain(
      "Finish signing in: https://auth.test.invalid/device",
    );
  });

  test("it gives up with a structured timeout error", async () => {
    const cli = createTestCli({
      commands: { probe: waitCommand(async () => false, 5000) },
      now: tickingClock(),
    });
    const result = await cli.run(["probe", "--json"], INTERACTIVE);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.BROWSER_WAIT_TIMEOUT");
    expect(errorOf(result)?.summary).toContain("Finish signing in");
  });

  test("Ctrl-C while waiting settles as a cancelled prompt, exit 3", async () => {
    const controller = new AbortController();
    const cli = createTestCli({
      commands: {
        probe: waitCommand(async () => {
          controller.abort("SIGINT");
          return false;
        }),
      },
      now: EPOCH,
    });
    const result = await cli.run(["probe", "--json"], {
      ...INTERACTIVE,
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(3);
    expect(errorOf(result)?.code).toBe("CLI.PROMPT_CANCELLED");
  });

  test("a non-interactive session neither opens nor polls: exit 2 with the URL", async () => {
    const opened: string[] = [];
    let polls = 0;
    const cli = createTestCli({
      commands: {
        probe: waitCommand(async () => {
          polls += 1;
          return true;
        }),
      },
      now: EPOCH,
      openUrl: (url) => {
        opened.push(url);
      },
    });
    const result = await cli.run(["probe", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.INTERACTION_REQUIRED");
    expect(errorOf(result)?.summary).toContain(
      "https://auth.test.invalid/device",
    );
    expect(opened).toEqual([]);
    expect(polls).toBe(0);
  });
});
