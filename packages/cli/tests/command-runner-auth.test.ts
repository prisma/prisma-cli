import { AuthError as SDKAuthError } from "@prisma/management-api-sdk";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { runCommand, runStreamingCommand } from "../src/shell/command-runner";
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

  return {
    runtime: {
      argv,
      cwd: await createTempCwd(),
      env: { ...process.env },
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
    },
    stdout,
    stderr,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("command runner auth errors", () => {
  it("renders SDK auth failures as structured CLI errors", async () => {
    const { runtime, stderr } = await createRuntime(["auth", "whoami"]);

    await runCommand(
      runtime,
      "auth.whoami",
      {},
      async () => {
        throw new SDKAuthError("invalid_grant: Invalid grant", true);
      },
      {
        renderHuman: () => [],
      },
    );

    expect(process.exitCode).toBe(1);
    expect(stderr.buffer).toContain("Authentication required [AUTH_REQUIRED]");
    expect(stderr.buffer).toContain("Next step:");
    expect(stderr.buffer).toContain("prisma-cli auth login");
    expect(stderr.buffer).not.toContain("invalid_grant");
  });

  it("shows SDK auth details only with trace enabled", async () => {
    const { runtime, stderr } = await createRuntime(["auth", "whoami", "--trace"]);

    await runCommand(
      runtime,
      "auth.whoami",
      {},
      async () => {
        throw new SDKAuthError("invalid_grant: Invalid grant", true);
      },
      {
        renderHuman: () => [],
      },
    );

    expect(stderr.buffer).toContain("Trace:");
    expect(stderr.buffer).toContain("invalid_grant: Invalid grant");
  });

  it("renders streaming SDK auth failures as JSON events", async () => {
    const { runtime, stdout } = await createRuntime(["--json", "app", "deploy"]);

    await runStreamingCommand(runtime, "app.deploy", {}, async () => {
      throw new SDKAuthError("invalid_grant: Invalid grant", true);
    });

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout.buffer)).toMatchObject({
      type: "error",
      command: "app.deploy",
      error: {
        code: "AUTH_REQUIRED",
        domain: "auth",
      },
      nextSteps: ["prisma-cli auth login"],
    });
  });
});
