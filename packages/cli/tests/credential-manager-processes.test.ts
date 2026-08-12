/**
 * The credential manager across real processes on a real filesystem:
 * the short lock prevents lost updates, a crashed holder's lock is
 * taken over, and a new process picks up the marker this one pinned
 * away from.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileCredentialManager } from "../src/auth/credential-manager";
import { readCredentialState } from "../src/auth/state-file";

const WORKSPACE_A = "wksp_a";
const WORKSPACE_B = "wksp_b";
const WORKSPACE_C = "wksp_c";

const workerPath = fileURLToPath(
  new URL("./helpers/credential-manager-worker.ts", import.meta.url),
);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

let stateFilePath: string;
const servers: Server[] = [];
/** Every worker's stderr, for the leak scan. */
const workerStderr: string[] = [];

/** The minter is a pure function of its claims, so two tokens for one
 *  workspace need a marker claim to come out as different strings. */
function mintToken(workspaceId: string, marker = "seed") {
  return mintTestJwt({ workspace_id: workspaceId, token: marker });
}

function runWorker(command: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", workerPath, stateFilePath, command, ...args],
      { cwd: packageRoot },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      workerStderr.push(stderr);
      if (code === 0) resolve(stdout);
      else reject(new Error(`worker ${command} failed: ${stderr}`));
    });
  });
}

function makeManager() {
  return new FileCredentialManager({
    env: { PRISMA_AUTH_FILE: stateFilePath },
  });
}

interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * The auth service's rotation rules (validated against
 * pdp-control-plane): a refresh token is single-use with a 10-second
 * reuse grace — the first exchange succeeds, one replay within the
 * grace succeeds with its own pair, later replays are invalid_grant.
 * The API side answers 401 for the seed access token so the SDK's
 * refresh path is what drives the exchange.
 */
const REUSE_GRACE_MS = 10_000;

async function startTokenEndpoint(script: {
  readonly seedAccessToken: string;
  readonly seedRefreshToken: string;
  readonly issued: readonly TokenPair[];
  /** Hold every token request until this many have arrived, so the
   *  replay really does land inside the grace rather than after the
   *  first exchange has already been written back. */
  readonly concurrentRefreshers?: number;
}): Promise<{
  readonly baseUrl: string;
  readonly exchanges: () => number;
}> {
  const grants = new Map<string, { uses: number; firstUsedAt: number }>([
    [script.seedRefreshToken, { uses: 0, firstUsedAt: 0 }],
  ]);
  let exchanges = 0;

  const expected = script.concurrentRefreshers ?? 1;
  const arrived: (() => void)[] = [];
  const allArrived = (): Promise<void> =>
    new Promise<void>((resolve) => {
      arrived.push(resolve);
      if (arrived.length < expected) return;
      for (const release of arrived.splice(0, arrived.length)) release();
    });

  const respond = (
    response: ServerResponse,
    status: number,
    body: unknown,
  ): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const exchange = (refreshToken: string | null): TokenPair | null => {
    const grant = refreshToken === null ? undefined : grants.get(refreshToken);
    if (grant === undefined) return null;
    if (grant.uses === 0) {
      grant.uses = 1;
      grant.firstUsedAt = Date.now();
    } else if (
      grant.uses === 1 &&
      Date.now() - grant.firstUsedAt <= REUSE_GRACE_MS
    ) {
      grant.uses = 2;
    } else {
      return null;
    }
    const pair = script.issued[exchanges];
    if (pair === undefined) return null;
    exchanges += 1;
    grants.set(pair.refreshToken, { uses: 0, firstUsedAt: 0 });
    return pair;
  };

  const server = createServer((request, response) => {
    if ((request.url ?? "").startsWith("/token")) {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        void allArrived().then(() => {
          const pair = exchange(new URLSearchParams(body).get("refresh_token"));
          if (pair === null) {
            respond(response, 400, { error: "invalid_grant" });
            return;
          }
          respond(response, 200, {
            access_token: pair.accessToken,
            refresh_token: pair.refreshToken,
          });
        });
      });
      return;
    }
    const bearer = request.headers.authorization;
    if (bearer === `Bearer ${script.seedAccessToken}`) {
      respond(response, 401, { message: "unauthorized" });
      return;
    }
    respond(response, 200, { workspaces: [] });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, exchanges: () => exchanges };
}

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prisma-credential-procs-"));
  stateFilePath = path.join(dir, "auth.json");
  workerStderr.length = 0;
});

