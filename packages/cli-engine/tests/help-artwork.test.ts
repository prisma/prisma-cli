import { describe, expect, test, vi } from "vitest";
import { defineCommand } from "../src/commands";
import { renderArtworkLine, revealArtwork } from "../src/help-artwork";
import { createTestCli } from "../src/testing";

const artwork = [
  [
    { text: "CC", rgb: [4, 213, 231] },
    { text: "RR", rgb: [254, 67, 82] },
    { text: "YY", rgb: [254, 190, 41] },
    { text: " Prisma" },
  ],
] as const;
const commands = {
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
  test.each([
    [0, "       Prisma"],
    [1 / 6, "C      Prisma"],
    [1 / 3, "CC     Prisma"],
    [1 / 2, "CCR    Prisma"],
    [2 / 3, "CCRR   Prisma"],
    [1, "CCRRYY Prisma"],
  ])("paints ordered bands at progress %s without moving the wordmark", (progress, expected) => {
    const frame = revealArtwork(artwork, progress);
    expect(frame?.map((line) => renderArtworkLine(line, false))).toEqual([
      expected,
    ]);
  });

  test("paces frames and restores the cursor before exiting", async () => {
    const delay = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
    const cli = createTestCli({ commands, help: { artwork }, delay });
    const result = await cli.run(["--help"], terminal);
    expect(result.exitCode).toBe(0);
    expect(delay).toHaveBeenCalledTimes(30);
    expect(delay.mock.calls.every(([ms]) => ms === 20)).toBe(true);
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

  test("interruption finishes the logo and restores the cursor", async () => {
    const controller = new AbortController();
    const cli = createTestCli({
      commands,
      help: { artwork },
      delay: async () => {
        controller.abort();
      },
    });
    const result = await cli.run(["--help"], {
      ...terminal,
      abort: controller.signal,
    });
    expect(result.exitCode).toBe(130);
    expect(result.stdout.endsWith("\u001b[?25h")).toBe(true);
  });
});
