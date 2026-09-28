/**
 * Settlement receives errors nothing has validated: one built by another
 * copy of the engine, or a handler's notOk failure. Substituting `{bin}`
 * must never be the reason such a run fails.
 */
import { defineCommand, type StreamEvent } from "@prisma/cli-engine";
import {
  type CliStructuredError,
  type Diagnostic,
  notOk,
} from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function foreignError(fields: Record<string, unknown>): CliStructuredError {
  return {
    name: "CliStructuredError",
    code: "FOREIGN.FAILED",
    message: "Run `{bin} status`.",
    toEnvelope: () => ({
      ok: false,
      code: "FOREIGN.FAILED",
      severity: "error",
      summary: "Run `{bin} status`.",
      nextActions: [],
    }),
    ...fields,
  } as unknown as CliStructuredError;
}

const CASES: Record<string, () => CliStructuredError> = {
  "an error without nextActions": () =>
    foreignError({ nextActions: undefined }),
  "an envelope without nextActions": () =>
    foreignError({
      nextActions: [],
      toEnvelope: () => ({
        ok: false,
        code: "FOREIGN.FAILED",
        severity: "error",
        summary: "Run `{bin} status`.",
      }),
    }),
  "an accompanying finding without nextActions": () =>
    foreignError({
      nextActions: [],
      diagnostics: [
        { code: "FOREIGN.FINDING", severity: "warn", summary: "{bin}" },
      ] as unknown as Diagnostic[],
    }),
  "an accompanying finding whose why is not a string": () =>
    foreignError({
      nextActions: [],
      diagnostics: [
        {
          code: "FOREIGN.FINDING",
          severity: "warn",
          summary: "{bin}",
          why: 42,
          nextActions: [],
        },
      ] as unknown as Diagnostic[],
    }),
};

function cli(build: () => CliStructuredError) {
  return createTestCli({
    commands: {
      thrown: defineCommand({
        help: { summary: "Throw" },
        args: {},
        handler: async () => {
          throw build();
        },
      }),
      returned: defineCommand({
        help: { summary: "Return" },
        args: {},
        handler: async () => notOk(build()),
      }),
    },
  });
}

function errorOf(frames: readonly StreamEvent[]) {
  const last = frames[frames.length - 1];
  if (last?.kind !== "result" || last.envelope.ok) {
    throw new Error("expected an errored result frame");
  }
  return last.envelope.error;
}

/** A list of next actions that is missing has never rendered in human
 *  or markdown output, so those cases are asserted in json alone. */
const RENDERABLE = [
  "an error without nextActions",
  "an accompanying finding whose why is not a string",
];

describe.each(Object.entries(CASES))("%s", (name, build) => {
  describe.each(["thrown", "returned"])("%s by the handler", (command) => {
    test("json settles with the original error", async () => {
      const result = await cli(build).run([command, "--json"]);

      expect(result.exitCode).toBe(2);
      expect(errorOf(result.json)).toMatchObject({
        code: "FOREIGN.FAILED",
        summary: "Run `prisma-test status`.",
      });
    });

    test.runIf(RENDERABLE.includes(name))(
      "human settles with the original error",
      async () => {
        const result = await cli(build).run([command], {
          isTty: { stdout: true },
        });

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(
          "[FOREIGN.FAILED] Run `prisma-test status`.",
        );
      },
    );

    test.runIf(RENDERABLE.includes(name))(
      "markdown settles with the original error",
      async () => {
        const result = await cli(build).run([command, "--format", "markdown"]);

        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain(
          "FOREIGN.FAILED: Run `prisma-test status`.",
        );
      },
    );
  });
});
