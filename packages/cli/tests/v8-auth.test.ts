import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StreamEvent } from "@prisma/cli-engine";
import { createTestCli } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EmptyServiceTokenError,
  listAuthWorkspaces,
  logoutAuthWorkspace,
  performLogin,
  performLogout,
  readAuthState,
  useAuthWorkspace,
} from "../src/auth";
import {
  workspaceAmbiguousError,
  workspaceNotAuthenticatedError,
} from "../src/shell/errors";
import type {
  AuthStateResult,
  AuthWorkspaceListResult,
} from "../src/types/auth";
import { authLoginCommand } from "../src/v8/auth/login";
import { authLogoutCommand } from "../src/v8/auth/logout";
import { authWhoamiCommand } from "../src/v8/auth/whoami";
import { authWorkspaceListCommand } from "../src/v8/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "../src/v8/auth/workspace-logout";
import { authWorkspaceUseCommand } from "../src/v8/auth/workspace-use";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  performLogin: vi.fn(),
  performLogout: vi.fn(),
  readAuthState: vi.fn(),
  listAuthWorkspaces: vi.fn(),
  useAuthWorkspace: vi.fn(),
  logoutAuthWorkspace: vi.fn(),
}));

const SIGNED_OUT: AuthStateResult = {
  authenticated: false,
  provider: null,
  user: null,
  workspace: null,
  credential: null,
};

const SIGNED_IN: AuthStateResult = {
  authenticated: true,
  provider: null,
  user: { id: "usr_456", email: "bob@example.com", name: "Bob Example" },
  workspace: { id: "ws_123", name: "Acme Inc" },
  credential: { type: "oauth", id: null, name: null },
};

const TWO_OAUTH_WORKSPACES: AuthWorkspaceListResult = {
  authSource: "oauth",
  activeWorkspace: { id: "ws_1", name: "Acme Inc" },
  workspaces: [
    {
      id: "ws_1",
      name: "Acme Inc",
      credentialWorkspaceId: "cred_1",
      active: true,
      source: "oauth",
      switchable: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "ws_2",
      name: "Globex",
      credentialWorkspaceId: "cred_2",
      active: false,
      source: "oauth",
      switchable: true,
      lastSeenAt: null,
    },
  ],
};

const MIXED_SOURCES: AuthWorkspaceListResult = {
  authSource: "service_token",
  activeWorkspace: { id: "ws_tok", name: "Token WS" },
  workspaces: [
    {
      id: "ws_tok",
      name: "Token WS",
      credentialWorkspaceId: null,
      active: true,
      source: "service_token",
      switchable: false,
      lastSeenAt: null,
    },
    {
      id: "ws_1",
      name: "Acme Inc",
      credentialWorkspaceId: "cred_1",
      active: false,
      source: "oauth",
      switchable: false,
      lastSeenAt: null,
    },
  ],
};

const EMPTY_LIST: AuthWorkspaceListResult = {
  authSource: "none",
  activeWorkspace: null,
  workspaces: [],
};

function makeCli() {
  return createTestCli({
    commands: {
      "auth login": authLoginCommand,
      "auth logout": authLogoutCommand,
      "auth whoami": authWhoamiCommand,
      "auth workspace list": authWorkspaceListCommand,
      "auth workspace use": authWorkspaceUseCommand,
      "auth workspace logout": authWorkspaceLogoutCommand,
    },
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
      "auth workspace": { brief: "Manage local workspace sessions" },
    },
    now: () => new Date(0),
  });
}

async function emptyTempCwd(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "v8-auth-test-"));
}

function resultFrame(frames: ReadonlyArray<{ kind: string }>) {
  const frame = frames.at(-1);
  if (frame === undefined || frame.kind !== "result") {
    throw new Error("expected a terminal result frame");
  }
  return frame as Extract<StreamEvent, { kind: "result" }>;
}

beforeEach(() => {
  vi.mocked(performLogin).mockReset();
  vi.mocked(performLogout).mockReset();
  vi.mocked(readAuthState).mockReset();
  vi.mocked(listAuthWorkspaces).mockReset();
  vi.mocked(useAuthWorkspace).mockReset();
  vi.mocked(logoutAuthWorkspace).mockReset();
});

