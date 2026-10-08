/**
 * A SIGTERM or SIGINT delivered while a prompt waits for the user
 * cancels the prompt with CLI.PROMPT_CANCELLED: exit 3 for SIGINT, as
 * Ctrl-C at the prompt, and 143 for SIGTERM. Without this a clack
 * prompt held the terminal until SIGKILL.
 */
import {
  createCli,
  defineCommand,
  type PromptSurface,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { describe, expect, test } from "vitest";

/** A terminal that never types anything and never closes. */
function silentStdin(rawMode: boolean): Runtime["stdin"] {
  return {
    ...(rawMode ? { setRawMode: () => {} } : {}),
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
      return: () => Promise.resolve({ done: true, value: undefined }),
    }),
  };
}

/** The first signal soon after the prompt shows, each further one a
 *  little later, so a handler that caught the cancel is waiting. */
function deliveryDelays(times: number): readonly number[] {
  return Array.from({ length: times }, (_unused, index) => 10 + index * 20);
}

async function runSignalled(
  ask: (prompt: PromptSurface) => Promise<unknown>,
  signal: "SIGINT" | "SIGTERM",
  rawMode: boolean,
  times = 1,
) {
  const probe = defineCommand({
    help: { summary: "Prompt probe" },
    handler: async (_args, ctx) => {
      const answer = await ask(ctx.prompt);
      return ok(
        ctx.present(
          { data: { answer } },
          {
            human: () => [],
            stdout: () => [],
            json: () => ({ answer }),
            next: () => [],
          },
        ),
      );
    },
  });
  const cli = createCli({
    name: "probe",
    version: "0.0.0",
    commandFamilies: [],
    groups: {},
    commands: { probe },
  });
  let deliver: ((signal: "SIGINT" | "SIGTERM") => void) | undefined;
  const exits: string[] = [];
  const deliverRecording = (): void => {
    try {
      deliver?.(signal);
    } catch (cause) {
      exits.push(String(cause));
    }
  };
  let stderr = "";
  const runtime: Runtime = {
    stdout: { write: () => {} },
    stderr: {
      write: (text) => {
        stderr += text;
        if (text.includes("Proceed?")) {
          for (const delay of deliveryDelays(times)) {
            setTimeout(deliverRecording, delay);
          }
        }
      },
    },
    stdin: silentStdin(rawMode),
    cwd: "/",
    env: {},
    isTty: { stdin: true, stdout: true, stderr: true },
    exit: (code: number): never => {
      throw new Error(`runtime.exit(${code})`);
    },
    onSignal: (cb) => {
      deliver = cb;
      return () => {
        deliver = undefined;
      };
    },
    loadConfig: async () => ({ files: [], diagnostics: [] }),
    managementApi: { baseUrl: "https://test.invalid" },
    host: {
      runtime: { name: "node", version: "v22.12.0" },
      platform: "linux",
      arch: "x64",
    },
  };
  const exitCode = await cli.run(["probe"], runtime);
  return { exitCode, stderr, exits };
}

describe("a signal while a prompt waits", () => {
  test.each([
    ["SIGTERM", "clack", 143, true],
    ["SIGINT", "clack", 3, true],
    ["SIGTERM", "line", 143, false],
    ["SIGINT", "line", 3, false],
  ] as const)("%s at a %s prompt cancels it, exit %s", async (signal, _tier, exitCode, rawMode) => {
    const result = await runSignalled(
      (prompt) => prompt.text("Proceed?"),
      signal,
      rawMode,
    );

    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr).toContain("CLI.PROMPT_CANCELLED");
    expect(result.exits).toEqual([]);
  });

  test.each([
    ["SIGTERM", "runtime.exit(143)"],
    ["SIGINT", "runtime.exit(130)"],
  ] as const)("after %s cancels a prompt the handler catches, the next signal force-exits", async (signal, exit) => {
    const catchAndWait = async (prompt: PromptSurface) => {
      try {
        return await prompt.text("Proceed?");
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "caught";
      }
    };
    const result = await runSignalled(catchAndWait, signal, true, 2);

    expect(result.exits).toEqual([`Error: ${exit}`]);
  });

  test("a prompt after a cancelled one is cancelled at once", async () => {
    const askTwice = async (prompt: PromptSurface) => {
      try {
        await prompt.text("Proceed?");
      } catch {
        return prompt.text("Again?");
      }
    };
    const result = await runSignalled(askTwice, "SIGINT", true);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("CLI.PROMPT_CANCELLED");
  });
});
