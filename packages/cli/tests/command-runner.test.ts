import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../src/shell/command-runner";
import type { CliRuntime } from "../src/shell/runtime";
import { createTempCwd } from "./helpers";

class CaptureStream extends Writable {
  buffer = "";
  declare isTTY?: boolean;
  declare columns?: number;
  declare rows?: number;

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.buffer += chunk.toString();
    callback();
  }
}

class CaptureInput extends PassThrough {
  declare isTTY?: boolean;
  setRawMode(_value: boolean) {
    return this;
  }
}

async function createRuntime(argv: string[]): Promise<{
  runtime: CliRuntime;
  controller: AbortController;
  stdout: CaptureStream;
  stderr: CaptureStream;
}> {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  stdout.isTTY = false;
  stderr.isTTY = false;
  stdout.columns = 80;
  stderr.columns = 80;
  stdout.rows = 24;
  stderr.rows = 24;

  const stdin = new CaptureInput();
  stdin.isTTY = false;
  stdin.end();
  const controller = new AbortController();

  return {
    runtime: {
      argv,
      cwd: await createTempCwd(),
      env: { ...process.env },
      signal: controller.signal,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
    },
    controller,
    stdout,
    stderr,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("command runner success output", () => {
  it("adds local diagnostics to successful verbose human output", async () => {
    const { runtime, stderr } = await createRuntime(["project", "show", "--verbose"]);

    await runCommand(
      runtime,
      "project.show",
      {},
      async () => ({
        command: "project.show",
        result: { ok: true },
        warnings: [],
        nextSteps: [],
      }),
      {
        renderHuman: () => ["Project linked"],
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(stderr.buffer).toContain("Project linked");
    expect(stderr.buffer).toContain("Local context:");
    expect(stderr.buffer).toContain("duration:");
    expect(stderr.buffer).toContain("cwd:");
    expect(stderr.buffer).toContain("state file:");
    expect(stderr.buffer).toContain("git:");
    expect(stderr.buffer).not.toContain("DATABASE_URL");
  });

  it("keeps successful verbose output when post-success diagnostics abort", async () => {
    const { runtime, controller, stderr } = await createRuntime(["project", "show", "--verbose"]);

    await runCommand(
      runtime,
      "project.show",
      {},
      async () => {
        controller.abort();
        return {
          command: "project.show",
          result: { ok: true },
          warnings: [],
          nextSteps: [],
        };
      },
      {
        renderHuman: () => ["Project linked"],
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(stderr.buffer).toContain("Project linked");
    expect(stderr.buffer).not.toContain("COMMAND_CANCELED");
    expect(stderr.buffer).not.toContain("Local context:");
  });

  it("does not add local diagnostics to successful JSON output", async () => {
    const { runtime, stdout, stderr } = await createRuntime(["project", "show", "--verbose", "--json"]);

    await runCommand(
      runtime,
      "project.show",
      { verbose: true, json: true },
      async () => ({
        command: "project.show",
        result: { ok: true },
        warnings: [],
        nextSteps: [],
      }),
      {
        renderHuman: () => ["Project linked"],
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(stderr.buffer).toBe("");
    expect(JSON.parse(stdout.buffer)).toMatchObject({
      ok: true,
      command: "project.show",
      result: { ok: true },
    });
    expect(stdout.buffer).not.toContain("Local context");
  });
});
