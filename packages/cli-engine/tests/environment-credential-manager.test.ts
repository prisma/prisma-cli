/**
 * The production, environment-only CredentialManager (R-S3-1): env
 * composition from PRISMA_SERVICE_TOKEN/PRISMA_WORKSPACE_ID, structured
 * mutation refusals, and the spawn path's pass-through token read.
 */
import {
  createCli,
  defineCommand,
  EnvironmentCredentialManager,
  exitWithChildStatus,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const CLAIMED_TOKEN = mintTestJwt({
  workspace_id: "ws_claimed",
  sub: "user_1",
  email: "user@example.com",
});
const CLAIMLESS_TOKEN = mintTestJwt({ sub: "user_1" });

describe("composition from the environment", () => {
  test("token and claimed workspace compose the active credential", async () => {
    const manager = new EnvironmentCredentialManager({
      env: { PRISMA_SERVICE_TOKEN: CLAIMED_TOKEN },
    });

    const credential = await manager.activeCredential();

    expect(credential).not.toBeNull();
    expect(credential?.workspaceId).toBe("ws_claimed");
    expect(credential?.origin).toEqual({ source: "environment" });
    expect(credential?.identity?.email).toBe("user@example.com");
  });

  test("a claimless token takes its workspace from PRISMA_WORKSPACE_ID", async () => {
    const manager = new EnvironmentCredentialManager({
      env: {
        PRISMA_SERVICE_TOKEN: CLAIMLESS_TOKEN,
        PRISMA_WORKSPACE_ID: "ws_env",
      },
    });

    expect((await manager.activeCredential())?.workspaceId).toBe("ws_env");
  });

  test("a claimless token with no workspace variable names no workspace", async () => {
    const manager = new EnvironmentCredentialManager({
      env: { PRISMA_SERVICE_TOKEN: CLAIMLESS_TOKEN },
    });

    expect((await manager.activeCredential())?.workspaceId).toBeUndefined();
  });

  test("an unset token means no credential at all", async () => {
    const manager = new EnvironmentCredentialManager({ env: {} });

    expect(await manager.activeCredential()).toBeNull();
    expect(await manager.activeAccessToken()).toBeNull();
    expect(await manager.sessions()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
  });

  test("a blank token is the structured empty-token error", async () => {
    const manager = new EnvironmentCredentialManager({
      env: { PRISMA_SERVICE_TOKEN: "   " },
    });

    await expect(manager.activeCredential()).rejects.toMatchObject({
      code: "AUTH.SERVICE_TOKEN_EMPTY",
    });
  });
});

describe("mutations refuse with a structured error", () => {
  const manager = new EnvironmentCredentialManager({
    env: { PRISMA_SERVICE_TOKEN: CLAIMED_TOKEN },
  });
  const mutations: ReadonlyArray<[string, () => Promise<unknown>]> = [
    [
      "createSession",
      () =>
        manager.createSession(
          {
            token: CLAIMED_TOKEN,
            refreshToken: undefined,
            expiresAt: undefined,
          },
          "ws_claimed",
        ),
    ],
    ["selectSession", () => manager.selectSession("ws_claimed")],
    ["endSession", () => manager.endSession("ws_claimed")],
    ["endAllSessions", () => manager.endAllSessions()],
  ];

  test.each(mutations)("%s refuses", async (_name, mutate) => {
    await expect(mutate()).rejects.toMatchObject({
      code: "AUTH.SESSIONS_UNSUPPORTED",
    });
  });
});

describe("the engine-facing reads", () => {
  test("activeAccessToken passes the env token through", async () => {
    const manager = new EnvironmentCredentialManager({
      env: { PRISMA_SERVICE_TOKEN: CLAIMED_TOKEN },
    });

    expect(await manager.activeAccessToken()).toBe(CLAIMED_TOKEN);
  });

  test("the storage is memory-backed and carries no refresh token", async () => {
    const manager = new EnvironmentCredentialManager({
      env: { PRISMA_SERVICE_TOKEN: CLAIMED_TOKEN },
    });
    await manager.activeCredential();

    const storage = await manager.activeCredentialStorage();
    const tokens = await storage.getTokens();

    expect(tokens?.accessToken).toBe(CLAIMED_TOKEN);
    expect(tokens?.refreshToken).toBeUndefined();
    await storage.clearTokens();
    expect(await storage.getTokens()).toBeNull();
  });
});

describe("wired as a Runtime's manager", () => {
  const converge = defineCommand({
    help: { summary: "Hands credentials to a child" },
    maySpawn: true,
    needs: { credentials: "child" },
    handler: async (_args, ctx) =>
      ok(exitWithChildStatus(await ctx.spawn({ command: "alchemy" }))),
  });
  const cli = createCli({
    name: "t",
    version: "0.0.0",
    commandFamilies: [],
    groups: {},
    commands: { converge },
  });

  function runtimeFor(
    env: Readonly<Record<string, string | undefined>>,
    record: (childEnv: Readonly<Record<string, string | undefined>>) => void,
  ): Runtime {
    return {
      isCI: false,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      stdin: {
        async *[Symbol.asyncIterator]() {},
      },
      cwd: "/",
      env,
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
      credentialManager: new EnvironmentCredentialManager({ env }),
      managementApiClientConfig: {
        clientId: "test",
        redirectUri: "https://test.invalid/callback",
        apiBaseUrl: "https://test.invalid",
        authBaseUrl: "https://auth.test.invalid",
      },
      spawn: (request) => {
        record(request.env);
        return {
          ended: Promise.resolve({ exitCode: 0, signal: null }),
          kill: () => {},
        };
      },
      managementApi: { baseUrl: "https://test.invalid" },
      packageManager: "unknown",
    };
  }

  test("a child-credentials command injects the env credential through it", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const env = { PRISMA_SERVICE_TOKEN: CLAIMED_TOKEN };

    const exitCode = await cli.run(
      ["converge"],
      runtimeFor(env, (childEnv) => (seen = childEnv)),
    );

    expect(exitCode).toBe(0);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(CLAIMED_TOKEN);
    expect(seen.PRISMA_WORKSPACE_ID).toBe("ws_claimed");
  });

  // A service token need not say when it expires. A missing `exp` claim
  // maps to no expiry at all, which the near-expiry refusal must read as
  // "nothing to refuse", not as "expires now".
  test("a token with no exp claim is not refused as near-expiry", async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    const env = {
      PRISMA_SERVICE_TOKEN: CLAIMLESS_TOKEN,
      PRISMA_WORKSPACE_ID: "ws_env",
    };

    expect(
      (await new EnvironmentCredentialManager({ env }).activeCredential())
        ?.expiresAt,
    ).toBeUndefined();

    const exitCode = await cli.run(
      ["converge"],
      runtimeFor(env, (childEnv) => (seen = childEnv)),
    );

    expect(exitCode).toBe(0);
    expect(seen.PRISMA_SERVICE_TOKEN).toBe(CLAIMLESS_TOKEN);
  });
});