describe("prisma-v8 auth login", () => {
  it("runs the browser flow, emits step and endpoint events, and renders the signed-in card", async () => {
    vi.mocked(performLogin).mockImplementation(
      async (_env, _signal, options) => {
        options?.onVerificationUrl?.(
          "https://auth.prisma.io/activate?code=XYZ",
        );
      },
    );
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);

    const result = await makeCli().run(["auth", "login"], {
      isTty: { stdout: true },
      cwd: await emptyTempCwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.events).toEqual([
      { kind: "step-started", step: "Sign in via your browser" },
      {
        kind: "endpoint",
        name: "verification",
        url: "https://auth.prisma.io/activate?code=XYZ",
      },
      {
        kind: "step-finished",
        step: "Sign in via your browser",
        outcome: "ok",
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "status: signed in",
      "user: bob@example.com",
      "workspace: Acme Inc",
    ]);
    expect(result.stderr).toContain(
      "ℹ Starting an authenticated CLI session.\n",
    );
    expect(result.stderr).toContain("verification: https://auth.prisma.io/");
    expect(result.stderr).toContain(
      "→ Show the signed-in identity: prisma-cli auth whoami\n",
    );
    expect(result.stderr).toContain(
      "→ List projects: prisma-cli project list\n",
    );
    expect(result.stderr).not.toContain("Install Prisma skills");
  });

  it("appends the agent-setup tip line and next action from a project directory", async () => {
    vi.mocked(performLogin).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
    const cwd = await emptyTempCwd();
    await writeFile(path.join(cwd, "package.json"), "{}\n", "utf8");
    const stateDir = path.join(cwd, ".state");

    const result = await makeCli().run(["auth", "login"], {
      isTty: { stdout: true },
      cwd,
      env: { PRISMA_CLI_STATE_DIR: stateDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "Install Prisma skills for this project with ",
    );
    expect(result.stderr).toContain("agent install");
    const presented = result.presented;
    expect(presented?.presentation.next.at(-1)).toMatchObject({
      kind: "run-command",
      label: "Install Prisma skills for this project",
      command: expect.stringContaining("agent install"),
    });
  });

  it("suppresses the agent-setup tip in CI", async () => {
    vi.mocked(performLogin).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
    const cwd = await emptyTempCwd();
    await writeFile(path.join(cwd, "package.json"), "{}\n", "utf8");

    const result = await makeCli().run(["auth", "login"], {
      isTty: { stdout: true },
      cwd,
      env: { CI: "1", PRISMA_CLI_STATE_DIR: path.join(cwd, ".state") },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Install Prisma skills");
  });

  it("suppresses the agent-setup tip when Prisma skills are already installed", async () => {
    vi.mocked(performLogin).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
    const cwd = await emptyTempCwd();
    await writeFile(path.join(cwd, "package.json"), "{}\n", "utf8");
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({ sources: ["prisma/skills"] }),
      "utf8",
    );

    const result = await makeCli().run(["auth", "login"], {
      isTty: { stdout: true },
      cwd,
      env: { PRISMA_CLI_STATE_DIR: path.join(cwd, ".state") },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Install Prisma skills");
    expect(
      result.presented?.presentation.next.some(
        (action) => action.label === "Install Prisma skills for this project",
      ),
    ).toBe(false);
  });

  it("carries the agent-setup tip in the json envelope (result field + nextAction)", async () => {
    vi.mocked(performLogin).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
    const cwd = await emptyTempCwd();
    await writeFile(path.join(cwd, "package.json"), "{}\n", "utf8");

    const result = await makeCli().run(["auth", "login", "--json"], {
      cwd,
      env: { PRISMA_CLI_STATE_DIR: path.join(cwd, ".state") },
    });

    expect(result.exitCode).toBe(0);
    const frame = resultFrame(result.json);
    if (!frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.result).toMatchObject({
      agentSetupTip: { command: expect.stringContaining("agent install") },
    });
    expect(frame.envelope.nextActions.at(-1)).toMatchObject({
      kind: "run-command",
      label: "Install Prisma skills for this project",
      command: expect.stringContaining("agent install"),
    });
  });

  it("maps an empty PRISMA_SERVICE_TOKEN to AUTH.CONFIG_INVALID, exit 2", async () => {
    vi.mocked(performLogin).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockRejectedValue(new EmptyServiceTokenError());

    const result = await makeCli().run(["auth", "login", "--json"], {
      cwd: await emptyTempCwd(),
    });

    expect(result.exitCode).toBe(2);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: false,
      commandId: "auth.login",
      error: {
        code: "AUTH.CONFIG_INVALID",
        summary: "Authentication configuration is invalid",
      },
    });
  });

  it("streams the flow events and the raw auth state envelope in json mode", async () => {
    vi.mocked(performLogin).mockImplementation(
      async (_env, _signal, options) => {
        options?.onVerificationUrl?.(
          "https://auth.prisma.io/activate?code=XYZ",
        );
      },
    );
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);

    const result = await makeCli().run(["auth", "login", "--json"], {
      cwd: await emptyTempCwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json.map((frame) => frame.kind)).toEqual([
      "step-started",
      "endpoint",
      "step-finished",
      "result",
    ]);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: true,
      commandId: "auth.login",
      result: SIGNED_IN,
      exitCode: 0,
    });
    if (!frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.nextActions.map((action) => action.command)).toEqual([
      "prisma-cli auth whoami",
      "prisma-cli project list",
    ]);
  });

  it("settles a failed login as a bug with the failed step event", async () => {
    vi.mocked(performLogin).mockRejectedValue(new Error("browser failed"));

    const result = await makeCli().run(["auth", "login"], {
      isTty: { stdout: true },
      cwd: await emptyTempCwd(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.events).toEqual([
      { kind: "step-started", step: "Sign in via your browser" },
      {
        kind: "step-finished",
        step: "Sign in via your browser",
        outcome: "failed",
      },
    ]);
    expect(result.stderr).toContain("✖ [CLI.INTERNAL_ERROR] browser failed");
    expect(vi.mocked(readAuthState)).not.toHaveBeenCalled();
  });

  it("never requires credentials (it creates the session)", () => {
    expect(authLoginCommand.needs.credentials).toBe(false);
  });
});

describe("prisma-v8 auth logout", () => {
  it("clears the session and renders the logout card with the sign-in follow-up", async () => {
    vi.mocked(performLogout).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_OUT);

    const result = await makeCli().run(["auth", "logout"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(performLogout)).toHaveBeenCalledTimes(1);
    expect(result.stderr).toContain("Clearing the current CLI session.");
    expect(result.stderr).toContain("Session removed from local CLI state.");
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Sign in",
        command: "prisma-cli auth login",
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "status: signed out",
    ]);
  });

  it("maps an empty PRISMA_SERVICE_TOKEN to AUTH.CONFIG_INVALID, exit 2", async () => {
    vi.mocked(performLogout).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockRejectedValue(new EmptyServiceTokenError());

    const result = await makeCli().run(["auth", "logout", "--json"]);

    expect(result.exitCode).toBe(2);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: false,
      commandId: "auth.logout",
      error: {
        code: "AUTH.CONFIG_INVALID",
        summary: "Authentication configuration is invalid",
      },
    });
  });

  it("carries the post-logout auth state as the json envelope result", async () => {
    vi.mocked(performLogout).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_OUT);

    const result = await makeCli().run(["auth", "logout", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: true,
      commandId: "auth.logout",
      result: SIGNED_OUT,
    });
  });

  it("--workspace runs the shared workspace-logout operation with its presentation", async () => {
    vi.mocked(logoutAuthWorkspace).mockResolvedValue({
      workspace: { id: "ws_2", name: "Globex" },
      wasActive: false,
      activeWorkspace: { id: "ws_1", name: "Acme Inc" },
    });

    const result = await makeCli().run(
      ["auth", "logout", "--workspace", "Globex"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(performLogout)).not.toHaveBeenCalled();
    expect(vi.mocked(logoutAuthWorkspace)).toHaveBeenCalledWith(
      expect.anything(),
      "Globex",
    );
    expect(result.stderr).toContain(
      "Removing a local OAuth workspace session.",
    );
    expect(result.stderr).toContain("Removed workspace session.");
    expect(result.presented?.presentation.stdout).toEqual([
      "workspace: Globex",
      "active: Acme Inc",
    ]);
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "List authenticated workspaces",
        command: "prisma-cli auth workspace list",
      },
    ]);
  });

  it("--workspace reports the mounted command id auth.logout in json mode", async () => {
    vi.mocked(logoutAuthWorkspace).mockResolvedValue({
      workspace: { id: "ws_2", name: "Globex" },
      wasActive: false,
      activeWorkspace: null,
    });

    const result = await makeCli().run([
      "auth",
      "logout",
      "--workspace",
      "ws_2",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: true,
      commandId: "auth.logout",
    });
  });

  it("--workspace maps a missing workspace to AUTH.WORKSPACE_NOT_AUTHENTICATED, exit 2", async () => {
    vi.mocked(logoutAuthWorkspace).mockRejectedValue(
      workspaceNotAuthenticatedError("nope"),
    );

    const result = await makeCli().run([
      "auth",
      "logout",
      "--workspace",
      "nope",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: false,
      commandId: "auth.logout",
      error: {
        code: "AUTH.WORKSPACE_NOT_AUTHENTICATED",
        summary: "Workspace is not authenticated",
        why: 'No stored OAuth session matched "nope".',
        meta: { workspaceRef: "nope" },
      },
    });
  });
});

