import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import { makeServiceCli, type Routes, SIGNED_IN } from "./v8-service-testkit";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
});

type Record_ =
  | {
      type: "log";
      text: string;
      level: "info" | "error";
      source: "runner" | "stdout" | "stderr";
      step?: string;
      cursor: string;
    }
  | {
      type: "terminal";
      kind: "end" | "error";
      code: string;
      message: string;
      retryable: boolean;
      cursor: string | null;
    };

/** Chunks that ignore record boundaries: every record is cut in half
 *  and the last one carries no trailing newline, so each stream drives
 *  both the reader's partial-line buffer and its end-of-stream tail. */
function ndjsonStream(records: Record_[]): ReadableStream<Uint8Array> {
  return chunkedStream(
    records.flatMap((record, index) => {
      const line = JSON.stringify(record);
      const split = Math.floor(line.length / 2);
      return [
        line.slice(0, split),
        line.slice(split) + (index === records.length - 1 ? "" : "\n"),
      ];
    }),
  );
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function log(
  text: string,
  overrides: Partial<Extract<Record_, { type: "log" }>> = {},
): Record_ {
  return {
    type: "log",
    text,
    level: "info",
    source: "stdout",
    cursor: "1",
    ...overrides,
  };
}

const END: Record_ = {
  type: "terminal",
  kind: "end",
  code: "end",
  message: "stream complete",
  retryable: false,
  cursor: "9",
};

function logRoutes(
  records: Record_[],
  capture?: (query: Record<string, unknown> | undefined) => void,
): Routes {
  return {
    "GET /v1/builds/{buildId}/logs": (init) => {
      capture?.(init.params?.query);
      return { data: ndjsonStream(records) };
    },
  };
}

function outputs(events: readonly { kind: string }[]) {
  return events
    .filter((event) => event.kind === "output")
    .map((event) => {
      const output = event as unknown as { channel: string; line: string };
      return { channel: output.channel, line: output.line };
    });
}

function outputData(events: readonly { kind: string }[]) {
  return events
    .filter((event) => event.kind === "output")
    .map((event) => (event as unknown as { data?: unknown }).data);
}

describe("prisma-v8 build logs", () => {
  it("streams every log record in order, routed by source and level", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([
        log("installing dependencies"),
        log("warning: peer dep", { source: "stderr" }),
        log("build failed to lint", { level: "error" }),
        log("runner note", { source: "runner", step: "prepare" }),
        END,
      ]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toEqual([
      { channel: "diagnostic", line: "Streaming logs for build bld_1" },
      { channel: "data", line: "installing dependencies" },
      { channel: "diagnostic", line: "warning: peer dep" },
      { channel: "diagnostic", line: "build failed to lint" },
      { channel: "data", line: "runner note" },
    ]);
  });

  it("reassembles records split across chunks, with no trailing newline", async () => {
    const body = [log("first"), log("second"), END]
      .map((record) => JSON.stringify(record))
      .join("\n");
    const harness = await makeServiceCli({
      routes: {
        // One chunk per character: every record spans many chunks and the
        // stream ends mid-line, so the reader's buffer and its
        // end-of-stream tail both have to work.
        "GET /v1/builds/{buildId}/logs": () => ({
          data: chunkedStream([...body]),
        }),
      },
    });

    const result = await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toEqual([
      { channel: "diagnostic", line: "Streaming logs for build bld_1" },
      { channel: "data", line: "first" },
      { channel: "data", line: "second" },
    ]);
  });

  it("carries each record's cursor, level, source and step in the event data", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([
        log("installing", { cursor: "12" }),
        log("runner note", { source: "runner", step: "prepare", cursor: "13" }),
        END,
      ]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputData(result.events)).toEqual([
      undefined,
      { cursor: "12", level: "info", source: "stdout" },
      { cursor: "13", level: "info", source: "runner", step: "prepare" },
    ]);
  });

  it("carries a reported terminal record's cursor, code and retryable", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([
        {
          type: "terminal",
          kind: "end",
          code: "no_logs",
          message: "This build produced no logs.",
          retryable: false,
          cursor: "9",
        },
      ]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputData(result.events)).toEqual([
      undefined,
      { cursor: "9", code: "no_logs", retryable: false },
    ]);
  });

  it("writes log text to stdout and everything else to stderr", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([
        log("compiled ok"),
        log("deprecation notice", { source: "stderr" }),
        END,
      ]),
    });

    // Sessions default to json when stdout is not a TTY; this case is
    // about the human rendering, so it asks for it explicitly.
    const result = await harness.cli.run(
      ["build", "logs", "bld_1", "--format", "human"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.stdout).toBe("compiled ok\n");
    expect(result.stderr).toContain("deprecation notice");
    expect(result.stderr).toContain("Streaming logs for build bld_1");
  });

  it("says nothing extra for a terminal end, but surfaces any other terminal message", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([
        {
          type: "terminal",
          kind: "end",
          code: "no_logs",
          message: "This build produced no logs.",
          retryable: false,
          cursor: null,
        },
      ]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(outputs(result.events)).toContainEqual({
      channel: "diagnostic",
      line: "This build produced no logs.",
    });
  });

  it("frames every record in json mode and terminates with one result frame", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([log("first"), log("second"), END]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1", "--json"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    const kinds = result.json.map((frame) => frame.kind);
    expect(kinds).toEqual(["output", "output", "output", "result"]);
    const last = result.json[result.json.length - 1];
    if (last?.kind !== "result" || !last.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(last.envelope.commandId).toBe("build.logs");
    expect(result.stdout).not.toContain("first\n\n");
  });

  it("passes --follow and --cursor through to the request", async () => {
    let query: Record<string, unknown> | undefined;
    const harness = await makeServiceCli({
      routes: logRoutes([END], (captured) => {
        query = captured;
      }),
    });

    const result = await harness.cli.run(
      ["build", "logs", "bld_1", "--follow", "--cursor", "4096"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(query).toEqual({ follow: "true", cursor: "4096" });
  });

  it("sends neither query parameter when the flags are absent", async () => {
    let query: Record<string, unknown> | undefined;
    const harness = await makeServiceCli({
      routes: logRoutes([END], (captured) => {
        query = captured;
      }),
    });

    await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(query).toEqual({});
  });

  it("reports a terminal error record as a failed build, after streaming its logs", async () => {
    const harness = await makeServiceCli({
      routes: logRoutes([
        log("step 1 ok"),
        {
          type: "terminal",
          kind: "error",
          code: "build_failed",
          message: "The build step exited with status 1.",
          retryable: false,
          cursor: "77",
        },
      ]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1", "--json"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    // ESCALATED: legacy exited 1 here. A session command cannot settle a
    // non-zero exit from a record, so the failure settles as an errored
    // envelope (exit 2) instead. Recorded in the divergence file.
    expect(result.exitCode).toBe(2);
    expect(outputs(result.events)).toContainEqual({
      channel: "data",
      line: "step 1 ok",
    });
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("BUILD.FAILED");
    expect(frame.envelope.error.why).toBe(
      "The build step exited with status 1.",
    );
    expect(frame.envelope.error.meta).toMatchObject({
      code: "build_failed",
      cursor: "77",
    });
    expect(
      frame.envelope.error.nextActions.some((action) =>
        action.command?.includes("--cursor 77"),
      ),
    ).toBe(true);
  });

  it("settles an unknown build as BUILD.NOT_FOUND", async () => {
    const harness = await makeServiceCli({
      routes: {
        "GET /v1/builds/{buildId}/logs": () => ({
          error: { error: { message: "not found" } },
          status: 404,
        }),
      },
    });

    const result = await harness.cli.run(["build", "logs", "bld_x", "--json"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("BUILD.NOT_FOUND");
  });

  it("settles any other request failure as BUILD.LOGS_FAILED with the status", async () => {
    const harness = await makeServiceCli({
      routes: {
        "GET /v1/builds/{buildId}/logs": () => ({
          error: { error: { message: "boom" } },
          status: 503,
        }),
      },
    });

    const result = await harness.cli.run(["build", "logs", "bld_1", "--json"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("BUILD.LOGS_FAILED");
    expect(frame.envelope.error.meta).toMatchObject({ status: 503 });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: logRoutes([END]),
    });

    const result = await harness.cli.run(["build", "logs", "bld_1"], {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });

  it("requires a build id", async () => {
    const harness = await makeServiceCli({ routes: logRoutes([END]) });

    const result = await harness.cli.run(["build", "logs"], {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
  });
});
