/**
 * The credential-manager engine surface (design rev 6, the active
 * credential): ctx.activeCredential on every context serving the
 * process pin, the managesCredentials capability, the manager-backed
 * needs check with its single-sourced errors, session mutations with
 * state read-back, process pinning, harness seeding, and the
 * no-token-material guarantees.
 */

import {
  type ActiveCredential,
  type Credential,
  defineCommand,
} from "@prisma/cli-engine";
import {
  type CliStructuredError,
  notOk,
  ok,
} from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  InMemoryCredentialManager,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { afterEach, describe, expect, test, vi } from "vitest";

const JWT_WORKSPACE_ID_REQUIRED = /must be a JWT with `workspace_id`/;
const ACTIVE_CREDENTIAL_FIRST =
  /only valid once activeCredential\(\) has returned non-null/;

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
): SessionRecord => ({
  workspaceId,
  workspaceName: opts?.name,
  credential: {
    token: mintTestJwt({ sub: "user-1", workspace_id: workspaceId }),
    refreshToken: undefined,
    expiresAt: undefined,
  },
});

const environmentCredentialFor = (claims: {
  readonly sub?: string;
  readonly workspace_id?: string;
}): Credential => ({
  token: mintTestJwt(claims),
  refreshToken: undefined,
  expiresAt: undefined,
});

const credentialReader = () => {
  let seen: ActiveCredential | null | undefined;
  const command = defineCommand({
    help: { summary: "Reads the active credential" },
    handler: async (_args, ctx) => {
      seen = await ctx.activeCredential();
      return ok(
        ctx.present(
          { data: seen },
          {
            human: () => [],
            stdout: () => [],
            json: () => seen,
            next: () => [],
          },
        ),
      );
    },
  });
  return { command, seen: () => seen };
};

describe("ctx.activeCredential", () => {
  test("resolves null on every context when signed out; the command still completes", async () => {
    const reader = credentialReader();
    const cli = createTestCli({ commands: { toy: reader.command } });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toBeNull();
  });

  test("a seeded credential runs real createSession derivation: workspace, expiry and identity come from the token's claims", async () => {
    const reader = credentialReader();
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
      identity: { userId: "user-1", email: undefined },
      origin: { source: "stored" },
    });
  });

  test("seeded sessions with a selection serve the selected session", async () => {
    const reader = credentialReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      sessions: [
        sessionRecordFor("workspace-1", { name: "Acme Prod" }),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
    });
    const { exitCode } = await cli.run(["toy"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toMatchObject({
      workspaceId: "workspace-1",
      workspaceName: "Acme Prod",
      origin: { source: "stored" },
    });
  });

  test("a seeded environment credential resolves with the environment origin", async () => {
    const reader = credentialReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      environmentCredential: environmentCredentialFor({
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
      identity: { userId: "svc-1", email: undefined },
      origin: { source: "environment" },
    });
  });

  /** Design §11.10, test 7. */
  test("a claimless environment token reports workspaceId undefined, and the JSON renders no empty string and no 'undefined'", async () => {
    const reader = credentialReader();
    const cli = createTestCli({
      commands: { toy: reader.command },
      environmentCredential: environmentCredentialFor({ sub: "svc-1" }),
    });
    const { exitCode, stdout } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(0);
    expect(reader.seen()).toEqual({
      workspaceId: undefined,
      workspaceName: undefined,
      expiresAt: undefined,
      identity: { userId: "svc-1", email: undefined },
      origin: { source: "environment" },
    });
    expect(reader.seen()?.workspaceId).not.toBe("");
    expect(stdout).toContain('"source":"environment"');
    expect(stdout).not.toContain("workspaceId");
    expect(stdout).not.toContain("undefined");
    expect(stdout).not.toContain('""');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("performs no network I/O", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("ctx.activeCredential() touched the network");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const reader = credentialReader();
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
        return ok(
          ctx.present(
            { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        );
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
        return ok(
          ctx.present(
            { data: null },
            {
              human: () => [],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        );
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
    ok(
      ctx.present(
        { data: null },
        { human: () => [], stdout: () => [], json: () => null, next: () => [] },
      ),
    ),
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

  test("sessions held, none selected: the identical single-sourced error from the needs check, ctx.activeCredential, and a bare ctx.api touch", async () => {
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
        readonly activeCredential: () => Promise<ActiveCredential | null>;
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
          return ok(
            ctx.present(
              { data: null },
              {
                human: () => [],
                stdout: () => [],
                json: () => null,
                next: () => [],
              },
            ),
          );
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

    const fromActiveCredential = await runCaught(
      caughtBy(async (ctx) => {
        await ctx.activeCredential();
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
    expect(fromActiveCredential).toEqual(fromNeedsCheck);
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
  test("createSession upserts by workspaceId, preserves a recorded name, and selects it", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [sessionRecordFor("workspace-1", { name: "Acme Prod" })],
      selectedWorkspaceId: "workspace-1",
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
    expect(state.selectedWorkspaceId).toBe("workspace-1");
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-1",
      origin: { source: "stored" },
    });
  });

  test("createSession refuses a workspaceId argument that disagrees with the workspace_id claim", async () => {
    const manager = new InMemoryCredentialManager({});
    await expect(
      manager.createSession(
        userCredential({ workspaceId: "workspace-1" }),
        "workspace-2",
      ),
      // The same structured error the file-backed manager raises, so a
      // test of this refusal sees what production does.
    ).rejects.toMatchObject({ code: "AUTH.CREDENTIAL_WORKSPACE_MISMATCH" });
  });

  test("selectSession switches the selection and refuses a workspace with no session", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
    });
    const selected = await manager.selectSession("workspace-2");
    expect(selected).toEqual({
      workspaceId: "workspace-2",
      workspaceName: undefined,
      expiresAt: undefined,
    });
    expect(manager.state().selectedWorkspaceId).toBe("workspace-2");
    expect((await manager.sessions()).selectedWorkspaceId).toBe("workspace-2");

    await expect(
      manager.selectSession("workspace-9").catch(codeOf),
    ).resolves.toBe("AUTH.NO_SESSION_FOR_WORKSPACE");
  });

  test("endSession removes one session and clears the selection only when it named it — no auto-promotion", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
    });
    await manager.endSession("workspace-1");
    const state = manager.state();
    expect(state.sessions.map((record) => record.workspaceId)).toEqual([
      "workspace-2",
    ]);
    expect(state.selectedWorkspaceId).toBeUndefined();
    await expect(manager.activeCredential().catch(codeOf)).resolves.toBe(
      "CLI.CREDENTIALS_REQUIRED",
    );
  });

  test("endSession on a workspace with no session succeeds and writes nothing", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      selectedWorkspaceId: "workspace-1",
    });
    const before = manager.state();
    await expect(manager.endSession("workspace-9")).resolves.toBeUndefined();
    expect(manager.state()).toEqual(before);
  });

  test("endAllSessions clears every session and the selection", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
    });
    await manager.endAllSessions();
    expect(manager.state()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
    expect(await manager.activeCredential()).toBeNull();
  });

  test("sessions() never reports a selection that names no stored session", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      selectedWorkspaceId: "workspace-gone",
    });
    expect(await manager.sessions()).toEqual({
      sessions: [
        {
          workspaceId: "workspace-1",
          workspaceName: undefined,
          expiresAt: undefined,
        },
      ],
      selectedWorkspaceId: undefined,
    });
  });
});

