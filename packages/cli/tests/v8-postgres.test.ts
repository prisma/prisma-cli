import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { postgresBackupListCommand } from "../src/v8/postgres/backup-list";
import { postgresConnectionCreateCommand } from "../src/v8/postgres/connection-create";
import { postgresConnectionListCommand } from "../src/v8/postgres/connection-list";
import { postgresConnectionRemoveCommand } from "../src/v8/postgres/connection-remove";
import { postgresConnectionRotateCommand } from "../src/v8/postgres/connection-rotate";
import { postgresCreateCommand } from "../src/v8/postgres/create";
import { postgresListCommand } from "../src/v8/postgres/list";
import { postgresRemoveCommand } from "../src/v8/postgres/remove";
import { postgresRestoreCommand } from "../src/v8/postgres/restore";
import { postgresShowCommand } from "../src/v8/postgres/show";
import { postgresUsageCommand } from "../src/v8/postgres/usage";

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

interface RawDatabase {
  id: string;
  name: string;
  projectId?: string;
  branchGitName?: string | null;
  region?: string | null;
  status?: string | null;
  isDefault?: boolean | null;
  createdAt?: string | null;
  connections?: unknown[];
}

const DB_ONE: RawDatabase = {
  id: "db_1",
  name: "acme-production",
  projectId: "proj_1",
  branchGitName: "main",
  region: "us-east-1",
  status: "ready",
  isDefault: true,
};

const DB_TWO: RawDatabase = {
  id: "db_2",
  name: "acme-preview",
  projectId: "proj_1",
  branchGitName: null,
  region: null,
  status: null,
  isDefault: false,
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly init: {
    params?: { path?: Record<string, string>; query?: Record<string, unknown> };
    body?: unknown;
  };
}

type Responder = (call: Call) => unknown;

interface PostgresClientSpec {
  readonly databases?: RawDatabase[];
  readonly connections?: unknown[];
  readonly calls?: Call[];
  readonly routes?: Readonly<Record<string, Responder>>;
}

function apiFailure(status: number, body?: unknown) {
  return {
    error: body ?? { error: { message: "boom" } },
    response: new Response(null, { status }),
  };
}

function postgresClient(spec: PostgresClientSpec = {}): ManagementApiClient {
  const databases = spec.databases ?? [DB_ONE, DB_TWO];
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
    if (method === "GET" && apiPath === "/v1/databases") {
      return { data: { data: databases, pagination: page } };
    }
    if (method === "GET" && apiPath === "/v1/databases/{databaseId}") {
      const id = init?.params?.path?.databaseId;
      const found = databases.find((database) => database.id === id);
      return found
        ? { data: { data: found } }
        : { error: undefined, response: new Response(null, { status: 404 }) };
    }
    if (
      method === "GET" &&
      apiPath === "/v1/databases/{databaseId}/connections"
    ) {
      return { data: { data: spec.connections ?? [] } };
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
    commands: {
      "postgres list": postgresListCommand,
      "postgres show": postgresShowCommand,
      "postgres create": postgresCreateCommand,
      "postgres usage": postgresUsageCommand,
      "postgres restore": postgresRestoreCommand,
      "postgres remove": postgresRemoveCommand,
      "postgres backup list": postgresBackupListCommand,
      "postgres connection list": postgresConnectionListCommand,
      "postgres connection create": postgresConnectionCreateCommand,
      "postgres connection rotate": postgresConnectionRotateCommand,
      "postgres connection remove": postgresConnectionRemoveCommand,
    },
    groups: {
      postgres: { brief: "Manage Prisma Postgres databases for a project" },
      "postgres backup": { brief: "Inspect platform-created database backups" },
      "postgres connection": {
        brief: "Manage one-time-view database connection strings",
      },
    },
    ...(signedIn
      ? {
          sessions: [ACME_SESSION],
          currentWorkspaceId: ACME_SESSION.workspaceId,
        }
      : {}),
    managementApi: { client },
    now: () => new Date(0),
  });
}

/** Every project-scoped command resolves the project from the local
 *  pin, so the runs need a pinned directory. */
async function pinnedCwd() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "v8-postgres-test-"));
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

const PLAN_LIMIT_BODY = { error: { code: "planLimitReached" } };

