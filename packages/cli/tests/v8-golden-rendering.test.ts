/**
 * The sanctioned golden-rendering suite (S2 ruling: byte-exact pins
 * live here, one representative per rendering surface — card, table,
 * error). Every other v8 test asserts semantically (envelope /
 * presented / events / exit code); when the engine's rendering style
 * changes deliberately, THIS file is the one place the new bytes get
 * re-pinned. The S1 whoami byte pins in v8-whoami.test.ts remain the
 * whoami-specific baseline.
 */
import { createTestCli } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAuthWorkspaces,
  logoutAuthWorkspace,
  performLogout,
  readAuthState,
} from "../src/auth";
import { workspaceAmbiguousError } from "../src/shell/errors";
import { authLogoutCommand } from "../src/v8/auth/logout";
import { authWorkspaceListCommand } from "../src/v8/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "../src/v8/auth/workspace-logout";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  performLogout: vi.fn(),
  readAuthState: vi.fn(),
  listAuthWorkspaces: vi.fn(),
  logoutAuthWorkspace: vi.fn(),
}));

function makeCli() {
  return createTestCli({
    commands: {
      "auth logout": authLogoutCommand,
      "auth workspace list": authWorkspaceListCommand,
      "auth workspace logout": authWorkspaceLogoutCommand,
    },
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
      "auth workspace": { brief: "Manage local workspace sessions" },
    },
    now: () => new Date(0),
  });
}

beforeEach(() => {
  vi.mocked(performLogout).mockReset();
  vi.mocked(readAuthState).mockReset();
  vi.mocked(listAuthWorkspaces).mockReset();
  vi.mocked(logoutAuthWorkspace).mockReset();
});

describe("v8 golden rendering", () => {
  it("human card (representative: auth logout)", async () => {
    vi.mocked(performLogout).mockResolvedValue(undefined);
    vi.mocked(readAuthState).mockResolvedValue({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      credential: null,
    });

    const result = await makeCli().run(["auth", "logout"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      "ℹ Clearing the current CLI session.\n" +
        "session: local CLI state\n" +
        "✔ Session removed from local CLI state.\n" +
        "→ Sign in: prisma-cli auth login\n",
    );
    expect(result.stdout).toBe("status: signed out\n");
  });

  it("table (representative: auth workspace list)", async () => {
    vi.mocked(listAuthWorkspaces).mockResolvedValue({
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
    });

    const result = await makeCli().run(["auth", "workspace", "list"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      "ℹ Listing authenticated workspaces on this machine.\n" +
        "auth source: local OAuth\n" +
        "name  id  status\n" +
        "Acme Inc  ws_1  active\n" +
        "Globex  ws_2  \n",
    );
    expect(result.stdout).toBe("Acme Inc  ws_1  active\nGlobex  ws_2\n");
  });

  it("error (representative: AUTH.WORKSPACE_AMBIGUOUS)", async () => {
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
    expect(result.stderr).toBe(
      "✖ [AUTH.WORKSPACE_AMBIGUOUS] Workspace name is ambiguous\n" +
        '  why: Multiple authenticated workspaces matched "Acme Inc".\n' +
        "→ Run prisma-cli auth workspace list and switch by workspace id.\n",
    );
    expect(result.stdout).toBe("");
  });
});
