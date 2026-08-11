/**
 * ctx.api under design rev 6: the ENGINE constructs ONE client for the
 * active credential from the injected config — always the SDK's
 * refreshing path over the storage the manager hands out, whatever the
 * credential's origin — plus the engine-side request-failure mapping
 * (refresh-invalid → expired; a credential that could never be renewed
 * → credential-rejected; other AuthError → stored-state re-read; cause-
 * chain unwrapping). Requests run against the real SDK over a scripted
 * global fetch.
 */

import {
  type ActiveCredential,
  type CredentialManager,
  credentialsRequiredError,
  defineCommand,
  type ManagementApiClient,
  type ManagementApiClientConfig,
  type Runtime,
  type TokenStorage,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  type InMemoryCredentialManager,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AnyCommand } from "../src/commands";
import { buildEngine, type RunHooks } from "../src/execution/engine";

const CLIENT_CONFIG: ManagementApiClientConfig = {
  clientId: "test-client-id",
  redirectUri: "https://test.invalid/auth/callback",
  apiBaseUrl: "https://api.test.invalid",
  authBaseUrl: "https://auth.test.invalid",
};
const TOKEN_ENDPOINT = "https://auth.test.invalid/token";
const WORKSPACES_ENDPOINT = "https://api.test.invalid/v1/workspaces";

function unusedManagerMethod(name: string): () => never {
  return () => {
    throw new Error(`unexpected CredentialManager.${name} call`);
  };
}

function fakeCredentialManager(
  overrides: Partial<CredentialManager>,
): CredentialManager {
  return {
    activeCredential: unusedManagerMethod("activeCredential"),
    sessions: unusedManagerMethod("sessions"),
    createSession: unusedManagerMethod("createSession"),
    selectSession: unusedManagerMethod("selectSession"),
    endSession: unusedManagerMethod("endSession"),
    endAllSessions: unusedManagerMethod("endAllSessions"),
    activeCredentialStorage: unusedManagerMethod("activeCredentialStorage"),
    activeAccessToken: unusedManagerMethod("activeAccessToken"),
    ...overrides,
  };
}

const storedCredential = (workspaceId: string): ActiveCredential => ({
  workspaceId,
  workspaceName: undefined,
  expiresAt: undefined,
  identity: undefined,
  origin: { source: "stored" },
});

const storedSessions = (...workspaceIds: readonly string[]) => ({
  sessions: workspaceIds.map((workspaceId) => ({
    workspaceId,
    workspaceName: undefined,
    expiresAt: undefined,
  })),
  selectedWorkspaceId: workspaceIds[0],
});

function makeRuntime(overrides?: {
  readonly credentialManager?: CredentialManager;
}): Runtime & {
  readonly stderrText: () => string;
  readonly stdoutText: () => string;
} {
  let stderrText = "";
  let stdoutText = "";
  return {
    stdout: {
      write: (text) => {
        stdoutText += text;
      },
    },
    stderr: {
      write: (text) => {
        stderrText += text;
      },
    },
    stdin: {
      async *[Symbol.asyncIterator]() {},
    },
    cwd: "/",
    env: {},
    isTty: { stdin: false, stdout: false, stderr: false },
    exit: (code: number): never => {
      throw new Error(`runtime.exit(${code})`);
    },
    onSignal: () => () => {},
    loadConfig: async () => ({
      path: "/prisma.config.ts",
      sections: {},
      diagnostics: [],
    }),
    credentialManager: overrides?.credentialManager,
    managementApiClientConfig: CLIENT_CONFIG,
    managementApi: { baseUrl: "https://test.invalid" },
    stderrText: () => stderrText,
    stdoutText: () => stdoutText,
  };
}

async function runEngine(
  command: AnyCommand,
  runtime: Runtime,
  hooks: RunHooks = {},
): Promise<number> {
  const engine = buildEngine({
    name: "t",
    version: "0.0.0",
    commandFamilies: [],
    groups: {},
    commands: { toy: command },
  });
  return engine.execute(["toy"], runtime, hooks);
}

const succeed = (
  body?: (ctx: { readonly api: ManagementApiClient }) => Promise<void>,
) =>
  defineCommand({
    help: { summary: "toy" },
    handler: async (_args, ctx) => {
      await body?.(ctx);
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

const callApi = succeed(async (ctx) => {
  await ctx.api.GET("/v1/workspaces", {});
});

interface RecordedFetch {
  readonly url: string;
  readonly authorization: string | null;
}

function scriptFetch(
  script: (url: string, request: Request) => Response | Promise<Response>,
): RecordedFetch[] {
  const calls: RecordedFetch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      calls.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
      });
      return script(request.url, request);
    }),
  );
  return calls;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const accessTokenFor = (workspaceId: string, marker: string): string =>
  mintTestJwt({ sub: "user-1", workspace_id: workspaceId, token: marker });

