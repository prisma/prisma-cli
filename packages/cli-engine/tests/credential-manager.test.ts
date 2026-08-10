/**
 * The credential-manager engine surface: ctx.session on every context,
 * the managesCredentials capability, the manager-backed needs check
 * with its single-sourced errors, harness seeding with state
 * read-back, and the no-token-material guarantees.
 */

import {
  type Credential,
  defineCommand,
  type GrantSummary,
  type Session,
} from "@prisma/cli-engine";
import {
  type CliStructuredError,
  notOk,
  ok,
} from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  mintTestJwt,
  type TestGrant,
} from "@prisma/cli-engine/testing";
import { afterEach, describe, expect, test, vi } from "vitest";

const userCredential = (overrides?: {
  readonly sub?: string;
  readonly workspaceId?: string;
  readonly email?: string;
  readonly exp?: number;
  readonly token?: string;
}): Credential => ({
  token:
    overrides?.token ??
    mintTestJwt({
      sub: overrides?.sub ?? "user-1",
      workspace_id: overrides?.workspaceId ?? "workspace-1",
      email: overrides?.email ?? "someone@example.com",
      exp: overrides?.exp ?? 1_900_000_000,
    }),
  refreshToken: undefined,
  expiresAt: undefined,
  method: "user-oauth",
});

const grantFor = (
  workspaceId: string,
  opts?: { readonly sub?: string; readonly name?: string },
): TestGrant => ({
  workspace: { id: workspaceId, name: opts?.name },
  credential: userCredential({
    sub: opts?.sub ?? "user-1",
    workspaceId,
  }),
});

const sessionReader = () => {
  let seen: Session | null | undefined;
  const command = defineCommand({
    help: { summary: "Reads the session" },
    handler: async (_args, ctx) => {
      seen = await ctx.session();
      return ok(ctx.present({ data: seen }, { human: () => [] }));
    },
  });
  return { command, seen: () => seen };
};

