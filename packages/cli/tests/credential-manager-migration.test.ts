/**
 * Migration from the legacy store: adoption is a pure read, and the
 * adopted set materializes in the new format on the first mutation.
 */
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { FileCredentialManager } from "../src/auth/credential-manager";
import {
  EMPTY_STATE,
  readCredentialState,
  writeCredentialState,
} from "../src/auth/state-file";
import { getAuthContextFilePath } from "../src/auth/token-storage";

const WORKSPACE_A = "wksp_a";
const WORKSPACE_B = "wksp_b";

let authFilePath: string;
let contextFilePath: string;

function mintToken(
  workspaceId: string,
  overrides: Record<string, unknown> = {},
) {
  return mintTestJwt({ workspace_id: workspaceId, ...overrides });
}

function legacyEntry(workspaceId: string, refreshToken?: string) {
  return {
    workspaceId,
    token: mintToken(workspaceId),
    ...(refreshToken === undefined ? {} : { refreshToken }),
  };
}

async function writeLegacyStore(entries: unknown[]): Promise<void> {
  await writeFile(authFilePath, JSON.stringify({ tokens: entries }), "utf8");
}

async function writeLegacyContext(context: unknown): Promise<void> {
  await writeFile(contextFilePath, JSON.stringify(context), "utf8");
}

function makeManager() {
  return new FileCredentialManager({ env: { PRISMA_AUTH_FILE: authFilePath } });
}

beforeEach(async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "prisma-credential-migration-"),
  );
  authFilePath = path.join(dir, "auth.json");
  contextFilePath = getAuthContextFilePath(authFilePath);
});