const sessionSeed = (
  workspaceId: string,
  refreshToken?: string,
  marker = "initial",
): SessionRecord => ({
  workspaceId,
  workspaceName: undefined,
  credential: {
    token: accessTokenFor(workspaceId, marker),
    refreshToken,
    expiresAt: undefined,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ctx.api construction", () => {
  test("the harness client override IS ctx.api", async () => {
    const fake = { GET: async () => ({}) } as unknown as ManagementApiClient;
    let seen: ManagementApiClient | undefined;
    const cli = createTestCli({
      commands: {
        toy: succeed(async (ctx) => {
          seen = ctx.api;
        }),
      },
      managementApi: { client: fake },
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(seen).toBe(fake);
  });

  test("nothing is constructed for a run that never issues a request", async () => {
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({}),
    });
    const exitCode = await runEngine(
      succeed(async (ctx) => {
        // Touch the property without invoking any request method.
        void ctx.api;
      }),
      runtime,
    );
    expect(exitCode).toBe(0);
  });

  test("unauthenticated api use throws CLI.CREDENTIALS_REQUIRED and settles errored, exit 2", async () => {
    const cli = createTestCli({
      commands: { toy: callApi },
    });
    const { exitCode, stderr, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.CREDENTIALS_REQUIRED",
          summary: "You must be signed in to run this command.",
        },
      },
    });
  });

  test("the client is constructed once per run over the active credential's storage; calls are proxied", async () => {
    const calls = scriptFetch(() => jsonResponse(200, { workspaces: [] }));
    let storageResolutions = 0;
    const storage: TokenStorage = {
      getTokens: async () => ({
        workspaceId: "workspace-1",
        accessToken: accessTokenFor("workspace-1", "initial"),
      }),
      setTokens: async () => {},
      clearTokens: async () => {},
    };
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        activeCredential: async () => storedCredential("workspace-1"),
        activeCredentialStorage: async () => {
          storageResolutions += 1;
          return storage;
        },
      }),
    });
    const exitCode = await runEngine(
      succeed(async (ctx) => {
        await ctx.api.GET("/v1/workspaces", {});
        await ctx.api.GET("/v1/workspaces", {});
      }),
      runtime,
    );
    expect(exitCode).toBe(0);
    expect(storageResolutions).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(WORKSPACES_ENDPOINT);
    expect(calls[0].authorization).toBe(
      `Bearer ${accessTokenFor("workspace-1", "initial")}`,
    );
  });
});

