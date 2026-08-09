/**
 * ctx.api: injected fakes, lazy construction, the unauthenticated
 * throw path, and per-request credential pickup.
 */
import {
  defineCommand,
  type ManagementApiClient,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";
import type { AnyCommand } from "../src/commands";
import { buildEngine, type RunHooks } from "../src/execution/engine";

function makeRuntime(overrides?: {
  readonly getCredentials?: Runtime["getCredentials"];
}): Runtime & { readonly stderrText: () => string } {
  let stderrText = "";
  return {
    stdout: { write: () => {} },
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
    getCredentials: overrides?.getCredentials ?? (async () => undefined),
    managementApi: { baseUrl: "https://test.invalid" },
    packageManager: "unknown",
    stderrText: () => stderrText,
  };
}

async function runEngine(
  command: AnyCommand,
  runtime: Runtime,
  hooks: RunHooks,
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

  test("no SDK construction when api is untouched", async () => {
    const exitCode = await runEngine(succeed(), makeRuntime(), {
      managementApi: {
        createSdk: () => {
          throw new Error(
            "the SDK factory ran for a run that never touched ctx.api",
          );
        },
      },
    });
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

  test("constructed once per run; credential refresh is picked up per request", async () => {
    const tokens = ["token-1", "token-2"];
    const observed: string[] = [];
    let constructions = 0;
    const exitCode = await runEngine(
      succeed(async (ctx) => {
        const client = ctx.api as unknown as { call: () => Promise<void> };
        await client.call();
        await client.call();
      }),
      makeRuntime({
        getCredentials: async () => ({ token: tokens.shift() ?? "spent" }),
      }),
      {
        managementApi: {
          createSdk: (config) => {
            constructions += 1;
            const call = async (): Promise<void> => {
              const stored = await config.tokenStorage.getTokens();
              observed.push(stored?.accessToken ?? "none");
            };
            return {
              client: { call } as unknown as ManagementApiClient,
              getLoginUrl: () => Promise.reject(new Error("unused")),
              handleCallback: () => Promise.reject(new Error("unused")),
              logout: () => Promise.reject(new Error("unused")),
            };
          },
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(constructions).toBe(1);
    expect(observed).toEqual(["token-1", "token-2"]);
  });
});
