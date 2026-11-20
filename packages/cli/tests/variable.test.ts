import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { variableAddCommand } from "../src/commands/variable/add";
import { variableDeleteCommand } from "../src/commands/variable/delete";
import { variableGroupCreateCommand } from "../src/commands/variable/group-create";
import { variableGroupDeleteCommand } from "../src/commands/variable/group-delete";
import { variableGroupListCommand } from "../src/commands/variable/group-list";
import { variableListCommand } from "../src/commands/variable/list";
import { variableUpdateCommand } from "../src/commands/variable/update";

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
    workspace: { id: "wksp_ws_1", name: "Acme Inc" },
  },
];

const PRODUCTION_GROUP = {
  id: "vg_prod",
  type: "variable-group",
  url: "https://api.prisma.io/v1/variable-groups/vg_prod",
  projectId: "proj_1",
  name: "production",
  class: "production",
  rule: null,
  ruleValue: null,
  matchedBranchIds: ["br_main"],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const PREVIEW_GROUP = {
  id: "vg_prev",
  type: "variable-group",
  url: "https://api.prisma.io/v1/variable-groups/vg_prev",
  projectId: "proj_1",
  name: "preview",
  class: "preview",
  rule: null,
  ruleValue: null,
  matchedBranchIds: ["br_1"],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const CUSTOM_GROUP = {
  id: "vg_custom",
  type: "variable-group",
  url: "https://api.prisma.io/v1/variable-groups/vg_custom",
  projectId: "proj_1",
  name: "staging",
  class: "custom",
  rule: "equals",
  ruleValue: "staging",
  matchedBranchIds: ["br_staging"],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const BUILT_IN_GROUPS = [PRODUCTION_GROUP, PREVIEW_GROUP];
const ALL_GROUPS = [PRODUCTION_GROUP, PREVIEW_GROUP, CUSTOM_GROUP];

interface Call {
  readonly method: string;
  readonly path: string;
  readonly init: {
    params?: { path?: Record<string, string>; query?: Record<string, unknown> };
    body?: unknown;
  };
}

type Responder = (call: Call) => unknown;

interface VariableClientSpec {
  readonly groups?: unknown[];
  readonly calls?: Call[];
  readonly routes?: Readonly<Record<string, Responder>>;
}

function apiFailure(status: number, body?: unknown) {
  return {
    error: body ?? { error: { message: "boom" } },
    response: new Response(null, { status }),
  };
}

function variableClient(spec: VariableClientSpec = {}): ManagementApiClient {
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
    if (method === "GET" && apiPath === "/v1/variable-groups") {
      return { data: { data: spec.groups ?? BUILT_IN_GROUPS } };
    }
    if (method === "GET" && apiPath === "/v1/environment-variables") {
      return { data: { data: [], pagination: page } };
    }
    if (method === "POST" && apiPath === "/v1/environment-variables") {
      const body = init.body as Record<string, string>;
      return {
        data: {
          data: {
            id: "ev_new",
            key: body.key,
            updatedAt: "2024-06-01T00:00:00Z",
          },
        },
      };
    }
    if (method === "POST" && apiPath === "/v1/variable-groups") {
      const body = init.body as Record<string, unknown>;
      return {
        data: {
          data: {
            id: "vg_new",
            type: "variable-group",
            url: "https://api.prisma.io/v1/variable-groups/vg_new",
            projectId: body.projectId,
            name: body.name,
            class: "custom",
            rule: (body.rule as { type: string }).type,
            ruleValue: (body.rule as { value: string }).value,
            matchedBranchIds: [],
            createdAt: "2024-06-01T00:00:00Z",
            updatedAt: "2024-06-01T00:00:00Z",
          },
        },
      };
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

function makeCli(
  client: ManagementApiClient,
  commands: Record<string, unknown> = {},
) {
  return createTestCli({
    commands: {
      "variable add": variableAddCommand,
      "variable update": variableUpdateCommand,
      "variable delete": variableDeleteCommand,
      "variable list": variableListCommand,
      "variable group list": variableGroupListCommand,
      "variable group create": variableGroupCreateCommand,
      "variable group delete": variableGroupDeleteCommand,
      ...commands,
    },
    groups: {
      variable: { brief: "Manage project variables" },
      "variable group": { brief: "Manage variable groups" },
    },
    sessions: [ACME_SESSION],
    selectedWorkspaceId: ACME_SESSION.workspaceId,
    managementApi: { client },
    now: () => new Date(0),
  });
}

async function pinnedCwd() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "variable-test-"));
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

// ---------------------------------------------------------------------------
// Flag validation
// ---------------------------------------------------------------------------

describe("flag validation", () => {
  it("rejects --group and --role used together", async () => {
    const result = await makeCli(variableClient()).run(
      [
        "variable",
        "add",
        "KEY=val",
        "--group",
        "production",
        "--role",
        "preview",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.CONFLICTING_FLAGS" },
    });
  });

  it("rejects add without --group or --role", async () => {
    const result = await makeCli(variableClient()).run(
      ["variable", "add", "KEY=val", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.MISSING_GROUP" },
    });
  });

  it("rejects --branch on variable add", async () => {
    const result = await makeCli(variableClient()).run(
      [
        "variable",
        "add",
        "KEY=val",
        "--branch",
        "feature/foo",
        "--group",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.NO_BRANCH_WRITE" },
    });
  });

  it("rejects --branch on variable update", async () => {
    const result = await makeCli(variableClient()).run(
      [
        "variable",
        "update",
        "KEY=val",
        "--branch",
        "feature/foo",
        "--group",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.NO_BRANCH_WRITE" },
    });
  });

  it("rejects --branch on variable delete", async () => {
    const result = await makeCli(variableClient()).run(
      [
        "variable",
        "delete",
        "KEY",
        "--branch",
        "feature/foo",
        "--group",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.NO_BRANCH_WRITE" },
    });
  });
});

// ---------------------------------------------------------------------------
// Strict preview check
// ---------------------------------------------------------------------------

describe("strict --role preview check", () => {
  it("fails when the project has custom groups", async () => {
    const result = await makeCli(variableClient({ groups: ALL_GROUPS })).run(
      ["variable", "add", "KEY=val", "--role", "preview", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.CUSTOM_GROUP_CONFLICT" },
    });
  });

  it("allows --role preview when there are no custom groups", async () => {
    const result = await makeCli(
      variableClient({ groups: BUILT_IN_GROUPS }),
    ).run(["variable", "add", "KEY=val", "--role", "preview", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
    });
  });
});

// ---------------------------------------------------------------------------
// variable add
// ---------------------------------------------------------------------------

describe("variable add", () => {
  it("POSTs to /v1/environment-variables with the group's id", async () => {
    const calls: Call[] = [];
    const result = await makeCli(variableClient({ calls })).run(
      [
        "variable",
        "add",
        "STRIPE_KEY=sk_test_xxx",
        "--group",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);

    const post = calls.find(
      (c) => c.method === "POST" && c.path === "/v1/environment-variables",
    );
    expect(post?.init.body).toMatchObject({
      projectId: "proj_1",
      groupId: "vg_prod",
      key: "STRIPE_KEY",
      value: "sk_test_xxx",
    });
  });

  it("resolves --role production to the production group id", async () => {
    const calls: Call[] = [];
    await makeCli(variableClient({ calls })).run(
      ["variable", "add", "KEY=val", "--role", "production"],
      { cwd: await pinnedCwd() },
    );

    const post = calls.find(
      (c) => c.method === "POST" && c.path === "/v1/environment-variables",
    );
    expect(post?.init.body).toMatchObject({ groupId: "vg_prod" });
  });

  it("fails when the group name does not exist", async () => {
    const result = await makeCli(variableClient()).run(
      ["variable", "add", "KEY=val", "--group", "nonexistent", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.GROUP_NOT_FOUND" },
    });
  });

  it("imports all variables from a dotenv file", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "A=1\nB=2\n", "utf8");

    const calls: Call[] = [];
    const result = await makeCli(variableClient({ calls })).run(
      ["variable", "add", "--file", ".env", "--group", "production", "--json"],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
    const posts = calls.filter(
      (c) => c.method === "POST" && c.path === "/v1/environment-variables",
    );
    expect(posts).toHaveLength(2);
    const keys = posts.map((c) => (c.init.body as { key: string }).key).sort();
    expect(keys).toEqual(["A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// variable update
// ---------------------------------------------------------------------------

describe("variable update", () => {
  it("PATCHes the matching variable by id", async () => {
    const existingVar = {
      id: "ev_existing",
      key: "API_KEY",
      groupId: "vg_prod",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const calls: Call[] = [];
    const result = await makeCli(
      variableClient({
        calls,
        routes: {
          "GET /v1/environment-variables": () => ({
            data: {
              data: [existingVar],
              pagination: { hasMore: false, nextCursor: null },
            },
          }),
          "PATCH /v1/environment-variables/{envVarId}": (call) => ({
            data: {
              data: {
                id: "ev_existing",
                key: "API_KEY",
                updatedAt: "2024-06-01T00:00:00Z",
                ...(call.init.body as object),
              },
            },
          }),
        },
      }),
    ).run(
      [
        "variable",
        "update",
        "API_KEY=new_value",
        "--group",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);

    const patch = calls.find(
      (c) =>
        c.method === "PATCH" &&
        c.path === "/v1/environment-variables/{envVarId}",
    );
    expect(patch?.init.params?.path).toMatchObject({ envVarId: "ev_existing" });
    expect(patch?.init.body).toMatchObject({ value: "new_value" });
  });

  it("fails with VARIABLE.NOT_FOUND when the variable does not exist in the group", async () => {
    const result = await makeCli(variableClient()).run(
      ["variable", "update", "MISSING=val", "--group", "production", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.NOT_FOUND" },
    });
  });
});

// ---------------------------------------------------------------------------
// variable delete
// ---------------------------------------------------------------------------

describe("variable delete", () => {
  it("DELETEs the matching variable by id", async () => {
    const existingVar = { id: "ev_del", key: "OLD_KEY" };

    const calls: Call[] = [];
    const result = await makeCli(
      variableClient({
        calls,
        routes: {
          "GET /v1/environment-variables": () => ({
            data: {
              data: [existingVar],
              pagination: { hasMore: false, nextCursor: null },
            },
          }),
          "DELETE /v1/environment-variables/{envVarId}": () => ({ data: {} }),
        },
      }),
    ).run(
      ["variable", "delete", "OLD_KEY", "--group", "production", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);

    const del = calls.find(
      (c) =>
        c.method === "DELETE" &&
        c.path === "/v1/environment-variables/{envVarId}",
    );
    expect(del?.init.params?.path).toMatchObject({ envVarId: "ev_del" });
  });

  it("fails with VARIABLE.NOT_FOUND when the variable does not exist", async () => {
    const result = await makeCli(variableClient()).run(
      ["variable", "delete", "GHOST", "--group", "production", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.NOT_FOUND" },
    });
  });
});

// ---------------------------------------------------------------------------
// variable list
// ---------------------------------------------------------------------------

describe("variable list", () => {
  it("renders a group table with variable counts", async () => {
    const result = await makeCli(
      variableClient({
        groups: ALL_GROUPS,
        routes: {
          "GET /v1/environment-variables": (call) => {
            const groupId = (call.init.params?.query as { groupId?: string })
              ?.groupId;
            if (groupId === "vg_prod") {
              return {
                data: {
                  data: [
                    {
                      id: "ev_1",
                      key: "STRIPE_KEY",
                      updatedAt: "2024-01-01T00:00:00Z",
                    },
                  ],
                  pagination: { hasMore: false, nextCursor: null },
                },
              };
            }
            return {
              data: {
                data: [],
                pagination: { hasMore: false, nextCursor: null },
              },
            };
          },
        },
      }),
    ).run(["variable", "list", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(0);
    const envelope = resultFrame(result.json).envelope as {
      ok: boolean;
      result: { groups: Array<{ group: { name: string }; keys: string[] }> };
    };
    expect(envelope.ok).toBe(true);
    const prodGroup = envelope.result.groups.find(
      (g) => g.group.name === "production",
    );
    expect(prodGroup?.keys).toEqual(["STRIPE_KEY"]);
  });
});

// ---------------------------------------------------------------------------
// variable group list
// ---------------------------------------------------------------------------

describe("variable group list", () => {
  it("renders a table with name, class, rule, and branch count", async () => {
    const result = await makeCli(variableClient({ groups: ALL_GROUPS })).run(
      ["variable", "group", "list"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);

    const presented = result.presented as
      | { presentation: { human: Array<{ kind: string }> } }
      | undefined;
    const human = presented?.presentation.human ?? [];

    expect(human).toContainEqual({
      kind: "table",
      columns: ["name", "class", "rule", "branches"],
      rows: expect.arrayContaining([
        ["production", "production", "production branch", "1"],
        ["preview", "preview", "all other branches", "1"],
        ["staging", "custom", "= staging", "1"],
      ]),
    });
  });

  it("renders an empty-state summary when there are no groups", async () => {
    const result = await makeCli(variableClient({ groups: [] })).run(
      ["variable", "group", "list"],
      {
        cwd: await pinnedCwd(),
        isTty: { stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    const presented = result.presented as
      | { presentation: { human: Array<{ kind: string; text?: string }> } }
      | undefined;
    const human = presented?.presentation.human ?? [];
    expect(human).toContainEqual(
      expect.objectContaining({
        kind: "summary",
        text: "No variable groups found.",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// variable group create
// ---------------------------------------------------------------------------

describe("variable group create", () => {
  it("POSTs an equals rule to /v1/variable-groups", async () => {
    const calls: Call[] = [];
    const result = await makeCli(variableClient({ calls })).run(
      [
        "variable",
        "group",
        "create",
        "staging",
        "--equals",
        "staging",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);

    const post = calls.find(
      (c) => c.method === "POST" && c.path === "/v1/variable-groups",
    );
    expect(post?.init.body).toMatchObject({
      projectId: "proj_1",
      name: "staging",
      rule: { type: "equals", value: "staging" },
    });
  });

  it("POSTs a startsWith rule when --starts-with is given", async () => {
    const calls: Call[] = [];
    await makeCli(variableClient({ calls })).run(
      [
        "variable",
        "group",
        "create",
        "features",
        "--starts-with",
        "feat/",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    const post = calls.find(
      (c) => c.method === "POST" && c.path === "/v1/variable-groups",
    );
    expect(post?.init.body).toMatchObject({
      rule: { type: "startsWith", value: "feat/" },
    });
  });

  it("fails when neither --equals nor --starts-with is given", async () => {
    const result = await makeCli(variableClient()).run(
      ["variable", "group", "create", "staging", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.GROUP_RULE_MISSING" },
    });
  });

  it("fails when both --equals and --starts-with are given", async () => {
    const result = await makeCli(variableClient()).run(
      [
        "variable",
        "group",
        "create",
        "staging",
        "--equals",
        "staging",
        "--starts-with",
        "stag",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.GROUP_RULE_CONFLICT" },
    });
  });
});

// ---------------------------------------------------------------------------
// variable group delete
// ---------------------------------------------------------------------------

describe("variable group delete", () => {
  it("DELETEs the group by id when --yes is passed", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      variableClient({
        calls,
        groups: ALL_GROUPS,
        routes: {
          "GET /v1/variable-groups": () => ({
            data: { data: ALL_GROUPS },
          }),
          "DELETE /v1/variable-groups/{groupId}": () => ({ data: {} }),
        },
      }),
    ).run(
      [
        "variable",
        "group",
        "delete",
        "staging",
        "--confirm",
        "staging",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);

    const del = calls.find(
      (c) =>
        c.method === "DELETE" && c.path === "/v1/variable-groups/{groupId}",
    );
    expect(del?.init.params?.path).toMatchObject({ groupId: "vg_custom" });
  });

  it("rejects deletion of the built-in production group", async () => {
    const result = await makeCli(
      variableClient({ groups: BUILT_IN_GROUPS }),
    ).run(
      [
        "variable",
        "group",
        "delete",
        "production",
        "--confirm",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "VARIABLE.BUILTIN_GROUP_DELETE" },
    });
  });
});