describe("the stored-session refresh path", () => {
  test("a 401 refreshes through the manager's storage and retries; the rotated pair lands in the store", async () => {
    const rotatedAccessToken = accessTokenFor("workspace-1", "rotated");
    const calls = scriptFetch((url) => {
      if (url === TOKEN_ENDPOINT) {
        return jsonResponse(200, {
          access_token: rotatedAccessToken,
          refresh_token: "refresh-2",
        });
      }
      const bearer = calls[calls.length - 1].authorization;
      return bearer === `Bearer ${rotatedAccessToken}`
        ? jsonResponse(200, { workspaces: ["fresh"] })
        : jsonResponse(401, { message: "unauthorized" });
    });
    let seen: unknown;
    const cli = createTestCli({
      commands: {
        toy: succeed(async (ctx) => {
          seen = await ctx.api.GET("/v1/workspaces", {});
        }),
      },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(seen).toMatchObject({ data: { workspaces: ["fresh"] } });
    const state = cli.credentialManager.state();
    expect(state.sessions).toMatchObject([
      {
        workspaceId: "workspace-1",
        credential: { token: rotatedAccessToken, refreshToken: "refresh-2" },
      },
    ]);
    expect(state.selectedWorkspaceId).toBe("workspace-1");
  });

  /** Design §11.10, test 5. */
  test("another process rotated first: the storage re-read serves its newer pair and the retry succeeds without touching the token endpoint", async () => {
    const rotatedByOtherProcess = accessTokenFor("workspace-1", "rotated-by-b");
    let manager: InMemoryCredentialManager | undefined;
    const calls = scriptFetch((url) => {
      if (url === TOKEN_ENDPOINT) {
        return jsonResponse(500, { message: "the exchange must not happen" });
      }
      if (
        calls[calls.length - 1].authorization ===
        `Bearer ${rotatedByOtherProcess}`
      ) {
        return jsonResponse(200, { workspaces: ["fresh"] });
      }
      // The other process rotated between this process's read and its
      // request, so the 401 is against a pair the store has replaced.
      manager?.overwriteStoredState({
        sessions: [
          {
            workspaceId: "workspace-1",
            workspaceName: undefined,
            credential: {
              token: rotatedByOtherProcess,
              refreshToken: "refresh-2",
              expiresAt: undefined,
            },
          },
        ],
      });
      return jsonResponse(401, { message: "unauthorized" });
    });
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    manager = cli.credentialManager;
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(calls.map((call) => call.url)).toEqual([
      WORKSPACES_ENDPOINT,
      WORKSPACES_ENDPOINT,
    ]);
    expect(calls[1].authorization).toBe(`Bearer ${rotatedByOtherProcess}`);
    expect(cli.credentialManager.state().sessions).toMatchObject([
      { credential: { token: rotatedByOtherProcess } },
    ]);
  });

  test("invalid_grant on refresh maps to CLI.CREDENTIALS_REQUIRED with the expiry wording; compare-and-clear ended the session", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(400, { error: "invalid_grant" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.CREDENTIALS_REQUIRED",
          summary: "Your session has expired — sign in again.",
        },
      },
    });
    expect(cli.credentialManager.state()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
  });

  /** Design §11.10, test 4 — §7's migrated entries carry no refresh
   *  token, and the SDK refuses the exchange rather than attempting it. */
  test("a stored session with no refresh token is rejected with the sign-in-again wording, not the retry advice", async () => {
    const calls = scriptFetch(() =>
      jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.CREDENTIALS_REQUIRED",
          summary: "Your session has expired — sign in again.",
        },
      },
    });
    expect(calls.map((call) => call.url)).toEqual([WORKSPACES_ENDPOINT]);
  });

  test("a transient refresh failure with the credential's session still stored maps to CLI.AUTH_SERVICE_ERROR; nothing cleared", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(500, { message: "boom" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: { code: "CLI.AUTH_SERVICE_ERROR" },
      },
    });
    expect(cli.credentialManager.state().sessions).toHaveLength(1);
  });

  test("the failure mapping re-reads the ACTIVE CREDENTIAL's workspace, not whatever is selected now", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(500, { message: "boom" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        // The pinned credential is workspace-1; the stored state only
        // holds workspace-2 — this process's session is gone.
        activeCredential: async () => storedCredential("workspace-1"),
        sessions: async () => storedSessions("workspace-2"),
        activeCredentialStorage: async () => ({
          getTokens: async () => ({
            workspaceId: "workspace-1",
            accessToken: accessTokenFor("workspace-1", "initial"),
            refreshToken: "refresh-1",
          }),
          setTokens: async () => {},
          clearTokens: async () => {},
        }),
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain("has ended");
  });

  test("a structured error thrown inside the request pipeline is unwrapped from the SDK's FetchError and settles as itself", async () => {
    scriptFetch(() => jsonResponse(200, {}));
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        activeCredential: async () => storedCredential("workspace-1"),
        activeCredentialStorage: async () => ({
          getTokens: async () => {
            throw credentialsRequiredError("sessions-held-none-selected");
          },
          setTokens: async () => {},
          clearTokens: async () => {},
        }),
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain(
      "You have workspace sessions but none is current.",
    );
  });

  test("a cyclic cause chain on a request failure terminates and settles as a bug", async () => {
    scriptFetch(() => jsonResponse(200, {}));
    const cyclic = new Error("outer");
    const inner = new Error("inner", { cause: cyclic });
    cyclic.cause = inner;
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        activeCredential: async () => storedCredential("workspace-1"),
        activeCredentialStorage: async () => ({
          getTokens: async () => {
            throw cyclic;
          },
          setTokens: async () => {},
          clearTokens: async () => {},
        }),
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(1);
    expect(runtime.stdoutText()).toContain('"code":"CLI.INTERNAL_ERROR"');
  });
});

