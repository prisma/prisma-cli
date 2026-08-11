/**
 * The credential manager over its state file: the file format and its
 * atomicity, process pinning, idempotent removal, what an environment
 * credential can and cannot reach, and the two token storages.
 */
import nodeFs from "node:fs";
import fsPromises, {
  mkdtemp,
  readdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TokenStorage } from "@prisma/cli-engine";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileCredentialManager } from "../src/auth/credential-manager";
import { readCredentialState } from "../src/auth/state-file";
import { getAuthContextFilePath } from "../src/auth/token-storage";

const NO_SPACE_LEFT = /no space left/;

/** Windows has no Unix permission bits — `stat` reports 0o666 whatever
 *  the file was created with — so the mode assertions only mean
 *  something on a POSIX filesystem. */
const POSIX_MODES = process.platform !== "win32";

function expectOwnerOnly(mode: number): void {
  if (POSIX_MODES) expect(mode & 0o777).toBe(0o600);
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Releases every caller once `expected` of them are waiting, and stays
 * open from then on so later callers pass straight through. Latching
 * matters: the waiter that loses the race below comes back for another
 * look, and a barrier that reset would hold it there forever.
 */
function barrierFor(expected: number): () => Promise<void> {
  const waiting: (() => void)[] = [];
  let open = false;
  return async () => {
    if (open) return;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length < expected) return;
      open = true;
      for (const release of waiting.splice(0, waiting.length)) release();
    });
  };
}

const WORKSPACE_A = "wksp_a";
const WORKSPACE_B = "wksp_b";
const WORKSPACE_C = "wksp_c";

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

/** The engine's order: resolve the active credential, then ask for the
 *  storage behind it. */
