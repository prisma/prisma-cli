/**
 * What each block draws. The engine renders and a command describes, so
 * these are the bytes a command can no longer get wrong: column widths
 * measured on text rather than escape sequences, a card whose values
 * start in one column, tree connectors, and a drawing the engine passes
 * through untouched.
 */
import { type Block, defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

/** Matching an escape sequence means matching the escape character. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: see above
const ANSI = /\u001b\[\d+m/g;

function strip(text: string): string {
  return text.replace(ANSI, "");
}

async function render(
  blocks: readonly Block[],
  options?: { readonly color?: boolean; readonly columns?: number },
): Promise<string> {
  const show = defineCommand({
    help: { summary: "Render the fixture blocks" },
    handler: async (_args, ctx) =>
      ok(ctx.present({ data: null }, { human: () => blocks })),
  });
  const result = await createTestCli({ commands: { show } }).run(
    [
      "show",
      "--format",
      "human",
      options?.color === true ? "--color" : "--no-color",
    ],
    options?.columns === undefined
      ? undefined
      : { columns: { stderr: options.columns } },
  );
  return result.stderr;
}

describe("table", () => {
  const RAGGED: Block = {
    kind: "table",
    columns: ["name", "id", "status"],
    rows: [
      ["Acme Inc", "ws_1", "current"],
      ["Globex", "ws_2", ""],
    ],
  };

  test("every column is as wide as its widest cell", async () => {
    expect(await render([RAGGED])).toBe(
      "name      id    status\n" +
        "Acme Inc  ws_1  current\n" +
        "Globex    ws_2\n",
    );
  });

  test("headers are toned, and a line never ends in padding", async () => {
    expect(await render([RAGGED], { color: true })).toBe(
      "\u001b[36mname    \u001b[39m  \u001b[36mid  \u001b[39m  \u001b[36mstatus\u001b[39m\n" +
        "Acme Inc  ws_1  current\n" +
        "Globex    ws_2\n",
    );
  });

  /**
   * The trap this whole design exists to close: pad a cell after
   * colouring it and the escape sequences count toward the width, so
   * every column right of a coloured cell shifts. Alignment must be
   * identical whether or not colour is on.
   */
  test("cells carrying spans align exactly as the same text uncoloured", async () => {
    const spanned: Block = {
      kind: "table",
      columns: ["name", "id"],
      rows: [
        [[{ text: "Acme", tone: "identifier" }, { text: " Inc" }], "ws_1"],
        ["Globex", "ws_2"],
      ],
    };
    const plain: Block = {
      kind: "table",
      columns: ["name", "id"],
      rows: [
        ["Acme Inc", "ws_1"],
        ["Globex", "ws_2"],
      ],
    };
    expect(strip(await render([spanned], { color: true }))).toBe(
      await render([plain]),
    );
  });

  test("a double-width cell is measured in columns, not code units", async () => {
    expect(
      await render([
        {
          kind: "table",
          columns: ["name", "id"],
          rows: [
            ["用户", "u1"],
            ["ab", "u2"],
          ],
        },
      ]),
    ).toBe("name  id\n用户  u1\nab    u2\n");
  });
});

describe("fields", () => {
  const CARD: Block = {
    kind: "fields",
    rows: [
      { label: "status", value: "signed in" },
      { label: "workspace", value: "Acme Inc" },
    ],
  };

  test("values start in one column", async () => {
    expect(await render([CARD])).toBe(
      "status:     signed in\nworkspace:  Acme Inc\n",
    );
  });

  test("labels are toned, padding included, as the legacy card drew them", async () => {
    expect(await render([CARD], { color: true })).toBe(
      "\u001b[36mstatus:   \u001b[39m  signed in\n" +
        "\u001b[36mworkspace:\u001b[39m  Acme Inc\n",
    );
  });

  test("rail: true prefixes each row with a dim rail and two spaces", async () => {
    expect(await render([{ ...CARD, rail: true }], { color: true })).toBe(
      "\u001b[2m│\u001b[22m  \u001b[36mstatus:   \u001b[39m  signed in\n" +
        "\u001b[2m│\u001b[22m  \u001b[36mworkspace:\u001b[39m  Acme Inc\n",
    );
  });

  test("a sensitive value is masked and the mask is what gets aligned", async () => {
    expect(
      await render([
        {
          kind: "fields",
          rows: [
            { label: "key", value: "AKIA", sensitive: true },
            { label: "endpoint", value: "https://s3.prisma.io" },
          ],
        },
      ]),
    ).toBe("key:       ********\nendpoint:  https://s3.prisma.io\n");
  });
});