describe("a refresh that fails without an AuthError", () => {
  /** The rotated token carries no workspace_id, so the SDK's own
   *  extraction throws a plain Error from inside the refresh. */
  const rotationTheSdkCannotDecode = () =>
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(200, {
            access_token: mintTestJwt({ sub: "user-1" }),
            refresh_token: "refresh-2",
          })
        : jsonResponse(401, { message: "unauthorized" }),
    );

  test("maps to CLI.AUTH_SERVICE_ERROR, not to the raw cause; nothing cleared", async () => {
    rotationTheSdkCannotDecode();
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: { ok: false, error: { code: "CLI.AUTH_SERVICE_ERROR" } },
    });
    expect(cli.credentialManager.state().sessions).toHaveLength(1);
  });

  test("a structured error raised BY the rotation write surfaces as itself, not as the transient error", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(200, {
            access_token: accessTokenFor("workspace-1", "rotated"),
            refresh_token: "refresh-2",
          })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        activeCredential: async () => storedCredential("workspace-1"),
        activeCredentialStorage: async () => ({
          getTokens: async () => ({
            workspaceId: "workspace-1",
            accessToken: accessTokenFor("workspace-1", "initial"),
            refreshToken: "refresh-1",
          }),
          // Another process ended this session while the exchange was
          // in flight, so the write refuses instead of resurrecting it.
          setTokens: async () => {
            throw credentialsRequiredError("session-ended");
          },
          clearTokens: async () => {},
        }),
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain("has ended");
  });

  test("a plain error from outside the refresh path still settles as a bug", async () => {
    scriptFetch(() => jsonResponse(200, {}));
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        activeCredential: async () => storedCredential("workspace-1"),
        activeCredentialStorage: async () => ({
          getTokens: async () => {
            throw new Error("something unrelated broke");
          },
          setTokens: async () => {},
          clearTokens: async () => {},
        }),
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(1);
    expect(runtime.stdoutText()).toContain('"code":"CLI.INTERNAL_ERROR"');
  });
});

describe("the engine's debug valve", () => {
  const refreshRejectedAsInvalidGrant = () =>
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(400, {
            error: "invalid_grant",
            error_description: "refresh token already used",
          })
        : jsonResponse(401, { message: "unauthorized" }),
    );

  const cliWithDebug = () =>
    createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1", "SECRET-REFRESH-TOKEN")],
      selectedWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });

  test("PRISMA_NEXT_DEBUG=1 records the refresh attempt and the endpoint's verdict", async () => {
    refreshRejectedAsInvalidGrant();
    const { stderr } = await cliWithDebug().run(["toy", "--json"], {
      env: { PRISMA_NEXT_DEBUG: "1" },
    });
    expect(stderr).toContain("refresh attempted for session workspace-1");
    expect(stderr).toContain(
      "refresh failed: refreshTokenInvalid=true error=invalid_grant",
    );
    // The endpoint's own free text is deliberately not echoed.
    expect(stderr).not.toContain("refresh token already used");
  });

  test("a non-OAuth refresh failure logs the SDK's verdict, which carries the status", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(503, { message: "boom" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const { stderr } = await cliWithDebug().run(["toy", "--json"], {
      env: { PRISMA_NEXT_DEBUG: "1" },
    });
    expect(stderr).toContain(
      "refresh failed: refreshTokenInvalid=false error=Token request failed with status 503",
    );
  });

  test("a refresh that throws no AuthError is recorded by type alone", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(200, {
            access_token: mintTestJwt({ sub: "user-1" }),
            refresh_token: "refresh-2",
          })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const { stderr } = await cliWithDebug().run(["toy", "--json"], {
      env: { PRISMA_NEXT_DEBUG: "1" },
    });
    expect(stderr).toContain("refresh failed without an AuthError (Error)");
  });

  test("the valve is silent when it is unset", async () => {
    refreshRejectedAsInvalidGrant();
    const { stderr } = await cliWithDebug().run(["toy", "--json"]);
    expect(stderr).toBe("");
  });

  test("no token material reaches any refresh-failure path with the valve open", async () => {
    const failures = [
      jsonResponse(400, { error: "invalid_grant" }),
      jsonResponse(500, { message: "boom" }),
      jsonResponse(200, {
        access_token: mintTestJwt({ sub: "user-1" }),
        refresh_token: "SECRET-ROTATED-TOKEN",
      }),
    ];
    for (const failure of failures) {
      scriptFetch((url) =>
        url === TOKEN_ENDPOINT
          ? failure.clone()
          : jsonResponse(401, { message: "unauthorized" }),
      );
      const { stderr, stdout, json } = await cliWithDebug().run(
        ["toy", "--json"],
        { env: { PRISMA_NEXT_DEBUG: "1" } },
      );
      const everything = stderr + stdout + JSON.stringify(json);
      expect(stderr).toContain("refresh attempted for session workspace-1");
      for (const material of [
        "SECRET-REFRESH-TOKEN",
        "SECRET-ROTATED-TOKEN",
        accessTokenFor("workspace-1", "initial"),
      ]) {
        expect(everything).not.toContain(material);
      }
    }
  });
});

