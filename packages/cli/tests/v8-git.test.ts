import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readGitOriginRemote } from "../src/adapters/git";
import { gitConnectCommand } from "../src/v8/git/connect";
import { gitDisconnectCommand } from "../src/v8/git/disconnect";

vi.mock("../src/adapters/git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/git")>()),
  readGitOriginRemote: vi.fn(),
}));

const readOrigin = vi.mocked(readGitOriginRemote);

const ACME_SESSION = {
  workspaceId: "ws_1",
  workspaceName: "Acme Inc",
  credential: {
    token: mintTestJwt({ sub: "usr_1", workspace_id: "ws_1" }),
    refreshToken: undefined,
    expiresAt: undefined,
  },
};

const PROJECTS = [
  {
    id: "proj_1",
    name: "Billing",
    workspace: { id: "ws_1", name: "Acme Inc" },
  },
];

const REPO_URL = "git@github.com:prisma/prisma-cli.git";

const SOURCE_REPOSITORY = {
  id: "srcrepo_1",
  repoId: 42,
  provider: "github" as const,
  repoFullName: "prisma/prisma-cli",
  defaultBranch: "main",
  isPrivate: false,
  status: "active" as const,
  installationId: "scm_1",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

const INSTALLATION = {
  id: "scm_1",
  type: "scm-installation" as const,
  url: "https://github.com/apps/prisma",
  provider: "github" as const,
  installationId: 7,
  accountId: 9,
  accountLogin: "prisma",
  accountType: "organization" as const,
  suspended: false,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const SCM_REPOSITORY = {
  id: 42,
  type: "scm-repository" as const,
  fullName: "prisma/prisma-cli",
  defaultBranch: "main",
  isPrivate: false,
};

const INSTALL_URL = "https://github.com/apps/prisma/installations/new";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly init: {
    params?: { path?: Record<string, string>; query?: Record<string, unknown> };
    body?: unknown;
  };
}

type Responder = (call: Call) => unknown;

interface GitClientSpec {
  readonly sourceRepositories?: unknown[];
  readonly installations?: unknown[];
  readonly repositories?: unknown[];
  readonly calls?: Call[];
  readonly routes?: Readonly<Record<string, Responder>>;
}

/** The generic fake answers unmatched POSTs with an empty object, so
 *  the install-intent call needs its own route. */
const INSTALL_INTENT_ROUTE = {
  "POST /v1/scm-installations/install-intents": () => ({
    data: { data: { installUrl: INSTALL_URL } },
  }),
};

function apiFailure(status: number, body?: unknown) {
  return {
    error: body ?? { error: { message: "boom" } },
    response: new Response(null, { status }),
  };
}

function gitClient(spec: GitClientSpec = {}): ManagementApiClient {
  const page = { hasMore: false, nextCursor: null };

  const dispatch = (method: string, apiPath: string, init: Call["init"]) => {
    const call: Call = { method, path: apiPath, init: init ?? {} };
    spec.calls?.push(call);
    const route = spec.routes?.[`${method} ${apiPath}`];
    if (route) {
      return route(call);
    }

    if (method === "GET" && apiPath === "/v1/projects") {
      return { data: { data: PROJECTS } };
    }
    if (method === "GET" && apiPath === "/v1/source-repositories") {
      return {
        data: { data: spec.sourceRepositories ?? [], pagination: page },
      };
    }
    if (method === "GET" && apiPath === "/v1/scm-installations") {
      return {
        data: { data: spec.installations ?? [INSTALLATION], pagination: page },
      };
    }
    if (
      method === "GET" &&
      apiPath === "/v1/scm-installations/{installationId}/repositories"
    ) {
      return {
        data: { data: spec.repositories ?? [SCM_REPOSITORY], pagination: page },
      };
    }
    if (method === "POST" && apiPath === "/v1/source-repositories") {
      return { data: { data: SOURCE_REPOSITORY } };
    }
    return { data: { data: {} } };
  };

  return {
    GET: async (apiPath: string, init: Call["init"]) =>
      dispatch("GET", apiPath, init),
    POST: async (apiPath: string, init: Call["init"]) =>
      dispatch("POST", apiPath, init),
    PATCH: async (apiPath: string, init: Call["init"]) =>
      dispatch("PATCH", apiPath, init),
    DELETE: async (apiPath: string, init: Call["init"]) =>
      dispatch("DELETE", apiPath, init),
  } as unknown as ManagementApiClient;
}

/** A clock that moves a second every time it is read — what makes the
 *  install wait's timeout reachable without real waiting. */
function tickingClock(stepMs = 1000): () => Date {
  let reads = 0;
  return () => {
    reads += 1;
    return new Date(reads * stepMs);
  };
}

interface CliOptions {
  readonly signedIn?: boolean;
  readonly now?: () => Date;
  readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function makeCli(client: ManagementApiClient, options: CliOptions = {}) {
  const signedIn = options.signedIn ?? true;
  return createTestCli({
    commands: {
      "git connect": gitConnectCommand,
      "git disconnect": gitDisconnectCommand,
    },
    groups: {
      git: { brief: "Manage Git repository connections for a project" },
    },
    ...(signedIn
      ? {
          sessions: [ACME_SESSION],
          currentWorkspaceId: ACME_SESSION.workspaceId,
        }
      : {}),
    managementApi: { client },
    now: options.now ?? (() => new Date(0)),
    ...(options.delay === undefined ? {} : { delay: options.delay }),
  });
}

/** Both git commands resolve the project from the local pin. */
async function pinnedCwd() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "v8-git-test-"));
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma", "local.json"),
    `${JSON.stringify({ workspaceId: "ws_1", projectId: "proj_1" }, null, 2)}\n`,
    "utf8",
  );
  return cwd;
}

