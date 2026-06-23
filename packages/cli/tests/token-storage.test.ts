import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FileTokenStorage,
  getAuthContextFilePath,
  RefreshLockTimeoutError,
} from "../src/adapters/token-storage";
import { createTempCwd } from "./helpers";

async function writeAuthFile(
  authFilePath: string,
  tokens: unknown[],
): Promise<void> {
  await fs.mkdir(path.dirname(authFilePath), { recursive: true });
  await fs.writeFile(authFilePath, JSON.stringify({ tokens }, null, 2));
}

describe("FileTokenStorage", () => {
  it("migrates an existing single-workspace auth file to an active workspace context", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token",
        refreshToken: "refresh-token",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });

    await expect(
      fs
        .readFile(getAuthContextFilePath(authFilePath), "utf8")
        .then(JSON.parse),
    ).resolves.toMatchObject({
      activeWorkspaceId: "workspace-1",
    });
  });

  it("uses the active workspace context instead of the latest stored credential", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await storage.useWorkspace("workspace-1");

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
  });

  it("uses PRISMA_CLI_WORKSPACE_ID without changing the active workspace", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "cmmxworkspace1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "cmmxworkspace2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const baseEnv = {
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv;
    const storage = new FileTokenStorage(baseEnv);
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });
    await storage.useWorkspace("cmmxworkspace1");

    const overrideStorage = new FileTokenStorage({
      ...baseEnv,
      PRISMA_CLI_WORKSPACE_ID: "wksp_cmmxworkspace2",
    } as NodeJS.ProcessEnv);

    await expect(overrideStorage.getTokens()).resolves.toEqual({
      workspaceId: "cmmxworkspace2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "cmmxworkspace1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await expect(storage.listWorkspaces()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialWorkspaceId: "cmmxworkspace1",
          active: true,
        }),
        expect.objectContaining({
          credentialWorkspaceId: "cmmxworkspace2",
          active: false,
        }),
      ]),
    );
  });

  it("does not migrate or write active workspace context when PRISMA_CLI_WORKSPACE_ID is used", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_CLI_WORKSPACE_ID: "workspace-1",
    } as NodeJS.ProcessEnv);

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await expect(
      fs.stat(getAuthContextFilePath(authFilePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("can list workspaces without migrating or writing active workspace context", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await expect(
      storage.listWorkspaces({ migrateAuthContext: false }),
    ).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "workspace-1",
        active: false,
      }),
      expect.objectContaining({
        credentialWorkspaceId: "workspace-2",
        active: false,
      }),
    ]);
    await expect(
      fs.stat(getAuthContextFilePath(authFilePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create a signed-out context when remembering metadata under PRISMA_CLI_WORKSPACE_ID", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_CLI_WORKSPACE_ID: "workspace-1",
    } as NodeJS.ProcessEnv);

    await storage.rememberWorkspace("workspace-1", {
      id: "wksp_workspace1",
      name: "Acme Inc",
    });

    await expect(
      fs.stat(getAuthContextFilePath(authFilePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create a signed-out context when clearing current PRISMA_CLI_WORKSPACE_ID tokens", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_CLI_WORKSPACE_ID: "workspace-1",
    } as NodeJS.ProcessEnv);

    await storage.clearTokensIfCurrent({
      workspaceId: "workspace-1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });

    await expect(storage.listWorkspaceTokens()).resolves.toEqual([
      {
        workspaceId: "workspace-2",
        accessToken: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);
    await expect(
      fs.stat(getAuthContextFilePath(authFilePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not match PRISMA_CLI_WORKSPACE_ID by workspace name", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "cmmxworkspace2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });

    const overrideStorage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_CLI_WORKSPACE_ID: "Prisma Labs",
    } as NodeJS.ProcessEnv);

    await expect(overrideStorage.getTokens()).rejects.toMatchObject({
      reason: "not-found",
      workspaceRef: "Prisma Labs",
    });
  });

  it("treats an empty PRISMA_CLI_WORKSPACE_ID as invalid", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_CLI_WORKSPACE_ID: "  ",
    } as NodeJS.ProcessEnv);

    await expect(storage.getTokens()).rejects.toThrow(
      "PRISMA_CLI_WORKSPACE_ID is set but empty. Provide a workspace id from prisma-cli auth workspace list, or unset the variable.",
    );
  });

  it("reports an empty PRISMA_CLI_WORKSPACE_ID before reading credentials", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await fs.mkdir(authFilePath, { recursive: true });

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_CLI_WORKSPACE_ID: "  ",
    } as NodeJS.ProcessEnv);

    await expect(storage.getTokens()).rejects.toThrow(
      "PRISMA_CLI_WORKSPACE_ID is set but empty. Provide a workspace id from prisma-cli auth workspace list, or unset the variable.",
    );
  });

  it("recovers from a malformed auth context file by migrating to the latest valid credential", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);
    await fs.writeFile(getAuthContextFilePath(authFilePath), "{ nope");

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await expect(
      fs
        .readFile(getAuthContextFilePath(authFilePath), "utf8")
        .then(JSON.parse),
    ).resolves.toMatchObject({
      activeWorkspaceId: "workspace-2",
    });
  });

  it("propagates unexpected auth context read errors", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, []);
    await fs.mkdir(getAuthContextFilePath(authFilePath), { recursive: true });

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await expect(storage.listWorkspaces()).rejects.toMatchObject({
      code: expect.any(String),
    });
  });

  it("does not reactivate another workspace when refresh stores updated tokens", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv;
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage(env);
    await storage.useWorkspace("workspace-2");

    const refreshStorage = new FileTokenStorage(env, undefined, {
      activateOnSetTokens: false,
    });
    await refreshStorage.setTokens({
      workspaceId: "workspace-1",
      accessToken: "new-access-token-1",
      refreshToken: "new-refresh-token-1",
    });

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await expect(storage.listWorkspaces()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialWorkspaceId: "workspace-1",
          active: false,
        }),
        expect.objectContaining({
          credentialWorkspaceId: "workspace-2",
          active: true,
        }),
      ]),
    );
  });

  it("does not activate a workspace from refresh storage when the active pointer is intentionally empty", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv;
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
    ]);

    const storage = new FileTokenStorage(env);
    await storage.useWorkspace("workspace-1");
    await storage.logoutWorkspace("workspace-1");

    const refreshStorage = new FileTokenStorage(env, undefined, {
      activateOnSetTokens: false,
    });
    await refreshStorage.setTokens({
      workspaceId: "workspace-1",
      accessToken: "new-access-token-1",
      refreshToken: "new-refresh-token-1",
    });

    await expect(storage.getTokens()).resolves.toBeNull();
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "workspace-1",
        active: false,
      }),
    ]);
  });

  it("keeps a workspace switch ordered after an in-flight refresh write", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv;
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const switchStorage = new FileTokenStorage(env);
    await switchStorage.useWorkspace("workspace-1");

    const refreshStorage = new FileTokenStorage(env, undefined, {
      activateOnSetTokens: false,
      lockSetTokens: false,
    });
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });

    const refresh = refreshStorage.withRefreshLock(async () => {
      await refreshStorage.setTokens({
        workspaceId: "workspace-1",
        accessToken: "new-access-token-1",
        refreshToken: "new-refresh-token-1",
      });
      markRefreshStarted();
      await refreshReleased;
    });
    await refreshStarted;

    const switchWorkspace = switchStorage.useWorkspace("workspace-2");
    await new Promise((resolve) => setImmediate(resolve));

    await expect(switchStorage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-1",
      accessToken: "new-access-token-1",
      refreshToken: "new-refresh-token-1",
    });

    releaseRefresh();
    await Promise.all([refresh, switchWorkspace]);

    await expect(switchStorage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
  });

  it("switches by cached canonical workspace id", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "cmmxworkspace1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "cmmxworkspace2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Acme Inc",
    });
    await storage.useWorkspace("wksp_cmmxworkspace2");

    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace2",
    });
  });

  it("switches by cached workspace name case-insensitively", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "cmmxworkspace1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "cmmxworkspace2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Acme Inc",
    });
    await storage.useWorkspace("acme inc");

    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace2",
    });
  });

  it("clears every stored workspace token on logout", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);

    await storage.clearTokens();

    await expect(storage.getTokens()).resolves.toBeNull();
    await expect(
      fs.readFile(authFilePath, "utf8").then(JSON.parse),
    ).resolves.toEqual({ tokens: [] });
    await expect(
      fs.stat(getAuthContextFilePath(authFilePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("orders full logout after in-flight refresh work", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
    ]);

    const env = {
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv;
    const refreshStorage = new FileTokenStorage(env);
    const logoutStorage = new FileTokenStorage(env);
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    const refresh = refreshStorage.withRefreshLock(async () => {
      markRefreshStarted();
      await refreshReleased;
    });
    await refreshStarted;

    const logout = logoutStorage.clearTokens();
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      fs.readFile(authFilePath, "utf8").then(JSON.parse),
    ).resolves.toEqual({
      tokens: [
        {
          workspaceId: "workspace-1",
          token: "access-token-1",
          refreshToken: "refresh-token-1",
        },
      ],
    });

    releaseRefresh();
    await Promise.all([refresh, logout]);

    await expect(
      fs.readFile(authFilePath, "utf8").then(JSON.parse),
    ).resolves.toEqual({ tokens: [] });
    await expect(
      fs.stat(getAuthContextFilePath(authFilePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("logs out an inactive workspace without changing the active workspace", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    await storage.useWorkspace("workspace-1");

    await expect(storage.logoutWorkspace("workspace-2")).resolves.toEqual({
      workspace: expect.objectContaining({
        credentialWorkspaceId: "workspace-2",
      }),
      wasActive: false,
      activeWorkspace: expect.objectContaining({
        credentialWorkspaceId: "workspace-1",
      }),
    });

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await expect(
      fs.readFile(authFilePath, "utf8").then(JSON.parse),
    ).resolves.toEqual({
      tokens: [
        {
          workspaceId: "workspace-1",
          token: "access-token-1",
          refreshToken: "refresh-token-1",
        },
      ],
    });
  });

  it("logs out one of three workspaces without changing the surviving active workspace", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
      {
        workspaceId: "workspace-3",
        token: "access-token-3",
        refreshToken: "refresh-token-3",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    await storage.useWorkspace("workspace-2");

    await expect(storage.logoutWorkspace("workspace-1")).resolves.toEqual({
      workspace: expect.objectContaining({
        credentialWorkspaceId: "workspace-1",
      }),
      wasActive: false,
      activeWorkspace: expect.objectContaining({
        credentialWorkspaceId: "workspace-2",
      }),
    });

    await expect(storage.getTokens()).resolves.toEqual({
      workspaceId: "workspace-2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await expect(storage.listWorkspaces()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialWorkspaceId: "workspace-2",
          active: true,
        }),
        expect.objectContaining({
          credentialWorkspaceId: "workspace-3",
          active: false,
        }),
      ]),
    );
  });

  it("logs out the active workspace without falling through to another workspace", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    await storage.useWorkspace("workspace-2");

    await expect(storage.logoutWorkspace("workspace-2")).resolves.toEqual({
      workspace: expect.objectContaining({
        credentialWorkspaceId: "workspace-2",
      }),
      wasActive: true,
      activeWorkspace: null,
    });

    await expect(storage.getTokens()).resolves.toBeNull();
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "workspace-1",
        active: false,
      }),
    ]);
  });

  it("clears only the active matching workspace when refresh invalidation wins the race", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "workspace-1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
      {
        workspaceId: "workspace-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
      },
    ]);

    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    await storage.useWorkspace("workspace-2");

    await storage.clearTokensIfCurrent({
      workspaceId: "workspace-2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });

    await expect(
      fs.readFile(authFilePath, "utf8").then(JSON.parse),
    ).resolves.toEqual({
      tokens: [
        {
          workspaceId: "workspace-1",
          token: "access-token-1",
          refreshToken: "refresh-token-1",
        },
      ],
    });
    await expect(storage.getTokens()).resolves.toBeNull();
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "workspace-1",
        active: false,
      }),
    ]);
  });

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

    await new Promise((resolve) => setImmediate(resolve));
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

  it("stops waiting for the refresh lock when the command signal is aborted", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const firstStorage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    const controller = new AbortController();
    const secondStorage = new FileTokenStorage(
      {
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      } as NodeJS.ProcessEnv,
      controller.signal,
    );
    const reason = new Error("cancelled");
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = firstStorage.withRefreshLock(async () => {
      markFirstStarted();
      await firstReleased;
    });
    await firstStarted;

    const second = secondStorage.withRefreshLock(async () => undefined);
    controller.abort(reason);

    await expect(second).rejects.toBe(reason);
    releaseFirst();
    await first;
  });

  it("fails loudly when waiting for the refresh lock times out", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const firstStorage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    const secondStorage = new FileTokenStorage(
      {
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      } as NodeJS.ProcessEnv,
      undefined,
      {
        lockRetryMs: 1,
        lockStaleMs: 10_000,
        lockWaitTimeoutMs: 5,
      },
    );
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = firstStorage.withRefreshLock(async () => {
      markFirstStarted();
      await firstReleased;
    });
    await firstStarted;

    await expect(
      secondStorage.withRefreshLock(async () => undefined),
    ).rejects.toBeInstanceOf(RefreshLockTimeoutError);

    releaseFirst();
    await first;
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

  it("does not remove another caller's active lock after stale takeover", async () => {
    const cwd = await createTempCwd();
    const authFilePath = path.join(cwd, "auth.json");
    const lockFilePath = `${authFilePath}.lock`;
    const firstStorage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    const secondStorage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    let releaseSecond!: () => void;
    let markSecondStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const secondReleased = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const first = firstStorage.withRefreshLock(async () => {
      events.push("first:start");
      markFirstStarted();
      await firstReleased;
      events.push("first:end");
    });

    await firstStarted;
    const firstLockId = await fs.readFile(lockFilePath, "utf8");
    const staleTime = new Date(Date.now() - 31_000);
    await fs.utimes(lockFilePath, staleTime, staleTime);

    const second = secondStorage.withRefreshLock(async () => {
      events.push("second:start");
      markSecondStarted();
      await secondReleased;
      events.push("second:end");
    });

    await secondStarted;
    const secondLockId = await fs.readFile(lockFilePath, "utf8");
    expect(secondLockId).not.toEqual(firstLockId);

    releaseFirst();
    await first;

    await expect(fs.readFile(lockFilePath, "utf8")).resolves.toBe(secondLockId);

    releaseSecond();
    await second;

    expect(events).toEqual([
      "first:start",
      "second:start",
      "first:end",
      "second:end",
    ]);
    await expect(fs.stat(lockFilePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