describe("ctx.session", () => {
  test("resolves null on every context when signed out; the command still completes", async () => {
    const reader = sessionReader();
    const cli = createTestCli({ commands: { toy: reader.command } });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toBeNull();
  });

  test("a seeded credential runs real claims derivation: identity, workspace, and expiry come from the token", async () => {
    const reader = sessionReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      credential: userCredential({
        sub: "user-42",
        workspaceId: "workspace-9",
        email: "user42@example.com",
        exp: 1_900_000_000,
      }),
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toEqual({
      identity: { kind: "user", id: "user-42", email: "user42@example.com" },
      method: "user-oauth",
      origin: "stored",
      workspace: { id: "workspace-9", name: undefined },
      expiresAt: new Date(1_900_000_000 * 1000),
    });
  });

  test("the seeded session escape hatch is returned verbatim", async () => {
    const seeded: Session = {
      identity: { kind: "service", id: "svc-1", label: undefined },
      method: "service-token",
      origin: "environment",
      workspace: { id: "workspace-env", name: undefined },
      expiresAt: undefined,
    };
    const reader = sessionReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      session: seeded,
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toEqual(seeded);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("performs no network I/O", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("ctx.session() touched the network");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const reader = sessionReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      credential: userCredential(),
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the managesCredentials capability", () => {
  test("declared: ctx.credentialManager is the harness manager, even signed out — a declaration never fails a run", async () => {
    let sameInstance: boolean | undefined;
    const toy = defineCommand({
      help: { summary: "Manages credentials" },
      managesCredentials: true,
      handler: async (_args, ctx) => {
        sameInstance = ctx.credentialManager === cli.credentialManager;
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({ commands: { toy } });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(sameInstance).toBe(true);
  });

  test("undeclared: credentialManager is absent from the context", async () => {
    let present: boolean | undefined;
    const toy = defineCommand({
      help: { summary: "Does not manage credentials" },
      handler: async (_args, ctx) => {
        present = "credentialManager" in ctx;
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({ commands: { toy } });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(present).toBe(false);
  });
});

const needsCredentials = defineCommand({
  help: { summary: "Needs credentials" },
  needs: { credentials: true },
  handler: async (_args, ctx) =>
    ok(ctx.present({ data: null }, { human: () => [] })),
});

describe("the manager-backed needs check", () => {
  test("signed out: fails early with CLI.CREDENTIALS_REQUIRED, exit 2", async () => {
    const cli = createTestCli({ commands: { toy: needsCredentials } });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    expect(json.find((frame) => frame.kind === "result")).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "CLI.CREDENTIALS_REQUIRED",
          summary: "You must be signed in to run this command.",
        },
      },
    });
  });

  test("grants held, none active: the identical single-sourced error from the needs check, ctx.session, and a bare ctx.api touch", async () => {
    const seeds = {
      grants: [grantFor("workspace-1"), grantFor("workspace-2")],
    };

    const fromNeedsCheck = await (async () => {
      const cli = createTestCli({
        commands: { toy: needsCredentials },
        ...seeds,
      });
      const { exitCode, json } = await cli.run(["toy", "--json"]);
      expect(exitCode).toBe(2);
      const result = json.find((frame) => frame.kind === "result");
      return result?.kind === "result" && result.envelope.ok === false
        ? result.envelope.error
        : undefined;
    })();

    const caughtBy = (
      body: (ctx: {
        readonly session: () => Promise<Session | null>;
        readonly api: { GET: (path: string, opts: unknown) => Promise<unknown> };
      }) => Promise<void>,
    ) =>
      defineCommand({
        help: { summary: "Catches the structured error" },
        handler: async (_args, ctx) => {
          try {
            await body(
              ctx as unknown as Parameters<typeof body>[0],
            );
          } catch (cause) {
            return notOk(cause as CliStructuredError);
          }
          return ok(ctx.present({ data: null }, { human: () => [] }));
        },
      });

    const runCaught = async (
      command: ReturnType<typeof caughtBy>,
    ): Promise<unknown> => {
      const cli = createTestCli({ commands: { toy: command }, ...seeds });
      const { exitCode, json } = await cli.run(["toy", "--json"]);
      expect(exitCode).toBe(2);
      const result = json.find((frame) => frame.kind === "result");
      return result?.kind === "result" && result.envelope.ok === false
        ? result.envelope.error
        : undefined;
    };

    const fromSession = await runCaught(
      caughtBy(async (ctx) => {
        await ctx.session();
      }),
    );
    const fromApiTouch = await runCaught(
      caughtBy(async (ctx) => {
        await ctx.api.GET("/v1/workspaces", {});
      }),
    );

    expect(fromNeedsCheck).toMatchObject({
      code: "CLI.CREDENTIALS_REQUIRED",
      why: "You hold workspace grants, but none is active.",
      nextActions: [
        {
          kind: "run-command",
          command: "prisma auth workspace use",
        },
        { kind: "user-choice" },
      ],
    });
    expect(fromSession).toEqual(fromNeedsCheck);
    expect(fromApiTouch).toEqual(fromNeedsCheck);
  });

  test("with a seeded credential the need is met", async () => {
    const cli = createTestCli({
      commands: { toy: needsCredentials },
      credential: userCredential(),
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
  });
});

const managed = (
  body: (manager: {
    readonly beginSession: (credential: Credential) => Promise<Session>;
    readonly endSession: () => Promise<void>;
    readonly activateGrant: (ref: string) => Promise<Session>;
    readonly forgetGrant: (ref: string) => Promise<void>;
    readonly rememberWorkspaceName: (
      workspaceId: string,
      name: string,
    ) => Promise<void>;
    readonly grants: () => Promise<readonly GrantSummary[]>;
  }) => Promise<void>,
) =>
  defineCommand({
    help: { summary: "Mutates through the manager" },
    managesCredentials: true,
    handler: async (_args, ctx) => {
      try {
        await body(ctx.credentialManager);
      } catch (cause) {
        return notOk(cause as CliStructuredError);
      }
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

describe("mutations and state read-back", () => {
  test("beginSession records identity, one grant, and the cursor", async () => {
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          await manager.beginSession(
            userCredential({ sub: "user-1", workspaceId: "workspace-1" }),
          );
        }),
      },
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    const state = cli.credentialManager?.state();
    expect(state?.identity).toEqual({
      kind: "user",
      id: "user-1",
      email: "someone@example.com",
    });
    expect(state?.grants.map((grant) => grant.workspace.id)).toEqual([
      "workspace-1",
    ]);
    expect(state?.activeWorkspaceId).toBe("workspace-1");
  });

  test("same identity upserts and preserves a recorded workspace name; a different identity replaces every grant", async () => {
    const sameIdentity = userCredential({
      sub: "user-1",
      workspaceId: "workspace-1",
    });
    const otherWorkspace = userCredential({
      sub: "user-1",
      workspaceId: "workspace-2",
    });
    const otherIdentity = userCredential({
      sub: "user-9",
      workspaceId: "workspace-3",
    });
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          await manager.beginSession(sameIdentity);
          await manager.rememberWorkspaceName("workspace-1", "Acme Prod");
          await manager.beginSession(otherWorkspace);
          await manager.beginSession(sameIdentity);
        }),
        replace: managed(async (manager) => {
          await manager.beginSession(otherIdentity);
        }),
      },
    });
    expect((await cli.run(["toy"])).exitCode).toBe(0);
    const upserted = cli.credentialManager?.state();
    expect(
      upserted?.grants.map((grant) => [
        grant.workspace.id,
        grant.workspace.name,
      ]),
    ).toEqual([
      ["workspace-2", undefined],
      ["workspace-1", "Acme Prod"],
    ]);
    expect(upserted?.activeWorkspaceId).toBe("workspace-1");

    expect((await cli.run(["replace"])).exitCode).toBe(0);
    const replaced = cli.credentialManager?.state();
    expect(replaced?.identity).toMatchObject({ id: "user-9" });
    expect(replaced?.grants.map((grant) => grant.workspace.id)).toEqual([
      "workspace-3",
    ]);
    expect(replaced?.activeWorkspaceId).toBe("workspace-3");
  });

  test("forgetGrant drops one grant and clears the cursor only when it named that grant", async () => {
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          await manager.forgetGrant("workspace-1");
        }),
      },
      grants: [grantFor("workspace-1"), grantFor("workspace-2")],
      activeWorkspaceId: "workspace-1",
    });
    expect((await cli.run(["toy"])).exitCode).toBe(0);
    const state = cli.credentialManager?.state();
    expect(state?.grants.map((grant) => grant.workspace.id)).toEqual([
      "workspace-2",
    ]);
    expect(state?.activeWorkspaceId).toBeNull();
  });

  test("activateGrant resolves an exact id first, then a case-insensitive name; ambiguity and no-match are structured errors", async () => {
    const outcomes: Record<string, string> = {};
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          outcomes.byId = (await manager.activateGrant("workspace-2")).workspace
            .id;
          outcomes.byName = (await manager.activateGrant("ACME staging"))
            .workspace.id;
          outcomes.ambiguous = await manager
            .activateGrant("twin")
            .then(() => "resolved")
            .catch((cause: CliStructuredError) => cause.code);
          outcomes.notHeld = await manager
            .activateGrant("nowhere")
            .then(() => "resolved")
            .catch((cause: CliStructuredError) => cause.code);
        }),
      },
      grants: [
        grantFor("workspace-1", { name: "Acme Staging" }),
        grantFor("workspace-2"),
        grantFor("workspace-3", { name: "Twin" }),
        grantFor("workspace-4", { name: "twin" }),
      ],
      activeWorkspaceId: "workspace-1",
    });
    expect((await cli.run(["toy"])).exitCode).toBe(0);
    expect(outcomes).toEqual({
      byId: "workspace-2",
      byName: "workspace-1",
      ambiguous: "AUTH.WORKSPACE_REF_AMBIGUOUS",
      notHeld: "AUTH.GRANT_NOT_HELD",
    });
    expect(cli.credentialManager?.state().activeWorkspaceId).toBe(
      "workspace-1",
    );
  });

  test("rememberWorkspaceName records on a held grant and no-ops on an unheld id", async () => {
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          await manager.rememberWorkspaceName("workspace-1", "Named");
          await manager.rememberWorkspaceName("workspace-unheld", "Ghost");
        }),
      },
      grants: [grantFor("workspace-1")],
      activeWorkspaceId: "workspace-1",
    });
    expect((await cli.run(["toy"])).exitCode).toBe(0);
    const state = cli.credentialManager?.state();
    expect(
      state?.grants.map((grant) => [grant.workspace.id, grant.workspace.name]),
    ).toEqual([["workspace-1", "Named"]]);
  });

  test("endSession clears identity, every grant, and the cursor", async () => {
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          await manager.endSession();
        }),
      },
      grants: [grantFor("workspace-1"), grantFor("workspace-2")],
      activeWorkspaceId: "workspace-1",
    });
    expect((await cli.run(["toy"])).exitCode).toBe(0);
    expect(cli.credentialManager?.state()).toEqual({
      identity: undefined,
      grants: [],
      activeWorkspaceId: null,
    });
  });

  test("mutations refuse under an env-supplied session, naming the variable and the unset command; state is untouched", async () => {
    const envSession: Session = {
      identity: { kind: "service", id: "svc-1", label: undefined },
      method: "service-token",
      origin: "environment",
      workspace: { id: "workspace-env", name: undefined },
      expiresAt: undefined,
    };
    const cli = createTestCli({
      commands: {
        toy: managed(async (manager) => {
          await manager.endSession();
        }),
      },
      session: envSession,
    });
    const { exitCode, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(2);
    const result = json.find((frame) => frame.kind === "result");
    expect(result).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: "AUTH.ENV_SESSION_IN_FORCE",
          nextActions: [
            { kind: "run-command", command: "unset PRISMA_SERVICE_TOKEN" },
          ],
        },
      },
    });
  });
});

