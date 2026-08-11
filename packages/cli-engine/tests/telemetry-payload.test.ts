import {
  defineCommand,
  type EngineCommandSnapshot,
  flag,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";
import { sanitizeCommandSnapshot } from "../src/telemetry/payload";

const deploy = defineCommand({
  help: { summary: "Deploy something" },
  args: {
    flags: {
      dryRun: flag.boolean({ brief: "no writes" }),
      name: flag.string({ brief: "deployment name", placeholder: "name" }),
      count: flag.number({ brief: "how many", alias: "c", placeholder: "n" }),
    },
    positionals: {
      target: positional.string({ brief: "where", placeholder: "target" }),
      extra: positional.optionalString({
        brief: "spare",
        placeholder: "extra",
      }),
    },
  },
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: null },
        { human: () => [{ kind: "summary", tone: "ok", text: "deployed" }] },
      ),
    ),
});

describe("sanitizeCommandSnapshot", () => {
  it("joins the command path with spaces and keeps only the flags the user typed", () => {
    expect(
      sanitizeCommandSnapshot({
        commandPath: ["postgres", "create"],
        positionalCount: 2,
        flags: [
          { name: "region", source: "cli" },
          { name: "json", source: "default" },
          { name: "service-token", source: "env" },
          { name: "connection-string", source: "cli" },
        ],
      }),
    ).toEqual({
      command: "postgres create",
      flags: ["region", "connection-string"],
    });
  });

  it("emits an empty flag list when the user typed none", () => {
    expect(
      sanitizeCommandSnapshot({
        commandPath: ["init"],
        positionalCount: 0,
        flags: [
          { name: "no-install", source: "default" },
          { name: "json", source: "default" },
        ],
      }),
    ).toEqual({ command: "init", flags: [] });
  });

  it("keeps the snapshot's flag order", () => {
    expect(
      sanitizeCommandSnapshot({
        commandPath: ["migrate"],
        positionalCount: 0,
        flags: [
          { name: "to", source: "cli" },
          { name: "json", source: "default" },
          { name: "yes", source: "cli" },
        ],
      }).flags,
    ).toEqual(["to", "yes"]);
  });

  it("returns an empty command for an empty command path", () => {
    expect(
      sanitizeCommandSnapshot({
        commandPath: [],
        positionalCount: 0,
        flags: [],
      }).command,
    ).toBe("");
  });

  it("copies nothing but the name out of a flag entry", () => {
    const smuggled = {
      commandPath: ["deploy"],
      positionalCount: 1,
      flags: [
        {
          name: "token",
          source: "cli",
          value: "sk_live_SHOULD-NEVER-LEAK",
        } as unknown as EngineCommandSnapshot["flags"][number],
      ],
      argv: ["--token", "sk_live_SHOULD-NEVER-LEAK"],
      positionals: ["/Users/alice/secret.toml"],
    } as unknown as EngineCommandSnapshot;
    expect(sanitizeCommandSnapshot(smuggled)).toEqual({
      command: "deploy",
      flags: ["token"],
    });
  });

  it("reduces a real run with values, positionals and defaulted flags to names alone", async () => {
    const snapshots: EngineCommandSnapshot[] = [];
    const result = await createTestCli({
      commands: { "app deploy": deploy },
      groups: { app: { brief: "app commands" } },
    }).run(
      [
        "app",
        "deploy",
        "--name",
        "customer-acme-payments",
        "--count",
        "7",
        "prod-target",
        "spare-target",
      ],
      { onSettled: (summary) => snapshots.push(summary.snapshot) },
    );

    expect(result.exitCode).toBe(0);
    expect(snapshots.map((snapshot) => snapshot.positionalCount)).toEqual([2]);

    const sanitized = snapshots.map(sanitizeCommandSnapshot);
    expect(sanitized).toEqual([
      { command: "app deploy", flags: ["name", "count"] },
    ]);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("customer-acme-payments");
    expect(serialized).not.toContain("prod-target");
    expect(serialized).not.toContain("spare-target");
    expect(serialized).not.toContain("dry-run");
    expect(serialized).not.toContain("7");
  });
});
