/**
 * The whoami-specific byte baseline (S1), now over the credential
 * manager: the card, the json stream, and the engine's early
 * credentials failure.
 */
import { defineCommand, type ManagementApiClient } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { authWhoamiCommand } from "../src/v8/auth/whoami";

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

const SESSION: SessionRecord = {
  workspaceId: "ws_123",
  workspaceName: "Acme Inc",
  credential: {
    token: mintTestJwt({ workspace_id: "ws_123", sub: "usr_456" }),
    refreshToken: "refresh_ws_123",
    expiresAt: undefined,
  },
};

const OFFLINE_API = {
  GET: async () => {
    throw new Error("offline");
  },
} as unknown as ManagementApiClient;

const IDENTIFIED_API = {
  GET: async () => ({
    data: {
      data: { user: { id: "usr_456", email: "bob@example.com", name: "Bob" } },
    },
    response: { status: 200 },
  }),
} as unknown as ManagementApiClient;

const requiresCredentials = defineCommand({
  help: { summary: "Requires a signed-in session" },
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: null },
        { human: () => [{ kind: "summary", status: "ok", text: "ran" }] },
      ),
    ),
  needs: { credentials: true },
});

function makeCli(options?: {
  readonly sessions?: readonly SessionRecord[];
  readonly selectedWorkspaceId?: string;
  readonly environmentCredential?: {
    readonly token: string;
    readonly refreshToken: string | undefined;
    readonly expiresAt: Date | undefined;
  };
  readonly client?: ManagementApiClient;
}) {
  return createTestCli({
    commands: {
      "auth whoami": authWhoamiCommand,
      "auth locked": requiresCredentials,
    },
    groups: { auth: { brief: "Manage local authentication for the CLI" } },
    sessions: options?.sessions ?? [],
    selectedWorkspaceId: options?.selectedWorkspaceId,
    environmentCredential: options?.environmentCredential,
    managementApi: { client: options?.client ?? OFFLINE_API },
    now: EPOCH,
  });
}

function signedInCli() {
  return makeCli({
    sessions: [SESSION],
    selectedWorkspaceId: "ws_123",
    client: IDENTIFIED_API,
  });
}

