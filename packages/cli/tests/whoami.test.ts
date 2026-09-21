/**
 * The whoami-specific byte baseline (S1), now over the credential
 * manager: the card, the json stream, and the engine's early
 * credentials failure.
 */
import {
  authServiceError,
  credentialRejectedError,
  credentialsRequiredError,
  defineCommand,
  type ManagementApiClient,
  SERVICE_TOKEN_ENV_VAR,
} from "@prisma/cli-engine";
import { type CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { authWhoamiCommand } from "../src/commands/auth/whoami";

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

/** ctx.api as the engine's request path leaves it when a request
 *  fails: the structured error its own constructors build, thrown
 *  unwrapped. */
function apiFailingWith(failure: CliStructuredError): ManagementApiClient {
  return {
    GET: async () => {
      throw failure;
    },
  } as unknown as ManagementApiClient;
}

const SIGNED_OUT_RESULT = {
  authenticated: false,
  workspace: null,
  user: null,
  source: null,
  expiresAt: null,
};

const SIGN_IN_ACTION = {
  kind: "run-command",
  label: "Sign in",
  command: "prisma auth login",
};

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
        {
          human: () => [{ kind: "summary", status: "ok", text: "ran" }],
          stdout: () => [],
          json: () => null,
          next: () => [],
        },
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

describe("prisma auth whoami", () => {
  it("renders the signed-out human card on stderr and the payload lines on stdout, exit 0", async () => {
    const result = await makeCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status: signed out\n");
    expect(result.stderr).toBe(
      "ℹ Showing the active authenticated identity.\n" +
        "\n" +
        "status:  signed out\n" +
        "\n" +
        "→ Sign in: prisma auth login\n",
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
        "\n" +
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
        `"command":"prisma auth login"}]},"commandId":"auth.whoami",` +
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

  /** The enrichment is best-effort for failures that leave the
   *  credential's standing unknown. The engine's verdict that the
   *  session is over is not one of those: automation reads
   *  `authenticated` to decide whether to sign in, and a `true` for a
   *  session the same run found dead makes its next command fail. */
  describe("when the engine rules the credential unusable during the lookup", () => {
    for (const [name, reason] of [
      ["expired beyond refresh", "expired"],
      ["ended underneath the process", "session-ended"],
    ] as const) {
      it(`reports a session ${name} as signed out, exit 0, with the Sign in action`, async () => {
        const cli = makeCli({
          sessions: [SESSION],
          selectedWorkspaceId: "ws_123",
          client: apiFailingWith(credentialsRequiredError(reason)),
        });

        const json = await cli.run(["auth", "whoami", "--json"]);

        expect(json.exitCode).toBe(0);
        const frame = json.json[0];
        if (frame.kind !== "result") {
          throw new Error("expected a result frame");
        }
        expect(frame.envelope).toEqual({
          ok: true,
          commandId: "auth.whoami",
          result: SIGNED_OUT_RESULT,
          exitCode: 0,
          diagnostics: [],
          nextActions: [SIGN_IN_ACTION],
        });
        expect(json.stdout).not.toContain("ws_123");
        expect(json.stdout).not.toContain("Acme Inc");

        const human = await cli.run(["auth", "whoami"], {
          isTty: { stdout: true },
        });

        expect(human.exitCode).toBe(0);
        expect(human.stdout).toBe("status: signed out\n");
        expect(human.stderr).toBe(
          "ℹ Showing the active authenticated identity.\n" +
            "\n" +
            "status:  signed out\n" +
            "\n" +
            "→ Sign in: prisma auth login\n",
        );
      });
    }

    /** Signing in cannot fix a refused PRISMA_SERVICE_TOKEN: the
     *  variable keeps overriding whatever session a login stores. The
     *  honest answer names the variable, as the blank-token error
     *  already does for this command. */
    it("lets a rejected environment credential settle as its own error instead of claiming it", async () => {
      const cli = makeCli({
        environmentCredential: {
          token: mintTestJwt({ workspace_id: "ws_env", sub: "usr_env" }),
          refreshToken: undefined,
          expiresAt: undefined,
        },
        client: apiFailingWith(
          credentialRejectedError(
            { source: "environment" },
            SERVICE_TOKEN_ENV_VAR,
          ),
        ),
      });

      const json = await cli.run(["auth", "whoami", "--json"]);

      expect(json.exitCode).toBe(2);
      const frame = json.json[0];
      if (frame.kind !== "result") {
        throw new Error("expected a result frame");
      }
      expect(frame.envelope).toMatchObject({
        ok: false,
        error: { code: "AUTH.SERVICE_TOKEN_REJECTED" },
      });
      expect(json.stdout).not.toContain('"authenticated":true');

      const human = await cli.run(["auth", "whoami"], {
        isTty: { stdout: true },
      });

      expect(human.exitCode).toBe(2);
      expect(human.stdout).toBe("");
      expect(human.stderr).toBe(
        "✘ [AUTH.SERVICE_TOKEN_REJECTED] The management API rejected the service token from PRISMA_SERVICE_TOKEN.\n" +
          "→ Replace PRISMA_SERVICE_TOKEN with a valid service token, or unset it to use your stored sessions.\n",
      );
    });

    /** The same dispatcher hands a stored credential that could never
     *  be renewed the expired wording, so it reads as signed out. */
    it("reports a rejected stored credential as signed out", async () => {
      const result = await makeCli({
        sessions: [SESSION],
        selectedWorkspaceId: "ws_123",
        client: apiFailingWith(
          credentialRejectedError({ source: "stored" }, SERVICE_TOKEN_ENV_VAR),
        ),
      }).run(["auth", "whoami", "--json"]);

      expect(result.exitCode).toBe(0);
      const frame = result.json[0];
      if (frame.kind !== "result") {
        throw new Error("expected a result frame");
      }
      expect(frame.envelope).toMatchObject({
        ok: true,
        result: SIGNED_OUT_RESULT,
        nextActions: [SIGN_IN_ACTION],
      });
    });
  });

  /** CLI.AUTH_SERVICE_ERROR is the auth service failing, not the
   *  credential: nothing was cleared and signing in is not the fix, so
   *  it is one more way of being offline. */
  it("still answers from the claims when the auth service fails transiently", async () => {
    const result = await makeCli({
      sessions: [SESSION],
      selectedWorkspaceId: "ws_123",
      client: apiFailingWith(authServiceError()),
    }).run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = result.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toMatchObject({
      ok: true,
      result: {
        authenticated: true,
        workspace: { id: "ws_123", name: "Acme Inc" },
        user: { id: "usr_456", email: null, name: null },
        source: "stored",
      },
      nextActions: [],
    });
  });

  /** Ctrl-C outranks whatever the interrupted request went on to throw
   *  — including a verdict on the credential, which must not turn an
   *  interrupt into an answer. */
  for (const [name, thrown] of [
    ["an abort error", () => new DOMException("aborted", "AbortError")],
    ["a credentials verdict", () => credentialsRequiredError("expired")],
  ] as const) {
    it(`settles CLI.ABORTED when the interrupt lands mid-lookup and the request throws ${name}`, async () => {
      const controller = new AbortController();
      const interrupted = {
        GET: async () => {
          controller.abort();
          throw thrown();
        },
      } as unknown as ManagementApiClient;

      const result = await makeCli({
        sessions: [SESSION],
        selectedWorkspaceId: "ws_123",
        client: interrupted,
      }).run(["auth", "whoami", "--json"], { abort: controller.signal });

      expect(result.exitCode).toBe(130);
      const frame = result.json[0];
      if (frame.kind !== "result") {
        throw new Error("expected a result frame");
      }
      expect(frame.envelope).toMatchObject({
        ok: false,
        error: { code: "CLI.ABORTED" },
      });
    });
  }

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
        "\n" +
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
      "✘ [CLI.CREDENTIALS_REQUIRED] You must be signed in to run this command.\n" +
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
