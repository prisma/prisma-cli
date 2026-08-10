/**
 * The credential-manager engine surface (design rev 5, the session
 * model): ctx.session on every context serving the process pin, the
 * managesCredentials capability, the manager-backed needs check with
 * its single-sourced errors, session mutations with state read-back,
 * process-pinning semantics, harness seeding, and the
 * no-token-material guarantees.
 */

import {
  type Credential,
  defineCommand,
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
  TestCredentialManager,
  type TestSessionRecord,
} from "@prisma/cli-engine/testing";
import { afterEach, describe, expect, test, vi } from "vitest";

const userCredential = (overrides?: {
  readonly sub?: string;
  readonly workspaceId?: string;
  readonly exp?: number;
}): Credential => ({
  token: mintTestJwt({
    sub: overrides?.sub ?? "user-1",
    workspace_id: overrides?.workspaceId ?? "workspace-1",
    exp: overrides?.exp ?? 1_900_000_000,
  }),
  refreshToken: undefined,
  expiresAt: undefined,
});

const sessionRecordFor = (
  workspaceId: string,
  opts?: { readonly name?: string },
): TestSessionRecord => ({
  workspaceId,
  workspaceName: opts?.name,
  credential: {
    token: mintTestJwt({ sub: "user-1", workspace_id: workspaceId }),
    refreshToken: undefined,
    expiresAt: undefined,
  },
});