async function storageFor(
  manager: FileCredentialManager,
): Promise<TokenStorage> {
  await manager.activeCredential();
  return manager.activeCredentialStorage();
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
    expectOwnerOnly((await stat(stateFilePath)).mode);
  });

  it("tightens permissions looser than 0600", async () => {
    await writeFile(stateFilePath, JSON.stringify({ tokens: [] }), {
      mode: 0o644,
    });
    await makeManager().createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);

    expectOwnerOnly((await stat(stateFilePath)).mode);
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

    const spies = [
      vi.spyOn(fsPromises, "writeFile"),
      vi.spyOn(fsPromises, "unlink"),
      vi.spyOn(fsPromises, "rm"),
      vi.spyOn(nodeFs, "writeFileSync"),
      vi.spyOn(nodeFs, "appendFileSync"),
      vi.spyOn(nodeFs, "truncateSync"),
      vi.spyOn(nodeFs, "writeSync"),
      vi.spyOn(nodeFs, "unlinkSync"),
      vi.spyOn(nodeFs, "renameSync"),
      vi.spyOn(nodeFs, "rmSync"),
      vi.spyOn(nodeFs, "openSync"),
    ];
    // These two are the pair a real write goes through, so both carry
    // a positive control below: a probe that cannot see a write proves
    // nothing about reads.
    const renames = vi.spyOn(fsPromises, "rename");
    const opens = vi.spyOn(fsPromises, "open");
    try {
      const manager = makeManager();
      await manager.activeCredential();
      await manager.sessions();
      await (await manager.activeCredentialStorage()).getTokens();

      const adopting = new FileCredentialManager({
        env: { PRISMA_AUTH_FILE: legacyPath },
      });
      await adopting.activeCredential();
      await adopting.sessions();

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(renames).not.toHaveBeenCalled();
      expect(opens).not.toHaveBeenCalled();

      await manager.endAllSessions();
      expect(renames).toHaveBeenCalled();
      expect(opens).toHaveBeenCalled();
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
      renames.mockRestore();
      opens.mockRestore();
    }
  });

  it("writes through a same-directory temp file that is synced before the rename", async () => {
    const order: string[] = [];
    const realOpen = fsPromises.open.bind(fsPromises);
    const realRename = fsPromises.rename.bind(fsPromises);
    const opens = vi
      .spyOn(fsPromises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fsPromises.open>) => {
          const handle = await realOpen(...args);
          if (!String(args[0]).endsWith(".tmp")) return handle;
          order.push(`open ${String(args[0])}`);
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            order.push("sync");
            await sync();
          };
          return handle;
        },
      );
    const renames = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        order.push(`rename ${String(from)} -> ${String(to)}`);
        await realRename(from, to);
      });
    try {
      await makeManager().createSession(
        credentialFor(WORKSPACE_A),
        WORKSPACE_A,
      );
    } finally {
      opens.mockRestore();
      renames.mockRestore();
    }

    const stateDir = path.dirname(stateFilePath);
    expect(order).toEqual([
      expect.stringMatching(
        new RegExp(`^open ${escapeForRegExp(stateFilePath)}\\..+\\.tmp$`),
      ),
      "sync",
      expect.stringMatching(
        new RegExp(
          `^rename ${escapeForRegExp(stateFilePath)}\\..+\\.tmp -> ${escapeForRegExp(stateFilePath)}$`,
        ),
      ),
    ]);
    expect(
      (await readdir(stateDir)).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("leaves no temp file behind when the write fails before the rename", async () => {
    const realOpen = fsPromises.open.bind(fsPromises);
    const opens = vi
      .spyOn(fsPromises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fsPromises.open>) => {
          const handle = await realOpen(...args);
          if (!String(args[0]).endsWith(".tmp")) return handle;
          handle.sync = async () => {
            throw Object.assign(new Error("no space left on device"), {
              code: "ENOSPC",
            });
          };
          return handle;
        },
      );
    try {
      await expect(
        makeManager().createSession(credentialFor(WORKSPACE_A), WORKSPACE_A),
      ).rejects.toThrow(NO_SPACE_LEFT);
    } finally {
      opens.mockRestore();
    }

    // A stranded temp file holds the whole state, tokens included.
    expect(
      (await readdir(path.dirname(stateFilePath))).filter((entry) =>
        entry.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("lets only one of two waiting mutations clear the same crashed holder's lock", async () => {
    await makeManager().createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    const lockPath = `${stateFilePath}.lock`;
    await writeFile(lockPath, "crashed-holder", "utf8");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lockPath, longAgo, longAgo);

    // Two hooks reproduce the worst interleaving deterministically,
    // rather than leaving it to the scheduler. Windows produced it
    // naturally and macOS did not, which is exactly the kind of race
    // that regresses unnoticed on one platform.
    //
    // First: hold both waiters until each has seen the lock as stale,
    // so both believe they may clear it.
    const bothSawItStale = barrierFor(2);
    const realStat = fsPromises.stat.bind(fsPromises);
    const stats = vi
      .spyOn(fsPromises, "stat")
      .mockImplementation(
        async (...args: Parameters<typeof fsPromises.stat>) => {
          const result = await realStat(...args);
          if (String(args[0]).endsWith(".lock")) await bothSawItStale();
          return result;
        },
      );

    // Second: hold the loser's removal until the winner has created its
    // fresh lock. The loser is then about to remove a lock that is not
    // the corpse it examined, which is the case the takeover has to
    // detect. The winner's create is the signal, so watch for it
    // directly rather than polling the filesystem.
    let announceFreshLock: () => void = () => {};
    const freshLockExists = new Promise<void>((resolve) => {
      announceFreshLock = resolve;
    });
    const realOpen = fsPromises.open.bind(fsPromises);
    const opens = vi
      .spyOn(fsPromises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fsPromises.open>) => {
          const handle = await realOpen(...args);
          if (String(args[0]).endsWith(".lock")) announceFreshLock();
          return handle;
        },
      );

    let removals = 0;
    const realRename = fsPromises.rename.bind(fsPromises);
    const renames = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        if (String(to).endsWith(".stale")) {
          removals += 1;
          if (removals === 2) {
            // Bounded: if the winner released before the loser looked,
            // there is no fresh lock to wait for and no race to force.
            await Promise.race([
              freshLockExists,
              new Promise((resolve) => setTimeout(resolve, 250)),
            ]);
          }
        }
        return realRename(from, to);
      });

    const debugLines: string[] = [];
    try {
      await Promise.all(
        [WORKSPACE_B, WORKSPACE_C].map((workspaceId) =>
          makeManager({
            env: { PRISMA_DEBUG: "1" },
            debugWrite: (text) => debugLines.push(text),
          }).createSession(credentialFor(workspaceId), workspaceId),
        ),
      );
    } finally {
      stats.mockRestore();
      renames.mockRestore();
      opens.mockRestore();
    }

    // At most one: if the winner released before the loser looked,
    // there was no corpse left to clear and zero is also correct. Two
    // is the defect — both would have entered the critical section.
    const takeovers = debugLines.filter((line) => line.includes("taken over"));
    expect(takeovers.length).toBeLessThanOrEqual(1);
    const state = await readCredentialState(stateFilePath);
    expect(
      [...state.sessions.map((session) => session.workspaceId)].sort(),
    ).toEqual([WORKSPACE_A, WORKSPACE_B, WORKSPACE_C]);
  });

  it("times out instead of spinning when a stale lock cannot be cleared at all", async () => {
    const lockPath = `${stateFilePath}.lock`;
    await writeFile(lockPath, "crashed-holder", "utf8");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lockPath, longAgo, longAgo);

    // A stale lock in a directory the process cannot write to: every
    // attempt to clear it fails. The acquisition loop must still reach
    // its timeout rather than retrying flat out forever.
    let attempts = 0;
    const renames = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from) => {
        if (!String(from).endsWith(".lock")) throw new Error("unexpected");
        attempts += 1;
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mutation = makeManager().createSession(
        credentialFor(WORKSPACE_A),
        WORKSPACE_A,
      );
      const settled = expect(mutation).rejects.toMatchObject({
        code: "CLI.CREDENTIALS_LOCKED",
      });
      await vi.advanceTimersByTimeAsync(11_000);
      await settled;
    } finally {
      vi.useRealTimers();
      renames.mockRestore();
    }

    // Retries are paced by the sleep, not run flat out.
    expect(attempts).toBeLessThan(2_000);
  });

  it("reaps a temp file a dead write left behind when the user logs out", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    const orphan = `${stateFilePath}.abandoned.tmp`;
    await writeFile(orphan, await readFile(stateFilePath, "utf8"), "utf8");

    await manager.endAllSessions();

    await expect(stat(orphan)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a corrupt file as signed out and never rewrites it", async () => {
    await writeFile(stateFilePath, "{ not json", "utf8");
    const before = await readRawState();

    const manager = makeManager();
    expect(await manager.activeCredential()).toBeNull();
    expect(await manager.sessions()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
    expect(await readRawState()).toBe(before);
  });
});

