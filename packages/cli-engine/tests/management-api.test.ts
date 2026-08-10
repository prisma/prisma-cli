/**
 * ctx.api: injected fakes, the lazy proxy over the credential
 * manager's apiClient(), the unauthenticated throw path, and the
 * engine-side request-failure mapping (refresh-invalid → expired;
 * other AuthError → state re-read).
 */

import {
  type CredentialManager,
  defineCommand,
  type ManagementApiClient,
  type Runtime,
  credentialsRequiredError,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { AuthError } from "@prisma/management-api-sdk";
import { describe, expect, test } from "vitest";
import type { AnyCommand } from "../src/commands";
import { buildEngine, type RunHooks } from "../src/execution/engine";

function unusedManagerMethod(name: string): () => never {
  return () => {
    throw new Error(`unexpected CredentialManager.${name} call`);
  };
}

function fakeCredentialManager(
  overrides: Partial<CredentialManager>,
): CredentialManager {
  return {
    session: unusedManagerMethod("session"),
    beginSession: unusedManagerMethod("beginSession"),
    endSession: unusedManagerMethod("endSession"),
    grants: unusedManagerMethod("grants"),
    rememberWorkspaceName: unusedManagerMethod("rememberWorkspaceName"),
    activateGrant: unusedManagerMethod("activateGrant"),
    forgetGrant: unusedManagerMethod("forgetGrant"),
    apiClient: unusedManagerMethod("apiClient"),
    ...overrides,
  };
}

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
  const client = ctx.api as unknown as { call: () => Promise<void> };
  await client.call();
});

function throwingClientManager(failure: unknown): CredentialManager {
  return fakeCredentialManager({
    apiClient: async () =>
      ({
        call: async () => {
          throw failure;
        },
      }) as unknown as ManagementApiClient,
  });
}

describe("ctx.api", () => {
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

  test("the manager's apiClient is never resolved for a run that never issues a request", async () => {
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
      commands: {
        toy: succeed(async (ctx) => {
          await ctx.api.GET("/v1/workspaces/{id}", {
            params: { path: { id: "w1" } },
          });
        }),
      },
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

  test("apiClient resolves on first method call and once per run; calls are proxied with their arguments", async () => {
    let resolutions = 0;
    const observed: unknown[] = [];
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        apiClient: async () => {
          resolutions += 1;
          return {
            call: async (argument: unknown) => {
              observed.push(argument);
            },
          } as unknown as ManagementApiClient;
        },
      }),
    });
    const exitCode = await runEngine(
      succeed(async (ctx) => {
        const client = ctx.api as unknown as {
          call: (argument: unknown) => Promise<void>;
        };
        await client.call("first");
        await client.call("second");
      }),
      runtime,
    );
    expect(exitCode).toBe(0);
    expect(resolutions).toBe(1);
    expect(observed).toEqual(["first", "second"]);
  });

  test("refreshTokenInvalid === true maps to CLI.CREDENTIALS_REQUIRED with the expiry wording, exit 2", async () => {
    const runtime = makeRuntime({
      credentialManager: throwingClientManager(
        new AuthError("401 Unauthorized", true),
      ),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain(
      "Your session has expired — sign in again.",
    );
  });

  test("another AuthError with the grant gone maps to the grant-removed CLI.CREDENTIALS_REQUIRED", async () => {
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        session: async () => null,
        apiClient: async () =>
          ({
            call: async () => {
              throw new AuthError("No tokens available", false);
            },
          }) as unknown as ManagementApiClient,
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain("no longer held");
  });

  test("another AuthError with a session still present maps to the transient auth-service error, exit 2", async () => {
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        session: async () => ({
          identity: { kind: "user", id: "u1", email: undefined },
          method: "user-oauth",
          origin: "stored",
          workspace: { id: "w1", name: undefined },
          expiresAt: undefined,
        }),
        apiClient: async () =>
          ({
            call: async () => {
              throw new AuthError("token endpoint returned 500", false);
            },
          }) as unknown as ManagementApiClient,
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.AUTH_SERVICE_ERROR"');
    expect(runtime.stdoutText()).not.toContain("CLI.CREDENTIALS_REQUIRED");
  });

  test("another AuthError while the state re-read raises a structured error surfaces that error", async () => {
    const runtime = makeRuntime({
      credentialManager: fakeCredentialManager({
        session: async () => {
          throw credentialsRequiredError("grants-held-none-active");
        },
        apiClient: async () =>
          ({
            call: async () => {
              throw new AuthError("refresh raced a forget", false);
            },
          }) as unknown as ManagementApiClient,
      }),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain(
      "You hold workspace grants, but none is active.",
    );
  });

  test("a structured error raised inside the request pipeline settles as itself", async () => {
    const runtime = makeRuntime({
      credentialManager: throwingClientManager(
        credentialsRequiredError("grants-held-none-active"),
      ),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(2);
    expect(runtime.stdoutText()).toContain('"code":"CLI.CREDENTIALS_REQUIRED"');
    expect(runtime.stdoutText()).toContain("No workspace is active.");
  });

  test("a cyclic cause chain on a request failure terminates and settles as a bug", async () => {
    const cyclic = new Error("outer");
    const inner = new Error("inner", { cause: cyclic });
    cyclic.cause = inner;
    const runtime = makeRuntime({
      credentialManager: throwingClientManager(cyclic),
    });
    const exitCode = await runEngine(callApi, runtime);
    expect(exitCode).toBe(1);
    expect(runtime.stdoutText()).toContain('"code":"CLI.INTERNAL_ERROR"');
  });
});
