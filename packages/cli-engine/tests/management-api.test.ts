/**
 * ctx.api under design rev 5: the ENGINE constructs the pinned
 * session's client from the injected config — the SDK's refreshing
 * path over the manager's TokenStorage view for stored sessions, the
 * static-token path for env sessions — plus the engine-side
 * request-failure mapping (refresh-invalid → expired; other AuthError
 * → bound-workspace state re-read; cause-chain unwrapping). Requests
 * run against the real SDK over a scripted global fetch.
 */

import {
  type CredentialManager,
  credentialsRequiredError,
  defineCommand,
  type ManagementApiClient,
  type ManagementApiClientConfig,
  type Runtime,
  type Session,
  type TokenStorage,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
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

function unusedManagerMethod(name: string): () => never {
  return () => {
    throw new Error(`unexpected CredentialManager.${name} call`);
  };
}

function fakeCredentialManager(
  overrides: Partial<CredentialManager>,
): CredentialManager {
  return {
    currentSession: unusedManagerMethod("currentSession"),
    sessions: unusedManagerMethod("sessions"),
    createSession: unusedManagerMethod("createSession"),
    useSession: unusedManagerMethod("useSession"),
    endSession: unusedManagerMethod("endSession"),
    endAllSessions: unusedManagerMethod("endAllSessions"),
    tokenStorage: unusedManagerMethod("tokenStorage"),
    ...overrides,
  };
}

const storedSession = (workspaceId: string): Session => ({
  workspaceId,
  workspaceName: undefined,
  expiresAt: undefined,
  source: "stored",
  current: true,
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
    config: { sections: {}, diagnostics: [] },
    credentialManager: overrides?.credentialManager,
    managementApiClientConfig: CLIENT_CONFIG,
    getCredentials: async () => undefined,
    managementApi: { baseUrl: "https://test.invalid" },
    packageManager: "unknown",
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

const sessionSeed = (workspaceId: string, refreshToken?: string) => ({
  workspaceId,
  workspaceName: undefined,
  credential: {
    token: accessTokenFor(workspaceId, "initial"),
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

  test("the client is constructed once per run over the pinned session's TokenStorage view; calls are proxied", async () => {
    const calls = scriptFetch(() => jsonResponse(200, { workspaces: [] }));
    let tokenStorageResolutions = 0;
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
        currentSession: async () => storedSession("workspace-1"),
        tokenStorage: (workspaceId) => {
          expect(workspaceId).toBe("workspace-1");
          tokenStorageResolutions += 1;
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
    expect(tokenStorageResolutions).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.test.invalid/v1/workspaces");
    expect(calls[0].authorization).toBe(
      `Bearer ${accessTokenFor("workspace-1", "initial")}`,
    );
  });
});

describe("the stored-session refresh path", () => {
  test("a 401 refreshes through the manager's TokenStorage view and retries; the rotated pair lands in the store", async () => {
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
      currentWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(seen).toMatchObject({ data: { workspaces: ["fresh"] } });
    const state = cli.credentialManager?.state();
    expect(state?.sessions).toMatchObject([
      {
        workspaceId: "workspace-1",
        credential: { token: rotatedAccessToken, refreshToken: "refresh-2" },
      },
    ]);
    expect(state?.currentWorkspaceId).toBe("workspace-1");
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
      currentWorkspaceId: "workspace-1",
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
    expect(cli.credentialManager?.state()).toEqual({
      sessions: [],
      currentWorkspaceId: null,
    });
  });

  test("a transient refresh failure with the bound session still stored maps to CLI.AUTH_SERVICE_ERROR; nothing cleared", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(500, { message: "boom" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      sessions: [sessionSeed("workspace-1", "refresh-1")],
      currentWorkspaceId: "workspace-1",
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
    expect(cli.credentialManager?.state().sessions).toHaveLength(1);
  });

  test("the failure mapping re-reads the workspace the client is BOUND to, not currentSession()", async () => {
    scriptFetch((url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse(500, { message: "boom" })
        : jsonResponse(401, { message: "unauthorized" }),
    );
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        // The pin still reports workspace-1; the stored state only
        // holds workspace-2 — the bound session is gone.
        currentSession: async () => storedSession("workspace-1"),
        sessions: async () => [storedSession("workspace-2")],
        tokenStorage: () => ({
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
        currentSession: async () => storedSession("workspace-1"),
        tokenStorage: () => ({
          getTokens: async () => {
            throw credentialsRequiredError("sessions-held-none-current");
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
        currentSession: async () => storedSession("workspace-1"),
        tokenStorage: () => ({
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
      currentWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: { ok: false, error: { code: "CLI.AUTH_SERVICE_ERROR" } },
    });
    expect(cli.credentialManager?.state().sessions).toHaveLength(1);
  });

  test("a plain error from outside the refresh path still settles as a bug", async () => {
    scriptFetch(() => jsonResponse(200, {}));
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        currentSession: async () => storedSession("workspace-1"),
        tokenStorage: () => ({
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
      currentWorkspaceId: "workspace-1",
      managementApiClientConfig: CLIENT_CONFIG,
    });

  test("PRISMA_NEXT_DEBUG=1 records the refresh attempt and the endpoint's verdict", async () => {
    refreshRejectedAsInvalidGrant();
    const { stderr } = await cliWithDebug().run(["toy", "--json"], {
      env: { PRISMA_NEXT_DEBUG: "1" },
    });
    expect(stderr).toContain("refresh attempted for session workspace-1");
    expect(stderr).toContain("refresh failed: refreshTokenInvalid=true");
    expect(stderr).toContain("refresh token already used");
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

describe("the environment-session static path", () => {
  const environmentToken = mintTestJwt({
    sub: "svc-1",
    workspace_id: "workspace-env",
  });

  test("requests carry the env token; a 401 maps to AUTH.SERVICE_TOKEN_REJECTED without touching the token endpoint", async () => {
    const calls = scriptFetch(() =>
      jsonResponse(401, { message: "unauthorized" }),
    );
    const cli = createTestCli({
      commands: { toy: callApi },
      environmentToken,
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: { code: "AUTH.SERVICE_TOKEN_REJECTED" },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.test.invalid/v1/workspaces");
    expect(calls[0].authorization).toBe(`Bearer ${environmentToken}`);
  });

  test("a successful env-session request passes its data through", async () => {
    scriptFetch(() => jsonResponse(200, { workspaces: ["env"] }));
    let seen: unknown;
    const cli = createTestCli({
      commands: {
        toy: succeed(async (ctx) => {
          seen = await ctx.api.GET("/v1/workspaces", {});
        }),
      },
      environmentToken,
      managementApiClientConfig: CLIENT_CONFIG,
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(seen).toMatchObject({ data: { workspaces: ["env"] } });
  });
});
