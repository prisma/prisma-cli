import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { executeCli } from "./helpers";

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

async function runFeedbackCli(url: string, argv: string[]) {
  return executeCli({
    argv: ["feedback", ...argv],
    env: { ...process.env, PRISMA_CLI_FEEDBACK_URL: url },
  });
}

describe("feedback", () => {
  it("sends anonymous feedback with non-PII context and returns the id", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await runFeedbackCli(url, [
      "loving the deploy flow",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "feedback",
      result: {
        id: "fb_test",
        email: null,
        context: {
          cliVersion: expect.any(String),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      message: "loving the deploy flow",
      meta: {
        cliVersion: payload.result.context.cliVersion,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(requests[0]?.userAgent).toMatch(/^prisma-cli\//);
  });

  it("includes the email only when --email is passed", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await runFeedbackCli(url, [
      "please add X",
      "--email",
      "dev@example.com",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.email).toBe("dev@example.com");
    expect(requests[0]?.body).toMatchObject({
      message: "please add X",
      email: "dev@example.com",
    });
  });

  it("rejects an empty message as a usage error without sending", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await runFeedbackCli(url, ["   ", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "USAGE_ERROR" },
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects an invalid --email as a usage error without sending", async () => {
    const { url, requests } = await startFeedbackService({});

    const result = await runFeedbackCli(url, [
      "hello",
      "--email",
      "not-an-email",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.error.code).toBe("USAGE_ERROR");
    expect(requests).toHaveLength(0);
  });

  it("fails with FEEDBACK_SEND_FAILED when the service errors", async () => {
    const { url } = await startFeedbackService({
      status: 500,
      response: {
        ok: false,
        error: { code: "STORAGE_UNAVAILABLE", message: "db down" },
      },
    });

    const result = await runFeedbackCli(url, ["hello", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("FEEDBACK_SEND_FAILED");
    expect(payload.error.why).toContain("HTTP 500");
    expect(payload.error.why).toContain("db down");
  });

  it("fails with FEEDBACK_SEND_FAILED when the service is unreachable", async () => {
    const result = await runFeedbackCli("http://127.0.0.1:9/feedback", [
      "hello",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error.code).toBe("FEEDBACK_SEND_FAILED");
  });

  it("reports a null id when the service response has none", async () => {
    const { url } = await startFeedbackService({ response: { ok: true } });

    const result = await runFeedbackCli(url, ["hello", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.id).toBeNull();
  });
});
