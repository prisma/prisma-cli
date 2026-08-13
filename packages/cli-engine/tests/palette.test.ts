/**
 * The styling surface: what each Tone renders as byte for byte, what a
 * Ui hands a command, and how the engine decides whether to colour at
 * all. What the block renderers do with all of it is blocks.test.ts.
 */
import { defineCommand, type Tone } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";
import { makeUi } from "../src/execution/command-context";
import { makePaint, renderText, textWidth } from "../src/execution/palette";

/**
 * A Record rather than a list, so a Tone added without a pinned
 * rendering fails to compile rather than going untested. Every value
 * here is the basic-ANSI sequence colorette emits for the verb the
 * contract's palette table names.
 */
const TONE_BYTES: Readonly<Record<Tone, string>> = {
  ok: "\u001b[92mX\u001b[39m",
  warn: "\u001b[33mX\u001b[39m",
  error: "\u001b[91mX\u001b[39m",
  info: "\u001b[34mX\u001b[39m",
  heading: "\u001b[36mX\u001b[39m",
  identifier: "\u001b[36mX\u001b[39m",
  ref: "\u001b[32mX\u001b[39m",
  placeholder: "\u001b[2mX\u001b[22m",
  link: "\u001b[34mX\u001b[39m",
  emphasis: "\u001b[1mX\u001b[22m",
  muted: "\u001b[2mX\u001b[22m",
  structure: "\u001b[2mX\u001b[22m",
  highlight: "\u001b[92mX\u001b[39m",
  "color-1": "\u001b[37mX\u001b[39m",
  "color-2": "\u001b[36mX\u001b[39m",
  "color-3": "\u001b[33mX\u001b[39m",
  "color-4": "\u001b[94mX\u001b[39m",
  "color-5": "\u001b[35mX\u001b[39m",
  "color-6": "\u001b[32mX\u001b[39m",
};

const INDEXED_TONES = [
  "color-1",
  "color-2",
  "color-3",
  "color-4",
  "color-5",
  "color-6",
] as const satisfies readonly Tone[];

const RED_SEQUENCES = ["\u001b[31m", "\u001b[91m"];

describe("the palette", () => {
  const paint = makePaint(true);
  const plain = makePaint(false);

  for (const [tone, bytes] of Object.entries(TONE_BYTES)) {
    test(`${tone} renders as ${JSON.stringify(bytes)} with colour on`, () => {
      expect(paint(tone as Tone, "X")).toBe(bytes);
    });

    test(`${tone} emits no bytes of its own with colour off`, () => {
      expect(plain(tone as Tone, "X")).toBe("X");
    });
  }

  test("no indexed colour is red, so a series member cannot read as an error", () => {
    for (const tone of INDEXED_TONES) {
      for (const red of RED_SEQUENCES) {
        expect(paint(tone, "X")).not.toContain(red);
      }
    }
  });
});

describe("rendering Text", () => {
  test("a bare string is untoned", () => {
    expect(renderText("plain", makePaint(true))).toBe("plain");
  });

  test("spans are painted individually and concatenated", () => {
    expect(
      renderText(
        [
          { text: "a", tone: "ok" },
          { text: "-" },
          { text: "b", tone: "error" },
        ],
        makePaint(true),
      ),
    ).toBe("\u001b[92ma\u001b[39m-\u001b[91mb\u001b[39m");
  });

  test("the same spans with colour off are the text alone", () => {
    expect(
      renderText(
        [
          { text: "a", tone: "ok" },
          { text: "-" },
          { text: "b", tone: "error" },
        ],
        makePaint(false),
      ),
    ).toBe("a-b");
  });

  test("width is the display width of the text, whatever the tones", () => {
    const spans = [
      { text: "用户", tone: "identifier" as const },
      { text: "!" },
    ];
    expect(textWidth(spans)).toBe(5);
    expect(textWidth("用户!")).toBe(5);
  });
});

/** A handler describes its text and never emits escape sequences; the
 *  engine is what turns the tone into bytes. */
const HEADING_SPAN = { text: "H", tone: "heading" } as const;

const styled = defineCommand({
  help: { summary: "Report what the styling surface resolved to" },
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: {} },
        {
          human: (ui) => [
            { kind: "summary", status: "ok", text: [HEADING_SPAN] },
            { kind: "list", items: [`width=${ui.width}`] },
          ],
          stdout: () => [],
          json: () => ({}),
          next: () => [],
        },
      ),
    ),
});

