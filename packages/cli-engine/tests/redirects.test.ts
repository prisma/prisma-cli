/**
 * Redirect tables: a command family declares the invocations it
 * retired, and typing one names the replacement instead of failing with
 * a generic unknown-command or unknown-flag error.
 */
import {
  defineCommand,
  defineCommandFamily,
  type ErroredEnvelope,
  flag,
  type RedirectSpec,
  type StreamEvent,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);

const status = defineCommand({
  help: { summary: "Show migration status" },
  args: { flags: { detailed: flag.boolean({ brief: "more detail" }) } },
  handler: async (_args, ctx) =>
    ok(ctx.present({ data: null }, { human: () => [] })),
});

const MIGRATION_GROUP = { migration: { brief: "Migrations" } };

/** A CLI mounting only `migration status`, with the given redirects. */
function redirectingCli(redirects: readonly RedirectSpec[]) {
  return createTestCli({
    commandFamilies: [defineCommandFamily({ commands: { status }, redirects })],
    commands: { "migration status": status },
    groups: MIGRATION_GROUP,
    now: EPOCH,
  });
}

function erroredEnvelope(frames: readonly StreamEvent[]): ErroredEnvelope {
  const last = frames[frames.length - 1];
  if (last.kind !== "result" || last.envelope.ok) {
    throw new Error("expected an errored result frame");
  }
  return last.envelope;
}

describe("construction-time validation", () => {
  test("a verb redirect onto a mounted command fails construction", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [{ from: "migration status", replacement: "migration graph" }],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow("redirect 'migration status' collides with a mounted command");
  });

  test("a verb redirect onto a group fails construction", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [{ from: "migration", replacement: "migrate" }],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow("redirect 'migration' collides with a mounted command group");
  });

  test("a flag redirect on a path that is not a mounted command fails construction", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [
        { from: "migration", flag: "graph", replacement: "migration graph" },
      ],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow(
      "redirect for flag 'graph' names 'migration', which is not a mounted command",
    );
  });

  test("a flag redirect for a flag the command declares fails construction", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [
        {
          from: "migration status",
          flag: "detailed",
          replacement: "migration graph",
        },
      ],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow(
      "redirect for flag 'detailed' on 'migration status' names a flag that command still accepts",
    );
  });

  test("a flag redirect for an engine-injected shared flag fails construction", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [
        {
          from: "migration status",
          flag: "json",
          replacement: "migration status --format json",
        },
      ],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow(
      "redirect for flag 'json' on 'migration status' names a flag that command still accepts",
    );
  });

  test("two families claiming the same retired path fail construction", () => {
    const first = defineCommandFamily({
      commands: { status },
      redirects: [
        { from: "migration apply", replacement: "migrate --to <ref>" },
      ],
    });
    const second = defineCommandFamily({
      commands: {},
      redirects: [{ from: "migration apply", replacement: "migrate" }],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [first, second],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow("redirect 'migration apply' is declared twice");
  });

  test("the same retired flag declared twice fails construction", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [
        {
          from: "migration status",
          flag: "graph",
          replacement: "migration graph",
        },
        {
          from: "migration status",
          flag: "graph",
          replacement: "migration graph --wide",
        },
      ],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
      }),
    ).toThrow(
      "redirect for flag 'graph' on 'migration status' is declared twice",
    );
  });

  test("a verb and a flag redirect may share a path", () => {
    const family = defineCommandFamily({
      commands: { status },
      redirects: [
        { from: "migration apply", replacement: "migrate --to <ref>" },
        {
          from: "migration status",
          flag: "graph",
          replacement: "migration graph",
        },
      ],
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { "migration status": status },
        groups: MIGRATION_GROUP,
        now: EPOCH,
      }),
    ).not.toThrow();
  });
});