describe("process pinning", () => {
  it("pins the credential at the first read and keeps it when another process moves the selection", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    await makeManager().selectSession(WORKSPACE_A);

    const pinned = await manager.activeCredential();
    expect(pinned?.workspaceId).toBe(WORKSPACE_A);

    await makeManager().selectSession(WORKSPACE_B);

    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_A);
    expect((await makeManager().activeCredential())?.workspaceId).toBe(
      WORKSPACE_B,
    );
  });

  it("moves the pin on this process's own mutations", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_B);

    await manager.selectSession(WORKSPACE_A);
    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_A);

    await manager.endSession(WORKSPACE_A);
    await expect(manager.activeCredential()).rejects.toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
    });
  });

  it("reads the material through the file, so another process's replacement is visible", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    expect((await manager.activeCredential())?.expiresAt).toBeUndefined();

    await makeManager().createSession(
      {
        token: mintToken(WORKSPACE_B, { exp: 2_000_000_000 }),
        refreshToken: "refresh-2",
        expiresAt: undefined,
      },
      WORKSPACE_B,
    );

    expect((await manager.activeCredential())?.expiresAt).toEqual(
      new Date(2_000_000_000 * 1000),
    );
  });

  it("fails with the session-ended error when another process ends the pinned session", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    await manager.activeCredential();

    await makeManager().endSession(WORKSPACE_B);

    await expect(manager.activeCredential()).rejects.toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
      message: "The workspace session this command was using has ended.",
    });
  });

  it("reports sessions held but none selected", async () => {
    await seedTwoSessions();
    await makeManager().endSession(WORKSPACE_B);

    await expect(makeManager().activeCredential()).rejects.toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
      why: "You have workspace sessions but none is current.",
    });
  });
});

