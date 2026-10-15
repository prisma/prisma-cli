/**
 * Where stdout goes never picks the format. With no format flag a pipe
 * gets the command's data lines, and JSON needs --json.
 */
import { defineCommand } from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const list = defineCommand({
  help: { summary: "List things" },
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: { items: ["a", "b"] } },
        {
          human: () => [{ kind: "summary", status: "ok", text: "2 things" }],
          stdout: () => ["thg_a\talpha", "thg_b\tbeta"],
          json: () => ({ items: ["a", "b"] }),
          next: () => [],
        },
      ),
    ),
});

const failing = defineCommand({
  help: { summary: "Always fails" },
  handler: async () =>
    notOk(new CliStructuredError("DEMO.BROKEN", "It broke", { why: "Demo." })),
});

function cli() {
  return createTestCli({
    commands: { list, failing },
    now: () => new Date(0),
  });
}

const PIPED = { isTty: { stdout: false, stderr: false } };

describe("a piped stdout", () => {
  test("gets the data lines and no JSON when no format flag is given", async () => {
    const result = await cli().run(["list"], PIPED);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("thg_a\talpha\nthg_b\tbeta\n");
    expect(result.json).toEqual([]);
    expect(result.stderr).toBe("✔ 2 things\n");
  });

  test("gets one NDJSON result frame with --json", async () => {
    const result = await cli().run(["list", "--json"], PIPED);

    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveLength(1);
    expect(result.json[0]).toMatchObject({
      kind: "result",
      envelope: { ok: true, result: { items: ["a", "b"] } },
    });
  });

  test("gets nothing when the command fails without --json; the error is human, on stderr", async () => {
    const result = await cli().run(["failing"], PIPED);
    const framed = await cli().run(["failing", "--json"], PIPED);

    expect(result.exitCode).toBe(framed.exitCode);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("It broke");
    expect(result.stderr).toContain("DEMO.BROKEN");
  });

  test("gets a human usage error for an unknown command", async () => {
    const result = await cli().run(["frobnicate"], PIPED);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CLI.UNKNOWN_COMMAND");
  });
});
