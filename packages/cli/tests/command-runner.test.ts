import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../src/shell/command-runner";
import type { CliRuntime } from "../src/shell/runtime";
import { createTempCwd } from "./helpers";

interface CapturedWrite {
  stream: "stdout" | "stderr";
  chunk: string;
}

class CaptureStream extends Writable {
  buffer = "";
  declare isTTY?: boolean;
  declare columns?: number;
  declare rows?: number;

  constructor(
    private readonly streamName?: "stdout" | "stderr",
    private readonly writes?: CapturedWrite[],
  ) {
    super();
  }

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    const text = chunk.toString();
    this.buffer += text;
    if (this.streamName && this.writes) {
      this.writes.push({ stream: this.streamName, chunk: text });
    }
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
  writes: CapturedWrite[];
}> {
  const writes: CapturedWrite[] = [];
  const stdout = new CaptureStream("stdout", writes);
  const stderr = new CaptureStream("stderr", writes);
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
    writes,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("command runner success output", () => {
  it("adds local diagnostics to successful verbose human output", async () => {
    const { runtime, stderr } = await createRuntime([
      "project",
      "show",
      "--verbose",
    ]);

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
    const { runtime, controller, stderr } = await createRuntime([
      "project",
      "show",
      "--verbose",
    ]);

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
    const { runtime, stdout, stderr } = await createRuntime([
      "project",
      "show",
      "--verbose",
      "--json",
    ]);

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

  it("writes human stderr before raw stdout when both are rendered", async () => {
    const { runtime, stdout, stderr, writes } = await createRuntime([
      "project",
      "show",
    ]);

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
        renderStdout: () => ["raw-value"],
        renderHuman: () => ["Created resource"],
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(stderr.buffer).toBe("Created resource\n\n");
    expect(stdout.buffer).toBe("raw-value\n");
    expect(writes.map((write) => write.stream)).toEqual(["stderr", "stdout"]);
  });

  it("suppresses human output in quiet mode while preserving raw stdout", async () => {
    const { runtime, stdout, stderr, writes } = await createRuntime([
      "project",
      "show",
      "--quiet",
    ]);
    let renderHumanCalled = false;

    await runCommand(
      runtime,
      "project.show",
      { quiet: true },
      async () => ({
        command: "project.show",
        result: { ok: true },
        warnings: [],
        nextSteps: [],
      }),
      {
        renderStdout: () => ["raw-value"],
        renderHuman: () => {
          renderHumanCalled = true;
          return ["Created resource"];
        },
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(renderHumanCalled).toBe(false);
    expect(stderr.buffer).toBe("");
    expect(stdout.buffer).toBe("raw-value\n");
    expect(writes.map((write) => write.stream)).toEqual(["stdout"]);
  });

  it("bypasses raw stdout and human output in JSON mode", async () => {
    const { runtime, stdout, stderr } = await createRuntime([
      "project",
      "show",
      "--json",
    ]);
    let renderStdoutCalled = false;
    let renderHumanCalled = false;

    await runCommand(
      runtime,
      "project.show",
      { json: true },
      async () => ({
        command: "project.show",
        result: { ok: true },
        warnings: [],
        nextSteps: [],
      }),
      {
        renderStdout: () => {
          renderStdoutCalled = true;
          return ["raw-value"];
        },
        renderHuman: () => {
          renderHumanCalled = true;
          return ["Created resource"];
        },
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(renderStdoutCalled).toBe(false);
    expect(renderHumanCalled).toBe(false);
    expect(stderr.buffer).toBe("");
    expect(JSON.parse(stdout.buffer)).toMatchObject({
      ok: true,
      command: "project.show",
      result: { ok: true },
    });
    expect(stdout.buffer).not.toContain("raw-value");
    expect(stdout.buffer).not.toContain("Created resource");
  });
});
