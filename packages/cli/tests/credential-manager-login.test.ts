/**
 * Minting and custody stay separate: performLogin returns the minted
 * credential and the SDK's callback-time write lands in a throwaway
 * storage, never in the credential manager's state file.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileCredentialManager } from "../src/auth/credential-manager";
import { login } from "../src/auth/login";
import { performLogin } from "../src/auth/operations";

vi.mock("../src/auth/login", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/login")>()),
  login: vi.fn(),
}));

const WORKSPACE_A = "wksp_a";
const MINTED_ACCESS_TOKEN = mintTestJwt({
  workspace_id: WORKSPACE_A,
  exp: 2_000_000_000,
});

let stateFilePath: string;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prisma-credential-login-"));
  stateFilePath = path.join(dir, "auth.json");
  vi.mocked(login).mockReset();
});

describe("performLogin", () => {
  it("returns the minted credential and writes nothing to the state file", async () => {
    vi.mocked(login).mockImplementation(async (options) => {
      await options?.tokenStorage?.setTokens({
        workspaceId: WORKSPACE_A,
        accessToken: MINTED_ACCESS_TOKEN,
        refreshToken: "minted-refresh-token",
      });
    });

    const env = { PRISMA_AUTH_FILE: stateFilePath };
    const credential = await performLogin(env);

    expect(credential).toEqual({
      token: MINTED_ACCESS_TOKEN,
      refreshToken: "minted-refresh-token",
      expiresAt: new Date(2_000_000_000 * 1000),
    });
    expect(await readFile(stateFilePath, "utf8").catch(() => null)).toBeNull();

    const manager = new FileCredentialManager({ env });
    expect((await manager.sessions()).sessions).toEqual([]);

    await manager.createSession(credential, WORKSPACE_A);
    expect(
      (await manager.sessions()).sessions.map((session) => session.workspaceId),
    ).toEqual([WORKSPACE_A]);
  });

  it("fails when the flow finishes without a credential", async () => {
    vi.mocked(login).mockResolvedValue(undefined);

    await expect(
      performLogin({ PRISMA_AUTH_FILE: stateFilePath }),
    ).rejects.toThrow("Sign-in finished without producing a credential.");
  });
});