describe("adopting the legacy store", () => {
  it("adopts every entry and marks the one the pointer targets", async () => {
    await writeLegacyStore([
      legacyEntry(WORKSPACE_A),
      legacyEntry(WORKSPACE_B),
    ]);
    await writeLegacyContext({
      activeWorkspaceId: WORKSPACE_B,
      workspaces: { [WORKSPACE_B]: { name: "Bravo" } },
    });

    const stored = await makeManager().sessions();
    expect(stored.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    expect(stored.selectedWorkspaceId).toBe(WORKSPACE_B);
    expect(stored.sessions[1].workspaceName).toBe("Bravo");
  });

  it("adopts with nothing selected when the pointer dangles", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A)]);
    await writeLegacyContext({
      activeWorkspaceId: "wksp_gone",
      workspaces: {},
    });

    const stored = await makeManager().sessions();
    expect(stored.sessions).toHaveLength(1);
    expect(stored.selectedWorkspaceId).toBeUndefined();
  });

  it("adopts with nothing selected when the pointer is null", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A)]);
    await writeLegacyContext({ activeWorkspaceId: null, workspaces: {} });

    expect(
      (await makeManager().sessions()).selectedWorkspaceId,
    ).toBeUndefined();
  });

  it("selects the only entry when there is no context file", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A)]);

    expect((await makeManager().sessions()).selectedWorkspaceId).toBe(
      WORKSPACE_A,
    );
  });

  it("selects nothing when several entries have no context file", async () => {
    await writeLegacyStore([
      legacyEntry(WORKSPACE_A),
      legacyEntry(WORKSPACE_B),
    ]);

    expect(
      (await makeManager().sessions()).selectedWorkspaceId,
    ).toBeUndefined();
  });

  it("adopts nothing from a missing, unparseable, or wrong-shaped file", async () => {
    const nothing = { sessions: [], selectedWorkspaceId: undefined };
    expect(await makeManager().sessions()).toEqual(nothing);

    await writeFile(authFilePath, "not json at all", "utf8");
    expect(await makeManager().sessions()).toEqual(nothing);

    await writeFile(authFilePath, JSON.stringify({ nope: true }), "utf8");
    expect(await makeManager().sessions()).toEqual(nothing);
  });

  /** Design §11.10, test 4: §7 adopts entries with no refresh token, and
   *  the engine tells "could never have been renewed" from a token set
   *  with no refresh token. This is where that state comes from. */
  it("hands the engine a token set with no refresh token for an adopted entry", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A)]);
    const manager = makeManager();

    await manager.activeCredential();
    const tokens = await (await manager.activeCredentialStorage()).getTokens();

    expect(tokens).toMatchObject({ workspaceId: WORKSPACE_A });
    expect(tokens?.refreshToken).toBeUndefined();
  });

  it("keys on the workspace_id claim, keeps the last duplicate, and ignores undecodable entries", async () => {
    await writeLegacyStore([
      {
        workspaceId: "stale-key",
        token: mintToken(WORKSPACE_A),
        refreshToken: "first",
      },
      {
        workspaceId: WORKSPACE_A,
        token: mintToken(WORKSPACE_A),
        refreshToken: "second",
      },
      { workspaceId: "wksp_broken", token: "not-a-jwt", refreshToken: "third" },
    ]);

    const state = await readCredentialState(authFilePath);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      workspaceId: WORKSPACE_A,
      refreshToken: "second",
    });
  });

  it("adopts placeholder names as no name and entries without a refresh token", async () => {
    await writeLegacyStore([
      legacyEntry(WORKSPACE_A),
      legacyEntry(WORKSPACE_B),
    ]);
    await writeLegacyContext({
      activeWorkspaceId: null,
      workspaces: {
        [WORKSPACE_A]: { name: "Unknown workspace" },
        [WORKSPACE_B]: { name: WORKSPACE_B },
      },
    });

    const state = await readCredentialState(authFilePath);
    expect(state.sessions.map((session) => session.name)).toEqual([
      undefined,
      undefined,
    ]);
    expect(
      state.sessions.every((session) => session.refreshToken === undefined),
    ).toBe(true);
  });

  it("leaves the legacy files untouched until a mutation materializes the adopted set", async () => {
    await writeLegacyStore([
      legacyEntry(WORKSPACE_A, "r1"),
      legacyEntry(WORKSPACE_B, "r2"),
    ]);
    await writeLegacyContext({
      activeWorkspaceId: WORKSPACE_A,
      workspaces: {},
    });
    const legacyBytes = await readFile(authFilePath, "utf8");

    const manager = makeManager();
    await manager.activeCredential();
    expect(await readFile(authFilePath, "utf8")).toBe(legacyBytes);

    await manager.selectSession(WORKSPACE_B);

    const state = await readCredentialState(authFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    expect(state.currentWorkspaceId).toBe(WORKSPACE_B);
    expect(await readFile(authFilePath, "utf8")).not.toBe(legacyBytes);
  });

  it("lets an existing new-format file win over adoption", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A)]);
    const manager = makeManager();
    await manager.sessions();

    await writeFile(
      authFilePath,
      JSON.stringify({
        version: 1,
        sessions: [{ workspaceId: WORKSPACE_B, token: mintToken(WORKSPACE_B) }],
        currentWorkspaceId: WORKSPACE_B,
      }),
      "utf8",
    );

    await manager.createSession(
      {
        token: mintToken(WORKSPACE_A),
        refreshToken: "r",
        expiresAt: undefined,
      },
      WORKSPACE_A,
    );

    const state = await readCredentialState(authFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_B,
      WORKSPACE_A,
    ]);
  });

  it("re-decides adoption inside the lock", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A, "legacy-refresh")]);
    const manager = makeManager();

    await writeFile(`${authFilePath}.lock`, "another-process", "utf8");
    const mutation = manager.createSession(
      {
        token: mintToken(WORKSPACE_B),
        refreshToken: "r",
        expiresAt: undefined,
      },
      WORKSPACE_B,
    );

    await writeFile(
      authFilePath,
      JSON.stringify({
        version: 1,
        sessions: [],
        currentWorkspaceId: null,
      }),
      "utf8",
    );
    await unlink(`${authFilePath}.lock`);
    await mutation;

    const state = await readCredentialState(authFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_B,
    ]);
  });

  it("reaps the legacy context file on endAllSessions", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A)]);
    await writeLegacyContext({
      activeWorkspaceId: WORKSPACE_A,
      workspaces: {},
    });

    await makeManager().endAllSessions();

    expect(
      await readFile(contextFilePath, "utf8").catch(() => null),
    ).toBeNull();
    const state = await readCredentialState(authFilePath);
    expect(state.sessions).toEqual([]);
    expect(state.currentWorkspaceId).toBeNull();
    await unlink(authFilePath);
  });
});