const storedSessionRef = (workspaceId: string): Session => ({
  workspaceId,
  workspaceName: undefined,
  expiresAt: undefined,
  source: "stored",
  current: false,
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

  test("a seeded credential runs real createSession derivation: workspace and expiry come from the token's claims", async () => {
    const reader = sessionReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      credential: userCredential({
        workspaceId: "workspace-9",
        exp: 1_900_000_000,
      }),
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toEqual({
      workspaceId: "workspace-9",
      workspaceName: undefined,
      expiresAt: new Date(1_900_000_000 * 1000),
      source: "stored",
      current: true,
    });
  });

  test("seeded sessions with a current marker serve the marked session", async () => {
    const reader = sessionReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      sessions: [
        sessionRecordFor("workspace-1", { name: "Acme Prod" }),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-1",
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toMatchObject({
      workspaceId: "workspace-1",
      workspaceName: "Acme Prod",
      source: "stored",
      current: true,
    });
  });

  test("a seeded environment token composes the env session", async () => {
    const reader = sessionReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      environmentToken: mintTestJwt({
        sub: "svc-1",
        workspace_id: "workspace-env",
      }),
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toEqual({
      workspaceId: "workspace-env",
      workspaceName: undefined,
      expiresAt: undefined,
      source: "environment",
      current: true,
    });
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

  test("sessions held, none current: the identical single-sourced error from the needs check, ctx.session, and a bare ctx.api touch", async () => {
    const seeds = {
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
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
        readonly api: {
          GET: (path: string, opts: unknown) => Promise<unknown>;
        };
      }) => Promise<void>,
    ) =>
      defineCommand({
        help: { summary: "Catches the structured error" },
        handler: async (_args, ctx) => {
          try {
            await body(ctx as unknown as Parameters<typeof body>[0]);
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
      why: "You have workspace sessions but none is current.",
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

const codeOf = (thrown: unknown): string => (thrown as CliStructuredError).code;

describe("session mutations and state read-back", () => {
  test("createSession upserts by workspaceId, preserves a recorded name, and sets the marker", async () => {
    const manager = new TestCredentialManager({
      sessions: [sessionRecordFor("workspace-1", { name: "Acme Prod" })],
      currentWorkspaceId: "workspace-1",
    });
    await manager.createSession(
      userCredential({ workspaceId: "workspace-2" }),
      "workspace-2",
    );
    await manager.createSession(
      userCredential({ workspaceId: "workspace-1", sub: "user-9" }),
      "workspace-1",
    );
    const state = manager.state();
    expect(
      state.sessions.map((record) => [
        record.workspaceId,
        record.workspaceName,
      ]),
    ).toEqual([
      ["workspace-2", undefined],
      ["workspace-1", "Acme Prod"],
    ]);
    expect(state.currentWorkspaceId).toBe("workspace-1");
    expect(await manager.currentSession()).toMatchObject({
      workspaceId: "workspace-1",
      current: true,
    });
  });

  test("createSession refuses a workspaceId argument that disagrees with the workspace_id claim", async () => {
    const manager = new TestCredentialManager({});
    await expect(
      manager.createSession(
        userCredential({ workspaceId: "workspace-1" }),
        "workspace-2",
      ),
    ).rejects.toThrow(/disagrees with the credential's workspace_id claim/);
  });

  test("useSession switches the marker; an unknown workspace and an environment-source argument raise AUTH.NO_SESSION_FOR_WORKSPACE", async () => {
    const manager = new TestCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-1",
    });
    const switched = await manager.useSession(storedSessionRef("workspace-2"));
    expect(switched).toMatchObject({
      workspaceId: "workspace-2",
      current: true,
    });
    expect(manager.state().currentWorkspaceId).toBe("workspace-2");

    await expect(
      manager.useSession(storedSessionRef("workspace-9")).catch(codeOf),
    ).resolves.toBe("AUTH.NO_SESSION_FOR_WORKSPACE");
    await expect(
      manager
        .useSession({
          ...storedSessionRef("workspace-2"),
          source: "environment",
        })
        .catch(codeOf),
    ).resolves.toBe("AUTH.NO_SESSION_FOR_WORKSPACE");

    const unchanged = await manager.useSession(storedSessionRef("workspace-2"));
    expect(unchanged).toMatchObject({ workspaceId: "workspace-2" });
  });

  test("endSession removes one session and clears the current only when it named it — no auto-promotion", async () => {
    const manager = new TestCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-1",
    });
    await manager.endSession(storedSessionRef("workspace-1"));
    const state = manager.state();
    expect(state.sessions.map((record) => record.workspaceId)).toEqual([
      "workspace-2",
    ]);
    expect(state.currentWorkspaceId).toBeNull();
    await expect(manager.currentSession().catch(codeOf)).resolves.toBe(
      "CLI.CREDENTIALS_REQUIRED",
    );
  });

  test("endAllSessions clears every session and the marker", async () => {
    const manager = new TestCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-1",
    });
    await manager.endAllSessions();
    expect(manager.state()).toEqual({
      sessions: [],
      currentWorkspaceId: null,
    });
    expect(await manager.currentSession()).toBeNull();
  });
});

describe("mutations under an env-supplied session", () => {
  const environmentToken = mintTestJwt({
    sub: "svc-1",
    workspace_id: "workspace-env",
  });

  test("useSession and endSession refuse, naming the variable and the unset command; state is untouched", async () => {
    const manager = new TestCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      currentWorkspaceId: "workspace-1",
      environmentToken,
    });
    for (const mutate of [
      () => manager.useSession(storedSessionRef("workspace-1")),
      () => manager.endSession(storedSessionRef("workspace-1")),
    ]) {
      const thrown = (await mutate().catch(
        (cause: unknown) => cause,
      )) as CliStructuredError;
      expect(thrown.code).toBe("AUTH.ENV_SESSION_IN_FORCE");
      expect(thrown.nextActions).toMatchObject([
        { kind: "run-command", command: "unset PRISMA_SERVICE_TOKEN" },
      ]);
    }
    expect(manager.state().sessions).toHaveLength(1);
    expect(manager.state().currentWorkspaceId).toBe("workspace-1");
  });

  test("endAllSessions refuses when stored sessions exist and succeeds as a no-op when there are none", async () => {
    const withStored = new TestCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      environmentToken,
    });
    await expect(withStored.endAllSessions().catch(codeOf)).resolves.toBe(
      "AUTH.ENV_SESSION_IN_FORCE",
    );
    expect(withStored.state().sessions).toHaveLength(1);

    const withoutStored = new TestCredentialManager({ environmentToken });
    await expect(withoutStored.endAllSessions()).resolves.toBeUndefined();
  });

  test("createSession is allowed; the env token remains in force", async () => {
    const manager = new TestCredentialManager({ environmentToken });
    await manager.createSession(
      userCredential({ workspaceId: "workspace-1" }),
      "workspace-1",
    );
    expect(
      manager.state().sessions.map((record) => record.workspaceId),
    ).toEqual(["workspace-1"]);
    expect(await manager.currentSession()).toMatchObject({
      source: "environment",
      workspaceId: "workspace-env",
    });
  });

  test("sessions() still lists stored sessions with the file's marked current", async () => {
    const manager = new TestCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-2",
      environmentToken,
    });
    const listed = await manager.sessions();
    expect(
      listed.map((session) => [session.workspaceId, session.current]),
    ).toEqual([
      ["workspace-1", false],
      ["workspace-2", true],
    ]);
    expect(listed.every((session) => session.source === "stored")).toBe(true);
  });
});

