/**
 * The sanctioned golden-rendering suite (S2 ruling: byte-exact pins
 * live here, one representative per rendering surface — card, table,
 * error). Every other v8 test asserts semantically (envelope /
 * presented / events / exit code); when the engine's rendering style
 * changes deliberately, THIS file is the one place the new bytes get
 * re-pinned. The S1 whoami byte pins in v8-whoami.test.ts remain the
 * whoami-specific baseline.
 */
import {
  createTestCli,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { authLogoutCommand } from "../src/v8/auth/logout";
import { authWorkspaceListCommand } from "../src/v8/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "../src/v8/auth/workspace-logout";

function record(workspaceId: string, workspaceName: string): SessionRecord {
  return {
    workspaceId,
    workspaceName,
    credential: {
      token: mintTestJwt({ workspace_id: workspaceId }),
      refreshToken: `refresh_${workspaceId}`,
      expiresAt: undefined,
    },
  };
}

function makeCli(sessions: readonly SessionRecord[], current?: string) {
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
    sessions,
    currentWorkspaceId: current,
    now: () => new Date(0),
  });
}

describe("v8 golden rendering", () => {
  it("human card (representative: auth logout)", async () => {
    const result = await makeCli([record("ws_1", "Acme Inc")], "ws_1").run(
      ["auth", "logout"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      "ℹ Clearing the current CLI session.\n" +
        "ended: 1\n" +
        "✔ Ended 1 workspace session.\n" +
        "→ Sign in: prisma-cli auth login\n",
    );
    expect(result.stdout).toBe("ended: 1\n");
  });

  it("table (representative: auth workspace list)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc"), record("ws_2", "Globex")],
      "ws_1",
    ).run(["auth", "workspace", "list"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      "ℹ Listing your workspace sessions on this machine.\n" +
        "name  id  status\n" +
        "Acme Inc  ws_1  current\n" +
        "Globex  ws_2  \n",
    );
    expect(result.stdout).toBe("Acme Inc  ws_1  current\nGlobex  ws_2\n");
  });

  it("error (representative: AUTH.WORKSPACE_AMBIGUOUS)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc"), record("ws_9", "Acme Inc")],
      "ws_1",
    ).run(["auth", "workspace", "logout", "Acme Inc"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(
      "✖ [AUTH.WORKSPACE_AMBIGUOUS] More than one workspace session is named 'Acme Inc'.\n" +
        "  why: Matching workspaces: ws_1, ws_9.\n" +
        "→ List your workspace sessions and pass a workspace id: prisma-cli auth workspace list\n",
    );
    expect(result.stdout).toBe("");
  });
});