describe("mutations while an environment credential is in force", () => {
  const environmentCredential = environmentCredentialFor({
    sub: "svc-1",
    workspace_id: "workspace-env",
  });

  const managerWithStoredSessions = () =>
    new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
      environmentCredential,
    });

  test("selectSession succeeds and changes the stored selection; the environment credential stays in force", async () => {
    const manager = managerWithStoredSessions();
    await manager.selectSession("workspace-2");
    expect(manager.state().selectedWorkspaceId).toBe("workspace-2");
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-env",
      origin: { source: "environment" },
    });
  });

  test("endSession succeeds and removes the stored session; the environment credential stays in force", async () => {
    const manager = managerWithStoredSessions();
    await manager.endSession("workspace-1");
    expect(
      manager.state().sessions.map((record) => record.workspaceId),
    ).toEqual(["workspace-2"]);
    expect(await manager.activeCredential()).toMatchObject({
      origin: { source: "environment" },
    });
  });

  test("endAllSessions simply clears the store, with or without stored sessions", async () => {
    const withStored = managerWithStoredSessions();
    await withStored.endAllSessions();
    expect(withStored.state()).toEqual({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
    expect(await withStored.activeCredential()).toMatchObject({
      origin: { source: "environment" },
    });

    const withoutStored = new InMemoryCredentialManager({
      environmentCredential,
    });
    await expect(withoutStored.endAllSessions()).resolves.toBeUndefined();
  });

  test("createSession is allowed; the environment credential remains in force", async () => {
    const manager = new InMemoryCredentialManager({ environmentCredential });
    await manager.createSession(
      userCredential({ workspaceId: "workspace-1" }),
      "workspace-1",
    );
    expect(
      manager.state().sessions.map((record) => record.workspaceId),
    ).toEqual(["workspace-1"]);
    expect(await manager.activeCredential()).toMatchObject({
      origin: { source: "environment" },
      workspaceId: "workspace-env",
    });
  });

  test("sessions() still lists the stored sessions and the stored selection", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-2",
      environmentCredential,
    });
    const stored = await manager.sessions();
    expect(stored.sessions.map((session) => session.workspaceId)).toEqual([
      "workspace-1",
      "workspace-2",
    ]);
    expect(stored.selectedWorkspaceId).toBe("workspace-2");
  });
});

