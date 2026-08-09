/**
 * Harness e2e for the D3 execution engine: a toy in-test command run
 * end to end through createTestCli, byte-asserting human output, the
 * json stream + envelope (completed and errored), exit codes, format
 * selection, log-level filtering, and quiet mode.
 */
import {
  createCli,
  createTestCli,
  defineCommand,
  type EngineEvent,
  flag,
  positional,
  type Runtime,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

const greet = defineCommand({
  help: { summary: "Greet someone" },
  args: {
    flags: { loud: flag.boolean({ brief: "shout it" }) },
    positionals: {
      name: positional.string({ brief: "who to greet", placeholder: "name" }),
    },
  },
  handler: async () => ({
    default: async (args, ctx) => {
      ctx.report({
        kind: "message",
        severity: "info",
        text: `greeting ${args.positionals.name}`,
      });
      ctx.report({
        kind: "message",
        severity: "verbose",
        text: "verbose detail",
      });
      const greeting = `Hello ${args.positionals.name}${args.flags.loud ? "!" : ""}`;
      return ok(
        ctx.present(
          { data: { greeting } },
          {
            human: () => [{ kind: "summary", tone: "ok", text: greeting }],
            stdout: () => [greeting],
            json: () => ({ greeting }),
            next: () => [{ kind: "done", label: "Nothing else to do" }],
          },
        ),
      );
    },
  }),
});

const failing = defineCommand({
  help: { summary: "Always errors" },
  handler: async () => ({
    default: async (_args, ctx) => {
      ctx.report({
        kind: "remediation",
        action: {
          kind: "run-command",
          label: "Try again",
          command: "demo retry",
        },
      });
      return notOk(
        new CliStructuredError("DEMO.BROKEN", "It broke", {
          why: "The demo always breaks.",
          fix: "Do not run the demo.",
        }),
      );
    },
  }),
});

const check = defineCommand({
  help: { summary: "Check with documented exit codes" },
  exitCodes: { 4: "findings" },
  handler: async () => ({
    default: async (_args, ctx) =>
      ok(
        ctx.present(
          {
            data: { findings: 1 },
            exitCode: 4,
            diagnostics: [
              {
                code: "CHECK.FINDING",
                severity: "warn",
                summary: "One finding",
              },
            ],
          },
          {
            human: () => [{ kind: "summary", tone: "warn", text: "1 finding" }],
          },
        ),
      ),
  }),
});

const throwing = defineCommand({
  help: { summary: "Throws a plain error" },
  handler: async () => ({
    default: async () => {
      throw new Error("kaboom");
    },
  }),
});

const whoami = defineCommand({
  help: { summary: "Show the signed-in user" },
  needs: { credentials: true },
  handler: async () => ({
    default: async (_args, ctx) => {
      const credentials = await ctx.getCredentials();
      return ok(
        ctx.present(
          { data: { token: credentials?.token } },
          {
            human: () => [
              {
                kind: "summary",
                tone: "ok",
                text: `Signed in (${credentials?.token})`,
              },
            ],
          },
        ),
      );
    },
  }),
});

function makeCli() {
  return createTestCli({
    commands: {
      greet,
      failing,
      check,
      throwing,
      "tool greet": greet,
      "auth whoami": whoami,
    },
    groups: { tool: { brief: "Tools" }, auth: { brief: "Authentication" } },
    now: EPOCH,
  });
}

describe("completed commands", () => {
  test("human format renders blocks to stdout and commentary to stderr", async () => {
    const result = await makeCli().run(["greet", "world", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✔ Hello world\n→ Nothing else to do\n");
    expect(result.stderr).toBe("greeting world\n");
  });

  test("json format streams events then exactly one terminal result frame", async () => {
    const result = await makeCli().run(["greet", "world", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `{"kind":"message","severity":"info","text":"greeting world","commandId":"greet","timestamp":"${T0}"}\n` +
        `{"kind":"result","envelope":{"ok":true,"commandId":"greet","result":{"greeting":"Hello world"},"exitCode":0,"diagnostics":[],"nextActions":[{"kind":"done","label":"Nothing else to do"}]},"commandId":"greet","timestamp":"${T0}"}\n`,
    );
    expect(result.stderr).toBe("");
    expect(result.json).toEqual([
      {
        kind: "message",
        severity: "info",
        text: "greeting world",
        commandId: "greet",
        timestamp: T0,
      },
      {
        kind: "result",
        envelope: {
          ok: true,
          commandId: "greet",
          result: { greeting: "Hello world" },
          exitCode: 0,
          diagnostics: [],
          nextActions: [{ kind: "done", label: "Nothing else to do" }],
        },
        commandId: "greet",
        timestamp: T0,
      },
    ]);
  });

  test("commandId is the full dotted mount path", async () => {
    const result = await makeCli().run(["tool", "greet", "world", "--json"]);

    const last = result.json[result.json.length - 1];
    expect(last.commandId).toBe("tool.greet");
    expect(last.kind === "result" && last.envelope.commandId).toBe(
      "tool.greet",
    );
  });

  test("a catalogued exit code passes through from the return site", async () => {
    const result = await makeCli().run(["check", "--json"]);

    expect(result.exitCode).toBe(4);
    expect(result.json).toEqual([
      {
        kind: "result",
        envelope: {
          ok: true,
          commandId: "check",
          result: { findings: 1 },
          exitCode: 4,
          diagnostics: [
            { code: "CHECK.FINDING", severity: "warn", summary: "One finding" },
          ],
          nextActions: [],
        },
        commandId: "check",
        timestamp: T0,
      },
    ]);
  });

  test("completed diagnostics render to stderr in human format", async () => {
    const result = await makeCli().run(["check", "--format", "human"]);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("⚠ 1 finding\n");
    expect(result.stderr).toBe("⚠ [CHECK.FINDING] One finding\n");
  });

  test("the harness exposes events and the presented result", async () => {
    const seen: string[] = [];
    const result = await makeCli().run(
      ["greet", "world", "--format", "human"],
      {
        onEvent: (event) => {
          seen.push(event.kind);
        },
      },
    );

    expect(result.events.map((event) => event.kind)).toEqual([
      "message",
      "message",
    ]);
    expect(seen).toEqual(["message", "message"]);
    expect(result.presented?.data).toEqual({ greeting: "Hello world" });
    expect(result.presented?.exitCode).toBe(0);
    expect(result.presented?.presentation.stdout).toEqual(["Hello world"]);
  });
});

describe("format selection", () => {
  test("json is auto-selected when stdout is not a tty", async () => {
    const result = await makeCli().run(["greet", "world"]);

    expect(result.json[result.json.length - 1]?.kind).toBe("result");
  });

  test("human is auto-selected when stdout is a tty", async () => {
    const result = await makeCli().run(["greet", "world"], {
      isTty: { stdout: true },
    });

    expect(result.json).toEqual([]);
    expect(result.stdout).toBe("✔ Hello world\n→ Nothing else to do\n");
  });

  test("--json is shorthand for --format json", async () => {
    const viaAlias = await makeCli().run(["greet", "world", "--json"]);
    const viaFormat = await makeCli().run([
      "greet",
      "world",
      "--format",
      "json",
    ]);

    expect(viaAlias.stdout).toBe(viaFormat.stdout);
    expect(viaAlias.json).toEqual(viaFormat.json);
  });
});

describe("log levels and quiet", () => {
  test("the default level filters verbose messages out of the stream", async () => {
    const result = await makeCli().run(["greet", "world", "--json"]);

    expect(
      result.json.filter(
        (frame) => frame.kind === "message" && frame.severity === "verbose",
      ),
    ).toEqual([]);
    expect(
      result.events.filter((event) => event.kind === "message"),
    ).toHaveLength(2);
  });

  test("--verbose admits verbose messages", async () => {
    const result = await makeCli().run([
      "greet",
      "world",
      "--json",
      "--verbose",
    ]);

    expect(
      result.json.filter(
        (frame) => frame.kind === "message" && frame.severity === "verbose",
      ),
    ).toHaveLength(1);
  });

  test("--log-level error silences info commentary in human format", async () => {
    const result = await makeCli().run([
      "greet",
      "world",
      "--format",
      "human",
      "--log-level",
      "error",
    ]);

    expect(result.stderr).toBe("");
  });

  test("--quiet leaves only the stdout presentation lines", async () => {
    const result = await makeCli().run([
      "greet",
      "world",
      "--format",
      "human",
      "--quiet",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello world\n");
    expect(result.stderr).toBe("");
  });
});

describe("errored commands", () => {
  test("a structured error renders the engine error layout on stderr and exits 2", async () => {
    const result = await makeCli().run(["failing", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✖ [DEMO.BROKEN] It broke\n" +
        "  why: The demo always breaks.\n" +
        "  fix: Do not run the demo.\n" +
        "→ Try again: demo retry\n",
    );
  });

  test("json format terminates the stream with the errored envelope", async () => {
    const result = await makeCli().run(["failing", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([
      {
        kind: "remediation",
        action: {
          kind: "run-command",
          label: "Try again",
          command: "demo retry",
        },
        commandId: "failing",
        timestamp: T0,
      },
      {
        kind: "result",
        envelope: {
          ok: false,
          commandId: "failing",
          error: {
            code: "DEMO.BROKEN",
            severity: "error",
            summary: "It broke",
            why: "The demo always breaks.",
            fix: "Do not run the demo.",
          },
          diagnostics: [],
          nextActions: [
            { kind: "run-command", label: "Try again", command: "demo retry" },
          ],
        },
        commandId: "failing",
        timestamp: T0,
      },
    ]);
  });

  test("an unknown thrown error is an engine bug: errored envelope, exit 1", async () => {
    const result = await makeCli().run(["throwing", "--json"]);

    expect(result.exitCode).toBe(1);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error,
    ).toEqual({
      code: "CLI.INTERNAL_ERROR",
      severity: "error",
      summary: "kaboom",
    });
  });
});

describe("needs preconditions", () => {
  test("needs.credentials fails early with the engine sign-in error", async () => {
    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([
      {
        kind: "result",
        envelope: {
          ok: false,
          commandId: "auth.whoami",
          error: {
            code: "CLI.CREDENTIALS_REQUIRED",
            severity: "error",
            summary: "You must be signed in to run this command.",
            fix: "Sign in, then run the command again.",
          },
          diagnostics: [],
          nextActions: [],
        },
        commandId: "auth.whoami",
        timestamp: T0,
      },
    ]);
  });

  test("with credentials supplied the handler runs and sees them", async () => {
    const cli = createTestCli({
      commands: { "auth whoami": whoami },
      groups: { auth: { brief: "Authentication" } },
      credentials: { token: "tok-123" },
      now: EPOCH,
    });
    const result = await cli.run(["auth", "whoami", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✔ Signed in (tok-123)\n");
  });
});

describe("undocumented completion exit codes", () => {
  test("a completed exit code the command never documented settles as a bug", async () => {
    const rogue = defineCommand({
      help: { summary: "Returns an undocumented exit code" },
      handler: async () => ({
        default: async (_args, ctx) =>
          ok(
            ctx.present(
              { data: null, exitCode: 7 } as unknown as { data: null },
              { human: () => [] },
            ),
          ),
      }),
    });
    const cli = createTestCli({ commands: { rogue }, now: EPOCH });
    const result = await cli.run(["rogue", "--json"]);

    expect(result.exitCode).toBe(1);
    const last = result.json[result.json.length - 1];
    if (last.kind !== "result" || last.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(last.envelope.error.code).toBe("CLI.INTERNAL_ERROR");
    expect(last.envelope.error.summary).toContain("exit code 7");
  });

  test("a completed exit code outside the documented set settles as a bug", async () => {
    const rogue = defineCommand({
      help: { summary: "Documents 4 but returns 5" },
      exitCodes: { 4: "findings" },
      handler: async () => ({
        default: async (_args, ctx) =>
          ok(
            ctx.present({ data: null, exitCode: 5 as 4 }, { human: () => [] }),
          ),
      }),
    });
    const cli = createTestCli({ commands: { rogue }, now: EPOCH });
    const result = await cli.run(["rogue", "--json"]);

    expect(result.exitCode).toBe(1);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("CLI.INTERNAL_ERROR");
  });

  test("a documented exit code still passes through", async () => {
    const result = await makeCli().run(["check", "--json"]);

    expect(result.exitCode).toBe(4);
  });
});

describe("sensitive field rows", () => {
  const reveal = defineCommand({
    help: { summary: "Show a credential" },
    handler: async () => ({
      default: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: { token: "tok_secret" } },
            {
              human: () => [
                {
                  kind: "fields",
                  rows: [
                    { label: "name", value: "deploy key" },
                    { label: "token", value: "tok_secret", sensitive: true },
                  ],
                },
              ],
            },
          ),
        ),
    }),
  });

  test("human rendering masks a sensitive field value", async () => {
    const cli = createTestCli({ commands: { reveal }, now: EPOCH });
    const result = await cli.run(["reveal", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("name: deploy key\ntoken: ********\n");
  });

  test("the json result payload is the command's own and stays unmasked", async () => {
    const cli = createTestCli({ commands: { reveal }, now: EPOCH });
    const result = await cli.run(["reveal", "--json"]);

    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && last.envelope.ok && last.envelope.result,
    ).toEqual({ token: "tok_secret" });
  });
});

describe("report() after the handler resolved", () => {
  test("a detached report after settlement is noted, not thrown", async () => {
    let smuggled: ((event: EngineEvent) => void) | undefined;
    const leaky = defineCommand({
      help: { summary: "Leaks its report function" },
      handler: async () => ({
        default: async (_args, ctx) => {
          smuggled = ctx.report;
          return ok(ctx.present({ data: null }, { human: () => [] }));
        },
      }),
    });
    const cli = createTestCli({ commands: { leaky }, now: EPOCH });
    const result = await cli.run(["leaky", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(smuggled).toBeDefined();
    expect(() =>
      smuggled?.({ kind: "message", severity: "info", text: "late" }),
    ).not.toThrow();
  });
});

describe("credentials that cannot be read", () => {
  test("a rejecting getCredentials settles as a structured error, exit 2", async () => {
    const locked = defineCommand({
      help: { summary: "Needs credentials" },
      needs: { credentials: true },
      handler: async () => ({
        default: async (_args, ctx) =>
          ok(ctx.present({ data: null }, { human: () => [] })),
      }),
    });
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      products: [],
      groups: {},
      commands: { locked },
    });
    let stdoutText = "";
    const runtime: Runtime = {
      stdout: {
        write: (text) => {
          stdoutText += text;
        },
      },
      stderr: { write: () => {} },
      stdin: {
        async *[Symbol.asyncIterator]() {},
      },
      cwd: "/",
      env: {},
      isTty: { stdin: false, stdout: false, stderr: false },
      signal: new AbortController().signal,
      config: { sections: {}, diagnostics: [] },
      getCredentials: async () => {
        throw new Error("token file corrupt: unexpected end of JSON input");
      },
      packageManager: "unknown",
    };
    const exitCode = await cli.run(["locked"], runtime);

    expect(exitCode).toBe(2);
    const frame = JSON.parse(stdoutText.trim());
    expect(frame.envelope.ok).toBe(false);
    expect(frame.envelope.error.code).toBe("CLI.CREDENTIALS_UNREADABLE");
    expect(frame.envelope.error.why).toBe(
      "token file corrupt: unexpected end of JSON input",
    );
  });
});

describe("parse and route failures", () => {
  test("an unknown flag is a structured usage error with exit 2", async () => {
    const result = await makeCli().run(["greet", "world", "--nope", "--json"]);

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("CLI.INVALID_ARGUMENTS");
  });

  test("a missing required positional is a usage error with exit 2", async () => {
    const result = await makeCli().run(["greet", "--json"]);

    expect(result.exitCode).toBe(2);
  });

  test("an unknown command is a structured usage error with exit 2", async () => {
    const result = await makeCli().run(["nonsense", "--json"]);

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("CLI.UNKNOWN_COMMAND");
  });

  test("usage errors render on stderr in human format", async () => {
    const result = await makeCli().run(["greet", "world", "--nope"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CLI.INVALID_ARGUMENTS");
  });

  test("a multi-error parse keeps the full text: first line as summary, rest as why", async () => {
    const strict = defineCommand({
      help: { summary: "Strictly typed flags" },
      args: {
        flags: {
          mode: flag.enum({ brief: "mode", values: ["a", "b"] }),
          count: flag.number({ brief: "how many", placeholder: "n" }),
        },
        positionals: {
          name: positional.string({ brief: "who", placeholder: "name" }),
        },
      },
      handler: async () => ({
        default: async (_args, ctx) =>
          ok(ctx.present({ data: null }, { human: () => [] })),
      }),
    });
    const cli = createTestCli({ commands: { strict }, now: EPOCH });
    const result = await cli.run(["strict", "--mode", "z", "--count", "q"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✖ [CLI.INVALID_ARGUMENTS] Expected argument for name\n" +
        '  why: Expected "z" to be one of (a|b), did you mean "a" or "b"?\n' +
        "Failed to parse \"q\" for count: expected a number, received 'q'\n",
    );
  });

  test("a positional value after -- does not flip the pre-parse format sniff", async () => {
    const tooMany = await makeCli().run(["greet", "--", "--json", "extra"], {
      isTty: { stdout: true },
    });

    expect(tooMany.exitCode).toBe(2);
    expect(tooMany.json).toEqual([]);
    expect(tooMany.stdout).toBe("");
    expect(tooMany.stderr).toContain("CLI.INVALID_ARGUMENTS");
  });

  test("a -- positional value that looks like --json is passed through literally", async () => {
    const result = await makeCli().run(["greet", "--", "--json"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✔ Hello --json\n→ Nothing else to do\n");
  });

  test("kebab-case input matches camelCase flag keys", async () => {
    const shouty = defineCommand({
      help: { summary: "Shout" },
      args: { flags: { withBang: flag.boolean({ brief: "bang" }) } },
      handler: async () => ({
        default: async (args, ctx) =>
          ok(
            ctx.present(
              { data: { bang: args.flags.withBang } },
              { human: () => [] },
            ),
          ),
      }),
    });
    const cli = createTestCli({ commands: { shouty }, now: EPOCH });
    const result = await cli.run(["shouty", "--with-bang", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ bang: true });
  });
});