describe("tree", () => {
  /**
   * The style guide's example (docs/product/cli-style-guide.md), which
   * is an excerpt: its `├─` says a sibling follows the branch shown, so
   * the fixture has one, and the first three lines are the example.
   */
  test("connectors and status glyphs match the style guide", async () => {
    const rendered = await render([
      {
        kind: "tree",
        roots: [
          {
            label: "contract",
            status: "error",
            children: [
              {
                label: "table user",
                status: "error",
                children: [{ label: "primary key: id", status: "ok" }],
              },
              { label: "table post", status: "ok" },
            ],
          },
        ],
      },
    ]);
    expect(rendered.split("\n").slice(0, 3).join("\n")).toBe(
      "✘ contract\n├─ ✘ table user\n│  └─ ✔ primary key: id",
    );
    expect(rendered).toBe(
      "✘ contract\n" +
        "├─ ✘ table user\n" +
        "│  └─ ✔ primary key: id\n" +
        "└─ ✔ table post\n",
    );
  });

  test("connectors are dim, the glyph and label take the node's colour", async () => {
    expect(
      await render(
        [
          {
            kind: "tree",
            roots: [
              {
                label: "contract",
                status: "error",
                children: [{ label: "table user", status: "ok" }],
              },
            ],
          },
        ],
        { color: true },
      ),
    ).toBe(
      "\u001b[91m✘\u001b[39m \u001b[91mcontract\u001b[39m\n" +
        "\u001b[2m└─\u001b[22m \u001b[92m✔\u001b[39m \u001b[92mtable user\u001b[39m\n",
    );
  });

  test("an explicit tone repaints a node without changing its glyph", async () => {
    expect(
      await render(
        [
          {
            kind: "tree",
            roots: [{ label: "migration 3", status: "error", tone: "color-4" }],
          },
        ],
        { color: true },
      ),
    ).toBe("\u001b[94m✘\u001b[39m \u001b[94mmigration 3\u001b[39m\n");
  });
});

describe("drawing", () => {
  test("spans round-trip with no layout of any kind", async () => {
    const lines = [
      [
        { text: "│ ", tone: "color-2" as const },
        { text: "○ ", tone: "color-3" as const },
        { text: "20260101_init" },
      ],
      "  │",
    ];
    expect(await render([{ kind: "drawing", lines }], { color: true })).toBe(
      "\u001b[36m│ \u001b[39m\u001b[33m○ \u001b[39m20260101_init\n  │\n",
    );
  });

  test("a line wider than the terminal is printed unmodified", async () => {
    const long = "x".repeat(120);
    expect(
      await render([{ kind: "drawing", lines: [long] }], { columns: 20 }),
    ).toBe(`${long}\n`);
  });
});

describe("summary and list", () => {
  test("the status picks the glyph and colours it; the text is left alone", async () => {
    expect(
      await render([{ kind: "summary", status: "ok", text: "Done." }], {
        color: true,
      }),
    ).toBe("\u001b[92m✔\u001b[39m Done.\n");
  });

  test("a tone overrides the status colour but not the glyph", async () => {
    expect(
      await render(
        [{ kind: "summary", status: "error", tone: "muted", text: "Gone." }],
        { color: true },
      ),
    ).toBe("\u001b[2m✘\u001b[22m Gone.\n");
  });

  test("list items take spans", async () => {
    expect(
      await render(
        [
          {
            kind: "list",
            items: [[{ text: "prisma deploy", tone: "identifier" }], "plain"],
          },
        ],
        { color: true },
      ),
    ).toBe("- \u001b[36mprisma deploy\u001b[39m\n- plain\n");
  });
});

/**
 * Three maps in the engine pick a mark: a block's status, a step's
 * outcome, and a diagnostic's severity. They answer different questions
 * and are allowed to; they are not allowed to disagree about the
 * character. They did: a run reported a failed step and a failed
 * summary with one mark and the diagnostic explaining it with another.
 */
describe("one character per meaning", () => {
  test("a failure reads the same however the run reports it", async () => {
    const fail = defineCommand({
      help: { summary: "Fail on every surface at once" },
      /** An error-severity diagnostic has to carry a non-zero code. */
      exitCodes: { 4: "broken" },
      handler: async (_args, ctx) => {
        ctx.report({
          kind: "step-finished",
          step: "migrate",
          outcome: "failed",
        });
        return ok(
          ctx.present(
            {
              data: null,
              exitCode: 4,
              diagnostics: [
                {
                  code: "TOY.BROKEN",
                  severity: "error",
                  summary: "It broke",
                  nextActions: [],
                },
              ],
            },
            {
              human: () => [
                { kind: "summary", status: "error", text: "Failed." },
              ],
            },
          ),
        );
      },
    });

    const result = await createTestCli({ commands: { fail } }).run([
      "fail",
      "--format",
      "human",
    ]);

    expect(result.stderr).toBe(
      "✘ migrate\n✘ Failed.\n✘ [TOY.BROKEN] It broke\n",
    );
  });

  test("ok, warn and info agree across the same surfaces", async () => {
    const mixed = defineCommand({
      help: { summary: "Report every non-failure outcome" },
      handler: async (_args, ctx) => {
        ctx.report({ kind: "step-finished", step: "build", outcome: "ok" });
        ctx.report({ kind: "step-finished", step: "seed", outcome: "warning" });
        return ok(
          ctx.present(
            {
              data: null,
              diagnostics: [
                {
                  code: "TOY.SLOW",
                  severity: "warn",
                  summary: "Took a while",
                  nextActions: [],
                },
                {
                  code: "TOY.NOTE",
                  severity: "info",
                  summary: "Worth knowing",
                  nextActions: [],
                },
              ],
            },
            {
              human: () => [
                { kind: "summary", status: "ok", text: "Built." },
                { kind: "summary", status: "warn", text: "Slowly." },
                { kind: "summary", status: "info", text: "Noted." },
              ],
            },
          ),
        );
      },
    });

    const result = await createTestCli({ commands: { mixed } }).run([
      "mixed",
      "--format",
      "human",
    ]);

    expect(result.stderr).toBe(
      "✔ build\n" +
        "⚠ seed\n" +
        "✔ Built.\n" +
        "⚠ Slowly.\n" +
        "ℹ Noted.\n" +
        "⚠ [TOY.SLOW] Took a while\n" +
        "ℹ [TOY.NOTE] Worth knowing\n",
    );
  });
});
