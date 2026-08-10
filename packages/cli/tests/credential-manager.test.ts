/**
 * The credential manager over its state file: the file format and its
 * atomicity, process pinning, the env override rules, the TokenStorage
 * write slices, and the legacy migration.
 */

/**
 * The credential manager over its state file: the file format and its
 * atomicity, process pinning, the env override rules, the TokenStorage
 * write slices, and the legacy migration.
 */
import fsPromises, {
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileCredentialManager } from "../src/auth/credential-manager";
import { readCredentialState } from "../src/auth/state-file";

const WORKSPACE_A = "wksp_a";
const WORKSPACE_B = "wksp_b";

let stateFilePath: string;

function mintToken(
  workspaceId: string,
  overrides: Record<string, unknown> = {},
) {
  return mintTestJwt({
    workspace_id: workspaceId,
    sub: "user_1",
    ...overrides,
  });
}

function credentialFor(workspaceId: string, refreshToken = "refresh-1") {
  return {
    token: mintToken(workspaceId),
    refreshToken,
    expiresAt: undefined,
  };
}

function makeManager(
  options: {
    env?: Record<string, string | undefined>;
    fetchWorkspaceName?: (
      credential: { token: string },
      workspaceId: string,
    ) => Promise<string | undefined>;
    debugWrite?: (text: string) => void;
  } = {},
) {
  return new FileCredentialManager({
    env: { PRISMA_AUTH_FILE: stateFilePath, ...options.env },
    fetchWorkspaceName: options.fetchWorkspaceName,
    debugWrite: options.debugWrite,
  });
}

async function readRawState(): Promise<string | null> {
  return readFile(stateFilePath, "utf8").catch(() => null);
}

async function seedTwoSessions(): Promise<void> {
  const manager = makeManager();
  await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
  await manager.createSession(credentialFor(WORKSPACE_B), WORKSPACE_B);
}

beforeEach(async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "prisma-credential-manager-"),
  );
  stateFilePath = path.join(dir, "auth.json");
});

describe("the state file", () => {
  it("writes the normative shape with mode 0600", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);

    const state = JSON.parse((await readRawState()) ?? "");
    expect(state).toMatchObject({
      version: 1,
      currentWorkspaceId: WORKSPACE_A,
      sessions: [{ workspaceId: WORKSPACE_A, refreshToken: "refresh-1" }],
    });
    expect((await stat(stateFilePath)).mode & 0o777).toBe(0o600);
  });

  it("tightens permissions looser than 0600", async () => {
    await writeFile(stateFilePath, JSON.stringify({ tokens: [] }), {
      mode: 0o644,
    });
    await makeManager().createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);

    expect((await stat(stateFilePath)).mode & 0o777).toBe(0o600);
  });

  it("reads never write", async () => {
    await seedTwoSessions();
    const legacyPath = path.join(path.dirname(stateFilePath), "legacy.json");
    await writeFile(
      legacyPath,
      JSON.stringify({
        tokens: [
          {
            workspaceId: WORKSPACE_A,
            token: mintToken(WORKSPACE_A),
            refreshToken: "legacy-refresh",
          },
        ],
      }),
    );

    const writes = vi.spyOn(fsPromises, "writeFile");
    const renames = vi.spyOn(fsPromises, "rename");
    const opens = vi.spyOn(fsPromises, "open");
    try {
      const manager = makeManager();
      await manager.currentSession();
      await manager.sessions();
      await manager.tokenStorage(WORKSPACE_A).getTokens();

      const adopting = new FileCredentialManager({
        env: { PRISMA_AUTH_FILE: legacyPath },
      });
      await adopting.currentSession();
      await adopting.sessions();

      expect(writes).not.toHaveBeenCalled();
      expect(renames).not.toHaveBeenCalled();
      expect(opens).not.toHaveBeenCalled();

      await manager.endAllSessions();
      expect(renames).toHaveBeenCalled();
    } finally {
      writes.mockRestore();
      renames.mockRestore();
      opens.mockRestore();
    }
  });

  it("treats a corrupt file as signed out and never rewrites it", async () => {
    await writeFile(stateFilePath, "{ not json", "utf8");
    const before = await readRawState();

    const manager = makeManager();
    expect(await manager.currentSession()).toBeNull();
    expect(await manager.sessions()).toEqual([]);
    expect(await readRawState()).toBe(before);
  });
});