describe("prisma-v8 postgres list", () => {
  it("lists the project's databases sorted by branch, name and id", async () => {
    const result = await makeCli(postgresClient()).run(["postgres", "list"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toEqual({
      kind: "table",
      columns: ["Name", "Branch", "Region", "Status", "Id"],
      rows: [
        ["acme-preview", "unscoped", "unknown", "unknown", "db_2"],
        ["acme-production", "main", "us-east-1", "ready", "db_1"],
      ],
    });
    expect(result.presented?.presentation.stdout).toEqual([
      "acme-preview\tunscoped\tunknown\tunknown\tdb_2",
      "acme-production\tmain\tus-east-1\tready\tdb_1",
    ]);
  });

  it("renders an empty-state list block", async () => {
    const result = await makeCli(postgresClient({ databases: [] })).run(
      ["postgres", "list"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No databases found."],
    });
    expect(result.presented?.presentation.stdout).toEqual([]);
  });

  it("passes --branch through to the list query", async () => {
    const calls: Call[] = [];
    const result = await makeCli(postgresClient({ calls })).run(
      ["postgres", "list", "--branch", "feature/foo"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.find((call) => call.path === "/v1/databases")?.init.params?.query,
    ).toMatchObject({ projectId: "proj_1", branchGitName: "feature/foo" });
    expect(result.presented?.data).toMatchObject({ branchName: "feature/foo" });
  });

  it("serializes the legacy list envelope in json mode", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "list", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.list",
      result: {
        context: { project: "Billing" },
        items: [
          { name: "acme-preview", id: "db_2", status: null },
          { name: "acme-production", id: "db_1", status: "default" },
        ],
        count: 2,
        projectId: "proj_1",
        branchName: null,
      },
    });
  });

  it("maps an API failure to the passthrough code", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases": () =>
            apiFailure(500, {
              error: { code: "internalError", message: "Backend exploded." },
            }),
        },
      }),
    ).run(["postgres", "list", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.internalError",
        summary: "Failed to list databases",
        why: "Backend exploded.",
      },
    });
  });

  it("maps a plan-limit failure to POSTGRES.PLAN_LIMIT_REACHED", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases": () => apiFailure(402, PLAN_LIMIT_BODY),
          "GET /v1/workspaces/{workspaceId}/subscription": () => ({
            data: {
              data: {
                planName: "Starter",
                usageBlocked: true,
                upgradeUrl: "https://console.prisma.io/upgrade",
              },
            },
          }),
        },
      }),
    ).run(["postgres", "list", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.PLAN_LIMIT_REACHED",
        summary: "Workspace plan limit reached",
        why: "Database operations are blocked because this workspace has used the operations included in its plan. This is a workspace plan limit, not a Prisma outage.",
        meta: { workspaceId: "ws_1", blockedFeature: null },
        nextActions: [
          { kind: "user-choice", label: "Upgrade the workspace plan" },
        ],
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "list",
    ]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 postgres show", () => {
  it("shows a database addressed by id", async () => {
    const result = await makeCli(
      postgresClient({
        connections: [{ id: "conn_1", name: "primary", databaseId: "db_1" }],
      }),
    ).run(["postgres", "show", "db_1"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "project", value: "Billing" },
        { label: "database", value: "acme-production" },
        { label: "id", value: "db_1" },
        { label: "branch", value: "main" },
        { label: "region", value: "us-east-1" },
        { label: "status", value: "ready" },
        { label: "connections", value: "1" },
      ],
    });
    expect(result.presented?.presentation.stdout).toContain(
      "database: acme-production",
    );
  });

  it("shows a database addressed by name", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "show", "acme-preview"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      database: { id: "db_2", name: "acme-preview" },
    });
  });

  it("maps an unknown database to POSTGRES.NOT_FOUND with the scope", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "show", "nope", "--branch", "main", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.NOT_FOUND",
        summary: "Database not found",
        why: 'No database matched "nope" in project "Billing" on branch "main".',
        nextActions: [
          {
            kind: "user-choice",
            label: "Pass a database id or name from prisma-cli postgres list.",
          },
          {
            kind: "run-command",
            command: "prisma-cli postgres list",
          },
        ],
      },
    });
  });

  it("maps duplicate names to POSTGRES.AMBIGUOUS with the matches", async () => {
    const result = await makeCli(
      postgresClient({
        databases: [DB_ONE, { ...DB_TWO, name: "acme-production" }],
      }),
    ).run(["postgres", "show", "acme-production", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.AMBIGUOUS",
        summary: "Database resolution is ambiguous",
        meta: {
          matches: [
            { id: "db_1", name: "acme-production", branchName: "main" },
            { id: "db_2", name: "acme-production", branchName: null },
          ],
        },
      },
    });
  });

  it("returns the show result in json mode", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "show", "db_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.show",
      result: {
        projectId: "proj_1",
        projectName: "Billing",
        database: { id: "db_1" },
        connections: [],
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "show",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const CREATED_DATABASE = {
  id: "db_new",
  name: "my-db",
  projectId: "proj_1",
  branchGitName: "main",
  region: "eu-central-1",
  status: "creating",
  connections: [
    {
      id: "conn_new",
      name: "primary",
      databaseId: "db_new",
      connectionString: "postgres://user:pass@host/db",
    },
  ],
};

describe("prisma-v8 postgres create", () => {
  it("prints the one-time URL on stdout and masks it in the card", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      postgresClient({
        calls,
        routes: {
          "POST /v1/databases": () => ({ data: { data: CREATED_DATABASE } }),
        },
      }),
    ).run(
      [
        "postgres",
        "create",
        "my-db",
        "--branch",
        "main",
        "--region",
        "eu-central-1",
      ],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.find(
        (call) => call.path === "/v1/databases" && call.method === "POST",
      )?.init.body,
    ).toMatchObject({
      projectId: "proj_1",
      name: "my-db",
      source: { type: "empty" },
      branchGitName: "main",
      region: "eu-central-1",
    });
    expect(result.presented?.presentation.stdout).toEqual([
      "postgres://user:pass@host/db",
    ]);
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: 'Created database "my-db" in Billing / main.',
      },
      {
        kind: "list",
        items: ["The connection URL below is shown once, so save it now."],
      },
      {
        kind: "fields",
        rows: [
          {
            label: "connection URL",
            value: "postgres://user:pass@host/db",
            sensitive: true,
          },
        ],
      },
    ]);
  });

  it("rejects a whitespace-only name", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "create", "   ", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Database name required",
        why: "Database create needs a non-empty name.",
        nextActions: [
          { kind: "user-choice", label: "Pass a database name." },
          {
            kind: "run-command",
            command: "prisma-cli postgres create <name>",
          },
        ],
      },
    });
  });

  it("maps a create response without a connection", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases": () => ({
            data: { data: { ...CREATED_DATABASE, connections: [] } },
          }),
        },
      }),
    ).run(["postgres", "create", "my-db", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.CONNECTION_MISSING",
        summary: "Created database did not return a connection string",
        why: "The Management API created the database but did not include the one-time connection payload.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Create a connection explicitly with prisma-cli postgres connection create <database>.",
          },
          {
            kind: "run-command",
            command: "prisma-cli postgres connection create db_new",
          },
        ],
      },
    });
  });

  it("maps a connection without a connection string", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases": () => ({
            data: {
              data: {
                ...CREATED_DATABASE,
                connections: [{ id: "conn_new", name: "primary" }],
              },
            },
          }),
        },
      }),
    ).run(["postgres", "create", "my-db", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.CONNECTION_STRING_MISSING",
        summary: "Created connection did not return a connection string",
      },
    });
  });

  it("maps a plan-limit create failure without a subscription lookup result", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases": () => apiFailure(402, PLAN_LIMIT_BODY),
          "GET /v1/workspaces/{workspaceId}/subscription": () =>
            apiFailure(500),
        },
      }),
    ).run(["postgres", "create", "my-db", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.PLAN_LIMIT_REACHED",
        nextActions: [
          {
            kind: "user-choice",
            label: "Upgrade the workspace plan",
            reason:
              "Open Prisma Console and upgrade the affected workspace plan.",
          },
        ],
      },
    });
  });

  it("carries the connection string in the json envelope", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases": () => ({ data: { data: CREATED_DATABASE } }),
        },
      }),
    ).run(["postgres", "create", "my-db", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.create",
      result: {
        projectId: "proj_1",
        database: { id: "db_new", name: "my-db" },
        connection: { id: "conn_new", name: "primary" },
        connectionString: "postgres://user:pass@host/db",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "create",
      "my-db",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const USAGE_BODY = {
  period: {
    start: "2026-06-01T00:00:00.000Z",
    end: "2026-06-30T23:59:59.999Z",
  },
  metrics: {
    operations: { used: 1200, unit: "ops" },
    storage: { used: 3, unit: "GiB" },
  },
  generatedAt: "2026-07-01T00:00:00.000Z",
};

describe("prisma-v8 postgres usage", () => {
  it("shows the usage card", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases/{databaseId}/usage": () => ({ data: USAGE_BODY }),
        },
      }),
    ).run(["postgres", "usage", "db_1"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "project", value: "Billing" },
        { label: "database", value: "acme-production" },
        { label: "id", value: "db_1" },
        {
          label: "period",
          value: "2026-06-01T00:00:00.000Z to 2026-06-30T23:59:59.999Z",
        },
        { label: "operations", value: "1200 ops" },
        { label: "storage", value: "3 GiB" },
        { label: "generated", value: "2026-07-01T00:00:00.000Z" },
      ],
    });
  });

  it("expands date-only bounds to UTC day boundaries", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      postgresClient({
        calls,
        routes: {
          "GET /v1/databases/{databaseId}/usage": () => ({ data: USAGE_BODY }),
        },
      }),
    ).run(
      [
        "postgres",
        "usage",
        "db_1",
        "--from",
        "2026-06-01",
        "--to",
        "2026-06-30",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.find((call) => call.path === "/v1/databases/{databaseId}/usage")
        ?.init.params?.query,
    ).toEqual({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-30T23:59:59.999Z",
    });
  });

  it("rejects an invalid --from", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "usage", "db_1", "--from", "2026-02-30", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Invalid usage period",
        why: "--from must be an ISO date such as 2026-06-01 or an ISO datetime such as 2026-06-01T12:00:00Z.",
        nextActions: [
          {
            kind: "user-choice",
            label: "Pass an ISO date or datetime to --from.",
          },
          {
            kind: "run-command",
            command:
              "prisma-cli postgres usage <database> --from 2026-06-01 --to 2026-06-30",
          },
        ],
      },
    });
  });

  it("rejects an invalid --to", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "usage", "db_1", "--to", "not-a-date", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        why: "--to must be an ISO date such as 2026-06-01 or an ISO datetime such as 2026-06-01T12:00:00Z.",
      },
    });
  });

  it("rejects a period that runs backwards", async () => {
    const result = await makeCli(postgresClient()).run(
      [
        "postgres",
        "usage",
        "db_1",
        "--from",
        "2026-06-30",
        "--to",
        "2026-06-01",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Invalid usage period",
        why: "--from must not be later than --to.",
      },
    });
  });

  it("returns the usage result in json mode", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases/{databaseId}/usage": () => ({ data: USAGE_BODY }),
        },
      }),
    ).run(["postgres", "usage", "db_1", "--json"], { cwd: await pinnedCwd() });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.usage",
      result: {
        projectId: "proj_1",
        database: { id: "db_1" },
        period: USAGE_BODY.period,
        metrics: USAGE_BODY.metrics,
        generatedAt: USAGE_BODY.generatedAt,
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "usage",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const RESTORED = { ...DB_ONE, status: "recovering" };

describe("prisma-v8 postgres restore", () => {
  it("restores the database and points at the show command", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      postgresClient({
        calls,
        routes: {
          "POST /v1/databases/{targetDatabaseId}/restore": () => ({
            data: { data: RESTORED },
          }),
        },
      }),
    ).run(
      ["postgres", "restore", "db_1", "--backup", "bkp_1", "--confirm", "db_1"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.find(
        (call) => call.path === "/v1/databases/{targetDatabaseId}/restore",
      )?.init.body,
    ).toEqual({
      source: { type: "backup", databaseId: "db_1", backupId: "bkp_1" },
    });
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: "Restoring database from backup.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: "Billing" },
          { label: "database", value: "acme-production" },
          { label: "id", value: "db_1" },
          { label: "backup", value: "bkp_1" },
        ],
      },
      {
        kind: "list",
        items: [
          'The restore is running; the database status is "recovering" until it completes.',
          "Connections and credentials are preserved.",
        ],
      },
    ]);
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "prisma-cli postgres show db_1",
        command: "prisma-cli postgres show db_1",
      },
    ]);
  });

  it("shows the source database when it differs from the target", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{targetDatabaseId}/restore": () => ({
            data: { data: RESTORED },
          }),
        },
      }),
    ).run(
      [
        "postgres",
        "restore",
        "db_1",
        "--backup",
        "bkp_1",
        "--source-database",
        "db_2",
        "--confirm",
        "db_1",
      ],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      source: { databaseId: "db_2", backupId: "bkp_1" },
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toMatchObject({
      rows: [
        { label: "project", value: "Billing" },
        { label: "database", value: "acme-production" },
        { label: "id", value: "db_1" },
        { label: "backup", value: "bkp_1" },
        { label: "source", value: "db_2" },
      ],
    });
  });

  it("requires --backup", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "restore", "db_1", "--confirm", "db_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Backup id required",
        why: "Database restore needs the backup to restore from.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Pass --backup <backup-id> from prisma-cli postgres backup list <database>.",
          },
          {
            kind: "run-command",
            command: "prisma-cli postgres backup list <database>",
          },
        ],
      },
    });
  });

  it("refuses to restore without consent in a non-interactive run", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "restore", "db_1", "--backup", "bkp_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to restore when --yes stands in for consent", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "restore", "db_1", "--backup", "bkp_1", "--yes", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("restores when the typed answer is the target database id", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{targetDatabaseId}/restore": () => ({
            data: { data: RESTORED },
          }),
        },
      }),
    ).run(["postgres", "restore", "db_1", "--backup", "bkp_1"], {
      cwd: await pinnedCwd(),
      answers: ["db_1"],
      isTty: { stdin: true, stdout: true },
    });

    expect(result.exitCode).toBe(0);
  });

  it("fails when the typed answer is not the target database id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "restore", "db_1", "--backup", "bkp_1", "--json"],
      {
        cwd: await pinnedCwd(),
        answers: ["db_2"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_INVALID" },
    });
  });

  it("maps a 409 to POSTGRES.RESTORE_CONFLICT", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{targetDatabaseId}/restore": () =>
            apiFailure(409),
        },
      }),
    ).run(
      [
        "postgres",
        "restore",
        "db_1",
        "--backup",
        "bkp_1",
        "--confirm",
        "db_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.RESTORE_CONFLICT",
        summary: "Database cannot be restored right now",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Wait for the database to become ready, then retry the restore.",
          },
          { kind: "run-command", command: "prisma-cli postgres show db_1" },
        ],
      },
    });
  });

  it("maps a 404 to POSTGRES.BACKUP_NOT_FOUND", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{targetDatabaseId}/restore": () =>
            apiFailure(404),
        },
      }),
    ).run(
      [
        "postgres",
        "restore",
        "db_1",
        "--backup",
        "bkp_1",
        "--confirm",
        "db_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.BACKUP_NOT_FOUND",
        summary: "Database backup not found",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Pass a backup id from prisma-cli postgres backup list db_1.",
          },
          {
            kind: "run-command",
            command: "prisma-cli postgres backup list db_1",
          },
        ],
      },
    });
  });

  it("returns the restore result in json mode", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{targetDatabaseId}/restore": () => ({
            data: { data: RESTORED },
          }),
        },
      }),
    ).run(
      [
        "postgres",
        "restore",
        "db_1",
        "--backup",
        "bkp_1",
        "--confirm",
        "db_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.restore",
      result: {
        projectId: "proj_1",
        database: { id: "db_1", status: "recovering" },
        source: { databaseId: "db_1", backupId: "bkp_1" },
      },
      nextActions: [
        {
          kind: "run-command",
          command: "prisma-cli postgres show db_1",
        },
      ],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "restore",
      "db_1",
      "--backup",
      "bkp_1",
      "--confirm",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 postgres remove", () => {
  it("removes the database", async () => {
    const calls: Call[] = [];
    const result = await makeCli(postgresClient({ calls })).run(
      ["postgres", "remove", "db_1", "--confirm", "db_1"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.path === "/v1/databases/{databaseId}",
      ),
    ).toBe(true);
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: "Removing database." },
      {
        kind: "fields",
        rows: [
          { label: "project", value: "Billing" },
          { label: "database", value: "acme-production" },
          { label: "id", value: "db_1" },
        ],
      },
      {
        kind: "list",
        items: ["Database and its connection metadata were removed."],
      },
    ]);
  });

  it("refuses to remove without consent in a non-interactive run", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "remove", "db_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to remove when --yes stands in for consent", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "remove", "db_1", "--yes", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("removes when the typed answer is the database id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "remove", "db_1"],
      {
        cwd: await pinnedCwd(),
        answers: ["db_1"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
  });

  it("fails when the typed answer is not the database id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "remove", "db_1", "--json"],
      {
        cwd: await pinnedCwd(),
        answers: ["nope"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_INVALID" },
    });
  });

  it("maps an unknown database to POSTGRES.NOT_FOUND", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "remove", "nope", "--confirm", "nope", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "POSTGRES.NOT_FOUND" },
    });
  });

  it("maps duplicate names to POSTGRES.AMBIGUOUS", async () => {
    const result = await makeCli(
      postgresClient({
        databases: [DB_ONE, { ...DB_TWO, name: "acme-production" }],
      }),
    ).run(
      [
        "postgres",
        "remove",
        "acme-production",
        "--confirm",
        "acme-production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "POSTGRES.AMBIGUOUS" },
    });
  });

  it("returns the pre-removal summary in json mode", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "remove", "db_1", "--confirm", "db_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.remove",
      result: {
        projectId: "proj_1",
        projectName: "Billing",
        database: { id: "db_1" },
      },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "remove",
      "db_1",
      "--confirm",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const BACKUP_BODY = {
  data: [
    {
      id: "bkp_1",
      backupType: "automatic",
      status: "available",
      size: 2048,
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    { id: "bkp_2" },
  ],
  meta: { backupRetentionDays: 7 },
  pagination: { hasMore: false },
};

describe("prisma-v8 postgres backup list", () => {
  it("lists the backups with sizes and retention", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases/{databaseId}/backups": () => ({
            data: BACKUP_BODY,
          }),
        },
      }),
    ).run(["postgres", "backup", "list", "db_1"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "database", value: "acme-production" },
        { label: "retention", value: "7 days" },
      ],
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toEqual({
      kind: "table",
      columns: ["Id", "Type", "Status", "Size", "Created"],
      rows: [
        [
          "bkp_1",
          "automatic",
          "available",
          "2.0 KiB",
          "2026-06-01T00:00:00.000Z",
        ],
        ["bkp_2", "unknown", "unknown", "unknown", "unknown"],
      ],
    });
  });

  it("renders an empty-state list block", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases/{databaseId}/backups": () => ({
            data: { data: [], meta: {}, pagination: { hasMore: false } },
          }),
        },
      }),
    ).run(["postgres", "backup", "list", "db_1"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No backups found."],
    });
  });

  it("says when more backups exist", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      postgresClient({
        calls,
        routes: {
          "GET /v1/databases/{databaseId}/backups": () => ({
            data: { ...BACKUP_BODY, pagination: { hasMore: true } },
          }),
        },
      }),
    ).run(["postgres", "backup", "list", "db_1", "--limit", "50"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(
      calls.find((call) => call.path === "/v1/databases/{databaseId}/backups")
        ?.init.params?.query,
    ).toEqual({ limit: 50 });
    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["More backups exist; raise --limit to see them."],
    });
  });

  it.each(["0", "101", "abc"])("rejects --limit %s", async (limit) => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "backup", "list", "db_1", "--limit", limit, "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Invalid backup limit",
        why: "--limit must be an integer between 1 and 100.",
        nextActions: [
          { kind: "user-choice", label: "Pass a --limit between 1 and 100." },
          {
            kind: "run-command",
            command: "prisma-cli postgres backup list <database> --limit 50",
          },
        ],
      },
    });
  });

  it("maps a 422 to POSTGRES.BACKUPS_UNSUPPORTED", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases/{databaseId}/backups": () => apiFailure(422),
        },
      }),
    ).run(["postgres", "backup", "list", "db_1", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.BACKUPS_UNSUPPORTED",
        summary: "Backups are not available for this database",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Use your own backup tooling for externally managed databases.",
          },
        ],
      },
    });
  });

  it("serializes the legacy backup-list envelope in json mode", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "GET /v1/databases/{databaseId}/backups": () => ({
            data: BACKUP_BODY,
          }),
        },
      }),
    ).run(["postgres", "backup", "list", "db_1", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.backup.list",
      result: {
        context: { project: "Billing", database: "acme-production" },
        items: [
          { name: "bkp_1", id: "bkp_1", status: null },
          { name: "bkp_2", id: "bkp_2", status: null },
        ],
        count: 2,
        retentionDays: 7,
        hasMore: false,
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "backup",
      "list",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 postgres connection list", () => {
  it("lists the connection metadata", async () => {
    const result = await makeCli(
      postgresClient({
        connections: [
          {
            id: "conn_1",
            name: "primary",
            databaseId: "db_1",
            createdAt: "2026-06-01T00:00:00.000Z",
          },
          { id: "conn_2" },
        ],
      }),
    ).run(["postgres", "connection", "list", "db_1"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toEqual({
      kind: "table",
      columns: ["Name", "Id", "Created"],
      rows: [
        ["primary", "conn_1", "2026-06-01T00:00:00.000Z"],
        ["conn_2", "conn_2", "unknown"],
      ],
    });
    expect(result.presented?.presentation.stdout).toEqual([
      "primary\tconn_1\t2026-06-01T00:00:00.000Z",
      "conn_2\tconn_2\tunknown",
    ]);
  });

  it("renders an empty-state list block", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "list", "db_1"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No database connections found."],
    });
  });

  it("maps an unknown database to POSTGRES.NOT_FOUND", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "list", "nope", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "POSTGRES.NOT_FOUND" },
    });
  });

  it("serializes the legacy connection-list envelope in json mode", async () => {
    const result = await makeCli(
      postgresClient({
        connections: [{ id: "conn_1", name: "primary", databaseId: "db_1" }],
      }),
    ).run(["postgres", "connection", "list", "db_1", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.connection.list",
      result: {
        context: { project: "Billing", database: "acme-production" },
        items: [{ name: "primary", id: "conn_1", status: null }],
        count: 1,
        projectId: "proj_1",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "connection",
      "list",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const CREATED_CONNECTION = {
  id: "conn_new",
  name: "readonly",
  databaseId: "db_1",
  endpoints: { pooled: { connectionString: "postgres://pooled/db" } },
};

describe("prisma-v8 postgres connection create", () => {
  it("names the connection after the CLI when --name is omitted", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      postgresClient({
        calls,
        routes: {
          "POST /v1/databases/{databaseId}/connections": () => ({
            data: { data: CREATED_CONNECTION },
          }),
        },
      }),
    ).run(["postgres", "connection", "create", "db_1"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    const body = calls.find(
      (call) => call.path === "/v1/databases/{databaseId}/connections",
    )?.init.body as { name: string };
    expect(body.name).toMatch(/^cli-\d{17}-[0-9a-f]{4}$/);
    expect(result.presented?.presentation.stdout).toEqual([
      "postgres://pooled/db",
    ]);
    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "ok",
      text: 'Added a connection to "acme-production" in Billing / main.',
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        {
          label: "connection URL",
          value: "postgres://pooled/db",
          sensitive: true,
        },
      ],
    });
  });

  it("uses an explicit --name", async () => {
    const calls: Call[] = [];
    await makeCli(
      postgresClient({
        calls,
        routes: {
          "POST /v1/databases/{databaseId}/connections": () => ({
            data: { data: CREATED_CONNECTION },
          }),
        },
      }),
    ).run(["postgres", "connection", "create", "db_1", "--name", "readonly"], {
      cwd: await pinnedCwd(),
    });

    expect(
      calls.find(
        (call) => call.path === "/v1/databases/{databaseId}/connections",
      )?.init.body,
    ).toEqual({ name: "readonly" });
  });

  it("maps a create response without a connection string", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{databaseId}/connections": () => ({
            data: { data: { id: "conn_new", name: "readonly" } },
          }),
        },
      }),
    ).run(["postgres", "connection", "create", "db_1", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.CONNECTION_STRING_MISSING",
        summary: "Created connection did not return a connection string",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Create another database connection and store the returned URL immediately.",
          },
          {
            kind: "run-command",
            command: "prisma-cli postgres connection create db_1",
          },
        ],
      },
    });
  });

  it("carries the connection string in the json envelope", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/databases/{databaseId}/connections": () => ({
            data: { data: CREATED_CONNECTION },
          }),
        },
      }),
    ).run(["postgres", "connection", "create", "db_1", "--json"], {
      cwd: await pinnedCwd(),
    });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.connection.create",
      result: {
        database: { id: "db_1" },
        connection: { id: "conn_new", name: "readonly" },
        connectionString: "postgres://pooled/db",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "connection",
      "create",
      "db_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const ROTATED_CONNECTION = {
  id: "conn_1",
  name: "primary",
  databaseId: "db_1",
  database: { id: "db_1", name: "acme-production" },
  connectionString: "postgres://rotated/db",
};

