/**
 * The v8 auth family over the credential manager: every assertion is
 * semantic (envelope / presented / events / exit code / manager state
 * read-back). Byte pins live in v8-golden-rendering.test.ts and
 * v8-whoami.test.ts.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ActiveCredential,
  type Credential,
  defineCommand,
  type ManagementApiClient,
  type Session,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { performLogin, storeLegacyCredential } from "../src/auth/operations";
import { authLoginCommand } from "../src/v8/auth/login";
import { authLogoutCommand } from "../src/v8/auth/logout";
import { authWhoamiCommand } from "../src/v8/auth/whoami";
import { authWorkspaceListCommand } from "../src/v8/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "../src/v8/auth/workspace-logout";
import { authWorkspaceUseCommand } from "../src/v8/auth/workspace-use";

vi.mock("../src/auth/operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/operations")>()),
  performLogin: vi.fn(),
  storeLegacyCredential: vi.fn(),
}));

const COMMANDS = {
  "auth login": authLoginCommand,
  "auth logout": authLogoutCommand,
  "auth whoami": authWhoamiCommand,
  "auth workspace list": authWorkspaceListCommand,
  "auth workspace use": authWorkspaceUseCommand,
  "auth workspace logout": authWorkspaceLogoutCommand,
};

const GROUPS = {
  auth: { brief: "Manage local authentication for the CLI" },
  "auth workspace": { brief: "Manage local workspace sessions" },
};

function tokenFor(
  workspaceId: string,
  claims: Readonly<Record<string, unknown>> = {},
): string {
  return mintTestJwt({ workspace_id: workspaceId, ...claims });
}

function credentialFor(workspaceId: string) {
  return {
    token: tokenFor(workspaceId, {
      sub: "usr_456",
      email: "bob@example.com",
    }),
    refreshToken: `refresh_${workspaceId}`,
    expiresAt: undefined,
  };
}

function record(
  workspaceId: string,
  workspaceName: string | undefined,
): SessionRecord {
  return {
    workspaceId,
    workspaceName,
    credential: credentialFor(workspaceId),
  };
}

/** ctx.api that never reaches the network: whoami's enrichment is
 *  best-effort, so an offline client leaves the identity unenriched. */
const OFFLINE_API = {
  GET: async () => {
    throw new Error("offline");
  },
} as unknown as ManagementApiClient;

function apiReturning(body: unknown): ManagementApiClient {
  return {
    GET: async () => ({ data: body, response: { status: 200 } }),
  } as unknown as ManagementApiClient;
}

/** The environment credential PRISMA_SERVICE_TOKEN supplies. One
 *  environment variable carries one bearer string, so it has no refresh
 *  token. */
function environmentCredentialFor(token: string): Credential {
  return { token, refreshToken: undefined, expiresAt: undefined };
}

function makeCli(spec?: {
  readonly sessions?: readonly SessionRecord[];
  readonly selectedWorkspaceId?: string;
  readonly environmentToken?: string;
  readonly client?: ManagementApiClient;
  readonly openUrl?: (url: string) => void;
}) {
  return createTestCli({
    commands: COMMANDS,
    groups: GROUPS,
    sessions: spec?.sessions ?? [],
    selectedWorkspaceId: spec?.selectedWorkspaceId,
    environmentCredential:
      spec?.environmentToken === undefined
        ? undefined
        : environmentCredentialFor(spec.environmentToken),
    managementApi: { client: spec?.client ?? OFFLINE_API },
    openUrl: spec?.openUrl,
    now: () => new Date(0),
  });
}

type ResultFrame = {
  readonly kind: string;
  readonly envelope: {
    readonly ok: boolean;
    readonly error?: Record<string, unknown>;
    readonly result?: unknown;
  };
};

function envelopeOf(result: { readonly json: readonly unknown[] }) {
  const frame = (result.json as readonly ResultFrame[]).find(
    (candidate) => candidate.kind === "result",
  );
  if (frame === undefined) {
    throw new Error("expected a terminal result frame");
  }
  return frame.envelope;
}

