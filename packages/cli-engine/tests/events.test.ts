/**
 * The full event vocabulary (§1 of the draft) through both renderers:
 * human mode writes `output` data lines to stdout and everything else as
 * log-level-filtered commentary on stderr; json mode frames every
 * unfiltered event as a StreamEvent.
 */
import { type Block, defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

const noisy = defineCommand({
  help: { summary: "Emits the whole vocabulary" },
  handler: async (_args, ctx) => {
    ctx.report({ kind: "step-started", step: "compile", id: "s1" });
    ctx.report({
      kind: "progress",
      step: "compile",
      completed: 1,
      total: 2,
    });
    ctx.report({
      kind: "step-finished",
      step: "compile",
      id: "s1",
      outcome: "ok",
    });
    ctx.report({ kind: "step-finished", step: "lint", outcome: "warning" });
    ctx.report({ kind: "message", severity: "warn", text: "heads up" });
    ctx.report({ kind: "message", severity: "info", text: "fyi" });
    ctx.report({
      kind: "output",
      source: "generator",
      channel: "data",
      line: "generated 3 files",
    });
    ctx.report({
      kind: "output",
      source: "generator",
      channel: "diagnostic",
      line: "generator warmed up",
    });
    ctx.report({
      kind: "remediation",
      action: { kind: "run-command", label: "Review", command: "demo show" },
    });
    ctx.report({
      kind: "endpoint",
      name: "studio",
      url: "http://localhost:5555",
    });
    ctx.report({
      kind: "status",
      subject: "db",
      status: "ready",
      from: "starting",
    });
    ctx.report({
      kind: "artifact",
      path: "out/contract.json",
      description: "the contract",
      data: { bytes: 42 },
    });
    return ok(
      ctx.present(
        { data: { done: true } },
        {
          human: (): readonly Block[] => [
            { kind: "summary", status: "ok", text: "done" },
          ],
          stdout: () => ["done"],
          json: () => ({ done: true }),
          next: () => [{ kind: "done", label: "Nothing else" }],
        },
      ),
    );
  },
});

function makeCli() {
  return createTestCli({ commands: { noisy }, now: EPOCH });
}

describe("human rendering", () => {
  test("payload lines go to stdout; blocks and commentary go to stderr", async () => {
    const result = await makeCli().run(["noisy", "--format", "human"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("generated 3 files\ndone\n");
    expect(result.stderr).toBe(
      "▸ compile\n" +
        "compile 1/2\n" +
        "✔ compile\n" +
        "⚠ lint\n" +
        "heads up\n" +
        "fyi\n" +
        "generator warmed up\n" +
        "studio: http://localhost:5555\n" +
        "db: starting → ready\n" +
        "out/contract.json — the contract\n" +
        "✔ done\n" +
        "→ Nothing else\n",
    );
  });

  test("an open-url next action renders its address, the same way a run-command renders its command", async () => {
    const withActions = defineCommand({
      help: { summary: "Suggests both kinds of follow-up" },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [
                {
                  kind: "open-url",
                  label: "Install the Prisma GitHub app",
                  url: "https://github.com/apps/prisma/installations/new",
                },
                {
                  kind: "run-command",
                  label: "Retry",
                  command: "prisma git connect",
                },
              ],
            },
          ),
        ),
    });
    const result = await createTestCli({
      commands: { probe: withActions },
      now: EPOCH,
    }).run(["probe", "--format", "human"]);

    expect(result.stderr).toBe(
      "→ Install the Prisma GitHub app: https://github.com/apps/prisma/installations/new\n" +
        "→ Retry: prisma git connect\n",
    );
  });

  test("an action whose label is already its command or url prints the string once", async () => {
    const bareStrings = defineCommand({
      help: { summary: "Suggests follow-ups mapped from bare strings" },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [
                {
                  kind: "run-command",
                  label: "prisma-cli project list",
                  command: "prisma-cli project list",
                },
                {
                  kind: "open-url",
                  label: "https://console.prisma.io/upgrade",
                  url: "https://console.prisma.io/upgrade",
                },
              ],
            },
          ),
        ),
    });
    const result = await createTestCli({
      commands: { probe: bareStrings },
      now: EPOCH,
    }).run(["probe", "--format", "human"]);

    expect(result.stderr).toBe(
      "→ prisma-cli project list\n" + "→ https://console.prisma.io/upgrade\n",
    );
  });

  test("--log-level warn filters info-grade commentary but keeps data lines", async () => {
    const result = await makeCli().run([
      "noisy",
      "--format",
      "human",
      "--log-level",
      "warn",
    ]);

    expect(result.stdout).toBe("generated 3 files\ndone\n");
    expect(result.stderr).toBe("heads up\n✔ done\n→ Nothing else\n");
  });

  test("--quiet silences commentary but keeps the presentation and data lines", async () => {
    const result = await makeCli().run([
      "noisy",
      "--format",
      "human",
      "--quiet",
    ]);

    expect(result.stdout).toBe("generated 3 files\ndone\n");
    expect(result.stderr).toBe("✔ done\n→ Nothing else\n");
  });
});

describe("json framing", () => {
  test("every unfiltered event becomes a StreamEvent with stream metadata", async () => {
    const result = await makeCli().run(["noisy", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json.map((frame) => frame.kind)).toEqual([
      "step-started",
      "progress",
      "step-finished",
      "step-finished",
      "message",
      "message",
      "output",
      "output",
      "remediation",
      "endpoint",
      "status",
      "artifact",
      "result",
    ]);
    for (const frame of result.json) {
      expect(frame.commandId).toBe("noisy");
      expect(frame.timestamp).toBe(T0);
    }
    expect(result.json[11]).toEqual({
      kind: "artifact",
      path: "out/contract.json",
      description: "the contract",
      data: { bytes: 42 },
      commandId: "noisy",
      timestamp: T0,
    });
  });

  test("--log-level error keeps only never-filtered data lines and the result", async () => {
    const result = await makeCli().run([
      "noisy",
      "--json",
      "--log-level",
      "error",
    ]);

    expect(result.json.map((frame) => frame.kind)).toEqual([
      "output",
      "result",
    ]);
    expect(result.json[0].kind === "output" && result.json[0].channel).toBe(
      "data",
    );
  });

  test("the harness still records every emitted event unfiltered", async () => {
    const result = await makeCli().run([
      "noisy",
      "--json",
      "--log-level",
      "error",
    ]);

    expect(result.events).toHaveLength(12);
  });
});