describe("process pinning", () => {
  test("the marker moved by another process between reads does not re-pin; a new manager picks up the new marker", async () => {
    const manager = new TestCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-1",
    });
    expect(await manager.currentSession()).toMatchObject({
      workspaceId: "workspace-1",
    });

    manager.overwriteStoredState({ currentWorkspaceId: "workspace-2" });
    expect(await manager.currentSession()).toMatchObject({
      workspaceId: "workspace-1",
    });

    const movedState = manager.state();
    const newProcess = new TestCredentialManager({
      sessions: movedState.sessions,
      currentWorkspaceId: movedState.currentWorkspaceId ?? undefined,
    });
    expect(await newProcess.currentSession()).toMatchObject({
      workspaceId: "workspace-2",
    });
  });

  test("this manager's own useSession moves the pin", async () => {
    const manager = new TestCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      currentWorkspaceId: "workspace-1",
    });
    expect(await manager.currentSession()).toMatchObject({
      workspaceId: "workspace-1",
    });
    await manager.useSession(storedSessionRef("workspace-2"));
    expect(await manager.currentSession()).toMatchObject({
      workspaceId: "workspace-2",
    });
  });

  test("a pinned session ended by another process raises the session-ended wording on the next read", async () => {
    const manager = new TestCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      currentWorkspaceId: "workspace-1",
    });
    expect(await manager.currentSession()).toMatchObject({
      workspaceId: "workspace-1",
    });
    manager.overwriteStoredState({ sessions: [], currentWorkspaceId: null });
    const thrown = (await manager
      .currentSession()
      .catch((cause: unknown) => cause)) as CliStructuredError;
    expect(thrown.code).toBe("CLI.CREDENTIALS_REQUIRED");
    expect(thrown.message).toContain("has ended");
  });
});

describe("token material never leaves", () => {
  test("sessions() and the session expose no seeded token through any output channel", async () => {
    const secret = mintTestJwt({
      sub: "user-1",
      workspace_id: "workspace-1",
      secret_marker: "SECRET-TOKEN-MATERIAL",
    });
    const toy = defineCommand({
      help: { summary: "Lists sessions" },
      managesCredentials: true,
      handler: async (_args, ctx) => {
        const sessions = await ctx.credentialManager.sessions();
        const session = await ctx.session();
        return ok(
          ctx.present({ data: { sessions, session } }, { human: () => [] }),
        );
      },
    });
    const cli = createTestCli({
      commands: { toy },
      sessions: [
        {
          workspaceId: "workspace-1",
          workspaceName: "Acme",
          credential: {
            token: secret,
            refreshToken: "SECRET-REFRESH-TOKEN",
            expiresAt: undefined,
          },
        },
      ],
      currentWorkspaceId: "workspace-1",
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

  test("a rotation write onto an ended session refuses with the same structured error the real manager raises", async () => {
    const toy = defineCommand({
      help: { summary: "Does nothing" },
      handler: async (_args, ctx) => {
        return ok(ctx.present({ data: null }, { human: () => [] }));
      },
    });
    const cli = createTestCli({
      commands: { toy },
      sessions: [
        {
          workspaceId: "workspace-1",
          workspaceName: undefined,
          credential: {
            token: mintTestJwt({ workspace_id: "workspace-1" }),
            refreshToken: "refresh-1",
            expiresAt: undefined,
          },
        },
      ],
      currentWorkspaceId: "workspace-1",
    });
    const storage = cli.credentialManager?.tokenStorage("workspace-gone");

    await expect(
      storage?.setTokens({
        workspaceId: "workspace-gone",
        accessToken: mintTestJwt({ workspace_id: "workspace-gone" }),
        refreshToken: "refresh-2",
      }),
    ).rejects.toMatchObject({ code: "CLI.CREDENTIALS_REQUIRED" });
  });
});