function errorOf(result: { readonly json: readonly unknown[] }) {
  const envelope = envelopeOf(result);
  if (envelope.ok) {
    throw new Error("expected an errored result frame");
  }
  return envelope.error as Record<string, unknown>;
}

function resultOf(result: { readonly json: readonly unknown[] }) {
  const envelope = envelopeOf(result);
  if (!envelope.ok) {
    throw new Error("expected an ok result frame");
  }
  return envelope.result;
}

beforeEach(() => {
  vi.mocked(performLogin).mockReset();
  vi.mocked(storeLegacyCredential).mockReset();
});

describe("auth login", () => {
  it("creates the session for the workspace the credential names", async () => {
    const credential = credentialFor("ws_1");
    vi.mocked(performLogin).mockResolvedValue(credential);
    const cli = makeCli();

    const result = await cli.run(["auth", "login", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({
      workspace: { id: "ws_1", name: null },
      environmentCredentialInForce: false,
    });
    const state = cli.credentialManager?.state();
    expect(state?.selectedWorkspaceId).toBe("ws_1");
    expect(state?.sessions.map((session) => session.workspaceId)).toEqual([
      "ws_1",
    ]);
  });

  it("no longer writes the minted credential into the legacy store", async () => {
    vi.mocked(performLogin).mockResolvedValue(credentialFor("ws_1"));

    await makeCli().run(["auth", "login", "--json"]);

    expect(vi.mocked(storeLegacyCredential)).not.toHaveBeenCalled();
  });

  it("declares the credential-manager capability", () => {
    expect(authLoginCommand.managesCredentials).toBe(true);
  });

  it("succeeds under an env override and states the env token stays in force", async () => {
    vi.mocked(performLogin).mockResolvedValue(credentialFor("ws_1"));
    const cli = makeCli({ environmentToken: tokenFor("ws_env") });

    const result = await cli.run(["auth", "login"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "PRISMA_SERVICE_TOKEN supplies the credential in force",
    );
    expect(cli.credentialManager?.state().sessions).toHaveLength(1);
  });

  it("refuses a credential that names no workspace", async () => {
    vi.mocked(performLogin).mockResolvedValue({
      token: mintTestJwt({ sub: "usr_456" }),
      refreshToken: undefined,
      expiresAt: undefined,
    });
    const cli = makeCli();

    const result = await cli.run(["auth", "login", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("AUTH.LOGIN_WORKSPACE_UNKNOWN");
    expect(cli.credentialManager?.state().sessions).toEqual([]);
    expect(
      result.events.filter(
        (event) => event.kind === "step-finished" && event.outcome === "failed",
      ),
    ).toHaveLength(1);
  });
});

describe("auth logout", () => {
  it("ends every session and reports the count it ended", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc"), record("ws_2", "Globex")],
      selectedWorkspaceId: "ws_1",
    });

    const result = await cli.run(["auth", "logout", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({
      endedCount: 2,
      workspaceIds: ["ws_1", "ws_2"],
    });
    expect(cli.credentialManager?.state()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
  });

  it("reports zero when there was nothing to end", async () => {
    const result = await makeCli().run(["auth", "logout", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({ endedCount: 0, workspaceIds: [] });
  });

  /** Design §11.7 and §11.10 test 8. */
  it("clears the store under an env override and says the env token stays in force", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
      environmentToken: tokenFor("ws_env"),
    });

    const result = await cli.run(["auth", "logout"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "PRISMA_SERVICE_TOKEN supplies the credential in force",
    );
    expect(cli.credentialManager?.state()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
  });

  it("succeeds as a no-op under an env override with no stored sessions", async () => {
    const cli = makeCli({ environmentToken: tokenFor("ws_env") });

    const result = await cli.run(["auth", "logout", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({ endedCount: 0, workspaceIds: [] });
  });
});

describe("auth whoami", () => {
  it("reports signed out with exit 0 and no manager capability", async () => {
    expect(authWhoamiCommand.managesCredentials).toBe(false);
    expect(authWhoamiCommand.needs.credentials).toBe(false);

    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({
      authenticated: false,
      workspace: null,
      user: null,
      source: null,
      expiresAt: null,
    });
  });

  it("falls back offline to the identity the credential's own claims carry", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
    });

    const result = await cli.run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      authenticated: true,
      workspace: { id: "ws_1", name: "Acme Inc" },
      user: { id: "usr_456", email: "bob@example.com" },
      source: "stored",
    });
  });

  it("lets the management API win over the claims where they disagree", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
      client: apiReturning({
        data: {
          user: { id: "usr_456", email: "renamed@example.com", name: "Bob" },
        },
      }),
    });

    const result = await cli.run(["auth", "whoami", "--json"]);

    expect(resultOf(result)).toMatchObject({
      user: { id: "usr_456", email: "renamed@example.com" },
    });
  });

  it("notes the env override and reads its identity from the token's claims", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
      environmentToken: tokenFor("ws_env", {
        sub: "usr_env",
        email: "ci@example.com",
      }),
    });

    const result = await cli.run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("workspace: ws_env");
    expect(result.stdout).toContain(
      "environment variable: PRISMA_SERVICE_TOKEN",
    );
    expect(result.stderr).toContain(
      "PRISMA_SERVICE_TOKEN supplies the credential in force",
    );
  });
});

