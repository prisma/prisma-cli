import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { branchListCommand } from "../src/v8/branch/list";

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

const BRANCHES = [
  { id: "br_1", gitName: "zeta", role: "preview" },
  { id: "br_2", gitName: "main", role: "production" },
  { id: "br_3", gitName: "alpha", role: "preview" },
];

interface Call {
  readonly method: string;
  readonly path: string;
  readonly init: {
    params?: { path?: Record<string, string>; query?: Record<string, unknown> };
    body?: unknown;
  };
}

type Responder = (call: Call) => unknown;

interface BranchClientSpec {
  readonly branches?: unknown[];
  readonly calls?: Call[];
  readonly routes?: Readonly<Record<string, Responder>>;
}

function apiFailure(status: number, body?: unknown) {
  return {
    error: body ?? { error: { message: "boom" } },
    response: new Response(null, { status }),
  };
}

function branchClient(spec: BranchClientSpec = {}): ManagementApiClient {
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
    if (method === "GET" && apiPath === "/v1/projects/{projectId}/branches") {
      return { data: { data: spec.branches ?? BRANCHES, pagination: page } };
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

function makeCli(client: ManagementApiClient, signedIn = true) {
  return createTestCli({
    commands: { "branch list": branchListCommand },
    groups: { branch: { brief: "View your Platform branches" } },
    ...(signedIn
      ? {
          sessions: [ACME_SESSION],
          selectedWorkspaceId: ACME_SESSION.workspaceId,
        }
      : {}),
    managementApi: { client },
    now: () => new Date(0),
  });
}

/** `branch list` resolves the project from the local pin only, so its
 *  runs need a pinned directory. */
async function pinnedCwd() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "v8-branch-test-"));
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma", "local.json"),
    `${JSON.stringify({ workspaceId: "ws_1", projectId: "proj_1" }, null, 2)}\n`,
    "utf8",
  );
  return cwd;
}

function resultFrame(frames: ReadonlyArray<{ kind: string }>) {
  const frame = frames.at(-1);
  if (frame === undefined || frame.kind !== "result") {
    throw new Error("expected a terminal result frame");
  }
  return frame as Extract<StreamEvent, { kind: "result" }>;
}

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

describe("prisma-v8 branch list", () => {
  it("lists production branches first, then the rest alphabetically", async () => {
    const result = await makeCli(branchClient()).run(["branch", "list"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "info",
        text: "Listing branches for the resolved project.",
      },
      { kind: "fields", rows: [{ label: "project", value: "Billing" }] },
      {
        kind: "table",
        columns: ["Name", "Role", "Env map"],
        rows: [
          ["main", "production", "production"],
          ["alpha", "preview", "preview"],
          ["zeta", "preview", "preview"],
        ],
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "main\tproduction\tproduction",
      "alpha\tpreview\tpreview",
      "zeta\tpreview\tpreview",
    ]);
  });

  it("follows the cursor to the last page", async () => {
    const calls: Call[] = [];
    let page = 0;
    const result = await makeCli(
      branchClient({
        calls,
        routes: {
          "GET /v1/projects/{projectId}/branches": () => {
            page += 1;
            return page === 1
              ? {
                  data: {
                    data: [BRANCHES[1]],
                    pagination: { hasMore: true, nextCursor: "cur_2" },
                  },
                }
              : {
                  data: {
                    data: [BRANCHES[2]],
                    pagination: { hasMore: false, nextCursor: null },
                  },
                };
          },
        },
      }),
    ).run(["branch", "list"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      calls
        .filter((call) => call.path === "/v1/projects/{projectId}/branches")
        .map((call) => call.init.params?.query),
    ).toEqual([{}, { cursor: "cur_2" }]);
    expect(result.presented?.presentation.stdout).toEqual([
      "main\tproduction\tproduction",
      "alpha\tpreview\tpreview",
    ]);
  });

  it("renders an empty-state list block", async () => {
    const result = await makeCli(branchClient({ branches: [] })).run(
      ["branch", "list"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No branches found."],
    });
    expect(result.presented?.presentation.stdout).toEqual([]);
  });

  it("maps an API failure to the passthrough code", async () => {
    const result = await makeCli(
      branchClient({
        routes: {
          "GET /v1/projects/{projectId}/branches": () =>
            apiFailure(500, {
              error: { code: "internalError", message: "Backend exploded." },
            }),
        },
      }),
    ).run(["branch", "list", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BRANCH.internalError",
        summary: "Failed to list branches",
        why: "Backend exploded.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Re-run with --log-level verbose for the underlying API response details.",
          },
        ],
      },
    });
  });

  it('maps an unbound directory to PROJECT.SETUP_REQUIRED reading "this command"', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "v8-branch-unpinned-"));
    const result = await makeCli(branchClient()).run(
      ["branch", "list", "--json"],
      {
        cwd,
      },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.SETUP_REQUIRED",
        summary: "Choose a Project before running this command",
        why: "This directory is not linked to a Prisma Project, and this command will not choose one from package or directory names.",
      },
    });
  });

  it("returns the branch list in json mode", async () => {
    const result = await makeCli(branchClient()).run(
      ["branch", "list", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "branch.list",
      result: {
        projectId: "proj_1",
        projectName: "Billing",
        branches: [
          {
            id: "br_2",
            name: "main",
            role: "production",
            envMap: "production",
          },
          { id: "br_3", name: "alpha", role: "preview", envMap: "preview" },
          { id: "br_1", name: "zeta", role: "preview", envMap: "preview" },
        ],
      },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(branchClient(), false).run(["branch", "list"]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});
