/**
 * A SIGTERM or SIGINT delivered while a prompt waits for the user
 * cancels the prompt, as Ctrl-C at the prompt does: CLI.PROMPT_CANCELLED,
 * exit 3. Without this a clack prompt held the terminal until SIGKILL.
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

async function runSignalled(
  ask: (prompt: PromptSurface) => Promise<unknown>,
  signal: "SIGINT" | "SIGTERM",
  rawMode: boolean,
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
  let stderr = "";
  const runtime: Runtime = {
    stdout: { write: () => {} },
    stderr: {
      write: (text) => {
        stderr += text;
        if (text.includes("Proceed?")) {
          setTimeout(() => deliver?.(signal), 10);
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
  return { exitCode, stderr };
}

describe("a signal while a prompt waits", () => {
  test.each([
    ["SIGTERM", "clack", true],
    ["SIGINT", "clack", true],
    ["SIGTERM", "line", false],
  ] as const)("%s at a %s prompt cancels it, exit 3", async (signal, _tier, rawMode) => {
    const result = await runSignalled(
      (prompt) => prompt.text("Proceed?"),
      signal,
      rawMode,
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("CLI.PROMPT_CANCELLED");
  });
});