afterEach(async () => {
  const running = servers.splice(0, servers.length);
  await Promise.all(
    running.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("across processes", () => {
  it("lands both concurrent mutations from separate processes", async () => {
    await Promise.all([
      runWorker("create", WORKSPACE_A, mintToken(WORKSPACE_A), "refresh-a"),
      runWorker("create", WORKSPACE_B, mintToken(WORKSPACE_B), "refresh-b"),
      runWorker("create", WORKSPACE_C, mintToken(WORKSPACE_C), "refresh-c"),
    ]);

    const state = await readCredentialState(stateFilePath);
    expect(
      [...state.sessions.map((session) => session.workspaceId)].sort(),
    ).toEqual([WORKSPACE_A, WORKSPACE_B, WORKSPACE_C]);
  }, 30_000);

  it("leaves a valid pair in the file when two processes really refresh the same session", async () => {
    const seedAccessToken = mintToken(WORKSPACE_A);
    const issued = [
      {
        accessToken: mintToken(WORKSPACE_A, "rotated-1"),
        refreshToken: "refresh-1",
      },
      {
        accessToken: mintToken(WORKSPACE_A, "rotated-2"),
        refreshToken: "refresh-2",
      },
    ];
    const endpoint = await startTokenEndpoint({
      seedAccessToken,
      seedRefreshToken: "refresh-0",
      issued,
      concurrentRefreshers: 2,
    });
    await runWorker("create", WORKSPACE_A, seedAccessToken, "refresh-0");

    const outcomes = await Promise.all([
      runWorker("refresh", WORKSPACE_A, endpoint.baseUrl, endpoint.baseUrl),
      runWorker("refresh", WORKSPACE_A, endpoint.baseUrl, endpoint.baseUrl),
    ]);

    expect(outcomes.map((outcome) => JSON.parse(outcome))).toEqual([
      { status: 200 },
      { status: 200 },
    ]);
    expect(endpoint.exchanges()).toBe(2);
    const state = await readCredentialState(stateFilePath);
    expect(state.sessions).toHaveLength(1);
    const record = state.sessions[0];
    expect(
      issued.map((pair) => `${pair.accessToken}|${pair.refreshToken}`),
    ).toContain(`${record.token}|${record.refreshToken}`);
  }, 30_000);

  it("takes over a crashed holder's lock after the stale threshold", async () => {
    await runWorker("create", WORKSPACE_A, mintToken(WORKSPACE_A), "refresh-a");
    await runWorker("crash-holding-the-lock");
    const lockPath = `${stateFilePath}.lock`;
    expect(await stat(lockPath)).toBeTruthy();

    const debugLines: string[] = [];
    const manager = new FileCredentialManager({
      env: { PRISMA_AUTH_FILE: stateFilePath, PRISMA_DEBUG: "1" },
      debugWrite: (text) => debugLines.push(text),
    });
    await manager.createSession(
      {
        token: mintToken(WORKSPACE_B),
        refreshToken: "refresh-b",
        expiresAt: undefined,
      },
      WORKSPACE_B,
    );

    const state = await readCredentialState(stateFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    expect(debugLines.join("")).toContain("taken over");
  }, 30_000);

  it("waits for a lock another process still holds", async () => {
    await runWorker("create", WORKSPACE_A, mintToken(WORKSPACE_A), "refresh-a");
    const lockPath = `${stateFilePath}.lock`;
    await writeFile(lockPath, "another-process", "utf8");

    const mutation = makeManager().createSession(
      {
        token: mintToken(WORKSPACE_B),
        refreshToken: "refresh-b",
        expiresAt: undefined,
      },
      WORKSPACE_B,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const during = await readCredentialState(stateFilePath);
    expect(during.sessions).toHaveLength(1);

    await unlink(lockPath);
    await mutation;

    expect((await readCredentialState(stateFilePath)).sessions).toHaveLength(2);
  }, 30_000);

  it("gives a new process the marker this process pinned away from", async () => {
    await runWorker("create", WORKSPACE_A, mintToken(WORKSPACE_A), "refresh-a");
    await runWorker("create", WORKSPACE_B, mintToken(WORKSPACE_B), "refresh-b");

    const manager = makeManager();
    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_B);

    await runWorker("use", WORKSPACE_A);
    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_B);

    const fromNewProcess = JSON.parse(await runWorker("active")) as {
      workspaceId: string;
    };
    expect(fromNewProcess.workspaceId).toBe(WORKSPACE_A);
  }, 30_000);

  it("never leaves token material in a worker's stdout or stderr", async () => {
    const seedAccessToken = mintToken(WORKSPACE_A);
    const rotated = {
      accessToken: mintToken(WORKSPACE_A, "rotated"),
      refreshToken: "s3cret-rotated-refresh",
    };
    const endpoint = await startTokenEndpoint({
      seedAccessToken,
      seedRefreshToken: "s3cret-refresh",
      issued: [rotated],
    });
    await runWorker("create", WORKSPACE_A, seedAccessToken, "s3cret-refresh");
    const printed = [
      await runWorker("sessions"),
      await runWorker("active"),
      await runWorker(
        "refresh",
        WORKSPACE_A,
        endpoint.baseUrl,
        endpoint.baseUrl,
      ),
    ].join("");
    expect(await readFile(stateFilePath, "utf8")).toContain(
      rotated.refreshToken,
    );

    // An endpoint that knows nothing of the stored refresh token
    // answers invalid_grant: the failure path must stay just as quiet.
    const rejecting = await startTokenEndpoint({
      seedAccessToken: rotated.accessToken,
      seedRefreshToken: "unknown-to-this-endpoint",
      issued: [],
    });
    const failed = await runWorker(
      "refresh",
      WORKSPACE_A,
      rejecting.baseUrl,
      rejecting.baseUrl,
    ).catch((error: unknown) => String(error));

    const scanned = `${printed}${failed}${workerStderr.join("")}`;
    for (const material of [
      "s3cret-refresh",
      rotated.refreshToken,
      seedAccessToken,
      rotated.accessToken,
    ]) {
      expect(scanned).not.toContain(material);
    }
  }, 30_000);
});