describe("token material never leaves", () => {
  test("grants() summaries and the session expose no seeded token through any output channel", async () => {
    const secret = mintTestJwt({
      sub: "user-1",
      workspace_id: "workspace-1",
      secret_marker: "SECRET-TOKEN-MATERIAL",
    });
    const toy = defineCommand({
      help: { summary: "Lists grants" },
      managesCredentials: true,
      handler: async (_args, ctx) => {
        const grants = await ctx.credentialManager.grants();
        const session = await ctx.session();
        return ok(
          ctx.present({ data: { grants, session } }, { human: () => [] }),
        );
      },
    });
    const cli = createTestCli({
      commands: { toy },
      grants: [
        {
          workspace: { id: "workspace-1", name: "Acme" },
          credential: {
            token: secret,
            refreshToken: "SECRET-REFRESH-TOKEN",
            expiresAt: undefined,
            method: "user-oauth",
          },
        },
      ],
      activeWorkspaceId: "workspace-1",
    });
    const { exitCode, stdout, stderr, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(0);
    const everything = stdout + stderr + JSON.stringify(json);
    expect(everything).toContain("workspace-1");
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain("SECRET-REFRESH-TOKEN");
  });
});

describe("harness seed validation", () => {
  test("the legacy credentials seed cannot be combined with manager seeds", () => {
    expect(() =>
      createTestCli({
        commands: {},
        credentials: { token: "legacy" },
        credential: userCredential(),
      }),
    ).toThrow(/legacy `credentials` seed/);
  });
});
