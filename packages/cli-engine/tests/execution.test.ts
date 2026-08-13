/**
 * Harness e2e for the D3 execution engine: a toy in-test command run
 * end to end through createTestCli, byte-asserting human output, the
 * json stream + envelope (completed and errored), exit codes, format
 * selection, log-level filtering, and quiet mode.
 */
import {
  createCli,
  defineCommand,
  defineConfigSection,
  defineSessionCommand,
  type EngineEvent,
  flag,
  positional,
  type Runtime,
} from "@prisma/cli-engine";
import {
  CliStructuredError,
  type Diagnostic,
  notOk,
  ok,
  STRUCTURED_ERROR,
} from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  InMemoryCredentialManager,
  mintTestJwt,
} from "@prisma/cli-engine/testing";
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
  handler: async (args, ctx) => {
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
          human: () => [{ kind: "summary", status: "ok", text: greeting }],
          stdout: () => [greeting],
          json: () => ({ greeting }),
          next: () => [{ kind: "done", label: "Nothing else to do" }],
        },
      ),
    );
  },
});

const failing = defineCommand({
  help: { summary: "Always errors" },
  handler: async (_args, ctx) => {
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
        nextActions: [{ kind: "user-choice", label: "Do not run the demo." }],
      }),
    );
  },
});

const check = defineCommand({
  help: { summary: "Check with documented exit codes" },
  exitCodes: { 4: "findings" },
  handler: async (_args, ctx) =>
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
              nextActions: [],
            },
          ],
        },
        {
          human: () => [{ kind: "summary", status: "warn", text: "1 finding" }],
          stdout: () => [],
          json: () => ({ findings: 1 }),
          next: () => [],
        },
      ),
    ),
});

const throwing = defineCommand({
  help: { summary: "Throws a plain error" },
  handler: async () => {
    throw new Error("kaboom");
  },
});

/** Its `data` and its json presentation deliberately differ. Every other
 *  fixture here passes the same value to both, so none of them can tell
 *  which one the envelope published — `data` is what the handler worked
 *  with, `result` is what the command chose to publish, and the engine
 *  used to publish `data` for any command that declared no json.
 *
 *  What this catches: settlement publishing `data` rather than the json
 *  presentation. What it does not catch: the old conditional fallback
 *  returning, because this command declares a json presentation, so the
 *  fallback's branch is never taken. Nothing compiled against this
 *  engine can omit `json`, so that branch is unreachable rather than
 *  untested. */
const divergent = defineCommand({
  help: { summary: "Publishes something other than its working data" },
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: { internal: "the handler's own object" } },
        {
          human: () => [],
          stdout: () => [],
          json: () => ({ published: "what the command states" }),
          next: () => [],
        },
      ),
    ),
});

const whoami = defineCommand({
  help: { summary: "Show the signed-in user" },
  needs: { credentials: true },
  handler: async (_args, ctx) => {
    const active = await ctx.activeCredential();
    return ok(
      ctx.present(
        { data: { workspaceId: active?.workspaceId } },
        {
          human: () => [
            {
              kind: "summary",
              status: "ok",
              text: `Signed in (${active?.workspaceId})`,
            },
          ],
          stdout: () => [],
          json: () => ({ workspaceId: active?.workspaceId }),
          next: () => [],
        },
      ),
    );
  },
});

function makeCli() {
  return createTestCli({
    commands: {
      greet,
      failing,
      check,
      throwing,
      divergent,
      "tool greet": greet,
      "auth whoami": whoami,
    },
    groups: { tool: { brief: "Tools" }, auth: { brief: "Authentication" } },
    now: EPOCH,
  });
}