describe("removal is idempotent", () => {
  /** Design §11.10, test 6. The rename is the last step of every write,
   *  so watching it says "wrote nothing" rather than "wrote the same
   *  bytes"; ending a session that exists is the positive control. */
  it("succeeds and writes nothing when the workspace has no session", async () => {
    await seedTwoSessions();
    const before = await readRawState();
    const manager = makeManager();
    const renames = vi.spyOn(fsPromises, "rename");

    try {
      await expect(manager.endSession(WORKSPACE_C)).resolves.toBeUndefined();
      expect(renames).not.toHaveBeenCalled();

      await manager.endSession(WORKSPACE_A);
      expect(renames).toHaveBeenCalled();
    } finally {
      renames.mockRestore();
    }

    expect(before).not.toBeNull();
    expect(await readRawState()).not.toBe(before);
  });

  it("succeeds when another process removed the session first", async () => {
    await seedTwoSessions();
    const manager = makeManager();
    await makeManager().endSession(WORKSPACE_A);

    await expect(manager.endSession(WORKSPACE_A)).resolves.toBeUndefined();

    expect(
      (await readCredentialState(stateFilePath)).sessions.map(
        (session) => session.workspaceId,
      ),
    ).toEqual([WORKSPACE_B]);
  });

  it("still refuses to select a workspace with no session", async () => {
    await seedTwoSessions();

    await expect(
      makeManager().selectSession(WORKSPACE_C),
    ).rejects.toMatchObject({ code: "AUTH.NO_SESSION_FOR_WORKSPACE" });
  });
});

describe("mutations while an environment credential is in force", () => {
  /** Design §11.7 and §11.10 test 8: the refusals are gone. Selecting or
   *  ending a stored session changes stored state; this process keeps
   *  authenticating as the environment credential either way. */
  it("lets every mutation through and leaves the pin on the environment credential", async () => {
    await seedTwoSessions();
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_C) },
    });
    expect((await manager.activeCredential())?.origin.source).toBe(
      "environment",
    );

    await expect(
      manager.createSession(
        credentialFor(WORKSPACE_A, "refresh-env"),
        WORKSPACE_A,
      ),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE_A });
    await expect(manager.selectSession(WORKSPACE_B)).resolves.toMatchObject({
      workspaceId: WORKSPACE_B,
    });
    await expect(manager.endSession(WORKSPACE_B)).resolves.toBeUndefined();
    await expect(manager.endAllSessions()).resolves.toBeUndefined();

    expect(await readCredentialState(stateFilePath)).toMatchObject({
      sessions: [],
      currentWorkspaceId: null,
    });
    expect((await manager.activeCredential())?.origin.source).toBe(
      "environment",
    );
    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_C);
  });

  it("moves the stored selection without moving the pin", async () => {
    await seedTwoSessions();
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_C) },
    });
    await manager.activeCredential();

    await manager.selectSession(WORKSPACE_A);

    expect((await manager.sessions()).selectedWorkspaceId).toBe(WORKSPACE_A);
    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_C);
  });

  for (const [name, token] of [
    ["blank", ""],
    ["whitespace", "   "],
  ] as const) {
    it(`refuses every mutation with the env token ${name}, changing nothing`, async () => {
      await seedTwoSessions();
      const before = await readRawState();
      const manager = makeManager({ env: { PRISMA_SERVICE_TOKEN: token } });
      const blank = { code: "AUTH.SERVICE_TOKEN_EMPTY" };

      await expect(
        manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A),
      ).rejects.toMatchObject(blank);
      await expect(manager.selectSession(WORKSPACE_A)).rejects.toMatchObject(
        blank,
      );
      await expect(manager.endSession(WORKSPACE_A)).rejects.toMatchObject(
        blank,
      );
      await expect(manager.endAllSessions()).rejects.toMatchObject(blank);
      expect(await readRawState()).toBe(before);
    });
  }

  it("lets every mutation through with the env token unset", async () => {
    await seedTwoSessions();
    const manager = makeManager();

    await expect(
      manager.createSession(
        credentialFor(WORKSPACE_A, "refresh-unset"),
        WORKSPACE_A,
      ),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE_A });
    await expect(manager.selectSession(WORKSPACE_A)).resolves.toMatchObject({
      workspaceId: WORKSPACE_A,
    });
    await expect(manager.endSession(WORKSPACE_A)).resolves.toBeUndefined();
    await expect(manager.endAllSessions()).resolves.toBeUndefined();

    expect(await readCredentialState(stateFilePath)).toMatchObject({
      sessions: [],
      currentWorkspaceId: null,
    });
  });

  it("writes no state file when endAllSessions has nothing to clear", async () => {
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_B) },
    });
    await expect(manager.endAllSessions()).resolves.toBeUndefined();
    expect(await readRawState()).toBeNull();
  });

  it("still reaps the legacy context sidecar when there is nothing to clear", async () => {
    const sidecarPath = getAuthContextFilePath(stateFilePath);
    await writeFile(
      sidecarPath,
      JSON.stringify({ activeWorkspaceId: WORKSPACE_A }),
      "utf8",
    );
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_B) },
    });

    await expect(manager.endAllSessions()).resolves.toBeUndefined();

    await expect(stat(sidecarPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("raises the blank-token error from activeCredential", async () => {
    const manager = makeManager({ env: { PRISMA_SERVICE_TOKEN: "  " } });
    await expect(manager.activeCredential()).rejects.toMatchObject({
      code: "AUTH.SERVICE_TOKEN_EMPTY",
    });
  });
});

