import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { FileTokenStorage } from "../src/auth";
import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function writeAuthFile(
  authFilePath: string,
  tokens: unknown[],
): Promise<void> {
  await mkdir(path.dirname(authFilePath), { recursive: true });
  await writeFile(authFilePath, JSON.stringify({ tokens }, null, 2));
}

describe("auth commands", () => {
  it("switches real OAuth storage by canonical workspace id", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
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
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });
    await storage.useWorkspace("wksp_cmmxworkspace1");

    const result = await executeCli({
      argv: ["auth", "workspace", "use", "wksp_cmmxworkspace2", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.use",
      result: {
        previousWorkspace: {
          id: "wksp_cmmxworkspace1",
          name: "Acme Inc",
        },
        workspace: {
          id: "wksp_cmmxworkspace2",
          name: "Prisma Labs",
        },
      },
    });
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace2",
    });
  });

  it("selects the only real OAuth workspace without prompting when no workspace argument is provided", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "cmmxworkspace1",
        token: "access-token-1",
        refreshToken: "refresh-token-1",
      },
    ]);
    const storage = new FileTokenStorage({
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
    } as NodeJS.ProcessEnv);
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });

    const result = await executeCli({
      argv: ["auth", "workspace", "use", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.use",
      result: {
        previousWorkspace: null,
        workspace: {
          id: "wksp_cmmxworkspace1",
          name: "Acme Inc",
        },
      },
    });
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace1",
    });
  });

  it("logs out one real OAuth workspace by canonical workspace id", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
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
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });
    await storage.useWorkspace("wksp_cmmxworkspace2");

    const result = await executeCli({
      argv: ["auth", "workspace", "logout", "wksp_cmmxworkspace2", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.logout",
      result: {
        workspace: {
          id: "wksp_cmmxworkspace2",
          name: "Prisma Labs",
        },
        wasActive: true,
        activeWorkspace: null,
      },
    });
    await expect(storage.getTokens()).resolves.toBeNull();
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "cmmxworkspace1",
        active: false,
      }),
    ]);
  });

  it("logs out one real OAuth workspace while PRISMA_SERVICE_TOKEN is set", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
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
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });
    await storage.useWorkspace("wksp_cmmxworkspace1");

    const result = await executeCli({
      argv: ["auth", "workspace", "logout", "wksp_cmmxworkspace2", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: "service-token",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.logout",
      result: {
        workspace: {
          id: "wksp_cmmxworkspace2",
          name: "Prisma Labs",
        },
        wasActive: false,
        activeWorkspace: {
          id: "wksp_cmmxworkspace1",
          name: "Acme Inc",
        },
      },
    });
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace1",
    });
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "cmmxworkspace1",
        active: true,
      }),
    ]);
  });

  it("returns WORKSPACE_NOT_AUTHENTICATED for workspace logout when no cached workspace matches", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");

    const result = await executeCli({
      argv: ["auth", "workspace", "logout", "wksp_missing", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: "service-token",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "auth.workspace.logout",
      error: {
        code: "WORKSPACE_NOT_AUTHENTICATED",
        domain: "auth",
        meta: {
          workspaceRef: "wksp_missing",
        },
      },
    });
  });

  it("supports auth logout --workspace as a shortcut for workspace logout", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
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
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });
    await storage.useWorkspace("wksp_cmmxworkspace1");

    const result = await executeCli({
      argv: ["auth", "logout", "--workspace", "wksp_cmmxworkspace2", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.logout",
      result: {
        workspace: {
          id: "wksp_cmmxworkspace2",
          name: "Prisma Labs",
        },
        wasActive: false,
        activeWorkspace: {
          id: "wksp_cmmxworkspace1",
          name: "Acme Inc",
        },
      },
    });
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace1",
    });
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "cmmxworkspace1",
        active: true,
      }),
    ]);
  });

  it("returns WORKSPACE_NOT_AUTHENTICATED when no cached workspace matches", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");

    const result = await executeCli({
      argv: ["auth", "workspace", "use", "wksp_missing", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "auth.workspace.use",
      error: {
        code: "WORKSPACE_NOT_AUTHENTICATED",
        domain: "auth",
        meta: {
          workspaceRef: "wksp_missing",
        },
      },
    });
  });

  it("returns WORKSPACE_AMBIGUOUS when a cached workspace name is duplicated", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
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
    await storage.rememberWorkspace("workspace-1", {
      id: "wksp_workspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("workspace-2", {
      id: "wksp_workspace2",
      name: "Acme Inc",
    });

    const result = await executeCli({
      argv: ["auth", "workspace", "use", "Acme Inc", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "auth.workspace.use",
      error: {
        code: "WORKSPACE_AMBIGUOUS",
        domain: "auth",
        meta: {
          workspaceRef: "Acme Inc",
        },
      },
    });
  });

  it("returns WORKSPACE_AMBIGUOUS for workspace logout when a cached workspace name is duplicated", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
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
    await storage.rememberWorkspace("workspace-1", {
      id: "wksp_workspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("workspace-2", {
      id: "wksp_workspace2",
      name: "Acme Inc",
    });

    const result = await executeCli({
      argv: ["auth", "workspace", "logout", "Acme Inc", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
        PRISMA_SERVICE_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "auth.workspace.logout",
      error: {
        code: "WORKSPACE_AMBIGUOUS",
        domain: "auth",
        meta: {
          workspaceRef: "Acme Inc",
        },
      },
    });
  });

  it("blocks workspace switching when PRISMA_SERVICE_TOKEN is set", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "workspace", "use", "wksp_123", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_SERVICE_TOKEN: "service-token",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "auth.workspace.use",
      error: {
        code: "WORKSPACE_SWITCH_UNAVAILABLE",
        domain: "auth",
      },
    });
  });

  it("returns a structured auth config error when PRISMA_SERVICE_TOKEN is empty", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_SERVICE_TOKEN: "  ",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "auth.whoami",
      error: {
        code: "AUTH_CONFIG_INVALID",
        domain: "auth",
      },
    });
  });

  it("shows the documented help text for auth login", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "login", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Log in to your Prisma platform account");
    expect(result.stderr).toContain("│  Examples:");
    expect(result.stderr).toContain("$ prisma-cli auth login");
    expect(result.stderr).not.toContain("Read more");
    expect(result.stderr).not.toContain("--provider");
    expect(result.stderr).not.toContain("--user");
    expect(result.stderr).not.toContain("--workspace");
  });

  it("shows workspace use as optional and does not advertise workspace select", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "workspace", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("use [id-or-name]");
    expect(result.stderr).toContain("$ prisma-cli auth workspace use");
    expect(result.stderr).not.toContain("select");
  });

  it("renders the TTY header block for auth whoami", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
    });

    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain(
      "auth whoami → Showing the current authenticated identity.",
    );
    expect(stderr).not.toContain("Read more");
    expect(stderr).toContain("status:  signed out");
  });
});
