import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildLogsOptions } from "../src/controllers/build";

const BUILD_ID = "bld_123";

interface GetResult {
  data: ReadableStream<Uint8Array> | null;
  response: { ok: boolean; status: number };
}

function ndjsonStream(lines: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

function streamResult(lines: unknown[]): GetResult {
  return { data: ndjsonStream(lines), response: { ok: true, status: 200 } };
}

function errorResult(status: number): GetResult {
  return { data: null, response: { ok: false, status } };
}

function logLine(text: string, cursor: string) {
  return {
    type: "log" as const,
    text,
    level: "info" as const,
    source: "stdout" as const,
    cursor,
  };
}

function retryableTerminal(cursor: string | null) {
  return {
    type: "terminal" as const,
    kind: "error" as const,
    code: "upstream_error",
    message: "Failed to read build logs.",
    retryable: true,
    cursor,
  };
}

async function runWithClient(
  get: ReturnType<typeof vi.fn>,
  options: BuildLogsOptions = {},
) {
  vi.doMock("../src/lib/auth/guard", () => ({
    requireComputeAuth: vi.fn().mockResolvedValue({ token: "t", GET: get }),
  }));

  const { createTestCommandContext } = await import("./helpers");
  const { runBuildLogs } = await import("../src/controllers/build");
  const { context, stdout, stderr } = await createTestCommandContext({
    isTTY: false,
    env: { PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
  });

  // backoffMs of zeros keeps the retry budget at 3 attempts without real waits.
  const run = runBuildLogs(context, BUILD_ID, options, { backoffMs: [0, 0] });
  return { run, stdout, stderr };
}

function queryOf(call: unknown[]): Record<string, unknown> {
  const [, init] = call as [
    string,
    { params: { query: Record<string, unknown> } },
  ];
  return init.params.query;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock("../src/lib/auth/guard");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("build logs controller", () => {
  it("maps a 401 to the shared auth-required error", async () => {
    const get = vi.fn().mockResolvedValue(errorResult(401));
    const { run } = await runWithClient(get);

    await expect(run).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      domain: "auth",
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable terminal error and resumes from the cursor", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(
        streamResult([logLine("first", "c1"), retryableTerminal("c1")]),
      )
      .mockResolvedValueOnce(
        streamResult([
          logLine("second", "c2"),
          {
            type: "terminal",
            kind: "end",
            code: "end",
            retryable: false,
            cursor: "c2",
            message: "",
          },
        ]),
      );
    const { run, stdout } = await runWithClient(get);

    await run;

    expect(process.exitCode).toBeUndefined();
    expect(stdout.buffer).toContain("first");
    expect(stdout.buffer).toContain("second");
    expect(get).toHaveBeenCalledTimes(2);
    expect(queryOf(get.mock.calls[0])).not.toHaveProperty("cursor");
    expect(queryOf(get.mock.calls[1])).toMatchObject({ cursor: "c1" });
  });

  it("exits non-zero and surfaces the message once when every attempt fails", async () => {
    const get = vi
      .fn()
      .mockImplementation(async () => streamResult([retryableTerminal("c1")]));
    const { run, stderr } = await runWithClient(get);

    await run;

    expect(process.exitCode).toBe(1);
    expect(get).toHaveBeenCalledTimes(3);
    const occurrences =
      stderr.buffer.split("Failed to read build logs.").length - 1;
    expect(occurrences).toBe(1);
  });

  it("reconnects a dropped --follow stream from the cursor", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(
        streamResult([logLine("a", "c1"), retryableTerminal("c1")]),
      )
      .mockResolvedValueOnce(streamResult([logLine("b", "c2")]));
    const { run, stdout } = await runWithClient(get, { follow: true });

    await run;

    expect(process.exitCode).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
    expect(queryOf(get.mock.calls[0])).toMatchObject({ follow: "true" });
    expect(queryOf(get.mock.calls[1])).toMatchObject({
      follow: "true",
      cursor: "c1",
    });
    expect(stdout.buffer).toContain("a");
    expect(stdout.buffer).toContain("b");
  });

  it("retries a transient open status and then succeeds", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(errorResult(503))
      .mockResolvedValueOnce(streamResult([logLine("ok", "c1")]));
    const { run, stdout } = await runWithClient(get);

    await run;

    expect(process.exitCode).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
    expect(stdout.buffer).toContain("ok");
  });

  it("does not retry a 404 and surfaces BUILD_NOT_FOUND", async () => {
    const get = vi.fn().mockResolvedValue(errorResult(404));
    const { run } = await runWithClient(get);

    await expect(run).rejects.toMatchObject({ code: "BUILD_NOT_FOUND" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable terminal end", async () => {
    const get = vi.fn().mockResolvedValue(
      streamResult([
        logLine("only", "c1"),
        {
          type: "terminal",
          kind: "end",
          code: "no_logs",
          retryable: false,
          cursor: "c1",
          message: "No logs were produced.",
        },
      ]),
    );
    const { run, stdout, stderr } = await runWithClient(get);

    await run;

    expect(process.exitCode).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
    expect(stdout.buffer).toContain("only");
    expect(stderr.buffer).toContain("No logs were produced.");
  });
});