describe("sessions held with none selected", () => {
  const needsCredentials = defineCommand({
    help: { summary: "Requires a signed-in session" },
    needs: { credentials: true },
    handler: async (_args, ctx) =>
      ok(
        ctx.present(
          { data: null },
          { human: () => [{ kind: "summary", status: "ok", text: "ran" }] },
        ),
      ),
  });

  const touchesApi = defineCommand({
    help: { summary: "Touches ctx.api" },
    handler: async (_args, ctx) => {
      await ctx.api.GET("/v1/me", {});
      return ok(
        ctx.present(
          { data: null },
          { human: () => [{ kind: "summary", status: "ok", text: "ran" }] },
        ),
      );
    },
  });

  it("raises one identical error from ctx.activeCredential, the needs check, and a bare ctx.api touch", async () => {
    const cli = createTestCli({
      commands: {
        "auth whoami": authWhoamiCommand,
        locked: needsCredentials,
        touch: touchesApi,
      },
      groups: GROUPS,
      sessions: [record("ws_1", "Acme Inc")],
      now: () => new Date(0),
    });

    const errors = [];
    for (const argv of [["auth", "whoami"], ["locked"], ["touch"]]) {
      // biome-ignore lint/performance/noAwaitInLoops: the three commands run through one CLI instance whose session state they share, and the assertions below compare errors[1] and errors[2] against errors[0].
      const run = await cli.run([...argv, "--json"]);
      expect(run.exitCode).toBe(2);
      errors.push(errorOf(run));
    }

    expect(errors[0]).toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
      summary: "No workspace session is current.",
      why: "You have workspace sessions but none is current.",
    });
    expect(errors[1]).toEqual(errors[0]);
    expect(errors[2]).toEqual(errors[0]);
  });
});

