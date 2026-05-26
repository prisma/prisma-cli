import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileTokenStorage } from "../src/adapters/token-storage";
import { createTempCwd } from "./helpers";

async function writeAuthFile(authFilePath: string, tokens: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(authFilePath), { recursive: true });
  await fs.writeFile(authFilePath, JSON.stringify({ tokens }, null, 2));
}

describe("FileTokenStorage", () => {
  it("clears tokens only when they still match the caller's stale view", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const staleCredential = {
      workspaceId: "workspace-1",
      token: "old-access-token",
      refreshToken: "old-refresh-token",
    };
    const freshCredential = {
      workspaceId: "workspace-1",
      token: "new-access-token",
      refreshToken: "new-refresh-token",
    };
    await writeAuthFile(authFilePath, [freshCredential]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await storage.clearTokensIfCurrent({
      workspaceId: staleCredential.workspaceId,
      accessToken: staleCredential.token,
      refreshToken: staleCredential.refreshToken,
    });

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: freshCredential.workspaceId,
      accessToken: freshCredential.token,
      refreshToken: freshCredential.refreshToken,
    });
  });

  it("serializes refresh work with an auth-file-adjacent lock", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = storage.withRefreshLock(async () => {
      events.push("first:start");
      markFirstStarted();
      await firstReleased;
      events.push("first:end");
    });

    await firstStarted;

    const second = storage.withRefreshLock(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    await expect(fs.stat(`${authFilePath}.lock`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("replaces stale refresh locks", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const lockFilePath = `${authFilePath}.lock`;
    await fs.mkdir(path.dirname(lockFilePath), { recursive: true });
    await fs.writeFile(lockFilePath, "stale");
    const staleTime = new Date(Date.now() - 31_000);
    await fs.utimes(lockFilePath, staleTime, staleTime);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    let ran = false;

    await storage.withRefreshLock(async () => {
      ran = true;
    });

    expect(ran).toBe(true);
    await expect(fs.stat(lockFilePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
