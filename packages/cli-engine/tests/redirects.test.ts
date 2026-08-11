/**
 * Redirect tables: a command family declares the invocations it
 * retired, and typing one names the replacement instead of failing with
 * a generic unknown-command or unknown-flag error.
 */
import { defineCommand, defineCommandFamily, flag } from "@prisma/cli-engine";
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
