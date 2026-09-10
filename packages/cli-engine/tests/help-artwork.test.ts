import { stripVTControlCharacters } from "node:util";
import { describe, expect, test, vi } from "vitest";
import { defineCommand } from "../src/commands";
import { addArtwork, writeArtworkFrames } from "../src/execution/artwork";
import { ok } from "../src/protocol";
import { createTestCli } from "../src/testing";

const CURSOR_UP = /\[\d+A/;

const artwork = [
  [
    { text: "CC", color: "cyan" },
    { text: "RR", color: "redBright" },
    { text: "YY", color: "yellow" },
    { text: " Prisma" },
  ],
] as const;
const initRun = vi.fn();
const commands = {
  init: defineCommand({
    help: { summary: "Initialize" },
    args: { flags: {}, positionals: {} },
    handler: async (_args, ctx) => {
      initRun();
      return ok(
        ctx.present(
          { data: null },
          {
            human: () => [
              { kind: "summary", status: "ok", text: "Initialized" },
            ],
            stdout: () => [],
            json: () => null,
            next: () => [],
          },
        ),
      );
    },
  }),
  example: defineCommand({
    help: { summary: "Example" },
    args: { flags: {}, positionals: {} },
    handler: async () => {
      throw new Error("Help must not execute commands");
    },
  }),
};
const terminal = {
  isTty: { stdout: true },
  columns: { stdout: 200 },
  rows: { stdout: 30 },
  env: { TERM: "xterm-256color" },
};

describe("help artwork painting", () => {
  test("restores the cursor after displaying animated help", async () => {
    const cli = createTestCli({ commands, help: { artwork } });
    const result = await cli.run(["--help"], terminal);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("\u001b[?25l");
    expect(result.stdout.endsWith("\u001b[?25h")).toBe(true);
  });

  test.each([
    { env: { PRISMA_REDUCED_MOTION: "1" } },
    { env: { NO_COLOR: "1" } },
    { env: { TERM: "dumb" } },
    { isCI: true },
    { isTty: { stdout: false } },
    { rows: { stdout: 3 } },
  ])("keeps output static with %j", async (options) => {
    const delay = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
    const cli = createTestCli({ commands, help: { artwork }, delay });
    const result = await cli.run(["--help"], { ...terminal, ...options });
    expect(delay).not.toHaveBeenCalled();
    expect(result.stdout).not.toContain("\u001b[?25l");
  });

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s finishes the logo and restores the cursor", async (signal, exitCode) => {
    const controller = new AbortController();
    const cli = createTestCli({
      commands,
      help: { artwork },
      delay: async () => {
        controller.abort(signal);
      },
    });
    const result = await cli.run(["--help"], {
      ...terminal,
      abort: controller.signal,
    });
    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout.endsWith("\u001b[?25h")).toBe(true);
  });
});

const initTerminal = {
  ...terminal,
  isTty: { stdin: true, stdout: true, stderr: true },
  columns: { stdout: 80, stderr: 80 },
  rows: { stdout: 24, stderr: 24 },
};
const initHelp = { artwork, artworkCommands: ["init"] };

test("init paints on stderr before the command result", async () => {
  const cli = createTestCli({ commands, help: initHelp });
  const result = await cli.run(["init"], initTerminal);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("\u001b[?25l");
  const plain = stripVTControlCharacters(result.stderr);
  expect(plain).toContain("CCRRYY Prisma");
  expect(plain.indexOf("CCRRYY Prisma")).toBeLessThan(
    plain.indexOf("Initialized"),
  );
});

test.each([
  [],
  ["example", "--help"],
  ["init", "--help"],
  ["init", "--json"],
  ["init", "--quiet"],
  ["init", "--unknown"],
])("omits artwork for %j", async (...argv) => {
  const cli = createTestCli({ commands, help: initHelp });
  const result = await cli.run(argv, initTerminal);
  expect(stripVTControlCharacters(result.stdout + result.stderr)).not.toContain(
    "CCRRYY Prisma",
  );
  expect(result.stdout + result.stderr).not.toContain("\u001b[?25l");
});

test("interrupting the init intro prevents the handler from running", async () => {
  initRun.mockClear();
  const controller = new AbortController();
  const cli = createTestCli({
    commands,
    help: initHelp,
    delay: async () => controller.abort("SIGTERM"),
  });
  const result = await cli.run(["init"], {
    ...initTerminal,
    abort: controller.signal,
  });
  expect(result.exitCode).toBe(143);
  expect(initRun).not.toHaveBeenCalled();
  expect(result.stderr).toContain("\u001b[?25h");
});

test("help and init isolate the same wordmark styling from surrounding output", async () => {
  const cli = createTestCli({ commands, help: initHelp });
  const options = { ...initTerminal, env: { PRISMA_REDUCED_MOTION: "1" } };
  const help = await cli.run(["--help"], options);
  const init = await cli.run(["init"], options);
  const helpRow = help.stdout
    .split("\n")
    .find((line) => line.includes(" Prisma"));
  const helpLogo = helpRow?.slice(helpRow.indexOf("\u001b[0m"));
  expect(helpLogo).toBeDefined();
  expect(helpLogo?.startsWith("\u001b[0m\u001b[1m")).toBe(true);
  expect(helpLogo?.endsWith(" Prisma\u001b[22m\u001b[0m")).toBe(true);
  expect(init.stderr).toContain(helpLogo);
});

test.each([
  "columns",
  "rows",
] as const)("stops cursor rewrites when terminal %s change", async (dimension) => {
  const size = { columns: 80, rows: 24 };
  const writes: string[] = [];
  const out = {
    get columns() {
      return size.columns;
    },
    get rows() {
      return size.rows;
    },
    write: (text: string) => {
      writes.push(text);
    },
  };
  const delay = vi.fn(async () => {
    size[dimension] = 5;
  });
  await writeArtworkFrames({
    out,
    animate: true,
    delay,
    signal: new AbortController().signal,
    render: (progress) => {
      const lines = ["Help", "", "Commands"];
      const rows = addArtwork(lines, artwork, out.columns, true, progress);
      return { text: `${lines.join("\n")}\n`, rows };
    },
  });
  expect(delay).toHaveBeenCalledTimes(1);
  expect(writes.slice(1).join("")).not.toMatch(CURSOR_UP);
  expect(writes.slice(1).join("")).toContain("Help");
  expect(writes.at(-1)).toBe("\u001b[?25h");
  expect(writes.slice(1).join("").includes("Prisma")).toBe(
    dimension === "rows",
  );
});