describe("auth workspace list", () => {
  it("lists the sessions with the current one marked, nameless rows by id", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc"), record("ws_2", undefined)],
      selectedWorkspaceId: "ws_2",
    });

    const result = await cli.run(["auth", "workspace", "list"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Acme Inc  ws_1\nws_2  ws_2  current\n");
  });

  it("serializes the sessions and the current marker for json", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
    });

    const result = await cli.run(["auth", "workspace", "list", "--json"]);

    expect(resultOf(result)).toEqual({
      context: {
        environmentCredentialInForce: false,
        currentWorkspaceId: "ws_1",
      },
      items: [
        {
          workspaceId: "ws_1",
          workspaceName: "Acme Inc",
          current: true,
          expiresAt: null,
        },
      ],
      count: 1,
    });
  });

  it("states that the environment credential is in force", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
      environmentToken: tokenFor("ws_env"),
    });

    const result = await cli.run(["auth", "workspace", "list", "--json"]);

    expect(resultOf(result)).toMatchObject({
      context: {
        environmentCredentialInForce: true,
        currentWorkspaceId: "ws_1",
      },
    });
  });

  it("offers sign-in when there are no sessions", async () => {
    const result = await makeCli().run(["auth", "workspace", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Sign in",
        command: "prisma-cli auth login",
      },
    ]);
  });
});