describe("completed commands", () => {
  test("human format renders payload lines to stdout and blocks with commentary to stderr", async () => {
    const result = await makeCli().run(["greet", "world", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello world\n");
    expect(result.stderr).toBe(
      "greeting world\n✔ Hello world\n→ Nothing else to do\n",
    );
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

  test("the envelope's result is the json presentation, never the handler's data", async () => {
    const result = await makeCli().run(["divergent", "--json"]);

    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && last.envelope.ok && last.envelope.result,
    ).toEqual({ published: "what the command states" });
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
            {
              code: "CHECK.FINDING",
              severity: "warn",
              summary: "One finding",
              nextActions: [],
            },
          ],
          nextActions: [],
        },
        commandId: "check",
        timestamp: T0,
      },
    ]);
  });

  test("completed blocks and diagnostics render to stderr in human format", async () => {
    const result = await makeCli().run(["check", "--format", "human"]);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("⚠ 1 finding\n⚠ [CHECK.FINDING] One finding\n");
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
    expect(result.stdout).toBe("Hello world\n");
    expect(result.stderr).toBe(
      "greeting world\n✔ Hello world\n→ Nothing else to do\n",
    );
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

  test("--log-level error silences info commentary but never the presentation", async () => {
    const result = await makeCli().run([
      "greet",
      "world",
      "--format",
      "human",
      "--log-level",
      "error",
    ]);

    expect(result.stdout).toBe("Hello world\n");
    expect(result.stderr).toBe("✔ Hello world\n→ Nothing else to do\n");
  });

  test("--quiet is shorthand for --log-level error: commentary silenced, presentation kept", async () => {
    const result = await makeCli().run([
      "greet",
      "world",
      "--format",
      "human",
      "--quiet",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello world\n");
    expect(result.stderr).toBe("✔ Hello world\n→ Nothing else to do\n");
  });

  test("--quiet beats an explicit --log-level, exactly like --verbose does", async () => {
    const quiet = await makeCli().run([
      "greet",
      "world",
      "--format",
      "human",
      "--quiet",
      "--log-level",
      "info",
    ]);
    const verbose = await makeCli().run([
      "greet",
      "world",
      "--format",
      "human",
      "--verbose",
      "--log-level",
      "error",
    ]);

    expect(quiet.stderr).toBe("✔ Hello world\n→ Nothing else to do\n");
    expect(verbose.stderr).toBe(
      "greeting world\nverbose detail\n✔ Hello world\n→ Nothing else to do\n",
    );
  });
});

describe("errored commands", () => {
  test("a structured error renders the engine error layout on stderr and exits 2", async () => {
    const result = await makeCli().run(["failing", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✘ [DEMO.BROKEN] It broke\n" +
        "  why: The demo always breaks.\n" +
        "→ Do not run the demo.\n",
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
            nextActions: [
              { kind: "user-choice", label: "Do not run the demo." },
            ],
          },
          diagnostics: [],
          nextActions: [{ kind: "user-choice", label: "Do not run the demo." }],
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
      nextActions: [],
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
            nextActions: [
              {
                kind: "user-choice",
                label: "Sign in, then run the command again.",
              },
            ],
          },
          diagnostics: [],
          nextActions: [
            {
              kind: "user-choice",
              label: "Sign in, then run the command again.",
            },
          ],
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
      credential: {
        token: mintTestJwt({ sub: "user-1", workspace_id: "workspace-1" }),
        refreshToken: undefined,
        expiresAt: undefined,
      },
      now: EPOCH,
    });
    const result = await cli.run(["auth", "whoami", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("✔ Signed in (workspace-1)\n");
  });

  function demanding(dependency: string) {
    return defineCommand({
      help: { summary: "Has every need" },
      needs: {
        interaction: true,
        dependencies: [dependency],
        credentials: true,
        config: defineConfigSection({
          name: "toy",
          validate: () => ({ ok: true, value: null, diagnostics: [] }),
        }),
      },
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
  }

  async function runDemanding(opts: {
    readonly dependency: string;
    readonly interactive: boolean;
    readonly signedIn?: boolean;
  }): Promise<{ exitCode: number; stderr: string }> {
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { demanding: demanding(opts.dependency) },
    });
    let stderrText = "";
    const runtime: Runtime = {
      stdout: { write: () => {} },
      stderr: {
        write: (text) => {
          stderrText += text;
        },
      },
      stdin: {
        async *[Symbol.asyncIterator]() {},
      },
      cwd: process.cwd(),
      env: {},
      isTty: { stdin: opts.interactive, stdout: false, stderr: false },
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
      loadConfig: async () => ({
        path: "/prisma.config.ts",
        sections: {},
        diagnostics: [
          {
            section: null,
            diagnostic: {
              code: "CONFIG.UNREADABLE",
              severity: "error",
              summary: "The config file could not be read",
              nextActions: [],
            },
          },
        ],
      }),
      credentialManager:
        opts.signedIn === true
          ? new InMemoryCredentialManager({
              credential: {
                token: mintTestJwt({ workspace_id: "workspace-1" }),
                refreshToken: undefined,
                expiresAt: undefined,
              },
            })
          : undefined,
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
    };
    const exitCode = await cli.run(["demanding", "--format", "human"], runtime);
    return { exitCode, stderr: stderrText };
  }

  test("needs are evaluated in a pinned order: interaction, then dependencies, then credentials, then file-level config", async () => {
    const missing = "@prisma/definitely-not-installed";

    const nothingMet = await runDemanding({
      dependency: missing,
      interactive: false,
    });
    expect(nothingMet.exitCode).toBe(2);
    expect(nothingMet.stderr).toContain("CLI.INTERACTION_REQUIRED");

    const interactionMet = await runDemanding({
      dependency: missing,
      interactive: true,
    });
    expect(interactionMet.stderr).toContain("CLI.MISSING_DEPENDENCY");

    const dependenciesMet = await runDemanding({
      dependency: "typescript",
      interactive: true,
    });
    expect(dependenciesMet.stderr).toContain("CLI.CREDENTIALS_REQUIRED");

    const credentialsMet = await runDemanding({
      dependency: "typescript",
      interactive: true,
      signedIn: true,
    });
    expect(credentialsMet.stderr).toContain("CONFIG.UNREADABLE");
  });
});

describe("undocumented completion exit codes", () => {
  test("a completed exit code the command never documented settles as a bug", async () => {
    const rogue = defineCommand({
      help: { summary: "Returns an undocumented exit code" },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null, exitCode: 7 } as unknown as { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        ),
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
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null, exitCode: 5 as 4 },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        ),
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
    handler: async (_args, ctx) =>
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
            stdout: () => [],
            json: () => ({ token: "tok_secret" }),
            next: () => [],
          },
        ),
      ),
  });

  test("human rendering masks a sensitive field value", async () => {
    const cli = createTestCli({ commands: { reveal }, now: EPOCH });
    const result = await cli.run(["reveal", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("name:   deploy key\ntoken:  ********\n");
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
  test("a detached report after settlement is noted on stderr, not thrown", async () => {
    let smuggled: ((event: EngineEvent) => void) | undefined;
    const leaky = defineCommand({
      help: { summary: "Leaks its report function" },
      handler: async (_args, ctx) => {
        smuggled = ctx.report;
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
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { leaky },
    });
    let stderrText = "";
    const runtime: Runtime = {
      stdout: { write: () => {} },
      stderr: {
        write: (text) => {
          stderrText += text;
        },
      },
      stdin: {
        async *[Symbol.asyncIterator]() {},
      },
      cwd: "/",
      env: {},
      isTty: { stdin: false, stdout: false, stderr: false },
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
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
    const exitCode = await cli.run(["leaky", "--format", "human"], runtime);

    expect(exitCode).toBe(0);
    expect(smuggled).toBeDefined();
    expect(() =>
      smuggled?.({ kind: "message", severity: "info", text: "late" }),
    ).not.toThrow();
    // The whole line: this mark is written as a literal rather than
    // read from the diagnostic-severity map, so nothing else pins it.
    expect(stderrText).toContain(
      "✘ [CLI.INTERNAL_ERROR] @prisma/cli-engine: report() was called after the handler resolved\n",
    );
  });
});

describe("credentials that cannot be read", () => {
  test("the manager's own structured error reaches the user verbatim, exit 2", async () => {
    const locked = defineCommand({
      help: { summary: "Needs credentials" },
      needs: { credentials: true },
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
      commands: { locked },
    });
    let stdoutText = "";
    const unreadable = new CliStructuredError(
      "CLI.CREDENTIALS_UNREADABLE",
      "Your stored credentials could not be read.",
      { why: "token file corrupt: unexpected end of JSON input" },
    );
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
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
      loadConfig: async () => ({
        path: "/prisma.config.ts",
        sections: {},
        diagnostics: [],
      }),
      credentialManager: {
        activeCredential: async () => {
          throw unreadable;
        },
      } as unknown as Runtime["credentialManager"],
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
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
    const cli = createTestCli({ commands: { strict }, now: EPOCH });
    const result = await cli.run(["strict", "--mode", "z", "--count", "q"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✘ [CLI.INVALID_ARGUMENTS] Expected argument for name\n" +
        '  why: Expected "z" to be one of (a|b), did you mean "a" or "b"?\n' +
        "Failed to parse \"q\" for count: expected a number, received 'q'\n",
    );
  });

  test("an empty numeric flag value is a usage error, not zero", async () => {
    const counting = defineCommand({
      help: { summary: "Counts" },
      args: {
        flags: { count: flag.number({ brief: "how many", placeholder: "n" }) },
      },
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
    const cli = createTestCli({ commands: { counting }, now: EPOCH });
    const result = await cli.run(["counting", "--count", ""], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "expected a number, received an empty value",
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
    expect(result.stdout).toBe("Hello --json\n");
    expect(result.stderr).toBe(
      "greeting --json\n✔ Hello --json\n→ Nothing else to do\n",
    );
  });

  test("kebab-case input matches camelCase flag keys", async () => {
    const shouty = defineCommand({
      help: { summary: "Shout" },
      args: { flags: { withBang: flag.boolean({ brief: "bang" }) } },
      handler: async (args, ctx) =>
        ok(
          ctx.present(
            { data: { bang: args.flags.withBang } },
            {
              human: () => [],
              stdout: () => [],
              json: () => ({ bang: args.flags.withBang }),
              next: () => [],
            },
          ),
        ),
    });
    const cli = createTestCli({ commands: { shouty }, now: EPOCH });
    const result = await cli.run(["shouty", "--with-bang", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ bang: true });
  });
});

describe("ctx.host", () => {
  const reporting = defineCommand({
    help: { summary: "Report the host" },
    handler: async (_args, ctx) =>
      ok(
        ctx.present(
          { data: ctx.host },
          {
            human: () => [],
            stdout: () => [],
            json: () => ctx.host,
            next: () => [],
          },
        ),
      ),
  });

  test("a command reads the runtime, platform and arch from the context", async () => {
    const result = await createTestCli({
      commands: { reporting },
      now: EPOCH,
      host: {
        runtime: { name: "bun", version: "1.2.3" },
        platform: "win32",
        arch: "arm64",
      },
    }).run(["reporting", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      runtime: { name: "bun", version: "1.2.3" },
      platform: "win32",
      arch: "arm64",
    });
  });

  test("the harness supplies a fixed host, so a payload asserts the same everywhere", async () => {
    const result = await createTestCli({
      commands: { reporting },
      now: EPOCH,
    }).run(["reporting", "--json"]);

    expect(result.presented?.data).toEqual({
      runtime: { name: "node", version: "v22.12.0" },
      platform: "linux",
      arch: "x64",
    });
  });
});

describe("flag.optionalBoolean", () => {
  const linking = defineCommand({
    help: { summary: "Link things" },
    args: { flags: { link: flag.optionalBoolean({ brief: "link it" }) } },
    handler: async (args, ctx) =>
      ok(
        ctx.present(
          { data: { link: args.flags.link ?? null } },
          {
            human: () => [],
            stdout: () => [],
            json: () => ({ link: args.flags.link ?? null }),
            next: () => [],
          },
        ),
      ),
  });

  const runWith = (argv: readonly string[]) =>
    createTestCli({ commands: { linking }, now: EPOCH }).run([
      "linking",
      ...argv,
      "--json",
    ]);

  test("--flag is true, --no-flag is false, and neither is undefined", async () => {
    expect((await runWith(["--link"])).presented?.data).toEqual({ link: true });
    expect((await runWith(["--no-link"])).presented?.data).toEqual({
      link: false,
    });
    expect((await runWith([])).presented?.data).toEqual({ link: null });
  });

  test("all three settle successfully", async () => {
    for (const argv of [["--link"], ["--no-link"], []]) {
      // biome-ignore lint/performance/noAwaitInLoops: each run builds its own CLI, and the assertion reads clearest one spelling at a time.
      expect((await runWith(argv)).exitCode).toBe(0);
    }
  });

  test("help names both spellings", async () => {
    const result = await createTestCli({
      commands: { linking },
      now: EPOCH,
    }).run(["linking", "--help"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--link/--no-link");
  });
});

describe("implicit help is only for bare invocations", () => {
  const grouped = () =>
    createTestCli({
      commands: { "auth login": greet },
      groups: { auth: { brief: "Authentication" } },
      now: EPOCH,
    });

  test("no argv renders root help and exits 0", async () => {
    const result = await grouped().run([], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("auth");
  });

  test("a bare group renders the group's help and exits 0", async () => {
    const result = await grouped().run(["auth"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("login");
  });

  test("an unknown root flag is a usage error, not a help card", async () => {
    const result = await grouped().run(["--frobnicate"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).not.toBe(0);
  });

  test("a group invocation carrying a flag reaches routing", async () => {
    const result = await grouped().run(["auth", "--frobnicate"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).not.toBe(0);
  });
});

describe("help examples", () => {
  test("examples get the CLI name: {bin} is substituted, plain examples are prefixed", async () => {
    const exemplified = defineCommand({
      help: {
        summary: "Greets someone",
        examples: ["greet world --loud", "{bin} greet world | cat"],
      },
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
    const cli = createTestCli({ commands: { greet: exemplified }, now: EPOCH });
    const result = await cli.run(["greet", "--help"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prisma-test greet world --loud");
    expect(result.stdout).toContain("prisma-test greet world | cat");
    expect(result.stdout).not.toContain("{bin}");
  });

  test("json mode --help keeps stdout frame-clean: help prose goes to stderr", async () => {
    const cli = createTestCli({ commands: { greet: greet }, now: EPOCH });
    const result = await cli.run(["greet", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage");
  });
});

describe("--version", () => {
  test("prints the version and exits 0 in human mode", async () => {
    const cli = createTestCli({ commands: { greet: greet }, now: EPOCH });
    const result = await cli.run(["--version"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.0.0\n");
    expect(result.stderr).toBe("");
  });

  test("works after a command path too", async () => {
    const cli = createTestCli({ commands: { greet: greet }, now: EPOCH });
    const result = await cli.run(["greet", "--version"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.0.0\n");
  });

  test("emits a single result frame in json mode", async () => {
    const cli = createTestCli({ commands: { greet: greet }, now: EPOCH });
    const result = await cli.run(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveLength(1);
    expect(result.json[0]).toEqual({
      kind: "result",
      envelope: {
        ok: true,
        commandId: "version",
        result: { version: "0.0.0" },
        exitCode: 0,
        diagnostics: [],
        nextActions: [],
      },
      commandId: "version",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
  });
});

describe("a failure carrying several findings", () => {
  const FINDINGS: readonly Diagnostic[] = [
    {
      code: "COMPOSER.MISSING_NAME",
      severity: "error",
      summary: "services[0] has no name.",
      nextActions: [{ kind: "edit-file", label: "Give services[0] a name." }],
    },
    {
      code: "COMPOSER.UNKNOWN_ENGINE",
      severity: "error",
      summary: "services[1].engine 'postgres9' is not a known engine.",
      nextActions: [],
    },
    {
      code: "COMPOSER.PORT_OUT_OF_RANGE",
      severity: "error",
      summary: "services[1].port 70000 is above 65535.",
      nextActions: [],
    },
  ];

  const NEXT_ACTIONS = [
    {
      kind: "user-choice",
      label: "Fix all three, then run the command again.",
    },
  ] as const;

  function configInvalid() {
    return new CliStructuredError(
      "COMPOSER.CONFIG_INVALID",
      "prisma.config.ts has 3 problems.",
      {
        why: "Every problem found is listed below.",
        nextActions: NEXT_ACTIONS,
        diagnostics: FINDINGS,
      },
    );
  }

  function erroredEnvelope(commandId: string) {
    return {
      ok: false,
      commandId,
      error: {
        code: "COMPOSER.CONFIG_INVALID",
        severity: "error",
        summary: "prisma.config.ts has 3 problems.",
        why: "Every problem found is listed below.",
        nextActions: NEXT_ACTIONS,
      },
      diagnostics: FINDINGS,
      nextActions: NEXT_ACTIONS,
    };
  }

  // Multi-line findings separate with a blank line; the trailing run of
  // one-liners keeps hugging as one glyph-aligned list.
  const STDERR =
    "✘ [COMPOSER.CONFIG_INVALID] prisma.config.ts has 3 problems.\n" +
    "  why: Every problem found is listed below.\n" +
    "→ Fix all three, then run the command again.\n" +
    "\n" +
    "✘ [COMPOSER.MISSING_NAME] services[0] has no name.\n" +
    "→ Give services[0] a name.\n" +
    "\n" +
    "✘ [COMPOSER.UNKNOWN_ENGINE] services[1].engine 'postgres9' is not a known engine.\n" +
    "✘ [COMPOSER.PORT_OUT_OF_RANGE] services[1].port 70000 is above 65535.\n";

  const compose = defineCommand({
    help: { summary: "Fails with everything it found" },
    handler: async () => notOk(configInvalid()),
  });

  const watch = defineSessionCommand({
    help: { summary: "A session that fails with everything it found" },
    handler: async () => notOk(configInvalid()),
  });

  const verify = defineCommand({
    help: { summary: "Throws the same error instead of returning it" },
    handler: async () => {
      throw configInvalid();
    },
  });

  function cli() {
    return createTestCli({
      commands: { compose, watch, verify },
      now: EPOCH,
    });
  }

  test("human renders the primary error then every finding on stderr", async () => {
    const result = await cli().run(["compose", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(STDERR);
  });

  test("json carries all three findings in the one errored envelope", async () => {
    const result = await cli().run(["compose", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("compose"),
        commandId: "compose",
        timestamp: T0,
      },
    ]);
  });

  test("a session command fails through the same door", async () => {
    const asJson = await cli().run(["watch", "--json"]);

    expect(asJson.exitCode).toBe(2);
    expect(asJson.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("watch"),
        commandId: "watch",
        timestamp: T0,
      },
    ]);

    const asHuman = await cli().run(["watch", "--format", "human"]);

    expect(asHuman.exitCode).toBe(2);
    expect(asHuman.stderr).toBe(STDERR);
  });

  test("a thrown error carrying findings takes the same path", async () => {
    const asJson = await cli().run(["verify", "--json"]);

    expect(asJson.exitCode).toBe(2);
    expect(asJson.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("verify"),
        commandId: "verify",
        timestamp: T0,
      },
    ]);

    const asHuman = await cli().run(["verify", "--format", "human"]);

    expect(asHuman.exitCode).toBe(2);
    expect(asHuman.stderr).toBe(STDERR);
  });

  test("an error with no findings still reports an empty list", async () => {
    const bare = defineCommand({
      help: { summary: "Fails with one problem and nothing beside it" },
      handler: async () =>
        notOk(new CliStructuredError("COMPOSER.UNREADABLE", "Cannot read it.")),
    });
    const result = await createTestCli({
      commands: { bare },
      now: EPOCH,
    }).run(["bare", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([
      {
        kind: "result",
        envelope: {
          ok: false,
          commandId: "bare",
          error: {
            code: "COMPOSER.UNREADABLE",
            severity: "error",
            summary: "Cannot read it.",
            nextActions: [],
          },
          diagnostics: [],
          nextActions: [],
        },
        commandId: "bare",
        timestamp: T0,
      },
    ]);
  });
});

describe("a structured error built by another copy of the engine", () => {
  /** A copy old enough to predate the brand: recognized only by the
   *  duck-typed fallback, an Error named CliStructuredError with a
   *  string code and a toEnvelope function. Two engine copies in one
   *  install is a shipped situation, so an instance of a different class
   *  reaches settlement whole and its `diagnostics` is whatever that
   *  copy put there. */
  function foreignError(fields: Record<string, unknown>): CliStructuredError {
    return Object.assign(new Error("prisma.config.ts could not be read."), {
      name: "CliStructuredError",
      code: "COMPOSER.UNREADABLE",
      severity: "error",
      nextActions: [],
      toEnvelope: () => ({
        ok: false,
        code: "COMPOSER.UNREADABLE",
        severity: "error",
        summary: "prisma.config.ts could not be read.",
        nextActions: [],
      }),
      ...fields,
    }) as unknown as CliStructuredError;
  }

  /** A copy that carries the brand. Its prototype leads nowhere near
   *  this module's class and it is not an Error at all, so the brand is
   *  the only thing the guard has to go on. */
  function brandedError(fields: Record<string, unknown>): CliStructuredError {
    return {
      [STRUCTURED_ERROR]: true,
      name: "SomethingElse",
      code: "COMPOSER.UNREADABLE",
      severity: "error",
      nextActions: [],
      toEnvelope: () => ({
        ok: false,
        code: "COMPOSER.UNREADABLE",
        severity: "error",
        summary: "prisma.config.ts could not be read.",
        nextActions: [],
      }),
      ...fields,
    } as unknown as CliStructuredError;
  }

  const LONE_FINDING: Diagnostic = {
    code: "COMPOSER.MISSING_NAME",
    severity: "error",
    summary: "services[0] has no name.",
    nextActions: [],
  };

  function erroredEnvelope(commandId: string) {
    return {
      ok: false,
      commandId,
      error: {
        code: "COMPOSER.UNREADABLE",
        severity: "error",
        summary: "prisma.config.ts could not be read.",
        nextActions: [],
      },
      diagnostics: [],
      nextActions: [],
    };
  }

  const STDERR =
    "✘ [COMPOSER.UNREADABLE] prisma.config.ts could not be read.\n";

  function cli(fields: Record<string, unknown>) {
    return createTestCli({
      commands: {
        thrown: defineCommand({
          help: { summary: "Throws the other copy's error" },
          handler: async () => {
            throw foreignError(fields);
          },
        }),
        returned: defineCommand({
          help: { summary: "Returns the other copy's error" },
          handler: async () => notOk(foreignError(fields)),
        }),
        branded: defineCommand({
          help: { summary: "Throws a branded error from another copy" },
          handler: async () => {
            throw brandedError(fields);
          },
        }),
      },
      now: EPOCH,
    });
  }

  // A single finding where a list belongs: the shape a copy that carries
  // one accompanying finding rather than several would hand over.
  const NOT_A_LIST = { diagnostics: LONE_FINDING };

  test("a thrown one whose findings are not a list renders only the error", async () => {
    const result = await cli(NOT_A_LIST).run(["thrown", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(STDERR);
  });

  test("and its json envelope reports no findings rather than garbage", async () => {
    const result = await cli(NOT_A_LIST).run(["thrown", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("thrown"),
        commandId: "thrown",
        timestamp: T0,
      },
    ]);
  });

  test("a returned one takes the same path", async () => {
    const asHuman = await cli(NOT_A_LIST).run([
      "returned",
      "--format",
      "human",
    ]);

    expect(asHuman.exitCode).toBe(2);
    expect(asHuman.stdout).toBe("");
    expect(asHuman.stderr).toBe(STDERR);

    const asJson = await cli(NOT_A_LIST).run(["returned", "--json"]);

    expect(asJson.exitCode).toBe(2);
    expect(asJson.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("returned"),
        commandId: "returned",
        timestamp: T0,
      },
    ]);
  });

  test("an older copy's error, with no findings field at all, still settles as the error it is", async () => {
    const asHuman = await cli({}).run(["thrown", "--format", "human"]);

    expect(asHuman.exitCode).toBe(2);
    expect(asHuman.stderr).toBe(STDERR);

    const asJson = await cli({}).run(["thrown", "--json"]);

    expect(asJson.exitCode).toBe(2);
    expect(asJson.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("thrown"),
        commandId: "thrown",
        timestamp: T0,
      },
    ]);
  });

  test("the brand alone settles it, and its findings are normalized the same way", async () => {
    const asHuman = await cli(NOT_A_LIST).run(["branded", "--format", "human"]);

    expect(asHuman.exitCode).toBe(2);
    expect(asHuman.stdout).toBe("");
    expect(asHuman.stderr).toBe(STDERR);

    const asJson = await cli(NOT_A_LIST).run(["branded", "--json"]);

    expect(asJson.exitCode).toBe(2);
    expect(asJson.json).toEqual([
      {
        kind: "result",
        envelope: erroredEnvelope("branded"),
        commandId: "branded",
        timestamp: T0,
      },
    ]);
  });
});