describe("process pinning", () => {
  it("pins the current session at the first read and keeps it when another process moves the marker", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    await makeManager().useSession(
      (await manager.sessions()).find(
        (session) => session.workspaceId === WORKSPACE_A,
      ) as never,
    );

    const pinned = await manager.currentSession();
    expect(pinned?.workspaceId).toBe(WORKSPACE_A);

    const otherProcess = makeManager();
    await otherProcess.useSession(
      (await otherProcess.sessions()).find(
        (session) => session.workspaceId === WORKSPACE_B,
      ) as never,
    );

    expect((await manager.currentSession())?.workspaceId).toBe(WORKSPACE_A);
    expect((await makeManager().currentSession())?.workspaceId).toBe(
      WORKSPACE_B,
    );
  });

  it("moves the pin on this process's own mutations", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    expect((await manager.currentSession())?.workspaceId).toBe(WORKSPACE_B);

    const sessionA = (await manager.sessions()).find(
      (session) => session.workspaceId === WORKSPACE_A,
    );
    await manager.useSession(sessionA as never);
    expect((await manager.currentSession())?.workspaceId).toBe(WORKSPACE_A);

    await manager.endSession(sessionA as never);
    await expect(manager.currentSession()).rejects.toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
    });
  });

  it("fails with the session-ended error when another process ends the pinned session", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    await manager.currentSession();

    const otherProcess = makeManager();
    await otherProcess.endSession(
      (await otherProcess.sessions()).find(
        (session) => session.workspaceId === WORKSPACE_B,
      ) as never,
    );

    await expect(manager.currentSession()).rejects.toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
      message: "The workspace session this command was using has ended.",
    });
  });

  it("reports sessions held but none current", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    const sessions = await manager.sessions();
    await manager.endSession(
      sessions.find((session) => session.workspaceId === WORKSPACE_B) as never,
    );

    await expect(makeManager().currentSession()).rejects.toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
      why: "You have workspace sessions but none is current.",
    });
  });
});

describe("mutations under an environment session", () => {
  const environments = {
    set: mintToken(WORKSPACE_B),
    blank: "",
    whitespace: "   ",
  } as const;

  for (const [name, token] of Object.entries(environments)) {
    it(`refuses useSession, endSession and endAllSessions with the env token ${name}`, async () => {
      await seedTwoSessions();
      const stored = await makeManager().sessions();
      const before = await readRawState();
      const manager = makeManager({ env: { PRISMA_SERVICE_TOKEN: token } });
      const expectedCode =
        name === "set"
          ? "AUTH.ENV_SESSION_IN_FORCE"
          : "AUTH.SERVICE_TOKEN_EMPTY";

      await expect(
        manager.useSession(stored[0] as never),
      ).rejects.toMatchObject({ code: expectedCode });
      await expect(
        manager.endSession(stored[0] as never),
      ).rejects.toMatchObject({ code: expectedCode });
      await expect(manager.endAllSessions()).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(await readRawState()).toBe(before);
    });
  }

  it("succeeds as a no-op when endAllSessions runs with no stored sessions", async () => {
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_B) },
    });
    await expect(manager.endAllSessions()).resolves.toBeUndefined();
    expect(await readRawState()).toBeNull();
  });

  it("allows createSession while the env token is in force and leaves the pin on the env session", async () => {
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_B) },
    });
    expect((await manager.currentSession())?.source).toBe("environment");

    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);

    expect((await manager.currentSession())?.source).toBe("environment");
    const state = await readCredentialState(stateFilePath);
    expect(state.currentWorkspaceId).toBe(WORKSPACE_A);
  });

  it("raises the blank-token error from currentSession", async () => {
    const manager = makeManager({ env: { PRISMA_SERVICE_TOKEN: "  " } });
    await expect(manager.currentSession()).rejects.toMatchObject({
      code: "AUTH.SERVICE_TOKEN_EMPTY",
    });
  });
});

