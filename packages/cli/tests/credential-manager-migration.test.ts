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
import { readCredentialState } from "../src/auth/state-file";
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