/** `git connect` declares needs.interaction, so every run that reaches
 *  its handler must look interactive. */
const INTERACTIVE = { stdin: true, stdout: true };

function resultFrame(frames: ReadonlyArray<{ kind: string }>) {
  const frame = frames.at(-1);
  if (frame === undefined || frame.kind !== "result") {
    throw new Error("expected a terminal result frame");
  }
  return frame as Extract<StreamEvent, { kind: "result" }>;
}

function errorOf(frames: ReadonlyArray<{ kind: string }>) {
  const { envelope } = resultFrame(frames);
  if (envelope.ok) {
    throw new Error("expected an errored envelope");
  }
  return envelope.error;
}

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

beforeEach(() => {
  readOrigin.mockReset();
  readOrigin.mockResolvedValue(null);
});

describe("prisma-v8 git connect", () => {
  it("connects the repository named by the positional", async () => {
    const calls: Call[] = [];
    const result = await makeCli(gitClient({ calls })).run(
      ["git", "connect", REPO_URL],
      { cwd: await pinnedCwd(), isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.find(
        (call) =>
          call.method === "POST" && call.path === "/v1/source-repositories",
      )?.init.body,
    ).toEqual({
      projectId: "proj_1",
      provider: "github",
      providerRepositoryId: 42,
      installationId: "scm_1",
    });
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: "Connecting Git to the resolved project.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: "Billing" },
          { label: "workspace", value: "Acme Inc" },
          { label: "repository", value: "prisma/prisma-cli" },
          { label: "status", value: "active" },
        ],
      },
      {
        kind: "list",
        items: ["GitHub branch automation is active for this project."],
      },
    ]);
  });

  it("falls back to the origin remote when no url is passed", async () => {
    readOrigin.mockResolvedValue("https://github.com/prisma/prisma-cli");
    const cwd = await pinnedCwd();
    const result = await makeCli(gitClient()).run(["git", "connect"], {
      cwd,
      isTty: INTERACTIVE,
    });

    expect(result.exitCode).toBe(0);
    expect(readOrigin).toHaveBeenCalledWith(cwd, expect.anything());
    expect(result.presented?.data).toMatchObject({
      repositoryConnection: { repository: { fullName: "prisma/prisma-cli" } },
    });
  });

  it("errors when there is no url and no origin remote", async () => {
    const result = await makeCli(gitClient()).run(
      ["git", "connect", "--json"],
      { cwd: await pinnedCwd(), isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.USAGE_ERROR",
        summary: "Repository connection requires a GitHub repository URL",
        why: "No git-url was provided and the local repo does not have an origin remote.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Pass a GitHub repository URL, or add a GitHub origin remote and rerun prisma-cli git connect.",
          },
          {
            kind: "run-command",
            command:
              "prisma-cli git connect git@github.com:prisma/prisma-cli.git",
          },
        ],
      },
    });
  });

  it("rejects a url that is not a GitHub repository", async () => {
    const result = await makeCli(gitClient()).run(
      ["git", "connect", "git@gitlab.com:prisma/prisma-cli.git", "--json"],
      { cwd: await pinnedCwd(), isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.REPO_PROVIDER_UNSUPPORTED",
        summary: "Repository provider is not supported",
        why: "Repository connection supports GitHub repository URLs only.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Pass a GitHub repository URL such as git@github.com:prisma/prisma-cli.git.",
          },
          {
            kind: "run-command",
            command: "prisma-cli git connect git@github.com:owner/repo.git",
          },
        ],
      },
    });
  });

  it("succeeds without mutating when the same repository is already connected", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      gitClient({ calls, sourceRepositories: [SOURCE_REPOSITORY] }),
    ).run(["git", "connect", "git@github.com:PRISMA/Prisma-CLI.git"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
    });

    expect(result.exitCode).toBe(0);
    expect(
      calls.some(
        (call) =>
          call.method === "POST" && call.path === "/v1/source-repositories",
      ),
    ).toBe(false);
    expect(result.presented?.data).toMatchObject({
      repositoryConnection: { id: "srcrepo_1" },
    });
  });

  it("refuses to connect a second repository", async () => {
    const result = await makeCli(
      gitClient({ sourceRepositories: [SOURCE_REPOSITORY] }),
    ).run(["git", "connect", "git@github.com:prisma/other.git", "--json"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.REPO_ALREADY_CONNECTED",
        summary: "Project already has a GitHub repository connected",
        why: "The resolved project is already connected to prisma/prisma-cli.",
        meta: { repository: "prisma/prisma-cli" },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Disconnect the existing repository before connecting a different one.",
          },
          { kind: "run-command", command: "prisma-cli git disconnect" },
        ],
      },
    });
  });

  it("gives up with GIT.REPO_INSTALLATION_REQUIRED when no installation appears", async () => {
    const result = await makeCli(
      gitClient({ installations: [], routes: { ...INSTALL_INTENT_ROUTE } }),
      { now: tickingClock() },
    ).run(["git", "connect", REPO_URL, "--json"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
      env: { PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS: "5000" },
    });

    expect(result.exitCode).toBe(2);
    const error = errorOf(result.json);
    expect(error).toMatchObject({
      code: "GIT.REPO_INSTALLATION_REQUIRED",
      summary: "GitHub App installation required",
      why: "The selected workspace does not have a GitHub App installation that can be used to link prisma/prisma-cli.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Finish installing the GitHub App in the browser, then rerun prisma-cli git connect.",
        },
        { kind: "open-url", label: INSTALL_URL, url: INSTALL_URL },
        {
          kind: "run-command",
          command:
            "prisma-cli git connect https://github.com/prisma/prisma-cli",
        },
      ],
    });
    expect(error.meta).toEqual({
      repository: "prisma/prisma-cli",
      installUrl: INSTALL_URL,
    });
  });

  it("gives up with GIT.REPO_NOT_ACCESSIBLE when an installation cannot see the repository", async () => {
    const result = await makeCli(
      gitClient({ repositories: [], routes: { ...INSTALL_INTENT_ROUTE } }),
      { now: tickingClock() },
    ).run(["git", "connect", REPO_URL, "--json"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
      env: { PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS: "5000" },
    });

    expect(result.exitCode).toBe(2);
    const error = errorOf(result.json);
    expect(error).toMatchObject({
      code: "GIT.REPO_NOT_ACCESSIBLE",
      summary: "GitHub repository is not accessible",
      why: "The GitHub App installations connected to this workspace do not expose prisma/prisma-cli.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Open the GitHub App installation URL, grant access to this repository, then rerun prisma-cli git connect.",
        },
        { kind: "open-url", label: INSTALL_URL, url: INSTALL_URL },
        {
          kind: "run-command",
          command:
            "prisma-cli git connect https://github.com/prisma/prisma-cli",
        },
      ],
    });
    expect(error.meta).toEqual({
      repository: "prisma/prisma-cli",
      installUrl: INSTALL_URL,
    });
  });

  it("announces the install URL once and connects when the poll finds the repository", async () => {
    const calls: Call[] = [];
    const intervals: number[] = [];
    let repositoryListCalls = 0;
    const result = await makeCli(
      gitClient({
        calls,
        routes: {
          ...INSTALL_INTENT_ROUTE,
          "GET /v1/scm-installations/{installationId}/repositories": () => {
            repositoryListCalls += 1;
            return {
              data: {
                data: repositoryListCalls > 2 ? [SCM_REPOSITORY] : [],
                pagination: { hasMore: false, nextCursor: null },
              },
            };
          },
        },
      }),
      {
        delay: async (ms) => {
          intervals.push(ms);
        },
      },
    ).run(["git", "connect", REPO_URL], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
      env: { PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS: "1" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.events).toEqual([
      {
        kind: "endpoint",
        name: "Waiting for GitHub App installation or repository access approval...",
        url: INSTALL_URL,
      },
    ]);
    expect(intervals).toEqual([1]);
    expect(repositoryListCalls).toBe(3);
    expect(
      calls.find(
        (call) =>
          call.method === "POST" && call.path === "/v1/source-repositories",
      )?.init.body,
    ).toMatchObject({ providerRepositoryId: 42, installationId: "scm_1" });
  });

  it("stops polling at the configured timeout", async () => {
    let polls = 0;
    const intervals: number[] = [];
    const result = await makeCli(
      gitClient({
        installations: [],
        routes: {
          ...INSTALL_INTENT_ROUTE,
          "GET /v1/scm-installations": () => {
            polls += 1;
            return {
              data: {
                data: [],
                pagination: { hasMore: false, nextCursor: null },
              },
            };
          },
        },
      }),
      {
        now: tickingClock(),
        delay: async (ms) => {
          intervals.push(ms);
        },
      },
    ).run(["git", "connect", REPO_URL, "--json"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
      env: { PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS: "5000" },
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "GIT.REPO_INSTALLATION_REQUIRED" },
    });
    // One pre-wait inspection plus a bounded number of polls: the loop
    // gave up on the 5s env timeout, not the 120s default.
    expect(polls).toBeGreaterThan(1);
    expect(polls).toBeLessThan(20);
    // No interval env var, so the loop asks for the legacy default.
    expect(new Set(intervals)).toEqual(new Set([2000]));
  });

  it("settles CLI.PROMPT_CANCELLED at exit 3 when the wait is interrupted", async () => {
    const controller = new AbortController();
    const result = await makeCli(
      gitClient({
        installations: [],
        routes: {
          ...INSTALL_INTENT_ROUTE,
          "GET /v1/scm-installations": () => ({
            data: {
              data: [],
              pagination: { hasMore: false, nextCursor: null },
            },
          }),
        },
      }),
      {
        now: tickingClock(),
        // Ctrl-C lands while the loop is sleeping between polls, which is
        // where the user spends the wait.
        delay: async () => {
          controller.abort();
        },
      },
    ).run(["git", "connect", REPO_URL, "--json"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
      abort: controller.signal,
    });

    expect(result.exitCode).toBe(3);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_CANCELLED" },
    });
  });

  it("maps a 409 on the connect call to the already-linked fix text", async () => {
    const result = await makeCli(
      gitClient({
        routes: { "POST /v1/source-repositories": () => apiFailure(409, {}) },
      }),
    ).run(["git", "connect", REPO_URL, "--json"], {
      cwd: await pinnedCwd(),
      isTty: INTERACTIVE,
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.REPO_CONNECTION_FAILED",
        summary: "Failed to connect GitHub repository",
        why: "The Management API returned status 409.",
        meta: { status: 409 },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "This project or repository is already linked. Disconnect the old link first, then try again.",
          },
          { kind: "run-command", command: "prisma-cli project show" },
        ],
      },
    });
  });

  it("returns the raw connection result in json mode", async () => {
    const result = await makeCli(gitClient()).run(
      ["git", "connect", REPO_URL, "--json"],
      { cwd: await pinnedCwd(), isTty: INTERACTIVE },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "git.connect",
      result: {
        workspace: { id: "ws_1", name: "Acme Inc" },
        project: { id: "proj_1", name: "Billing" },
        resolution: { projectSource: "local-pin" },
        repositoryConnection: {
          id: "srcrepo_1",
          provider: "github",
          repoId: 42,
          repository: {
            owner: "prisma",
            name: "prisma-cli",
            fullName: "prisma/prisma-cli",
            url: "https://github.com/prisma/prisma-cli",
          },
          status: "active",
          installation: { id: "scm_1", status: "connected" },
          automation: { branches: true, pullRequests: false, comments: false },
        },
      },
      nextActions: [],
    });
  });

  it("fails a non-interactive run before it calls the API", async () => {
    const calls: Call[] = [];
    const result = await makeCli(gitClient({ calls })).run(
      ["git", "connect", REPO_URL, "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.INTERACTION_REQUIRED" },
    });
    expect(calls).toEqual([]);
  });

  it("requires credentials", async () => {
    const result = await makeCli(gitClient(), { signedIn: false }).run(
      ["git", "connect", REPO_URL, "--json"],
      { cwd: await pinnedCwd(), isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 git disconnect", () => {
  it("disconnects the connected repository", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      gitClient({ calls, sourceRepositories: [SOURCE_REPOSITORY] }),
    ).run(["git", "disconnect"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      calls.find(
        (call) =>
          call.method === "DELETE" &&
          call.path === "/v1/source-repositories/{id}",
      )?.init.params?.path,
    ).toEqual({ id: "srcrepo_1" });
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: "Disconnecting Git from the resolved project.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: "Billing" },
          { label: "workspace", value: "Acme Inc" },
          { label: "repository", value: "prisma/prisma-cli" },
        ],
      },
      {
        kind: "list",
        items: [
          "GitHub branch automation is no longer active for this project.",
        ],
      },
    ]);
  });

  it("errors when nothing is connected", async () => {
    const result = await makeCli(gitClient()).run(
      ["git", "disconnect", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.REPO_NOT_CONNECTED",
        summary: "No GitHub repository connected",
        why: "The resolved project does not have an active GitHub repository connection.",
        nextActions: [
          {
            kind: "user-choice",
            label: "Run prisma-cli git connect before disconnecting.",
          },
          { kind: "run-command", command: "prisma-cli git connect" },
        ],
      },
    });
  });

  it("maps a failed delete to GIT.REPO_CONNECTION_FAILED", async () => {
    const result = await makeCli(
      gitClient({
        sourceRepositories: [SOURCE_REPOSITORY],
        routes: {
          "DELETE /v1/source-repositories/{id}": () =>
            apiFailure(422, { error: { message: "Still building." } }),
        },
      }),
    ).run(["git", "disconnect", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.REPO_CONNECTION_FAILED",
        summary: "Failed to disconnect GitHub repository",
        why: "Still building.",
        meta: { status: 422 },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Make sure the GitHub App installation has access to this repository.",
          },
          { kind: "run-command", command: "prisma-cli project show" },
        ],
      },
    });
  });

  it("maps a forbidden delete to GIT.AUTH_REQUIRED without the TTY offer", async () => {
    const result = await makeCli(
      gitClient({
        sourceRepositories: [SOURCE_REPOSITORY],
        routes: {
          "DELETE /v1/source-repositories/{id}": () => apiFailure(403, {}),
        },
      }),
    ).run(["git", "disconnect", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.AUTH_REQUIRED",
        summary: "Authentication required",
        why: "This command needs an authenticated session.",
        nextActions: [
          { kind: "user-choice", label: "Run prisma-cli auth login." },
          {
            kind: "run-command",
            label: "prisma-cli auth login",
            command: "prisma-cli auth login",
          },
        ],
      },
    });
  });

  it("falls back to the log-level fix text on a status with no variant", async () => {
    const result = await makeCli(
      gitClient({
        sourceRepositories: [SOURCE_REPOSITORY],
        routes: {
          "DELETE /v1/source-repositories/{id}": () =>
            apiFailure(500, { error: { message: "Backend exploded." } }),
        },
      }),
    ).run(["git", "disconnect", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "GIT.REPO_CONNECTION_FAILED",
        why: "Backend exploded.",
        meta: { status: 500 },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Re-run with --log-level verbose for the underlying API response details.",
          },
          { kind: "run-command", command: "prisma-cli project show" },
        ],
      },
    });
  });

  it("returns the removed connection in json mode", async () => {
    const result = await makeCli(
      gitClient({ sourceRepositories: [SOURCE_REPOSITORY] }),
    ).run(["git", "disconnect", "--json"], { cwd: await pinnedCwd() });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "git.disconnect",
      result: {
        workspace: { id: "ws_1", name: "Acme Inc" },
        project: { id: "proj_1", name: "Billing" },
        repositoryConnection: {
          id: "srcrepo_1",
          repository: { fullName: "prisma/prisma-cli" },
        },
      },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(gitClient(), { signedIn: false }).run(
      ["git", "disconnect"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});