describe("prisma-v8 postgres connection rotate", () => {
  it("rotates the credentials and prints the new URL", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/connections/{id}/rotate": () => ({
            data: { data: ROTATED_CONNECTION },
          }),
        },
      }),
    ).run(
      ["postgres", "connection", "rotate", "conn_1", "--confirm", "conn_1"],
      {
        cwd: await pinnedCwd(),
        isTty: { stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.stdout).toEqual([
      "postgres://rotated/db",
    ]);
    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "ok",
      text: 'Rotated credentials for "acme-production". The previous credentials no longer work.',
    });
  });

  it("names the connection when the response has no database", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/connections/{id}/rotate": () => ({
            data: {
              data: {
                id: "conn_1",
                connectionString: "postgres://rotated/db",
              },
            },
          }),
        },
      }),
    ).run(
      ["postgres", "connection", "rotate", "conn_1", "--confirm", "conn_1"],
      {
        cwd: await pinnedCwd(),
        isTty: { stdout: true },
      },
    );

    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "ok",
      text: "Rotated credentials for connection conn_1. The previous credentials no longer work.",
    });
  });

  it("rejects a blank connection id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "rotate", "  ", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Connection id required",
        why: "Database connection rotation needs a connection id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the connection id to rotate." },
          {
            kind: "run-command",
            command:
              "prisma-cli postgres connection rotate <connection-id> --confirm <connection-id>",
          },
        ],
      },
    });
  });

  it("refuses to rotate without consent in a non-interactive run", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "rotate", "conn_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to rotate when --yes stands in for consent", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "rotate", "conn_1", "--yes", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("rotates when the typed answer is the connection id", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/connections/{id}/rotate": () => ({
            data: { data: ROTATED_CONNECTION },
          }),
        },
      }),
    ).run(["postgres", "connection", "rotate", "conn_1"], {
      cwd: await pinnedCwd(),
      answers: ["conn_1"],
      isTty: { stdin: true, stdout: true },
    });

    expect(result.exitCode).toBe(0);
  });

  it("fails when the typed answer is not the connection id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "rotate", "conn_1", "--json"],
      {
        cwd: await pinnedCwd(),
        answers: ["nope"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_INVALID" },
    });
  });

  it("maps a rotate response without a connection string", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/connections/{id}/rotate": () => ({
            data: { data: { id: "conn_1" } },
          }),
        },
      }),
    ).run(
      [
        "postgres",
        "connection",
        "rotate",
        "conn_1",
        "--confirm",
        "conn_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.CONNECTION_STRING_MISSING",
        summary: "Rotated connection did not return a connection string",
        why: "Rotated connection strings are one-time-view secrets, but the Management API did not include one in this rotate response.",
      },
    });
  });

  it("passes an unknown connection through as an API error", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/connections/{id}/rotate": () =>
            apiFailure(404, {
              error: { code: "notFound", message: "Connection not found." },
            }),
        },
      }),
    ).run(
      [
        "postgres",
        "connection",
        "rotate",
        "conn_1",
        "--confirm",
        "conn_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.notFound",
        summary: "Failed to rotate database connection",
        why: "Connection not found.",
      },
    });
  });

  it("returns the rotate result unchanged in json mode", async () => {
    const result = await makeCli(
      postgresClient({
        routes: {
          "POST /v1/connections/{id}/rotate": () => ({
            data: { data: ROTATED_CONNECTION },
          }),
        },
      }),
    ).run(
      [
        "postgres",
        "connection",
        "rotate",
        "conn_1",
        "--confirm",
        "conn_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.connection.rotate",
      result: {
        connection: { id: "conn_1", name: "primary" },
        database: { id: "db_1", name: "acme-production" },
        connectionString: "postgres://rotated/db",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "connection",
      "rotate",
      "conn_1",
      "--confirm",
      "conn_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 postgres connection remove", () => {
  it("removes the connection", async () => {
    const calls: Call[] = [];
    const result = await makeCli(postgresClient({ calls })).run(
      ["postgres", "connection", "remove", "conn_1", "--confirm", "conn_1"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" && call.path === "/v1/connections/{id}",
      ),
    ).toBe(true);
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: "Removing database connection." },
      {
        kind: "fields",
        rows: [{ label: "connection", value: "conn_1" }],
      },
      {
        kind: "list",
        items: [
          "The connection metadata was removed. Existing one-time secrets were not shown.",
        ],
      },
    ]);
  });

  it("rejects a blank connection id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "remove", "  ", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "POSTGRES.USAGE_ERROR",
        summary: "Connection id required",
        why: "Database connection removal needs a connection id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the connection id to remove." },
          {
            kind: "run-command",
            command:
              "prisma-cli postgres connection remove <connection-id> --confirm <connection-id>",
          },
        ],
      },
    });
  });

  it("refuses to remove without consent in a non-interactive run", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "remove", "conn_1", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to remove when --yes stands in for consent", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "remove", "conn_1", "--yes", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("removes when the typed answer is the connection id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "remove", "conn_1"],
      {
        cwd: await pinnedCwd(),
        answers: ["conn_1"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
  });

  it("fails when the typed answer is not the connection id", async () => {
    const result = await makeCli(postgresClient()).run(
      ["postgres", "connection", "remove", "conn_1", "--json"],
      {
        cwd: await pinnedCwd(),
        answers: ["nope"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_INVALID" },
    });
  });

  it("returns the removed connection in json mode", async () => {
    const result = await makeCli(postgresClient()).run(
      [
        "postgres",
        "connection",
        "remove",
        "conn_1",
        "--confirm",
        "conn_1",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "postgres.connection.remove",
      result: { connection: { id: "conn_1" } },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(postgresClient(), false).run([
      "postgres",
      "connection",
      "remove",
      "conn_1",
      "--confirm",
      "conn_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});