describe("the environment credential", () => {
  const environmentToken = accessTokenFor("workspace-env", "environment");

  /** Design §11.10, test 1 — the path that actually runs today. */
  test("with no refresh token: a 401 is the credential-rejected error naming the variable, and the token endpoint is never touched", async () => {
    const calls = scriptFetch(() =>
      jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      environmentCredential: {
        token: environmentToken,
        refreshToken: undefined,
        expiresAt: undefined,
      },
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "AUTH.SERVICE_TOKEN_REJECTED",
          summary:
            "The management API rejected the service token from PRISMA_SERVICE_TOKEN.",
        },
      },
    });
    expect(calls.map((call) => call.url)).toEqual([WORKSPACES_ENDPOINT]);
    expect(calls[0].authorization).toBe(`Bearer ${environmentToken}`);
  });

  /** "Expired" and "ended" describe a stored session. An environment
   *  credential has none, so neither can be the answer for it however
   *  its refresh fails. Unreachable today — one environment variable
   *  carries one bearer string, so there is no refresh token — but
   *  §11.2 keeps the uniform path on purpose. */
  test("with a refresh token: invalid_grant is the credential-rejected error, not an expired session", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(400, { error: "invalid_grant" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      environmentCredential: {
        token: environmentToken,
        refreshToken: "refresh-env",
        expiresAt: undefined,
      },
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        ok: false,
        error: { code: "AUTH.SERVICE_TOKEN_REJECTED" },
      },
    });
  });

  test("with a refresh token: a transient refresh failure stays transient, and is never reported as an ended session", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(503, { message: "boom" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      environmentCredential: {
        token: environmentToken,
        refreshToken: "refresh-env",
        expiresAt: undefined,
      },
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        ok: false,
        error: { code: "CLI.AUTH_SERVICE_ERROR" },
      },
    });
  });

  test("a successful request passes its data through and carries the environment token", async () => {
    const calls = scriptFetch(() => jsonResponse(200, { workspaces: ["env"] }));
    let seen: unknown;
    const cli = createTestCli({
      commands: {
        toy: succeed(async (ctx) => {
          seen = await ctx.api.GET("/v1/workspaces", {});
        }),
      },
      environmentCredential: {
        token: environmentToken,
        refreshToken: undefined,
        expiresAt: undefined,
      },
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(seen).toMatchObject({ data: { workspaces: ["env"] } });
    expect(calls[0].authorization).toBe(`Bearer ${environmentToken}`);
  });

  /** Design §11.10, test 2 — the uniform refresh path, over memory. */
  test("with a refresh token: the rotation happens in memory, the store is untouched, and the next request in the same process carries the rotated token", async () => {
    const rotatedAccessToken = accessTokenFor("workspace-env", "rotated");
    const calls = scriptFetch((url) => {
      if (url === TOKEN_ENDPOINT) {
        return jsonResponse(200, {
          access_token: rotatedAccessToken,
          refresh_token: "env-refresh-2",
        });
      }
      return calls[calls.length - 1].authorization ===
        `Bearer ${rotatedAccessToken}`
        ? jsonResponse(200, { workspaces: ["fresh"] })
        : jsonResponse(401, { message: "unauthorized" });
    });
    const cli = createTestCli({
      commands: {
        toy: succeed(async (ctx) => {
          await ctx.api.GET("/v1/workspaces", {});
          await ctx.api.GET("/v1/workspaces", {});
        }),
      },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      selectedWorkspaceId: "workspace-1",
      environmentCredential: {
        token: environmentToken,
        refreshToken: "env-refresh-1",
        expiresAt: undefined,
      },
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const before = cli.credentialManager.state();
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(calls.map((call) => call.url)).toEqual([
      WORKSPACES_ENDPOINT,
      TOKEN_ENDPOINT,
      WORKSPACES_ENDPOINT,
      WORKSPACES_ENDPOINT,
    ]);
    expect(calls[3].authorization).toBe(`Bearer ${rotatedAccessToken}`);
    expect(cli.credentialManager.state()).toEqual(before);
  });

  /** Design §11.10, test 3 — the memory-backed storage cannot reach the
   *  stored session that happens to share its workspace. */
  test("whose workspace matches a stored session: invalid_grant clears only its own memory, leaving the stored session intact", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(400, { error: "invalid_grant" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-shared", "refresh-1")],
      selectedWorkspaceId: "workspace-shared",
      environmentCredential: {
        token: accessTokenFor("workspace-shared", "environment"),
        refreshToken: "env-refresh-1",
        expiresAt: undefined,
      },
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const before = cli.credentialManager.state();
    const { exitCode } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    expect(cli.credentialManager.state().sessions).toHaveLength(1);
    expect(cli.credentialManager.state()).toEqual(before);
  });
});