describe("auth workspace use", () => {
  const twoSessions = [record("ws_1", "Acme Inc"), record("ws_2", "Globex")];

  it("selects by workspace id", async () => {
    const cli = makeCli({ sessions: twoSessions, selectedWorkspaceId: "ws_1" });

    const result = await cli.run([
      "auth",
      "workspace",
      "use",
      "ws_2",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({
      workspace: { id: "ws_2", name: "Globex" },
      previousWorkspaceId: "ws_1",
    });
    expect(cli.credentialManager?.state().selectedWorkspaceId).toBe("ws_2");
  });

  it("selects by workspace name, case-insensitively", async () => {
    const cli = makeCli({ sessions: twoSessions, selectedWorkspaceId: "ws_1" });

    const result = await cli.run([
      "auth",
      "workspace",
      "use",
      "globex",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(cli.credentialManager?.state().selectedWorkspaceId).toBe("ws_2");
  });

  it("refuses an ambiguous name, listing the workspaces that matched", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc"), record("ws_9", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
    });

    const result = await cli.run([
      "auth",
      "workspace",
      "use",
      "Acme Inc",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toMatchObject({
      code: "AUTH.WORKSPACE_AMBIGUOUS",
      meta: { workspaceIds: ["ws_1", "ws_9"] },
    });
    expect(cli.credentialManager?.state().selectedWorkspaceId).toBe("ws_1");
  });

  it("never opens a browser for a workspace it has no session for", async () => {
    const openUrl = vi.fn();
    const cli = makeCli({ sessions: twoSessions, openUrl });

    const result = await cli.run([
      "auth",
      "workspace",
      "use",
      "ws_missing",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toMatchObject({
      code: "AUTH.NO_SESSION_FOR_WORKSPACE",
      summary: "You have no session for workspace 'ws_missing'.",
      nextActions: [
        {
          kind: "run-command",
          label: "Sign in and pick 'ws_missing' in the browser",
          command: "prisma auth login",
        },
      ],
    });
    expect(openUrl).not.toHaveBeenCalled();
  });

  /** Design §11.7 and §11.10 test 8. */
  it("switches under an env override and says the env token stays in force", async () => {
    const cli = makeCli({
      sessions: twoSessions,
      selectedWorkspaceId: "ws_1",
      environmentToken: tokenFor("ws_env"),
    });

    const result = await cli.run(["auth", "workspace", "use", "ws_2"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "PRISMA_SERVICE_TOKEN supplies the credential in force",
    );
    expect(cli.credentialManager?.state().selectedWorkspaceId).toBe("ws_2");
  });

  it("reports having nothing to select when no sessions are held", async () => {
    const result = await makeCli().run([
      "auth",
      "workspace",
      "use",
      "ws_1",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("AUTH.NO_WORKSPACE_SESSIONS");
  });
});

describe("auth workspace logout", () => {
  it("ends the named session and prints the workspace it ended", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc"), record("ws_2", "Globex")],
      selectedWorkspaceId: "ws_2",
    });

    const result = await cli.run([
      "auth",
      "workspace",
      "logout",
      "Acme Inc",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({
      workspace: { id: "ws_1", name: "Acme Inc" },
      wasSelected: false,
    });
    expect(
      cli.credentialManager?.state().sessions.map((s) => s.workspaceId),
    ).toEqual(["ws_2"]);
  });

  it("clears the current marker when the ended session was current", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
    });

    const result = await cli.run([
      "auth",
      "workspace",
      "logout",
      "ws_1",
      "--json",
    ]);

    expect(resultOf(result)).toMatchObject({ wasSelected: true });
    expect(cli.credentialManager?.state()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
  });

  it("raises the ruled error for a workspace it holds no session for", async () => {
    const result = await makeCli({ sessions: [record("ws_1", "Acme")] }).run([
      "auth",
      "workspace",
      "logout",
      "nope",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("AUTH.NO_SESSION_FOR_WORKSPACE");
  });

  /** Design §11.7 and §11.10 test 8. */
  it("ends the session under an env override and says the env token stays in force", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
      environmentToken: tokenFor("ws_env"),
    });

    const result = await cli.run(["auth", "workspace", "logout", "ws_1"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "PRISMA_SERVICE_TOKEN supplies the credential in force",
    );
    expect(cli.credentialManager?.state().sessions).toEqual([]);
  });

  /** Design §11.10, test 6: the ref resolves, then another process
   *  removes the session before the write lands. Removal is idempotent,
   *  so the command still exits 0 rather than saying something untrue. */
  it("exits 0 when another process removed the session mid-command", async () => {
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
    });
    const manager = cli.credentialManager;
    const readSessions = manager.sessions.bind(manager);
    vi.spyOn(manager, "sessions").mockImplementation(async () => {
      const stored = await readSessions();
      manager.overwriteStoredState({
        sessions: [],
        selectedWorkspaceId: undefined,
      });
      return stored;
    });

    const result = await cli.run([
      "auth",
      "workspace",
      "logout",
      "ws_1",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toEqual({
      workspace: { id: "ws_1", name: "Acme Inc" },
      wasSelected: true,
    });
    expect(manager.state().sessions).toEqual([]);
  });
});

describe("the environment credential carries no refresh token", () => {
  let server: Server | undefined;
  const paths: string[] = [];

  afterEach(async () => {
    const running = server;
    server = undefined;
    paths.length = 0;
    if (running !== undefined) {
      await new Promise<void>((resolve) => running.close(() => resolve()));
    }
  });

  const touchesApi = defineCommand({
    help: { summary: "Issues one management API request" },
    handler: async (_args, ctx) => {
      await ctx.api.GET("/v1/me", {});
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

  async function cliAgainstA401Server() {
    server = createServer((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    return createTestCli({
      commands: { ...COMMANDS, probe: touchesApi },
      groups: GROUPS,
      environmentCredential: environmentCredentialFor(
        tokenFor("ws_env", { sub: "usr_env" }),
      ),
      managementApiClientConfig: {
        clientId: "test-client-id",
        redirectUri: `${baseUrl}/auth/callback`,
        apiBaseUrl: baseUrl,
        authBaseUrl: baseUrl,
      },
      now: () => new Date(0),
    });
  }

  it("does not reach the token endpoint when the API answers 401", async () => {
    const cli = await cliAgainstA401Server();

    const result = await cli.run(["probe", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result).code).toBe("AUTH.SERVICE_TOKEN_REJECTED");
    expect(paths).toEqual(["/v1/me"]);
  });

  /** §11.6: whoami does not branch on origin — it attempts the same
   *  online enrichment for an environment credential, and falls back to
   *  the token's own claims when the request fails. */
  it("falls back to the env token's own claims when the enrichment is rejected", async () => {
    const cli = await cliAgainstA401Server();

    const result = await cli.run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      source: "environment",
      user: { id: "usr_env", email: null },
    });
    expect(paths).toEqual(["/v1/me"]);
  });

  /** A host that accepts the connection and never answers is the case
   *  ctx.signal cannot cover — it only fires on Ctrl-C. Without its own
   *  deadline the enrichment would hold whoami for as long as the
   *  runtime's own timeouts allow, which on a CI runner behind a
   *  black-holing proxy is minutes. */
  it("gives up on an enrichment that never answers and reports the claims", async () => {
    server = createServer((request) => {
      paths.push(request.url ?? "");
      // Accept, then never respond.
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const cli = createTestCli({
      commands: COMMANDS,
      groups: GROUPS,
      environmentCredential: environmentCredentialFor(
        tokenFor("ws_env", { sub: "usr_env" }),
      ),
      managementApiClientConfig: {
        clientId: "test-client-id",
        redirectUri: `${baseUrl}/auth/callback`,
        apiBaseUrl: baseUrl,
        authBaseUrl: baseUrl,
      },
      now: () => new Date(0),
    });

    const startedAt = Date.now();
    const result = await cli.run(["auth", "whoami", "--json"]);
    const elapsed = Date.now() - startedAt;

    expect(result.exitCode).toBe(0);
    expect(resultOf(result)).toMatchObject({
      source: "environment",
      user: { id: "usr_env" },
    });
    expect(paths).toEqual(["/v1/me"]);
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);
});

describe("a blank service token is never an override", () => {
  for (const [name, token] of [
    ["blank", ""],
    ["whitespace", "   "],
  ] as const) {
    it(`fails auth workspace list with the blank-token error (${name})`, async () => {
      const cli = makeCli({
        sessions: [record("ws_1", "Acme Inc")],
        selectedWorkspaceId: "ws_1",
      });

      const result = await cli.run(["auth", "workspace", "list", "--json"], {
        env: { PRISMA_SERVICE_TOKEN: token },
      });

      expect(result.exitCode).toBe(2);
      expect(errorOf(result).code).toBe("AUTH.SERVICE_TOKEN_EMPTY");
      expect(result.stdout).not.toContain("supplies the credential in force");
      expect(result.stderr).not.toContain("supplies the credential in force");
    });

    it(`fails auth login with the blank-token error before the browser opens (${name})`, async () => {
      vi.mocked(performLogin).mockResolvedValue(credentialFor("ws_1"));
      const cli = makeCli();

      const result = await cli.run(["auth", "login", "--json"], {
        env: { PRISMA_SERVICE_TOKEN: token },
      });

      expect(result.exitCode).toBe(2);
      expect(errorOf(result).code).toBe("AUTH.SERVICE_TOKEN_EMPTY");
      expect(vi.mocked(performLogin)).not.toHaveBeenCalled();
      expect(cli.credentialManager?.state().sessions).toEqual([]);
    });
  }
});

describe("the shapes the commands hand back", () => {
  it("never lets token material reach the output", async () => {
    const secret = "refresh_ws_1";
    const cli = makeCli({
      sessions: [record("ws_1", "Acme Inc")],
      selectedWorkspaceId: "ws_1",
    });

    const runs = [
      await cli.run(["auth", "workspace", "list", "--json"]),
      await cli.run(["auth", "whoami", "--json"]),
    ];

    for (const run of runs) {
      expect(run.stdout).not.toContain(secret);
      expect(run.stderr).not.toContain(secret);
    }
  });

  it("exposes no token on the shapes the commands see", () => {
    const session: Session = {
      workspaceId: "ws_1",
      workspaceName: "Acme Inc",
      expiresAt: undefined,
    };
    const active: ActiveCredential = {
      workspaceId: "ws_1",
      workspaceName: "Acme Inc",
      expiresAt: undefined,
      identity: {
        userId: "usr_456",
        email: "bob@example.com",
        name: undefined,
      },
      origin: { source: "stored" },
    };
    expect(Object.keys(session)).not.toContain("token");
    expect(Object.keys(active)).not.toContain("token");
  });
});
