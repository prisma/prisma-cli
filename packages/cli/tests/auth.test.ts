import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { FileTokenStorage } from "../src/adapters/token-storage";
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
  it("shows the signed-out empty state for whoami", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "auth whoami → Showing the current authenticated identity.\n\n│  status:  signed out\n",
    );
  });

  it("logs in with mock selectors and returns the documented human output", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "auth login → Starting an authenticated CLI session.\n\n│  provider:   GitHub\n│  user:       bob@example.com\n│  workspace:  Acme Inc\n\n◇ Applying authentication session changes...\n✔ Applied 1 operation(s)\n  Session stored in local CLI state.\n",
    );
  });

  it("returns the stable signed-in JSON shape for whoami", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "auth.whoami",
      result: {
        authenticated: true,
        provider: "github",
        user: {
          id: "usr_456",
          email: "bob@example.com",
          name: "Bob Example",
        },
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        credential: {
          type: "oauth",
          id: null,
          name: null,
        },
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
  });

  it("lists and switches mock workspaces for the current session", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: [
        "auth",
        "login",
        "--provider",
        "github",
        "--user",
        "usr_123",
        "--workspace",
        "ws_123",
      ],
      cwd,
      stateDir,
      fixturePath,
    });

    const list = await executeCli({
      argv: ["auth", "workspace", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.list",
      result: {
        context: {
          authSource: "oauth",
          activeWorkspaceId: "ws_123",
          activeWorkspaceName: "Acme Inc",
        },
        items: [
          {
            id: "ws_123",
            name: "Acme Inc",
            status: "active",
            switchable: true,
          },
          {
            id: "ws_456",
            name: "Prisma Labs",
            status: null,
            switchable: true,
          },
        ],
        count: 2,
      },
    });

    const use = await executeCli({
      argv: ["auth", "workspace", "use", "ws_456", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(use.exitCode).toBe(0);
    expect(JSON.parse(use.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.use",
      result: {
        previousWorkspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        workspace: {
          id: "ws_456",
          name: "Prisma Labs",
        },
      },
    });

    const whoami = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    expect(JSON.parse(whoami.stdout).result.workspace).toEqual({
      id: "ws_456",
      name: "Prisma Labs",
    });
  });

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

  it("returns a structured usage error for non-interactive login without selectors", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "login", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "auth.login",
      error: {
        code: "USAGE_ERROR",
        domain: "auth",
        severity: "error",
        summary: "Login requires explicit selectors in non-interactive mode",
        why: "The fixture mode cannot prompt in the current mode.",
        fix: "Re-run prisma-cli auth login in a TTY, or provide --provider and --user, and --workspace when required.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma-cli auth login"],
      nextActions: [],
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