describe("the legacy mirror", () => {
  /** Reads the store exactly as the 3.x CLI does (#204): sessions come
   *  from auth.json's `tokens` array (`data.tokens || []`), selected by
   *  auth.context.json's `activeWorkspaceId`, and a record without a
   *  workspaceId, token, and refreshToken is skipped. */
  async function readAsLegacyCli() {
    const data = JSON.parse(await readFile(authFilePath, "utf8")) as {
      tokens?: unknown[];
    };
    const tokens = data.tokens || [];
    const context = JSON.parse(await readFile(contextFilePath, "utf8")) as {
      activeWorkspaceId?: string | null;
      workspaces?: Record<string, { name?: string }>;
    };
    const active = context.activeWorkspaceId;
    if (!active) return null;
    const credential = tokens.find(
      (entry) => (entry as { workspaceId?: string })?.workspaceId === active,
    ) as
      | { workspaceId: string; token?: string; refreshToken?: string }
      | undefined;
    if (!credential?.token || !credential.refreshToken) return null;
    return {
      workspaceId: credential.workspaceId,
      accessToken: credential.token,
      refreshToken: credential.refreshToken,
    };
  }

  it("a token refresh keeps the session visible to the 3.x reader", async () => {
    await writeLegacyStore([legacyEntry(WORKSPACE_A, "legacy-refresh")]);
    await writeLegacyContext({
      activeWorkspaceId: WORKSPACE_A,
      workspaces: { [WORKSPACE_A]: { name: "Alpha" } },
    });

    const manager = makeManager();
    await manager.activeCredential();
    const storage = await manager.activeCredentialStorage();
    const rotatedToken = mintToken(WORKSPACE_A);
    await storage.setTokens({
      workspaceId: WORKSPACE_A,
      accessToken: rotatedToken,
      refreshToken: "rotated-refresh",
    });

    expect(await readAsLegacyCli()).toEqual({
      workspaceId: WORKSPACE_A,
      accessToken: rotatedToken,
      refreshToken: "rotated-refresh",
    });

    const context = JSON.parse(await readFile(contextFilePath, "utf8")) as {
      workspaces: Record<string, { name?: string }>;
    };
    expect(context.workspaces[WORKSPACE_A]?.name).toBe("Alpha");
  });

  it("creating and selecting sessions moves the 3.x active pointer with them", async () => {
    const manager = makeManager();
    const tokenA = mintToken(WORKSPACE_A);
    const tokenB = mintToken(WORKSPACE_B);
    await manager.createSession(
      { token: tokenA, refreshToken: "ra", expiresAt: undefined },
      WORKSPACE_A,
    );
    await manager.createSession(
      { token: tokenB, refreshToken: "rb", expiresAt: undefined },
      WORKSPACE_B,
    );

    expect((await readAsLegacyCli())?.workspaceId).toBe(WORKSPACE_B);

    await manager.selectSession(WORKSPACE_A);
    expect(await readAsLegacyCli()).toEqual({
      workspaceId: WORKSPACE_A,
      accessToken: tokenA,
      refreshToken: "ra",
    });
  });

  it("the mirror is invisible to this CLI's own reader", async () => {
    const manager = makeManager();
    await manager.createSession(
      {
        token: mintToken(WORKSPACE_A),
        refreshToken: "r",
        expiresAt: undefined,
      },
      WORKSPACE_A,
    );

    const state = await readCredentialState(authFilePath);
    expect(Object.keys(state)).toEqual([
      "version",
      "sessions",
      "currentWorkspaceId",
    ]);
    expect(state.sessions).toHaveLength(1);
  });
});

describe("the legacy mirror's context sync", () => {
  it("a pointer move preserves the remembered-workspace name map", async () => {
    await writeLegacyStore([
      legacyEntry(WORKSPACE_A, "ra"),
      legacyEntry(WORKSPACE_B, "rb"),
    ]);
    await writeLegacyContext({
      activeWorkspaceId: WORKSPACE_A,
      workspaces: {
        [WORKSPACE_A]: { name: "Alpha" },
        [WORKSPACE_B]: { name: "Bravo" },
      },
    });

    await makeManager().selectSession(WORKSPACE_B);

    const context = JSON.parse(await readFile(contextFilePath, "utf8")) as {
      activeWorkspaceId: string | null;
      workspaces: Record<string, { name?: string }>;
    };
    expect(context.activeWorkspaceId).toBe(WORKSPACE_B);
    expect(context.workspaces[WORKSPACE_A]?.name).toBe("Alpha");
    expect(context.workspaces[WORKSPACE_B]?.name).toBe("Bravo");
  });

  it("writes no context file when none exists and nothing is selected", async () => {
    await writeCredentialState(authFilePath, EMPTY_STATE);

    await expect(readFile(contextFilePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("ending sessions and the legacy mirror", () => {
  async function readLegacyView() {
    const data = JSON.parse(await readFile(authFilePath, "utf8")) as {
      tokens?: { workspaceId: string }[];
    };
    const context = JSON.parse(await readFile(contextFilePath, "utf8")) as {
      activeWorkspaceId?: string | null;
    };
    return {
      tokenWorkspaces: (data.tokens ?? []).map((entry) => entry.workspaceId),
      activeWorkspaceId: context.activeWorkspaceId ?? null,
    };
  }

  it("ending a non-active session keeps the active one visible to the 3.x reader", async () => {
    const manager = makeManager();
    await manager.createSession(
      {
        token: mintToken(WORKSPACE_A),
        refreshToken: "ra",
        expiresAt: undefined,
      },
      WORKSPACE_A,
    );
    await manager.createSession(
      {
        token: mintToken(WORKSPACE_B),
        refreshToken: "rb",
        expiresAt: undefined,
      },
      WORKSPACE_B,
    );

    await manager.endSession(WORKSPACE_A);

    expect(await readLegacyView()).toEqual({
      tokenWorkspaces: [WORKSPACE_B],
      activeWorkspaceId: WORKSPACE_B,
    });
  });

  it("ending the active session clears the 3.x pointer with it", async () => {
    const manager = makeManager();
    await manager.createSession(
      {
        token: mintToken(WORKSPACE_A),
        refreshToken: "ra",
        expiresAt: undefined,
      },
      WORKSPACE_A,
    );

    await manager.endSession(WORKSPACE_A);

    expect(await readLegacyView()).toEqual({
      tokenWorkspaces: [],
      activeWorkspaceId: null,
    });
  });
});