describe("prisma-v8 auth whoami", () => {
  it("renders the signed-out human card on stderr and the payload lines on stdout, exit 0", async () => {
    const result = await makeCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status: signed out\n");
    expect(result.stderr).toBe(
      "ℹ Showing the active authenticated identity.\n" +
        "status:  signed out\n" +
        "→ Sign in: prisma-cli auth login\n",
    );
  });

  it("renders the signed-in human output: card on stderr, payload on stdout", async () => {
    const result = await signedInCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "status: signed in\nuser: bob@example.com\nworkspace: Acme Inc\n",
    );
    expect(result.stderr).toBe(
      "ℹ Showing the active authenticated identity.\n" +
        "status:     signed in\n" +
        "user:       bob@example.com\n" +
        "workspace:  Acme Inc\n",
    );
  });

  it("emits the json stream with a terminal completed envelope", async () => {
    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `{"kind":"result","envelope":{"ok":true,"commandId":"auth.whoami",` +
        `"result":{"authenticated":false,"workspace":null,"user":null,` +
        `"source":null,"expiresAt":null},"exitCode":0,"diagnostics":[],` +
        `"nextActions":[{"kind":"run-command","label":"Sign in",` +
        `"command":"prisma-cli auth login"}]},"commandId":"auth.whoami",` +
        `"timestamp":"${T0}"}\n`,
    );
    expect(result.json).toHaveLength(1);
  });

  it("carries the signed-in session as the envelope result", async () => {
    const result = await signedInCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = result.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toEqual({
      ok: true,
      commandId: "auth.whoami",
      result: {
        authenticated: true,
        workspace: { id: "ws_123", name: "Acme Inc" },
        user: { id: "usr_456", email: "bob@example.com", name: "Bob" },
        source: "stored",
        expiresAt: null,
      },
      exitCode: 0,
      diagnostics: [],
      nextActions: [],
    });
  });

  /** Design §11.10, test 7: an environment token whose claims name no
   *  workspace has no workspace row and a null JSON workspace — never
   *  an empty string and never the literal "undefined". */
  it("omits the workspace entirely for a claimless environment token", async () => {
    const cli = makeCli({
      environmentCredential: {
        token: mintTestJwt({ sub: "usr_env" }),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    const human = await cli.run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(human.exitCode).toBe(0);
    expect(human.stdout).toBe(
      "status: signed in\nenvironment variable: PRISMA_SERVICE_TOKEN\n",
    );
    expect(human.stderr).not.toContain("workspace:");
    expect(human.stderr).not.toContain("undefined");

    const json = await cli.run(["auth", "whoami", "--json"]);
    const frame = json.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toMatchObject({
      ok: true,
      result: {
        authenticated: true,
        workspace: null,
        user: { id: "usr_env", email: null, name: null },
        source: "environment",
      },
    });
    expect(json.stdout).not.toContain('""');
    expect(json.stdout).not.toContain("undefined");
  });

  /** A real service token's subject is its workspace, not a person.
   *  Reporting `workspace:ws_1` as the user's id would put a workspace
   *  in the user field of a machine-readable contract. */
  it("reads a service token's workspace subject as a workspace, not a user", async () => {
    const cli = makeCli({
      environmentCredential: {
        token: mintTestJwt({ sub: "workspace:ws_svc" }),
        refreshToken: undefined,
        expiresAt: undefined,
      },
    });

    const json = await cli.run(["auth", "whoami", "--json"]);
    const frame = json.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toMatchObject({
      ok: true,
      result: {
        authenticated: true,
        workspace: { id: "ws_svc" },
        user: null,
        source: "environment",
      },
    });
    expect(json.stdout).not.toContain("workspace:ws_svc");
  });

  /** The claims and the lookup are read at different moments, so a
   *  session replaced in between can have them describing two different
   *  people. Filling a gap in one from the other would report a user
   *  who does not exist. */
  it("does not blend two identities when the lookup names a different user", async () => {
    const differentUser = {
      GET: async () => ({
        data: { data: { user: { id: "usr_999", email: null, name: null } } },
        response: { status: 200 },
      }),
    } as unknown as ManagementApiClient;
    const result = await makeCli({
      sessions: [SESSION],
      selectedWorkspaceId: "ws_123",
      client: differentUser,
    }).run(["auth", "whoami", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toMatchObject({
      ok: true,
      result: { user: { id: "usr_999", email: null, name: null } },
    });
  });

  it("falls back to the stored credential's own claims when /v1/me is unreachable", async () => {
    const result = await makeCli({
      sessions: [SESSION],
      selectedWorkspaceId: "ws_123",
    }).run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = result.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toMatchObject({
      result: {
        user: { id: "usr_456", email: null, name: null },
        source: "stored",
      },
    });
  });

  it("renders the unchanged presentation under --quiet (a log-level alias)", async () => {
    const result = await signedInCli().run(["auth", "whoami", "--quiet"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "status: signed in\nuser: bob@example.com\nworkspace: Acme Inc\n",
    );
    expect(result.stderr).toBe(
      "ℹ Showing the active authenticated identity.\n" +
        "status:     signed in\n" +
        "user:       bob@example.com\n" +
        "workspace:  Acme Inc\n",
    );
  });
});

describe("needs.credentials early failure", () => {
  it("fails a credentials-needing command early with the engine's sign-in error", async () => {
    const result = await makeCli().run(["auth", "locked"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✖ [CLI.CREDENTIALS_REQUIRED] You must be signed in to run this command.\n" +
        "→ Sign in, then run the command again.\n",
    );
  });

  it("runs the handler when a session is selected", async () => {
    const result = await signedInCli().run(["auth", "locked"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("✔ ran\n");
  });

  it("whoami itself completes without credentials (no needs.credentials)", async () => {
    expect(authWhoamiCommand.needs.credentials).toBe(false);

    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
  });
});