describe("process pinning", () => {
  test("the selection moved by another process between reads does not re-pin; a new manager picks up the new selection", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
    });
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-1",
    });

    manager.overwriteStoredState({ selectedWorkspaceId: "workspace-2" });
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-1",
    });

    const movedState = manager.state();
    const newProcess = new InMemoryCredentialManager({
      sessions: movedState.sessions,
      selectedWorkspaceId: movedState.selectedWorkspaceId,
    });
    expect(await newProcess.activeCredential()).toMatchObject({
      workspaceId: "workspace-2",
    });
  });

  test("this manager's own selectSession moves the pin", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [
        sessionRecordFor("workspace-1"),
        sessionRecordFor("workspace-2"),
      ],
      selectedWorkspaceId: "workspace-1",
    });
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-1",
    });
    await manager.selectSession("workspace-2");
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-2",
    });
  });

  test("a pinned session ended by another process raises the session-ended wording on the next read", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      selectedWorkspaceId: "workspace-1",
    });
    expect(await manager.activeCredential()).toMatchObject({
      workspaceId: "workspace-1",
    });
    manager.overwriteStoredState({
      sessions: [],
      selectedWorkspaceId: undefined,
    });
    const thrown = (await manager
      .activeCredential()
      .catch((cause: unknown) => cause)) as CliStructuredError;
    expect(thrown.code).toBe("CLI.CREDENTIALS_REQUIRED");
    expect(thrown.message).toContain("has ended");
  });
});

describe("token material never leaves", () => {
  test("sessions() and the active credential expose no seeded token through any output channel", async () => {
    const secret = mintTestJwt({
      sub: "user-1",
      workspace_id: "workspace-1",
      secret_marker: "SECRET-TOKEN-MATERIAL",
    });
    const toy = defineCommand({
      help: { summary: "Lists sessions" },
      managesCredentials: true,
      handler: async (_args, ctx) => {
        const stored = await ctx.credentialManager.sessions();
        const active = await ctx.activeCredential();
        return ok(
          ctx.present(
            { data: { stored, active } },
            {
              human: () => [],
              stdout: () => [],
              json: () => ({ stored, active }),
              next: () => [],
            },
          ),
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
      selectedWorkspaceId: "workspace-1",
    });
    const { exitCode, stdout, stderr, json } = await cli.run(["toy", "--json"]);
    expect(exitCode).toBe(0);
    const everything = stdout + stderr + JSON.stringify(json);
    expect(everything).toContain("workspace-1");
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain("SECRET-REFRESH-TOKEN");
  });
});

describe("activeAccessToken, the spawn path's read", () => {
  test("an unseeded manager has no token to give and returns null", async () => {
    const manager = new InMemoryCredentialManager({});

    expect(await manager.activeAccessToken()).toBeNull();
  });

  test("no token is available after the last session ends", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      selectedWorkspaceId: "workspace-1",
    });
    await manager.endAllSessions();

    expect(await manager.activeAccessToken()).toBeNull();
  });

  test("a selected session's access token is what the child would get", async () => {
    const record = sessionRecordFor("workspace-1");
    const manager = new InMemoryCredentialManager({
      sessions: [record],
      selectedWorkspaceId: "workspace-1",
    });

    expect(await manager.activeAccessToken()).toBe(record.credential.token);
  });
});

describe("harness seed validation", () => {
  test("a `credential` seed whose token names no workspace is refused: createSession is workspace-keyed", () => {
    expect(
      () =>
        new InMemoryCredentialManager({
          credential: {
            token: mintTestJwt({ sub: "user-1" }),
            refreshToken: undefined,
            expiresAt: undefined,
          },
        }),
    ).toThrow(JWT_WORKSPACE_ID_REQUIRED);
  });

  test("activeCredentialStorage before the credential resolves is a harness misuse", async () => {
    const manager = new InMemoryCredentialManager({
      sessions: [sessionRecordFor("workspace-1")],
      selectedWorkspaceId: "workspace-1",
    });
    await expect(manager.activeCredentialStorage()).rejects.toThrow(
      ACTIVE_CREDENTIAL_FIRST,
    );
  });

  test("a rotation write onto a session another process ended refuses with the same structured error the real manager raises", async () => {
    const manager = new InMemoryCredentialManager({
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
      selectedWorkspaceId: "workspace-1",
    });
    await manager.activeCredential();
    const storage = await manager.activeCredentialStorage();
    manager.overwriteStoredState({ sessions: [] });

    await expect(
      storage.setTokens({
        workspaceId: "workspace-1",
        accessToken: mintTestJwt({ workspace_id: "workspace-1" }),
        refreshToken: "refresh-2",
      }),
    ).rejects.toMatchObject({ code: "CLI.CREDENTIALS_REQUIRED" });
  });
});