describe("createSession", () => {
  it("refuses a credential whose workspace_id claim names another workspace", async () => {
    const manager = makeManager();
    await expect(
      manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_B),
    ).rejects.toMatchObject({ code: "AUTH.CREDENTIAL_WORKSPACE_MISMATCH" });
    expect(await readRawState()).toBeNull();
  });

  it("holds no lock while the workspace name is fetched", async () => {
    let releaseFetch: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      const manager = makeManager({
        fetchWorkspaceName: async () => {
          resolve();
          await new Promise<void>((done) => {
            releaseFetch = done;
          });
          return "Workspace A";
        },
      });
      void manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    });

    await fetchStarted;
    await makeManager().createSession(credentialFor(WORKSPACE_B), WORKSPACE_B);
    releaseFetch();

    await vi.waitFor(async () => {
      const state = await readCredentialState(stateFilePath);
      expect(
        state.sessions.find((session) => session.workspaceId === WORKSPACE_A)
          ?.name,
      ).toBe("Workspace A");
    });
    const state = await readCredentialState(stateFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
  });

  it("keeps login working when the name lookup fails", async () => {
    const manager = makeManager({
      fetchWorkspaceName: async () => {
        throw new Error("offline");
      },
    });
    const session = await manager.createSession(
      credentialFor(WORKSPACE_A),
      WORKSPACE_A,
    );
    expect(session.workspaceName).toBeUndefined();
  });

  it("does not resurrect a record ended while the name was fetched", async () => {
    let releaseFetch: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      const manager = makeManager({
        fetchWorkspaceName: async () => {
          resolve();
          await new Promise<void>((done) => {
            releaseFetch = done;
          });
          return "Workspace A";
        },
      });
      void manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    });

    await fetchStarted;
    const otherProcess = makeManager();
    await otherProcess.endSession(
      (await otherProcess.sessions()).find(
        (session) => session.workspaceId === WORKSPACE_A,
      ) as never,
    );
    releaseFetch();

    await vi.waitFor(async () => {
      expect((await readCredentialState(stateFilePath)).sessions).toEqual([]);
    });
  });

  it("upserts by workspace id, keeping the stored name and moving the marker", async () => {
    const manager = makeManager({
      fetchWorkspaceName: async () => "Workspace A",
    });
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    await manager.createSession(credentialFor(WORKSPACE_B), WORKSPACE_B);

    const plain = makeManager();
    await plain.createSession(
      credentialFor(WORKSPACE_A, "refresh-2"),
      WORKSPACE_A,
    );

    const state = await readCredentialState(stateFilePath);
    expect(state.currentWorkspaceId).toBe(WORKSPACE_A);
    expect(state.sessions).toHaveLength(2);
    expect(
      state.sessions.find((session) => session.workspaceId === WORKSPACE_A),
    ).toMatchObject({ name: "Workspace A", refreshToken: "refresh-2" });
  });
});

