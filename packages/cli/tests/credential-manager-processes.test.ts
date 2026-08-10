/**
 * The credential manager across real processes on a real filesystem:
 * the short lock prevents lost updates, a crashed holder's lock is
 * taken over, and a new process picks up the marker this one pinned
 * away from.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it } from "vitest";

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

function mintToken(workspaceId: string) {
  return mintTestJwt({ workspace_id: workspaceId });
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

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prisma-credential-procs-"));
  stateFilePath = path.join(dir, "auth.json");
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

  it("leaves a valid pair in the file when two processes rotate the same session", async () => {
    await runWorker("create", WORKSPACE_A, mintToken(WORKSPACE_A), "refresh-0");
    const first = mintToken(WORKSPACE_A);
    const second = mintToken(WORKSPACE_A);

    await Promise.all([
      runWorker("rotate", WORKSPACE_A, first, "refresh-1"),
      runWorker("rotate", WORKSPACE_A, second, "refresh-2"),
    ]);

    const state = await readCredentialState(stateFilePath);
    expect(state.sessions).toHaveLength(1);
    const record = state.sessions[0];
    expect([`${first}|refresh-1`, `${second}|refresh-2`]).toContain(
      `${record.token}|${record.refreshToken}`,
    );
  }, 30_000);

  it("takes over a crashed holder's lock after the stale threshold", async () => {
    await runWorker("create", WORKSPACE_A, mintToken(WORKSPACE_A), "refresh-a");
    await runWorker("crash-holding-the-lock");
    const lockPath = `${stateFilePath}.lock`;
    expect(await stat(lockPath)).toBeTruthy();

    const debugLines: string[] = [];
    const manager = new FileCredentialManager({
      env: { PRISMA_AUTH_FILE: stateFilePath, PRISMA_NEXT_DEBUG: "1" },
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
    expect((await manager.currentSession())?.workspaceId).toBe(WORKSPACE_B);

    await runWorker("use", WORKSPACE_A);
    expect((await manager.currentSession())?.workspaceId).toBe(WORKSPACE_B);

    const fromNewProcess = JSON.parse(await runWorker("current")) as {
      workspaceId: string;
    };
    expect(fromNewProcess.workspaceId).toBe(WORKSPACE_A);
  }, 30_000);

  it("never leaves token material in a worker's output", async () => {
    const token = mintToken(WORKSPACE_A);
    await runWorker("create", WORKSPACE_A, token, "s3cret-refresh");
    const printed = await runWorker("sessions");

    expect(printed).not.toContain("s3cret-refresh");
    expect(printed).not.toContain(token);
    expect(await readFile(stateFilePath, "utf8")).toContain("s3cret-refresh");
  }, 30_000);
});