const HEADING_ON = "\u001b[36mH\u001b[39m";

function makeCli() {
  return createTestCli({ commands: { styled } });
}

/** Format is a separate question from colour — it asks whether stdout
 *  is a pipe — so these runs state it rather than letting a TTY pick. */
const HUMAN = ["styled", "--format", "human"];

describe("colour resolution", () => {
  test("colour is on when stderr is a terminal", async () => {
    const result = await makeCli().run(HUMAN, { isTty: { stderr: true } });
    expect(result.stderr).toContain(HEADING_ON);
  });

  test("colour is off when stderr is not a terminal", async () => {
    const result = await makeCli().run(HUMAN, { isTty: { stderr: false } });
    expect(result.stderr).toContain("✔ H\n");
  });

  test("stdout redirected to a file keeps colour on a terminal stderr", async () => {
    const result = await makeCli().run(HUMAN, {
      isTty: { stdout: false, stderr: true },
    });
    expect(result.stderr).toContain(HEADING_ON);
  });

  test("stderr redirected to a file loses colour on a terminal stdout", async () => {
    const result = await makeCli().run(HUMAN, {
      isTty: { stdout: true, stderr: false },
    });
    expect(result.stderr).toContain("✔ H\n");
  });

  test("NO_COLOR disables colour on a terminal", async () => {
    const result = await makeCli().run(HUMAN, {
      isTty: { stderr: true },
      env: { NO_COLOR: "1" },
    });
    expect(result.stderr).toContain("✔ H\n");
  });

  test("--color beats NO_COLOR, and does not need a terminal", async () => {
    const result = await makeCli().run([...HUMAN, "--color"], {
      isTty: { stderr: false },
      env: { NO_COLOR: "1" },
    });
    expect(result.stderr).toContain(HEADING_ON);
  });

  test("--no-color disables colour on a terminal", async () => {
    const result = await makeCli().run([...HUMAN, "--no-color"], {
      isTty: { stderr: true },
    });
    expect(result.stderr).toContain("✔ H\n");
  });
});

describe("ui.width", () => {
  test("is stderr's columns", async () => {
    const result = await makeCli().run(HUMAN, {
      isTty: { stderr: true },
      columns: { stderr: 100 },
    });
    expect(result.stderr).toContain("- width=100\n");
  });

  test("is unbounded when stderr is not a terminal", async () => {
    const result = await makeCli().run(HUMAN, { isTty: { stderr: false } });
    expect(result.stderr).toContain("- width=Infinity\n");
  });

  test("is stdout-blind: a terminal stdout does not supply the width", async () => {
    const result = await makeCli().run(HUMAN, {
      isTty: { stdout: true, stderr: false },
    });
    expect(result.stderr).toContain("- width=Infinity\n");
  });
});

describe("the Ui a command is handed", () => {
  /** A stream whose width the test can change under the Ui, which is
   *  what a terminal does when the user resizes the window. */
  function stream(columns?: number): {
    write(text: string): void;
    columns?: number;
  } {
    return { write: () => {}, columns };
  }

  test("width is read on every access, never cached at construction", () => {
    const stderr = stream(80);
    const ui = makeUi(false, stderr);

    expect(ui.width).toBe(80);
    stderr.columns = 40;
    expect(ui.width).toBe(40);
  });

  test("a stream that stops reporting a width goes back to unbounded", () => {
    const stderr = stream(80);
    const ui = makeUi(false, stderr);

    stderr.columns = undefined;
    expect(ui.width).toBe(Number.POSITIVE_INFINITY);
  });

  test("tone paints, and emphasize and dim keep the bytes they always emitted", () => {
    const ui = makeUi(true, stream());

    expect(ui.tone("heading", "H")).toBe(HEADING_ON);
    expect(ui.emphasize("X")).toBe("\u001b[1mX\u001b[22m");
    expect(ui.dim("X")).toBe("\u001b[2mX\u001b[22m");
    expect(ui.code("X")).toBe("`X`");
  });

  test("every verb is the identity function when colour is off", () => {
    const ui = makeUi(false, stream());

    expect(ui.tone("heading", "H")).toBe("H");
    expect(ui.emphasize("X")).toBe("X");
    expect(ui.dim("X")).toBe("X");
  });
});
