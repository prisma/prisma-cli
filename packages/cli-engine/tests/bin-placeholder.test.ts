/**
 * A command family never names the binary: it writes `{bin}`, and the
 * engine substitutes the name of the CLI the user ran in everything it
 * prints or serializes from the command.
 */
import { defineCommand, type StreamEvent } from "@prisma/cli-engine";
import {
  CliStructuredError,
  type Diagnostic,
  ok,
} from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const FINDING: Diagnostic = {
  code: "MIGRATION.DRIFT",
  severity: "warn",
  summary: "Run `{bin} migration status` to see the drift.",
  why: "`{bin} db migrate` was interrupted.",
  nextActions: [
    { kind: "run-command", label: "Inspect", command: "{bin} db inspect" },
  ],
};

const DATA = { note: "the row says {bin}" };

const plan = defineCommand({
  help: { summary: "Plan a migration" },
  args: {},
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: DATA, diagnostics: [FINDING] },
        {
          human: () => [
            {
              kind: "summary",
              status: "info",
              text: "Run `{bin} migration plan --name <name>` to author one.",
            },
            {
              kind: "list",
              items: [[{ text: "{bin} migration graph", tone: "identifier" }]],
            },
            {
              kind: "table",
              columns: ["name"],
              rows: [["{bin}"]],
            },
            {
              kind: "fields",
              rows: [{ label: "value", value: "{bin}" }],
            },
          ],
          stdout: () => ["{bin}"],
          json: () => DATA,
          next: () => [
            {
              kind: "run-command",
              label: "Apply the migration",
              command: "{bin} db migrate",
            },
            {
              kind: "run-command",
              label: "Or step by step",
              commands: ["{bin} db migrate --dry-run", "{bin} db migrate"],
            },
            { kind: "run-command", label: "No placeholder", command: "ls" },
          ],
        },
      ),
    ),
});

const failing = defineCommand({
  help: { summary: "Fail" },
  args: {},
  handler: async () => {
    throw new CliStructuredError(
      "MIGRATION.NOT_FOUND",
      "Run `{bin} migration plan` first.",
      {
        why: "`{bin} db migrate` found no migration.",
        nextActions: [
          {
            kind: "run-command",
            label: "Plan one",
            command: "{bin} migration plan",
          },
        ],
        diagnostics: [FINDING],
        meta: { echoed: "{bin}" },
      },
    );
  },
});

const HUMAN = { isTty: { stdout: true } };

const cli = () => createTestCli({ commands: { plan, failing } });

function lastEnvelope(frames: readonly StreamEvent[]) {
  const last = frames[frames.length - 1];
  if (last.kind !== "result") {
    throw new Error("expected a result frame");
  }
  return last.envelope;
}

describe("a completed command", () => {
  test("human output names the binary and leaves table cells and field values alone", async () => {
    const result = await cli().run(["plan"], HUMAN);

    expect(result.stderr).toBe(
      "ℹ Run `prisma-test migration plan --name <name>` to author one.\n" +
        "\n" +
        "- prisma-test migration graph\n" +
        "\n" +
        "Name\n" +
        "{bin}\n" +
        "\n" +
        "value:  {bin}\n" +
        "\n" +
        "→ Apply the migration: prisma-test db migrate\n" +
        "→ Or step by step\n" +
        "→ No placeholder: ls\n" +
        "\n" +
        "⚠ [MIGRATION.DRIFT] Run `prisma-test migration status` to see the drift.\n" +
        "  why: `prisma-test db migrate` was interrupted.\n" +
        "→ Inspect: prisma-test db inspect\n",
    );
  });

  test("the machine lines on stdout are left as the command wrote them", async () => {
    const result = await cli().run(["plan"], HUMAN);

    expect(result.stdout).toBe("{bin}\n");
  });

  test("markdown output names the binary and leaves table cells and field values alone", async () => {
    const result = await cli().run(["plan", "--format", "markdown"]);

    expect(result.stdout).toBe(
      "[info] Run `prisma-test migration plan --name <name>` to author one.\n" +
        "\n" +
        "- prisma-test migration graph\n" +
        "\n" +
        "| Name |\n" +
        "| --- |\n" +
        "| {bin} |\n" +
        "\n" +
        "value: {bin}\n" +
        "\n" +
        "### Next\n" +
        "- Apply the migration: `prisma-test db migrate`\n" +
        "- Or step by step\n" +
        "  - `prisma-test db migrate --dry-run`\n" +
        "  - `prisma-test db migrate`\n" +
        "- No placeholder: `ls`\n" +
        "\n" +
        "### Diagnostics\n" +
        "[warn] MIGRATION.DRIFT: Run `prisma-test migration status` to see the drift.\n" +
        "why: `prisma-test db migrate` was interrupted.\n" +
        "- Inspect: `prisma-test db inspect`\n",
    );
  });

  test("the json envelope names the binary and leaves the result alone", async () => {
    const result = await cli().run(["plan", "--json"]);

    expect(lastEnvelope(result.json)).toMatchObject({
      ok: true,
      result: { note: "the row says {bin}" },
      nextActions: [
        { label: "Apply the migration", command: "prisma-test db migrate" },
        {
          label: "Or step by step",
          commands: [
            "prisma-test db migrate --dry-run",
            "prisma-test db migrate",
          ],
        },
        { label: "No placeholder", command: "ls" },
      ],
      diagnostics: [
        {
          summary: "Run `prisma-test migration status` to see the drift.",
          why: "`prisma-test db migrate` was interrupted.",
          nextActions: [{ command: "prisma-test db inspect" }],
        },
      ],
    });
  });
});

describe("a failed command", () => {
  test("human output names the binary", async () => {
    const result = await cli().run(["failing"], HUMAN);

    expect(result.stderr).toBe(
      "✘ [MIGRATION.NOT_FOUND] Run `prisma-test migration plan` first.\n" +
        "  why: `prisma-test db migrate` found no migration.\n" +
        "→ Plan one: prisma-test migration plan\n" +
        "\n" +
        "⚠ [MIGRATION.DRIFT] Run `prisma-test migration status` to see the drift.\n" +
        "  why: `prisma-test db migrate` was interrupted.\n" +
        "→ Inspect: prisma-test db inspect\n",
    );
  });

  test("markdown output names the binary", async () => {
    const result = await cli().run(["failing", "--format", "markdown"]);

    expect(result.stdout).not.toContain("{bin}");
    expect(result.stdout).toContain(
      "[error] MIGRATION.NOT_FOUND: Run `prisma-test migration plan` first.\n" +
        "why: `prisma-test db migrate` found no migration.\n" +
        "- Plan one: `prisma-test migration plan`\n",
    );
  });

  test("the json envelope names the binary and leaves meta alone", async () => {
    const result = await cli().run(["failing", "--json"]);

    const planOne = {
      label: "Plan one",
      command: "prisma-test migration plan",
    };
    expect(lastEnvelope(result.json)).toMatchObject({
      ok: false,
      error: {
        summary: "Run `prisma-test migration plan` first.",
        why: "`prisma-test db migrate` found no migration.",
        nextActions: [planOne],
        meta: { echoed: "{bin}" },
      },
      diagnostics: [
        {
          summary: "Run `prisma-test migration status` to see the drift.",
          why: "`prisma-test db migrate` was interrupted.",
          nextActions: [{ command: "prisma-test db inspect" }],
        },
      ],
      nextActions: [planOne],
    });
  });
});