describe("retired verbs", () => {
  const APPLY: RedirectSpec = {
    from: "migration apply",
    replacement: "migrate --to <ref>",
    reason: "migration apply was replaced by migrate --to.",
  };

  test("typing one settles as CLI.COMMAND_MOVED naming the replacement", async () => {
    const result = await redirectingCli([APPLY]).run([
      "migration",
      "apply",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    const envelope = erroredEnvelope(result.json);
    expect(envelope.error.code).toBe("CLI.COMMAND_MOVED");
    expect(envelope.error.summary).toBe("`migration apply` has been replaced");
    expect(envelope.error.why).toBe(
      "migration apply was replaced by migrate --to.",
    );
    expect(envelope.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Use the replacement",
        command: "prisma-test migrate --to <ref>",
      },
    ]);
    expect(envelope.error.nextActions).toEqual(envelope.nextActions);
  });

  test("the retired path identifies the run", async () => {
    const result = await redirectingCli([APPLY]).run([
      "migration",
      "apply",
      "--json",
    ]);

    expect(erroredEnvelope(result.json).commandId).toBe("migration.apply");
  });

  test("a redirect without a reason carries no why", async () => {
    const result = await redirectingCli([
      { from: "migration apply", replacement: "migrate --to <ref>" },
    ]).run(["migration", "apply", "--json"]);

    expect(erroredEnvelope(result.json).error.why).toBeUndefined();
  });

  test("arguments after the retired path do not stop it matching", async () => {
    const result = await redirectingCli([APPLY]).run([
      "migration",
      "apply",
      "20240101_init",
      "--json",
    ]);

    expect(erroredEnvelope(result.json).error.code).toBe("CLI.COMMAND_MOVED");
  });

  test("the longest matching redirect wins", async () => {
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({
          commands: { status },
          redirects: [{ from: "migration", replacement: "migrate" }, APPLY],
        }),
      ],
      commands: { status },
      now: EPOCH,
    });

    const deep = await cli.run(["migration", "apply", "--json"]);
    expect(erroredEnvelope(deep.json).error.summary).toBe(
      "`migration apply` has been replaced",
    );

    const shallow = await cli.run(["migration", "list", "--json"]);
    expect(erroredEnvelope(shallow.json).error.summary).toBe(
      "`migration` has been replaced",
    );
  });

  test("a redirect under a live group fires", async () => {
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({
          commands: { status },
          redirects: [
            { from: "migration ref", replacement: "ref set|list|delete" },
          ],
        }),
      ],
      commands: { "migration status": status },
      groups: MIGRATION_GROUP,
      now: EPOCH,
    });

    const result = await cli.run(["migration", "ref", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(erroredEnvelope(result.json).error.code).toBe("CLI.COMMAND_MOVED");
  });

  test("segments match exactly, never fuzzily", async () => {
    const result = await redirectingCli([APPLY]).run([
      "migrations",
      "apply",
      "--json",
    ]);

    expect(erroredEnvelope(result.json).error.code).toBe("CLI.UNKNOWN_COMMAND");
  });

  test("an unknown command matching no redirect is unchanged", async () => {
    const result = await redirectingCli([APPLY]).run(["nonsense", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(erroredEnvelope(result.json).error.code).toBe("CLI.UNKNOWN_COMMAND");
  });

  test("a replacement carrying {bin} is rendered in place", async () => {
    const result = await redirectingCli([
      {
        from: "migration apply",
        replacement: "{bin} migrate --to <ref> && {bin} migration status",
      },
    ]).run(["migration", "apply", "--json"]);

    expect(erroredEnvelope(result.json).nextActions[0].command).toBe(
      "prisma-test migrate --to <ref> && prisma-test migration status",
    );
  });

  test("human mode renders the replacement on stderr", async () => {
    const result = await redirectingCli([APPLY]).run(["migration", "apply"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✖ [CLI.COMMAND_MOVED] `migration apply` has been replaced\n" +
        "  why: migration apply was replaced by migrate --to.\n" +
        "→ Use the replacement: prisma-test migrate --to <ref>\n",
    );
  });
});

describe("redirects stay out of help", () => {
  const cli = redirectingCli([
    { from: "migration apply", replacement: "migrate --to <ref>" },
    {
      from: "migration status",
      flag: "graph",
      replacement: "migration graph",
    },
  ]);

  test("the root help lists no retired invocation", async () => {
    const result = await cli.run(["--help"], { isTty: { stdout: true } });

    expect(result.stdout).toContain("migration");
    expect(result.stdout).not.toContain("apply");
    expect(result.stdout).not.toContain("graph");
  });

  test("group help lists no retired invocation", async () => {
    const result = await cli.run(["migration", "--help"], {
      isTty: { stdout: true },
    });

    expect(result.stdout).toContain("status");
    expect(result.stdout).not.toContain("apply");
  });

  test("command help lists no retired flag", async () => {
    const result = await cli.run(["migration", "status", "--help"], {
      isTty: { stdout: true },
    });

    expect(result.stdout).toContain("--detailed");
    expect(result.stdout).not.toContain("--graph");
  });
});
