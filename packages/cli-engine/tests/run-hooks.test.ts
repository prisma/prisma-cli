import {
  defineCommand,
  flag,
  positional,
  type RunSummary,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

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
        {
          human: () => [{ kind: "summary", tone: "ok", text: "deployed" }],
          stdout: () => [],
          json: () => null,
          next: () => [],
        },
      ),
    ),
});

const failing = defineCommand({
  help: { summary: "Always errors" },
  handler: async () => notOk(new CliStructuredError("APP.BROKEN", "It broke")),
});

/** Fixed-step injectable clock: every now() call advances exactly one
 *  second, so durationMs is a positive multiple of 1000 iff it came
 *  from this clock and not from wall time. */
function steppingClock(): () => Date {
  let tick = 0;
  return () => {
    tick += 1_000;
    return new Date(tick);
  };
}

function makeCli(options?: { now?: () => Date }) {
  return createTestCli({
    commands: { "app deploy": deploy, "app fail": failing },
    groups: { app: { brief: "app commands" } },
    now: options?.now ?? (() => new Date(0)),
  });
}

describe("RunHooks.onSettled", () => {
  it("fires exactly once with the command identity, exit code, and value-free snapshot", async () => {
    const summaries: RunSummary[] = [];
    const result = await makeCli().run(
      ["app", "deploy", "--dry-run", "--name", "secret-value", "prod-target"],
      { onSettled: (summary) => summaries.push(summary) },
    );

    expect(result.exitCode).toBe(0);
    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    expect(summary?.commandId).toBe("app.deploy");
    expect(summary?.exitCode).toBe(0);
    expect(summary?.snapshot.commandPath).toEqual(["app", "deploy"]);
    expect(summary?.snapshot.positionalCount).toBe(1);
    expect(summary?.snapshot.flags).toEqual([
      { name: "format", source: "default" },
      { name: "json", source: "default" },
      { name: "log-level", source: "default" },
      { name: "verbose", source: "default" },
      { name: "quiet", source: "default" },
      { name: "yes", source: "default" },
      { name: "confirm", source: "default" },
      { name: "interactive", source: "default" },
      { name: "color", source: "default" },
      { name: "dry-run", source: "cli" },
      { name: "name", source: "cli" },
      { name: "count", source: "default" },
    ]);
    // Value-free: flag values and positional values never appear.
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain("secret-value");
    expect(serialised).not.toContain("prod-target");
  });

  it("marks alias-passed and =-form flags as cli, and shared flags when explicitly set", async () => {
    const summaries: RunSummary[] = [];
    await makeCli().run(
      ["app", "deploy", "-c", "3", "--name=x", "--yes", "t"],
      {
        onSettled: (summary) => summaries.push(summary),
      },
    );

    const bySource = new Map(
      summaries[0]?.snapshot.flags.map((entry) => [entry.name, entry.source]),
    );
    expect(bySource.get("count")).toBe("cli");
    expect(bySource.get("name")).toBe("cli");
    expect(bySource.get("yes")).toBe("cli");
    expect(bySource.get("dry-run")).toBe("default");
  });

  it("fires for errored runs with the errored exit code", async () => {
    const summaries: RunSummary[] = [];
    const result = await makeCli().run(["app", "fail"], {
      onSettled: (summary) => summaries.push(summary),
    });

    expect(result.exitCode).toBe(2);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.commandId).toBe("app.fail");
    expect(summaries[0]?.exitCode).toBe(2);
    expect(summaries[0]?.snapshot.positionalCount).toBe(0);
  });

  it("derives durationMs from the injectable clock", async () => {
    const summaries: RunSummary[] = [];
    await makeCli({ now: steppingClock() }).run(["app", "fail"], {
      onSettled: (summary) => summaries.push(summary),
    });

    const durationMs = summaries[0]?.durationMs;
    expect(durationMs).toBeGreaterThan(0);
    expect((durationMs ?? 0) % 1_000).toBe(0);
  });

  it("swallows a throwing hook without changing the run's outcome", async () => {
    const result = await makeCli().run(["app", "deploy", "t"], {
      onSettled: () => {
        throw new Error("telemetry bug");
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("telemetry bug");
  });

  it("does not fire for --help", async () => {
    const summaries: RunSummary[] = [];
    const result = await makeCli().run(["app", "deploy", "--help"], {
      onSettled: (summary) => summaries.push(summary),
    });

    expect(result.exitCode).toBe(0);
    expect(summaries).toHaveLength(0);
  });

  it("does not fire for --version", async () => {
    const summaries: RunSummary[] = [];
    const result = await makeCli().run(["--version"], {
      onSettled: (summary) => summaries.push(summary),
    });

    expect(result.exitCode).toBe(0);
    expect(summaries).toHaveLength(0);
  });

  it("does not fire for a usage error that never reaches a mounted command", async () => {
    const summaries: RunSummary[] = [];
    const result = await makeCli().run(["app", "no-such-command"], {
      onSettled: (summary) => summaries.push(summary),
    });

    expect(result.exitCode).not.toBe(0);
    expect(summaries).toHaveLength(0);
  });
});
