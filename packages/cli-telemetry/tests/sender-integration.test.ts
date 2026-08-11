import { fork } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ParentToSenderPayload, TelemetryEvent } from "../src/payload";

const DB_URL_LEAK = /postgres:\/\/u:p@h\/d/;
const PROJECT_NAME_LEAK = /customer-acme-payments/;
const HOME_PATH_LEAK = /\/Users\/alice\/secrets/;

/**
 * End-to-end sender coverage against a local mock HTTP backend — the
 * same faking approach the ORM CLI's integration suite uses (endpoint
 * override pointed at an ephemeral local server; the production
 * endpoint is never contacted). Forks the compiled `dist/sender.js`,
 * drives it over IPC exactly like `runTelemetry` does, and asserts the
 * wire shape the backend receives plus the silence invariants.
 */

const SENDER_PATH = fileURLToPath(
  new URL("../dist/sender.js", import.meta.url),
);

interface CapturedRequest {
  readonly url: string;
  readonly contentType: string | undefined;
  readonly body: TelemetryEvent;
}

let server: Server;
let endpointBase: string;
const captured: CapturedRequest[] = [];
let projectDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      captured.push({
        url: req.url ?? "",
        contentType: req.headers["content-type"],
        body: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not bind a port");
  }
  endpointBase = `http://127.0.0.1:${address.port}`;
  projectDir = mkdtempSync(join(tmpdir(), "cli-telemetry-sender-int-"));
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      devDependencies: { typescript: "^5.9.3" },
    }),
  );
});

afterEach(() => {
  captured.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(projectDir, { recursive: true, force: true });
});

function buildPayload(
  overrides: Partial<ParentToSenderPayload> = {},
): ParentToSenderPayload {
  return {
    installationId: "00000000-0000-4000-8000-000000000001",
    version: "0.9.0",
    command: "auth whoami",
    flags: ["json", "dry-run"],
    projectRoot: projectDir,
    endpoint: `${endpointBase}/events`,
    ...overrides,
  };
}

interface SenderResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Fork the sender with stdout + stderr piped into in-memory buffers so
 * a test can assert on what the child wrote. Resolves on `exit` + both
 * stdio streams reporting `end` (composing the three signals directly
 * avoids the parent-side IPC handle lingering that keeps `close` from
 * firing after the child's disconnect-driven exit).
 */
function spawnSender(options: {
  readonly payload?: ParentToSenderPayload;
  readonly env: NodeJS.ProcessEnv;
}): Promise<SenderResult> {
  return new Promise((resolveSender, reject) => {
    const child = fork(SENDER_PATH, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: options.env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    let exited = false;
    let exitCode: number | null = null;
    let settled = false;

    const maybeResolve = (): void => {
      if (settled || !exited || !stdoutEnded || !stderrEnded) return;
      settled = true;
      resolveSender({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdout?.on("end", () => {
      stdoutEnded = true;
      maybeResolve();
    });
    child.stderr?.on("end", () => {
      stderrEnded = true;
      maybeResolve();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      maybeResolve();
    });

    if (options.payload !== undefined) {
      child.send(options.payload);
    }
  });
}

/**
 * A hermetic child env: no inherited debug/opt-out signals, no agent
 * markers, so assertions hold no matter what the developer's (or CI's)
 * session exports. `extra` layers on top for explicit opt-ins.
 */
function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    ...extra,
  };
}

describe("sender end-to-end via a local mock backend", () => {
  it("POSTs the enriched wire shape and stays silent on success", async () => {
    const result = await spawnSender({
      payload: buildPayload(),
      env: childEnv(),
    });

    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request?.url).toBe("/events");
    expect(request?.contentType).toBe("application/json");
    const event = request?.body;
    expect(event?.installationId).toBe("00000000-0000-4000-8000-000000000001");
    expect(event?.version).toBe("0.9.0");
    expect(event?.command).toBe("auth whoami");
    expect(event?.flags).toEqual(["json", "dry-run"]);
    expect(event?.databaseTarget).toBeNull();
    expect(event?.extensions).toEqual([]);
    expect(event?.tsVersion).toBe("5.9.3");
    expect(typeof event?.runtimeName).toBe("string");
    expect(typeof event?.runtimeVersion).toBe("string");
    expect(typeof event?.os).toBe("string");
    expect(typeof event?.arch).toBe("string");
    expect(event?.agent).toBeNull();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("transmits only flag names, never values or positionals", async () => {
    const sensitiveFlags = ["connection-string", "name", "config"];
    await spawnSender({
      payload: buildPayload({ flags: sensitiveFlags }),
      env: childEnv(),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.flags).toEqual(sensitiveFlags);
    const serialised = JSON.stringify(captured[0]?.body);
    expect(serialised).not.toMatch(DB_URL_LEAK);
    expect(serialised).not.toMatch(PROJECT_NAME_LEAK);
    expect(serialised).not.toMatch(HOME_PATH_LEAK);
  });

  it("never reads a prisma-next.config.* from projectRoot (config load dropped; payload-only fields)", async () => {
    const configuredDir = mkdtempSync(
      join(tmpdir(), "cli-telemetry-sender-cfg-"),
    );
    try {
      writeFileSync(
        join(configuredDir, "prisma-next.config.mjs"),
        [
          "export default {",
          "  target: { kind: 'target', id: 'postgres', targetId: 'postgres', version: '0.0.1', create: () => ({}) },",
          "  extensions: [{ kind: 'extension', id: 'pgvector', version: '0.0.1', create: () => ({}) }],",
          "};",
          "",
        ].join("\n"),
      );
      await spawnSender({
        payload: buildPayload({ projectRoot: configuredDir }),
        env: childEnv(),
      });
      expect(captured).toHaveLength(1);
      expect(captured[0]?.body.databaseTarget).toBeNull();
      expect(captured[0]?.body.extensions).toEqual([]);
    } finally {
      rmSync(configuredDir, { recursive: true, force: true });
    }
  });

  it("passes the payload databaseTarget through to the event", async () => {
    await spawnSender({
      payload: buildPayload({ databaseTarget: "postgres" }),
      env: childEnv(),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.databaseTarget).toBe("postgres");
  });

  it("populates the agent field from the child env", async () => {
    await spawnSender({
      payload: buildPayload(),
      env: childEnv({ CLAUDECODE: "1" }),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.agent).toBe("claude");
  });

  it("swallows a network failure (exit 0, silent) when the endpoint is unreachable", async () => {
    const result = await spawnSender({
      payload: buildPayload({ endpoint: "http://127.0.0.1:1/events" }),
      env: childEnv(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("emits diagnostics to stderr under PRISMA_NEXT_DEBUG=1", async () => {
    const result = await spawnSender({
      payload: buildPayload({ endpoint: "http://127.0.0.1:1/events" }),
      env: childEnv({ PRISMA_NEXT_DEBUG: "1" }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[cli-telemetry]");
    expect(result.stderr).toContain("send failed");
  });

  it("exits 0 when no payload arrives within the idle timeout, and stays silent", {
    timeout: 10_000,
  }, async () => {
    const result = await spawnSender({ env: childEnv() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