describe("prisma-v8 auth workspace list", () => {
  it("renders the workspace table without the source column for a single source", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(TWO_OAUTH_WORKSPACES);

    const result = await makeCli().run(["auth", "workspace", "list"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    const table = result.presented?.presentation.human.find(
      (block) => block.kind === "table",
    );
    expect(table).toEqual({
      kind: "table",
      columns: ["name", "id", "status"],
      rows: [
        ["Acme Inc", "ws_1", "active"],
        ["Globex", "ws_2", ""],
      ],
    });
    expect(result.presented?.presentation.stdout).toEqual([
      "Acme Inc  ws_1  active",
      "Globex  ws_2",
    ]);
  });

  it("adds the source column only when sources are mixed", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(MIXED_SOURCES);

    const result = await makeCli().run(["auth", "workspace", "list"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    const table = result.presented?.presentation.human.find(
      (block) => block.kind === "table",
    );
    expect(table).toEqual({
      kind: "table",
      columns: ["name", "id", "source", "status"],
      rows: [
        ["Token WS", "ws_tok", "service token", "active"],
        ["Acme Inc", "ws_1", "OAuth", ""],
      ],
    });
  });

  it("serializes the ported list shape in json mode", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(TWO_OAUTH_WORKSPACES);

    const result = await makeCli().run(["auth", "workspace", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = resultFrame(result.json);
    if (!frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.result).toEqual({
      context: {
        authSource: "oauth",
        activeWorkspaceId: "ws_1",
        activeWorkspaceName: "Acme Inc",
      },
      items: [
        {
          id: "ws_1",
          name: "Acme Inc",
          status: "active",
          source: "oauth",
          switchable: true,
          credentialWorkspaceId: "cred_1",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "ws_2",
          name: "Globex",
          status: null,
          source: "oauth",
          switchable: true,
          credentialWorkspaceId: "cred_2",
          lastSeenAt: null,
        },
      ],
      count: 2,
    });
  });

  it("maps an empty PRISMA_SERVICE_TOKEN to AUTH.CONFIG_INVALID, exit 2 (parity with whoami/login/logout)", async () => {
    vi.mocked(listAuthWorkspaces).mockRejectedValue(
      new EmptyServiceTokenError(),
    );

    const result = await makeCli().run(["auth", "workspace", "list", "--json"]);

    expect(result.exitCode).toBe(2);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: false,
      commandId: "auth.workspace.list",
      error: {
        code: "AUTH.CONFIG_INVALID",
        summary: "Authentication configuration is invalid",
      },
    });
  });

  it("shows the empty state with the sign-in follow-up while signed out", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(EMPTY_LIST);

    const result = await makeCli().run(["auth", "workspace", "list"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("No local OAuth workspaces found.\n");
    expect(result.stderr).toContain("→ Sign in: prisma-cli auth login\n");
    expect(result.stdout).toBe("");
  });
});

describe("prisma-v8 auth workspace use", () => {
  it("switches by explicit ref and renders the mutation card", async () => {
    vi.mocked(useAuthWorkspace).mockResolvedValue({
      previousWorkspace: { id: "ws_1", name: "Acme Inc" },
      workspace: { id: "ws_2", name: "Globex" },
    });

    const result = await makeCli().run(["auth", "workspace", "use", " ws_2 "], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(useAuthWorkspace)).toHaveBeenCalledWith(
      expect.anything(),
      "ws_2",
    );
    expect(result.stderr).toContain("Switching the local CLI workspace.");
    expect(result.stderr).toContain("Local OAuth workspace selection updated.");
    expect(result.presented?.presentation.stdout).toEqual([
      "previous: Acme Inc",
      "workspace: Globex",
    ]);
    expect(
      result.presented?.presentation.next.map((action) =>
        action.kind === "run-command" ? action.command : action.label,
      ),
    ).toEqual(["prisma-cli auth whoami", "prisma-cli project list"]);
  });

  it("carries the raw use result in the json envelope", async () => {
    vi.mocked(useAuthWorkspace).mockResolvedValue({
      previousWorkspace: null,
      workspace: { id: "ws_2", name: "Globex" },
    });

    const result = await makeCli().run([
      "auth",
      "workspace",
      "use",
      "ws_2",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: true,
      commandId: "auth.workspace.use",
      result: {
        previousWorkspace: null,
        workspace: { id: "ws_2", name: "Globex" },
      },
    });
  });

  it("maps an ambiguous name to AUTH.WORKSPACE_AMBIGUOUS with the match list, exit 2", async () => {
    vi.mocked(useAuthWorkspace).mockRejectedValue(
      workspaceAmbiguousError("Acme Inc", [
        { id: "ws_1", name: "Acme Inc", credentialWorkspaceId: "cred_1" },
        { id: "ws_9", name: "Acme Inc", credentialWorkspaceId: "cred_9" },
      ]),
    );

    const result = await makeCli().run([
      "auth",
      "workspace",
      "use",
      "Acme Inc",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: false,
      commandId: "auth.workspace.use",
      error: {
        code: "AUTH.WORKSPACE_AMBIGUOUS",
        summary: "Workspace name is ambiguous",
        meta: {
          workspaceRef: "Acme Inc",
          matches: [
            { id: "ws_1", name: "Acme Inc", credentialWorkspaceId: "cred_1" },
            { id: "ws_9", name: "Acme Inc", credentialWorkspaceId: "cred_9" },
          ],
        },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Run prisma-cli auth workspace list and switch by workspace id.",
          },
        ],
      },
    });
  });

  it("fails selection with AUTH.WORKSPACE_SWITCH_UNAVAILABLE when PRISMA_SERVICE_TOKEN is set", async () => {
    const result = await makeCli().run(["auth", "workspace", "use"], {
      isTty: { stdout: true },
      env: { PRISMA_SERVICE_TOKEN: "svc_token" },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "✖ [AUTH.WORKSPACE_SWITCH_UNAVAILABLE] Workspace switching is unavailable\n",
    );
    expect(vi.mocked(listAuthWorkspaces)).not.toHaveBeenCalled();
  });

  it("fails with AUTH.USAGE_ERROR when no switchable workspaces exist", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(EMPTY_LIST);

    const result = await makeCli().run(["auth", "workspace", "use"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "✖ [AUTH.USAGE_ERROR] No authenticated workspaces\n",
    );
  });

  it("auto-selects the only switchable workspace without prompting", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue({
      ...TWO_OAUTH_WORKSPACES,
      workspaces: [TWO_OAUTH_WORKSPACES.workspaces[0]],
    });
    vi.mocked(useAuthWorkspace).mockResolvedValue({
      previousWorkspace: null,
      workspace: { id: "ws_1", name: "Acme Inc" },
    });

    const result = await makeCli().run(["auth", "workspace", "use"], {
      isTty: { stdout: true, stdin: true },
    });

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(useAuthWorkspace)).toHaveBeenCalledWith(
      expect.anything(),
      "ws_1",
    );
  });

  it("prompts a select over the workspaces and switches to the answer", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(TWO_OAUTH_WORKSPACES);
    vi.mocked(useAuthWorkspace).mockResolvedValue({
      previousWorkspace: { id: "ws_1", name: "Acme Inc" },
      workspace: { id: "ws_2", name: "Globex" },
    });

    const result = await makeCli().run(["auth", "workspace", "use"], {
      isTty: { stdout: true, stdin: true },
      answers: ["ws_2"],
    });

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(useAuthWorkspace)).toHaveBeenCalledWith(
      expect.anything(),
      "ws_2",
    );
  });

  it("fails an invalid select answer with CLI.PROMPT_INVALID, exit 2", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(TWO_OAUTH_WORKSPACES);

    const result = await makeCli().run(["auth", "workspace", "use"], {
      isTty: { stdout: true, stdin: true },
      answers: ["not-a-workspace"],
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("[CLI.PROMPT_INVALID]");
    expect(vi.mocked(useAuthWorkspace)).not.toHaveBeenCalled();
  });

  it("fails non-interactively with the engine's structural prompt error, exit 2", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue(TWO_OAUTH_WORKSPACES);

    const result = await makeCli().run(["auth", "workspace", "use"], {
      isTty: { stdout: true, stdin: false },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("[CLI.PROMPT_REQUIRED]");
    expect(vi.mocked(useAuthWorkspace)).not.toHaveBeenCalled();
  });
});