describe("the TokenStorage view", () => {
  it("writes only the token fields on rotation and re-derives the expiry", async () => {
    const manager = makeManager({
      fetchWorkspaceName: async () => "Workspace A",
    });
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    await makeManager().createSession(credentialFor(WORKSPACE_B), WORKSPACE_B);

    const rotated = mintToken(WORKSPACE_A, { exp: 2_000_000_000 });
    await manager.tokenStorage(WORKSPACE_A).setTokens({
      workspaceId: WORKSPACE_A,
      accessToken: rotated,
      refreshToken: "refresh-2",
    });

    const state = await readCredentialState(stateFilePath);
    const record = state.sessions.find(
      (session) => session.workspaceId === WORKSPACE_A,
    );
    expect(record).toMatchObject({
      name: "Workspace A",
      token: rotated,
      refreshToken: "refresh-2",
      expiresAt: new Date(2_000_000_000 * 1000).toISOString(),
    });
    expect(state.currentWorkspaceId).toBe(WORKSPACE_B);
  });

  it("refuses to resurrect a session ended during the rotation", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);

    const otherProcess = makeManager();
    await otherProcess.endSession(
      (await otherProcess.sessions()).find(
        (session) => session.workspaceId === WORKSPACE_A,
      ) as never,
    );

    await expect(
      manager.tokenStorage(WORKSPACE_A).setTokens({
        workspaceId: WORKSPACE_A,
        accessToken: mintToken(WORKSPACE_A),
        refreshToken: "refresh-2",
      }),
    ).rejects.toMatchObject({ code: "CLI.CREDENTIALS_REQUIRED" });
    expect((await readCredentialState(stateFilePath)).sessions).toEqual([]);
  });

  it("refuses a rotated token that re-scopes to another workspace", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);

    await expect(
      manager.tokenStorage(WORKSPACE_A).setTokens({
        workspaceId: WORKSPACE_A,
        accessToken: mintToken(WORKSPACE_B),
        refreshToken: "refresh-2",
      }),
    ).rejects.toMatchObject({ code: "AUTH.CREDENTIAL_WORKSPACE_MISMATCH" });
  });

  it("clears on an exact three-field match and leaves a newer pair alone", async () => {
    const manager = makeManager();
    const credential = credentialFor(WORKSPACE_A);
    await manager.createSession(credential, WORKSPACE_A);
    const storage = manager.tokenStorage(WORKSPACE_A);

    const stale = {
      workspaceId: WORKSPACE_A,
      accessToken: "stale-access-token",
      refreshToken: "refresh-1",
    };
    const before = await readRawState();
    await storage.clearTokensIfCurrent?.(stale);
    expect(await readRawState()).toBe(before);

    await storage.clearTokensIfCurrent?.({
      workspaceId: WORKSPACE_A,
      accessToken: credential.token,
      refreshToken: credential.refreshToken,
    });
    const state = await readCredentialState(stateFilePath);
    expect(state.sessions).toEqual([]);
    expect(state.currentWorkspaceId).toBeNull();
  });

  it("clearTokens removes only the bound record", async () => {
    await seedTwoSessions();
    await makeManager().tokenStorage(WORKSPACE_A).clearTokens();

    const state = await readCredentialState(stateFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_B,
    ]);
    expect(state.currentWorkspaceId).toBe(WORKSPACE_B);
  });

  it("serializes refreshes in this process", async () => {
    const manager = makeManager();
    const storage = manager.tokenStorage(WORKSPACE_A);
    const order: string[] = [];
    const first = storage.withRefreshLock?.(async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
    });
    const second = storage.withRefreshLock?.(async () => {
      order.push("second-start");
    });
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("re-reads the file on every getTokens", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    const storage = manager.tokenStorage(WORKSPACE_A);
    expect((await storage.getTokens())?.refreshToken).toBe("refresh-1");

    await makeManager().createSession(
      credentialFor(WORKSPACE_A, "refresh-2"),
      WORKSPACE_A,
    );
    expect((await storage.getTokens())?.refreshToken).toBe("refresh-2");
  });
});

describe("token material never leaks", () => {
  it("keeps the secret out of debug output and errors", async () => {
    const secret = "s3cret-refresh-token";
    const debugLines: string[] = [];
    const manager = makeManager({
      env: { PRISMA_NEXT_DEBUG: "1" },
      debugWrite: (text) => debugLines.push(text),
    });
    const credential = {
      token: mintToken(WORKSPACE_A),
      refreshToken: secret,
      expiresAt: undefined,
    };
    await manager.createSession(credential, WORKSPACE_A);
    await manager.currentSession();

    const mismatch = await manager
      .createSession(credential, WORKSPACE_B)
      .catch((error: unknown) => error);

    const rendered = `${debugLines.join("")}${JSON.stringify(mismatch, Object.getOwnPropertyNames(mismatch))}`;
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain(credential.token);
  });
});
