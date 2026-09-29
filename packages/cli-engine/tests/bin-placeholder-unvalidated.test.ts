/**
 * Settlement receives errors nothing has validated: one built by another
 * copy of the engine, or a handler's notOk failure. Substituting `{bin}`
 * must never be the reason such a run fails.
 */
import { defineCommand, type StreamEvent } from "@prisma/cli-engine";
import { type CliStructuredError, notOk } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function foreignError(fields: Record<string, unknown>): CliStructuredError {
  return {
    name: "CliStructuredError",
    code: "FOREIGN.FAILED",
    message: "Run `{bin} status`.",
    toEnvelope: () => envelope({ nextActions: fields.nextActions ?? [] }),
    ...fields,
  } as unknown as CliStructuredError;
}

function envelope(fields: Record<string, unknown>) {
  return {
    ok: false,
    code: "FOREIGN.FAILED",
    severity: "error",
    summary: "Run `{bin} status`.",
    ...fields,
  };
}

const FINDING = { code: "FOREIGN.FINDING", severity: "warn" };

const NULL_ENTRY = [null, { kind: "done", label: "{bin}" }];

const ARRAY_ENTRY = [["{bin}"], { kind: "done", label: "{bin}" }];

const WRONG_TYPES = [
  { kind: "run-command", label: 42, reason: 42, command: 42 },
  { kind: "run-command", command: "{bin} status" },
  { kind: "run-command", label: "{bin}", commands: "{bin} status" },
  { kind: "run-command", label: "{bin}", commands: [42, null, "{bin}"] },
];

interface Case {
  readonly build: () => CliStructuredError;
  /** What the json envelope carries. */
  readonly settled: {
    readonly errorNextActions: unknown;
    readonly diagnostics: unknown;
    readonly nextActions: unknown;
  };
}

const CASES: Record<string, Case> = {
  "an error without nextActions": {
    build: () => foreignError({ nextActions: undefined }),
    settled: { errorNextActions: [], diagnostics: [], nextActions: undefined },
  },
  "an envelope without nextActions": {
    build: () =>
      foreignError({ nextActions: [], toEnvelope: () => envelope({}) }),
    settled: { errorNextActions: undefined, diagnostics: [], nextActions: [] },
  },
  "an accompanying finding without nextActions": {
    build: () =>
      foreignError({
        nextActions: [],
        diagnostics: [{ ...FINDING, summary: "{bin}" }],
      }),
    settled: {
      errorNextActions: [],
      diagnostics: [{ ...FINDING, summary: "prisma-test" }],
      nextActions: [],
    },
  },
  "an accompanying finding whose why is not a string": {
    build: () =>
      foreignError({
        nextActions: [],
        diagnostics: [
          { ...FINDING, summary: "{bin}", why: 42, nextActions: NULL_ENTRY },
        ],
      }),
    settled: {
      errorNextActions: [],
      diagnostics: [
        {
          ...FINDING,
          summary: "prisma-test",
          why: 42,
          nextActions: [null, { kind: "done", label: "prisma-test" }],
        },
      ],
      nextActions: [],
    },
  },
  "a next action that is null": {
    build: () => foreignError({ nextActions: NULL_ENTRY }),
    settled: {
      errorNextActions: [null, { kind: "done", label: "prisma-test" }],
      diagnostics: [],
      nextActions: [null, { kind: "done", label: "prisma-test" }],
    },
  },
  "a next action that is an array": {
    build: () => foreignError({ nextActions: ARRAY_ENTRY }),
    settled: {
      errorNextActions: [["{bin}"], { kind: "done", label: "prisma-test" }],
      diagnostics: [],
      nextActions: [["{bin}"], { kind: "done", label: "prisma-test" }],
    },
  },
  "a next action with fields of the wrong type": {
    build: () => foreignError({ nextActions: WRONG_TYPES }),
    settled: {
      errorNextActions: [
        WRONG_TYPES[0],
        { ...WRONG_TYPES[1], command: "prisma-test status" },
        { ...WRONG_TYPES[2], label: "prisma-test" },
        {
          ...WRONG_TYPES[3],
          label: "prisma-test",
          commands: [42, null, "prisma-test"],
        },
      ],
      diagnostics: [],
      nextActions: [
        WRONG_TYPES[0],
        { ...WRONG_TYPES[1], command: "prisma-test status" },
        { ...WRONG_TYPES[2], label: "prisma-test" },
        {
          ...WRONG_TYPES[3],
          label: "prisma-test",
          commands: [42, null, "prisma-test"],
        },
      ],
    },
  },
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

function envelopeOf(frames: readonly StreamEvent[]) {
  const last = frames[frames.length - 1];
  if (last?.kind !== "result" || last.envelope.ok) {
    throw new Error("expected an errored result frame");
  }
  return last.envelope;
}

describe.each(Object.entries(CASES))("%s", (_name, { build, settled }) => {
  describe.each(["thrown", "returned"])("%s by the handler", (command) => {
    test("json settles with the original error", async () => {
      const result = await cli(build).run([command, "--json"]);

      expect(result.exitCode).toBe(2);
      expect(envelopeOf(result.json).error).toMatchObject({
        code: "FOREIGN.FAILED",
        summary: "Run `prisma-test status`.",
      });
    });

    test("json passes malformed values through and substitutes beside them", async () => {
      const result = await cli(build).run([command, "--json"]);

      const settledEnvelope = envelopeOf(result.json);
      expect(settledEnvelope.error.nextActions).toStrictEqual(
        settled.errorNextActions,
      );
      expect(settledEnvelope.diagnostics).toStrictEqual(settled.diagnostics);
      expect(settledEnvelope.nextActions).toStrictEqual(settled.nextActions);
    });

    test("human settles with the original error", async () => {
      const result = await cli(build).run([command], {
        isTty: { stdout: true },
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        "[FOREIGN.FAILED] Run `prisma-test status`.",
      );
    });

    test("markdown settles with the original error", async () => {
      const result = await cli(build).run([command, "--format", "markdown"]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain(
        "FOREIGN.FAILED: Run `prisma-test status`.",
      );
    });
  });
});