describe("prisma-v8 auth workspace logout", () => {
  it("removes a non-active session and keeps the active workspace", async () => {
    vi.mocked(logoutAuthWorkspace).mockResolvedValue({
      workspace: { id: "ws_2", name: "Globex" },
      wasActive: false,
      activeWorkspace: { id: "ws_1", name: "Acme Inc" },
    });

    const result = await makeCli().run(
      ["auth", "workspace", "logout", "ws_2"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "Removing a local OAuth workspace session.",
    );
    expect(result.stderr).toContain("Removed workspace session.");
    expect(result.presented?.presentation.stdout).toEqual([
      "workspace: Globex",
      "active: Acme Inc",
    ]);
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "List authenticated workspaces",
        command: "prisma-cli auth workspace list",
      },
    ]);
  });

  it("reports the was-active removal with no auto-fallthrough and the use follow-up", async () => {
    vi.mocked(logoutAuthWorkspace).mockResolvedValue({
      workspace: { id: "ws_1", name: "Acme Inc" },
      wasActive: true,
      activeWorkspace: null,
    });

    const result = await makeCli().run(
      ["auth", "workspace", "logout", "ws_1"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "✔ Removed active workspace session; no replacement workspace was selected.\n",
    );
    expect(result.stderr).toContain("active: none\n");
    expect(result.stderr).toContain(
      "→ Select a replacement workspace: prisma-cli auth workspace use <id>\n",
    );
  });

  it("carries the raw logout result in the json envelope", async () => {
    vi.mocked(logoutAuthWorkspace).mockResolvedValue({
      workspace: { id: "ws_2", name: "Globex" },
      wasActive: false,
      activeWorkspace: { id: "ws_1", name: "Acme Inc" },
    });

    const result = await makeCli().run([
      "auth",
      "workspace",
      "logout",
      "ws_2",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: true,
      commandId: "auth.workspace.logout",
      result: {
        workspace: { id: "ws_2", name: "Globex" },
        wasActive: false,
        activeWorkspace: { id: "ws_1", name: "Acme Inc" },
      },
    });
  });

  it("maps an ambiguous name to AUTH.WORKSPACE_AMBIGUOUS, exit 2", async () => {
    vi.mocked(logoutAuthWorkspace).mockRejectedValue(
      workspaceAmbiguousError("Acme Inc", [
        { id: "ws_1", name: "Acme Inc", credentialWorkspaceId: "cred_1" },
        { id: "ws_9", name: "Acme Inc", credentialWorkspaceId: "cred_9" },
      ]),
    );

    const result = await makeCli().run(
      ["auth", "workspace", "logout", "Acme Inc"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "✖ [AUTH.WORKSPACE_AMBIGUOUS] Workspace name is ambiguous\n",
    );
  });

  it("fails a blank workspace ref with AUTH.USAGE_ERROR, exit 2", async () => {
    const result = await makeCli().run(["auth", "workspace", "logout", "  "], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "✖ [AUTH.USAGE_ERROR] Workspace required\n",
    );
    expect(vi.mocked(logoutAuthWorkspace)).not.toHaveBeenCalled();
  });
});