describe("the environment credential", () => {
  /** Design §11.10, test 7: nothing manufactures an empty workspace id. */
  it("reports no workspace id when the token's claims name none", async () => {
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintTestJwt({ sub: "usr_1" }) },
    });

    const active = await manager.activeCredential();

    expect(active).toMatchObject({
      workspaceName: undefined,
      identity: { userId: "usr_1" },
      origin: { source: "environment" },
    });
    expect(active?.workspaceId).toBeUndefined();
  });

  it("reports the workspace a service token's sub names", async () => {
    const manager = makeManager({
      env: {
        PRISMA_SERVICE_TOKEN: mintTestJwt({ sub: `workspace:${WORKSPACE_B}` }),
      },
    });

    expect((await manager.activeCredential())?.workspaceId).toBe(WORKSPACE_B);
  });

  /** Design §11.2 and §11.10 tests 2 and 3: the memory-backed storage
   *  closes over a local variable and is never given the file path, so
   *  no method of it can reach the stored sessions. */
  it("rotates in memory and leaves the state file byte-unchanged", async () => {
    await seedTwoSessions();
    const before = await readRawState();
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_A) },
    });

    const storage = await storageFor(manager);
    expect(await storage.getTokens()).toMatchObject({
      workspaceId: WORKSPACE_A,
      accessToken: mintToken(WORKSPACE_A),
      refreshToken: undefined,
    });

    const rotated = mintToken(WORKSPACE_A, { exp: 2_000_000_000 });
    await storage.setTokens({
      workspaceId: WORKSPACE_A,
      accessToken: rotated,
      refreshToken: "rotated-refresh",
    });

    expect(await storage.getTokens()).toMatchObject({
      accessToken: rotated,
      refreshToken: "rotated-refresh",
    });
    expect(await readRawState()).toBe(before);
  });

  it("cannot delete the stored session its workspace matches", async () => {
    await seedTwoSessions();
    const before = await readRawState();
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintToken(WORKSPACE_A) },
    });

    const storage = await storageFor(manager);
    await storage.clearTokens();

    expect(storage.clearTokensIfCurrent).toBeUndefined();
    expect(await storage.getTokens()).toBeNull();
    expect(await readRawState()).toBe(before);
    expect(
      (await manager.sessions()).sessions.map((session) => session.workspaceId),
    ).toEqual([WORKSPACE_A, WORKSPACE_B]);
  });

  it("keys the token set by a fixed constant when the claims name no workspace", async () => {
    const manager = makeManager({
      env: { PRISMA_SERVICE_TOKEN: mintTestJwt({ sub: "usr_1" }) },
    });

    const tokens = await (await storageFor(manager)).getTokens();

    expect(tokens?.workspaceId).toBe("(no workspace)");
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
    await makeManager().endSession(WORKSPACE_A);
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

describe("the file-backed TokenStorage", () => {
  it("writes only the token fields on rotation and re-derives the expiry", async () => {
    const manager = makeManager({
      fetchWorkspaceName: async () => "Workspace A",
    });
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    await makeManager().createSession(credentialFor(WORKSPACE_B), WORKSPACE_B);

    const rotated = mintToken(WORKSPACE_A, { exp: 2_000_000_000 });
    await (await storageFor(manager)).setTokens({
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
    const storage = await storageFor(manager);

    await makeManager().endSession(WORKSPACE_A);

    await expect(
      storage.setTokens({
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
      (await storageFor(manager)).setTokens({
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
    const storage = await storageFor(manager);

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

  it("clearTokens removes only the pinned record", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    await makeManager().createSession(credentialFor(WORKSPACE_B), WORKSPACE_B);

    await (await storageFor(manager)).clearTokens();

    const state = await readCredentialState(stateFilePath);
    expect(state.sessions.map((session) => session.workspaceId)).toEqual([
      WORKSPACE_B,
    ]);
    expect(state.currentWorkspaceId).toBe(WORKSPACE_B);
  });

  it("serializes refreshes in this process", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    const storage = await storageFor(manager);
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
    const storage = await storageFor(manager);
    expect((await storage.getTokens())?.refreshToken).toBe("refresh-1");

    await makeManager().createSession(
      credentialFor(WORKSPACE_A, "refresh-2"),
      WORKSPACE_A,
    );
    expect((await storage.getTokens())?.refreshToken).toBe("refresh-2");
  });
});

describe("token material never leaks", () => {
  it("keeps the secret out of the debug lines of every write path and out of errors", async () => {
    const secret = "s3cret-refresh-token";
    const rotatedSecret = "s3cret-rotated-refresh-token";
    const debugLines: string[] = [];
    const manager = makeManager({
      env: { PRISMA_DEBUG: "1" },
      debugWrite: (text) => debugLines.push(text),
    });
    const credential = {
      token: mintToken(WORKSPACE_A),
      refreshToken: secret,
      expiresAt: undefined,
    };
    await manager.createSession(credential, WORKSPACE_A);
    const storage = await storageFor(manager);

    const rotated = mintToken(WORKSPACE_A, { exp: 2_000_000_000 });
    await storage.setTokens({
      workspaceId: WORKSPACE_A,
      accessToken: rotated,
      refreshToken: rotatedSecret,
    });
    await storage.clearTokensIfCurrent?.({
      workspaceId: WORKSPACE_A,
      accessToken: rotated,
      refreshToken: rotatedSecret,
    });

    const secondProcess = makeManager({
      env: { PRISMA_DEBUG: "1" },
      debugWrite: (text) => debugLines.push(text),
    });
    await secondProcess.createSession(
      {
        token: mintToken(WORKSPACE_B),
        refreshToken: secret,
        expiresAt: undefined,
      },
      WORKSPACE_B,
    );
    await (await storageFor(secondProcess)).clearTokens();

    const errors = [
      await manager
        .createSession(credential, WORKSPACE_B)
        .catch((error: unknown) => error),
      await storage
        .setTokens({
          workspaceId: WORKSPACE_A,
          accessToken: rotated,
          refreshToken: rotatedSecret,
        })
        .catch((error: unknown) => error),
    ];

    const rendered = [
      debugLines.join(""),
      ...errors.map((error) =>
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      ),
    ].join("");
    for (const material of [secret, rotatedSecret, credential.token, rotated]) {
      expect(rendered).not.toContain(material);
    }
    expect(debugLines.join("")).toContain(`rotation write for session`);
    expect(debugLines.join("")).toContain(`clearing session`);
  });
});

describe("rotation durability", () => {
  it("has the rotated pair on disk by the time setTokens resolves", async () => {
    const manager = makeManager();
    await manager.createSession(credentialFor(WORKSPACE_A), WORKSPACE_A);
    const storage = await storageFor(manager);
    const rotated = mintToken(WORKSPACE_A, { exp: 2_000_000_000 });

    let renamedBeforeResolve = false;
    const realRename = fsPromises.rename.bind(fsPromises);
    const renames = vi
      .spyOn(fsPromises, "rename")
      .mockImplementation(async (from, to) => {
        await realRename(from, to);
        renamedBeforeResolve = true;
      });
    try {
      await storage.setTokens({
        workspaceId: WORKSPACE_A,
        accessToken: rotated,
        refreshToken: "refresh-2",
      });
    } finally {
      renames.mockRestore();
    }

    expect(renamedBeforeResolve).toBe(true);
    expect(JSON.parse((await readRawState()) ?? "")).toMatchObject({
      sessions: [{ workspaceId: WORKSPACE_A, token: rotated }],
    });
  });
});
