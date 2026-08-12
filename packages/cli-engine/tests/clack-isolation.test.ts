/**
 * Proves the scripted and non-TTY prompt paths never load
 * @clack/prompts. The module is mocked with a factory that records the
 * load and throws, so any run that reaches the dynamic import both
 * flips the flag and fails. A clack-capable run validates the spy
 * mechanism itself (the canary).
 */
import {
  type Block,
  createCli,
  defineCommand,
  type PromptSurface,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test, vi } from "vitest";

const clackLoad = vi.hoisted(() => ({ attempted: false }));

vi.mock("@clack/prompts", () => {
  clackLoad.attempted = true;
  throw new Error("@clack/prompts must not load on this path");
});

const EPOCH = () => new Date(0);

function promptCommand(run: (prompt: PromptSurface) => Promise<unknown>) {
  return defineCommand({
    help: { summary: "Prompt probe" },
    handler: async (_args, ctx) => {
      const answer = await run(ctx.prompt);
      return ok(
        ctx.present(
          { data: { answer } },
          {
            human: (): readonly Block[] => [
              { kind: "summary", status: "ok", text: `answer=${answer}` },
            ],
          },
        ),
      );
    },
  });
}

const confirming = (prompt: PromptSurface) =>
  prompt.confirm("Proceed?", { default: true });

describe("scripted and non-TTY paths are clack-free", () => {
  test("scripted answers on a TTY use the plain renderer, no clack load", async () => {
    const cli = createTestCli({
      commands: { probe: promptCommand(confirming) },
      now: EPOCH,
    });
    const result = await cli.run(["probe"], {
      isTty: { stdin: true, stdout: true },
      answers: ["n"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: false });
    expect(clackLoad.attempted).toBe(false);
  });

  test("a piped TTY-flagged stdin without setRawMode stays plain", async () => {
    const cli = createTestCli({
      commands: { probe: promptCommand(confirming) },
      now: EPOCH,
    });
    const result = await cli.run(["probe"], {
      isTty: { stdin: true, stdout: true },
      stdin: "y\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toContain("? Proceed? (Y/n) ");
    expect(clackLoad.attempted).toBe(false);
  });

  test("a non-TTY run resolves defaults without any renderer", async () => {
    const cli = createTestCli({
      commands: { probe: promptCommand(confirming) },
      now: EPOCH,
    });
    const result = await cli.run(["probe", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(clackLoad.attempted).toBe(false);
  });

  test("canary: a raw-mode-capable TTY run does reach the clack import", async () => {
    let stderr = "";
    const runtime: Runtime = {
      stdout: { write: () => {} },
      stderr: {
        write: (text) => {
          stderr += text;
        },
      },
      stdin: {
        setRawMode: () => {},
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
          return: async (): Promise<IteratorResult<Uint8Array>> => ({
            done: true,
            value: undefined,
          }),
        }),
      },
      cwd: "/",
      env: {},
      isTty: { stdin: true, stdout: true, stderr: true },
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
      loadConfig: async () => ({
        path: "/prisma.config.ts",
        sections: {},
        diagnostics: [],
      }),
      managementApi: { baseUrl: "https://test.invalid" },
    };
    const cli = createCli({
      name: "probe",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { probe: promptCommand(confirming) },
    });

    const exitCode = await cli.run(["probe"], runtime);

    expect(clackLoad.attempted).toBe(true);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CLI.INTERNAL_ERROR");
  });
});
