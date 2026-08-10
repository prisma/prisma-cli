import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestCli } from "@prisma/cli-engine/testing";
import { afterEach, describe, expect, it } from "vitest";

import { feedbackCommand } from "../src/v8/feedback";
import { mountedCommands } from "./v8-service-testkit";

/** The command posts with the global fetch and the engine hands session
 *  commands no HTTP seam, so the service is faked where the legacy
 *  tests fake it: a loopback server the run is pointed at with
 *  PRISMA_CLI_FEEDBACK_URL. */
interface ReceivedRequest {
  body: unknown;
  userAgent: string | undefined;
}

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  }
});

async function startFeedbackService(options: {
  status?: number;
  response?: unknown;
}): Promise<{ url: string; requests: ReceivedRequest[] }> {
  const requests: ReceivedRequest[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({
        body: JSON.parse(raw),
        userAgent: req.headers["user-agent"],
      });
      res.statusCode = options.status ?? 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(options.response ?? { ok: true, id: "fb_test" }));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/feedback`, requests };
}

/** No session is ever seeded, so every run also proves the
 *  unauthenticated axis of R-S2b-9. */
function makeCli() {
  return createTestCli({
    commands: mountedCommands(["feedback"]),
    now: () => new Date(0),
  });
}

function run(url: string, argv: readonly string[]) {
  return makeCli().run(["feedback", ...argv], {
    env: { PRISMA_CLI_FEEDBACK_URL: url },
  });
}

function errorFrame(json: readonly unknown[]) {
  const frame = json[json.length - 1] as
    | { kind: string; envelope: { ok: boolean } }
    | undefined;
  if (frame?.kind !== "result" || frame.envelope.ok) {
    throw new Error("expected an errored envelope");
  }
  return frame.envelope as unknown as {
    ok: false;
    commandId: string;
    error: { code: string; summary: string; why?: string };
  };
}

function completedFrame(json: readonly unknown[]) {
  const frame = json[json.length - 1] as
    | { kind: string; envelope: { ok: boolean } }
    | undefined;
  if (frame?.kind !== "result" || !frame.envelope.ok) {
    throw new Error("expected a completed envelope");
  }
  return frame.envelope as unknown as {
    ok: true;
    commandId: string;
    result: unknown;
  };
}

describe("prisma-v8 feedback", () => {
  it("declares no credential needs and sends without a session", async () => {
    expect(feedbackCommand.needs.credentials).toBe(false);
    const { url, requests } = await startFeedbackService({});

    const result = await run(url, ["loving the deploy flow"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      id: "fb_test",
      email: null,
      context: {
        cliVersion: expect.any(String),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      message: "loving the deploy flow",
      meta: {
        cliVersion: (
          result.presented?.data as { context: { cliVersion: string } }
        ).context.cliVersion,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(requests[0]?.userAgent).toMatch(/^prisma-cli\//);
  });

  it("includes the email only when --email is passed", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await run(url, [
      "please add X",
      "--email",
      "dev@example.com",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ email: "dev@example.com" });
    expect(requests[0]?.body).toMatchObject({
      message: "please add X",
      email: "dev@example.com",
    });
  });

  it("emits the completed json envelope with commandId feedback", async () => {
    const { url } = await startFeedbackService({});

    const result = await run(url, ["loving the deploy flow", "--json"]);

    expect(result.exitCode).toBe(0);
    const envelope = completedFrame(result.json);
    expect(envelope.commandId).toBe("feedback");
    expect(envelope.result).toMatchObject({ id: "fb_test", email: null });
  });

  it("reports a null id when the service response has none", async () => {
    const { url } = await startFeedbackService({ response: { ok: true } });

    const result = await run(url, ["hello"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ id: null });
  });

  it("rejects an empty message without sending", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await run(url, ["   ", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorFrame(result.json).error.code).toBe(
      "FEEDBACK.MESSAGE_REQUIRED",
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects a message over 4000 characters without sending", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await run(url, ["x".repeat(4001), "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = errorFrame(result.json);
    expect(envelope.error.code).toBe("FEEDBACK.MESSAGE_TOO_LONG");
    expect(envelope.error.why).toContain("4001 characters");
    expect(requests).toHaveLength(0);
  });

  it("rejects a malformed --email without sending", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await run(url, [
      "hello",
      "--email",
      "not-an-email",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorFrame(result.json).error.code).toBe("FEEDBACK.EMAIL_INVALID");
    expect(requests).toHaveLength(0);
  });

  it("rejects a regex-valid email over 320 characters without sending", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await run(url, [
      "hello",
      "--email",
      `${"a".repeat(320)}@example.com`,
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorFrame(result.json).error.code).toBe("FEEDBACK.EMAIL_INVALID");
    expect(requests).toHaveLength(0);
  });

  it("settles a service error as FEEDBACK.SEND_FAILED with the service's own message", async () => {
    const { url } = await startFeedbackService({
      status: 500,
      response: {
        ok: false,
        error: { code: "STORAGE_UNAVAILABLE", message: "db down" },
      },
    });

    const result = await run(url, ["hello", "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = errorFrame(result.json);
    expect(envelope.commandId).toBe("feedback");
    expect(envelope.error.code).toBe("FEEDBACK.SEND_FAILED");
    expect(envelope.error.summary).toBe("Feedback could not be delivered");
    expect(envelope.error.why).toContain("HTTP 500");
    expect(envelope.error.why).toContain("db down");
  });

  it("settles an unreachable service as FEEDBACK.SEND_FAILED", async () => {
    const result = await run("http://127.0.0.1:9/feedback", [
      "hello",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorFrame(result.json).error.code).toBe("FEEDBACK.SEND_FAILED");
  });

  it("rejects a missing message with the engine's own usage error", async () => {
    const result = await makeCli().run(["feedback", "--json"], {});

    expect(result.exitCode).toBe(2);
    expect(errorFrame(result.json).error.code).toBe("CLI.INVALID_ARGUMENTS");
  });
});
