import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { bucketCreateCommand } from "../src/v8/bucket/create";
import { bucketDeleteCommand } from "../src/v8/bucket/delete";
import { bucketKeyCreateCommand } from "../src/v8/bucket/key-create";
import { bucketKeyDeleteCommand } from "../src/v8/bucket/key-delete";
import { bucketKeyListCommand } from "../src/v8/bucket/key-list";
import { bucketListCommand } from "../src/v8/bucket/list";

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

const BUCKET_ONE = {
  id: "bkt_1",
  name: "assets",
  status: "ready",
  branchId: "main",
  createdAt: "2026-06-01T00:00:00.000Z",
};

const BUCKET_TWO = {
  id: "bkt_2",
  name: "uploads",
  status: "creating",
  branchId: null,
  createdAt: "2026-06-02T00:00:00.000Z",
};

const KEY_ONE = {
  id: "bkey_1",
  name: "ci-key",
  role: "read_write" as const,
  valueHint: "AKIA…9Z",
  createdAt: "2026-06-03T00:00:00.000Z",
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

interface BucketClientSpec {
  readonly buckets?: unknown[];
  readonly keys?: unknown[];
  readonly projects?: unknown[];
  readonly calls?: Call[];
  readonly routes?: Readonly<Record<string, Responder>>;
}

function apiFailure(status: number, body?: unknown) {
  return {
    error: body ?? { error: { message: "boom" } },
    response: new Response(null, { status }),
  };
}

function bucketClient(spec: BucketClientSpec = {}): ManagementApiClient {
  const page = { hasMore: false, nextCursor: null };

  const dispatch = (method: string, apiPath: string, init: Call["init"]) => {
    const call: Call = { method, path: apiPath, init: init ?? {} };
    spec.calls?.push(call);
    const route = spec.routes?.[`${method} ${apiPath}`];
    if (route) {
      return route(call);
    }

    if (method === "GET" && apiPath === "/v1/projects") {
      return { data: { data: spec.projects ?? PROJECTS } };
    }
    if (method === "GET" && apiPath === "/v1/buckets") {
      return {
        data: {
          data: spec.buckets ?? [BUCKET_ONE, BUCKET_TWO],
          pagination: page,
        },
      };
    }
    if (method === "GET" && apiPath === "/v1/buckets/{bucketId}/keys") {
      return { data: { data: spec.keys ?? [KEY_ONE], pagination: page } };
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
      "bucket list": bucketListCommand,
      "bucket create": bucketCreateCommand,
      "bucket delete": bucketDeleteCommand,
      "bucket key list": bucketKeyListCommand,
      "bucket key create": bucketKeyCreateCommand,
      "bucket key delete": bucketKeyDeleteCommand,
    },
    groups: {
      bucket: { brief: "Manage object-store buckets for a project" },
      "bucket key": { brief: "Manage access keys for an object-store bucket" },
    },
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

/** `bucket list` and `bucket create` resolve the project from the local
 *  pin, so their runs need a pinned directory. */
async function pinnedCwd() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "v8-bucket-test-"));
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma", "local.json"),
    `${JSON.stringify({ workspaceId: "ws_1", projectId: "proj_1" }, null, 2)}\n`,
    "utf8",
  );
  return cwd;
}

function unpinnedCwd() {
  return mkdtemp(path.join(os.tmpdir(), "v8-bucket-unpinned-"));
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

describe("prisma-v8 bucket list", () => {
  it("lists the project's buckets", async () => {
    const result = await makeCli(bucketClient()).run(["bucket", "list"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "info",
        text: "Listing object-store buckets for the resolved project.",
      },
      { kind: "fields", rows: [{ label: "project", value: "Billing" }] },
      {
        kind: "table",
        columns: ["Name", "Id", "Status", "Branch", "Created"],
        rows: [
          ["assets", "bkt_1", "ready", "main", "2026-06-01T00:00:00.000Z"],
          [
            "uploads",
            "bkt_2",
            "creating",
            "unscoped",
            "2026-06-02T00:00:00.000Z",
          ],
        ],
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "assets\tbkt_1\tready\tmain\t2026-06-01T00:00:00.000Z",
      "uploads\tbkt_2\tcreating\tunscoped\t2026-06-02T00:00:00.000Z",
    ]);
  });

  it("renders an empty-state list block", async () => {
    const result = await makeCli(bucketClient({ buckets: [] })).run(
      ["bucket", "list"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No buckets found."],
    });
    expect(result.presented?.presentation.stdout).toEqual([]);
  });

  it("passes --branch through to the list query", async () => {
    const calls: Call[] = [];
    const result = await makeCli(bucketClient({ calls })).run(
      ["bucket", "list", "--branch", "preview"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.find((call) => call.path === "/v1/buckets")?.init.params?.query,
    ).toMatchObject({ projectId: "proj_1", branchGitName: "preview" });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "project", value: "Billing" },
        { label: "branch", value: "preview" },
      ],
    });
  });

  it("maps an unbound directory to PROJECT.SETUP_REQUIRED", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "list", "--json"],
      { cwd: await unpinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.SETUP_REQUIRED",
        summary: "Choose a Project before running this command",
        why: "This directory is not linked to a Prisma Project, and prisma-cli bucket list will not choose one from package or directory names.",
      },
    });
  });

  it("serializes the legacy list envelope in json mode", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "list", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "bucket.list",
      result: {
        context: { project: "Billing" },
        items: [
          { name: "assets", id: "bkt_1", status: "ready" },
          { name: "uploads", id: "bkt_2", status: "creating" },
        ],
        count: 2,
        projectId: "proj_1",
        branchName: null,
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(bucketClient(), false).run(["bucket", "list"]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 bucket create", () => {
  it("creates a named bucket", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      bucketClient({
        calls,
        routes: { "POST /v1/buckets": () => ({ data: { data: BUCKET_ONE } }) },
      }),
    ).run(["bucket", "create", "--name", "assets", "--branch", "main"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      calls.find(
        (call) => call.method === "POST" && call.path === "/v1/buckets",
      )?.init.body,
    ).toEqual({
      projectId: "proj_1",
      name: "assets",
      branchGitName: "main",
    });
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: 'Created bucket "assets" in Billing / main.',
      },
    ]);
  });

  it("lets the server name the bucket when --name is blank", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      bucketClient({
        calls,
        routes: { "POST /v1/buckets": () => ({ data: { data: BUCKET_TWO } }) },
      }),
    ).run(["bucket", "create", "--name", "   "], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      calls.find(
        (call) => call.method === "POST" && call.path === "/v1/buckets",
      )?.init.body,
    ).toEqual({ projectId: "proj_1" });
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: 'Created bucket "uploads" in Billing.',
      },
    ]);
  });

  it("maps an API failure to the passthrough code", async () => {
    const result = await makeCli(
      bucketClient({
        routes: {
          "POST /v1/buckets": () =>
            apiFailure(500, {
              error: { code: "internalError", message: "Backend exploded." },
            }),
        },
      }),
    ).run(["bucket", "create", "--json"], { cwd: await pinnedCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.internalError",
        summary: "Failed to create bucket",
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

  it("returns the create result in json mode", async () => {
    const result = await makeCli(
      bucketClient({
        routes: { "POST /v1/buckets": () => ({ data: { data: BUCKET_ONE } }) },
      }),
    ).run(["bucket", "create", "--json"], { cwd: await pinnedCwd() });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "bucket.create",
      result: {
        projectId: "proj_1",
        projectName: "Billing",
        bucket: { id: "bkt_1", name: "assets" },
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(bucketClient(), false).run([
      "bucket",
      "create",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 bucket delete", () => {
  it("deletes the bucket", async () => {
    const calls: Call[] = [];
    const result = await makeCli(bucketClient({ calls })).run(
      ["bucket", "delete", "bkt_1", "--confirm", "bkt_1"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" && call.path === "/v1/buckets/{bucketId}",
      ),
    ).toBe(true);
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: "Deleting object-store bucket." },
      { kind: "fields", rows: [{ label: "bucket", value: "bkt_1" }] },
      {
        kind: "list",
        items: ["Bucket and all its access keys were removed."],
      },
    ]);
  });

  it("rejects a blank bucket id", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "   ", "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.USAGE_ERROR",
        summary: "Bucket id required",
        why: "Bucket deletion needs a bucket id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the bucket id to delete." },
          { kind: "run-command", command: "prisma-cli bucket list" },
        ],
      },
    });
  });

  it("refuses to delete without consent in a non-interactive run", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "bkt_1", "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to delete when --yes stands in for consent", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "bkt_1", "--yes", "--json"],
      {},
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("deletes when the typed answer is the bucket id", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "bkt_1"],
      { answers: ["bkt_1"], isTty: { stdin: true, stdout: true } },
    );

    expect(result.exitCode).toBe(0);
  });

  it("fails when the typed answer is not the bucket id", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "bkt_1", "--json"],
      { answers: ["bkt_2"], isTty: { stdin: true, stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_INVALID" },
    });
  });

  it("exits 3 when the consent prompt is cancelled", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "bkt_1", "--json"],
      { stdin: "", isTty: { stdin: true, stdout: true } },
    );

    expect(result.exitCode).toBe(3);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_CANCELLED" },
    });
  });

  it("maps an API failure to the passthrough code", async () => {
    const result = await makeCli(
      bucketClient({
        routes: {
          "DELETE /v1/buckets/{bucketId}": () =>
            apiFailure(404, { error: { code: "notFound" } }),
        },
      }),
    ).run(["bucket", "delete", "bkt_1", "--confirm", "bkt_1", "--json"], {});

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "BUCKET.notFound", summary: "Failed to delete bucket" },
    });
  });

  it("returns the deleted bucket id in json mode", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "delete", "bkt_1", "--confirm", "bkt_1", "--json"],
      {},
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "bucket.delete",
      result: { bucket: { id: "bkt_1" } },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(bucketClient(), false).run([
      "bucket",
      "delete",
      "bkt_1",
      "--confirm",
      "bkt_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 bucket key list", () => {
  it("lists the bucket's access keys", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "key", "list", "bkt_1"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "info",
        text: "Listing access keys for bucket.",
      },
      { kind: "fields", rows: [{ label: "bucket", value: "bkt_1" }] },
      {
        kind: "table",
        columns: ["Name", "Id", "Role", "Hint", "Created"],
        rows: [
          [
            "ci-key",
            "bkey_1",
            "read_write",
            "AKIA…9Z",
            "2026-06-03T00:00:00.000Z",
          ],
        ],
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "ci-key\tbkey_1\tread_write\tAKIA…9Z\t2026-06-03T00:00:00.000Z",
    ]);
  });

  it("renders an empty-state list block", async () => {
    const result = await makeCli(bucketClient({ keys: [] })).run(
      ["bucket", "key", "list", "bkt_1"],
      { isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No keys found."],
    });
  });

  it("rejects a blank bucket id", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "key", "list", "  ", "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.USAGE_ERROR",
        summary: "Bucket id required",
        why: "Bucket key listing needs a bucket id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the bucket id." },
          { kind: "run-command", command: "prisma-cli bucket list" },
        ],
      },
    });
  });

  it("serializes the legacy key-list envelope in json mode", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "key", "list", "bkt_1", "--json"],
      {},
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "bucket.key.list",
      result: {
        context: { bucket: "bkt_1" },
        items: [{ name: "ci-key", id: "bkey_1", status: null }],
        count: 1,
        bucketId: "bkt_1",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(bucketClient(), false).run([
      "bucket",
      "key",
      "list",
      "bkt_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

const CREATED_KEY = {
  ...KEY_ONE,
  secretAccessKey: "s3cr3t",
  accessKeyId: "AKIAEXAMPLE",
  endpoint: "https://s3.prisma.io",
  bucketName: "assets",
};

describe("prisma-v8 bucket key create", () => {
  it("prints the credentials on stdout and masks the secrets in the card", async () => {
    const result = await makeCli(
      bucketClient({
        routes: {
          "POST /v1/buckets/{bucketId}/keys": () => ({
            data: { data: CREATED_KEY },
          }),
        },
      }),
    ).run(["bucket", "key", "create", "bkt_1", "--name", "ci-key"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.stdout).toEqual([
      "S3_ENDPOINT=https://s3.prisma.io",
      "S3_ACCESS_KEY_ID=AKIAEXAMPLE",
      "S3_SECRET_ACCESS_KEY=s3cr3t",
      "S3_BUCKET=assets",
    ]);
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "ok",
        text: 'Created key "ci-key" for bucket "assets".',
      },
      {
        kind: "list",
        items: [
          "The credentials below are shown once — copy them now.",
          "Set these environment variables to use this bucket:",
        ],
      },
      {
        kind: "fields",
        rows: [
          { label: "S3_ENDPOINT", value: "https://s3.prisma.io" },
          {
            label: "S3_ACCESS_KEY_ID",
            value: "AKIAEXAMPLE",
            sensitive: true,
          },
          { label: "S3_SECRET_ACCESS_KEY", value: "s3cr3t", sensitive: true },
          { label: "S3_BUCKET", value: "assets" },
        ],
      },
    ]);
  });

  it("sends read_write when --role is omitted", async () => {
    const calls: Call[] = [];
    const result = await makeCli(
      bucketClient({
        calls,
        routes: {
          "POST /v1/buckets/{bucketId}/keys": () => ({
            data: { data: CREATED_KEY },
          }),
        },
      }),
    ).run(["bucket", "key", "create", "bkt_1"], {});

    expect(result.exitCode).toBe(0);
    expect(
      calls.find((call) => call.path === "/v1/buckets/{bucketId}/keys")?.init
        .body,
    ).toEqual({ role: "read_write" });
  });

  it("rejects a blank bucket id", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "key", "create", " ", "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.USAGE_ERROR",
        summary: "Bucket id required",
        why: "Bucket key creation needs a bucket id.",
      },
    });
  });

  it("maps a credential-less create response to BUCKET.KEY_SECRET_MISSING", async () => {
    const result = await makeCli(
      bucketClient({
        routes: {
          "POST /v1/buckets/{bucketId}/keys": () => ({
            data: { data: KEY_ONE },
          }),
        },
      }),
    ).run(["bucket", "key", "create", "bkt_1", "--json"], {});

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.KEY_SECRET_MISSING",
        summary: "Created bucket key did not return credentials",
        why: "Bucket key credentials are one-time-view secrets, but the Management API did not include them in this create response.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Create another bucket key and store the returned credentials immediately.",
          },
          {
            kind: "run-command",
            command: "prisma-cli bucket key create bkt_1",
          },
        ],
      },
    });
  });

  it("carries the credentials in the json envelope", async () => {
    const result = await makeCli(
      bucketClient({
        routes: {
          "POST /v1/buckets/{bucketId}/keys": () => ({
            data: { data: CREATED_KEY },
          }),
        },
      }),
    ).run(["bucket", "key", "create", "bkt_1", "--json"], {});

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "bucket.key.create",
      result: {
        bucketId: "bkt_1",
        key: { id: "bkey_1", name: "ci-key" },
        secretAccessKey: "s3cr3t",
        accessKeyId: "AKIAEXAMPLE",
        endpoint: "https://s3.prisma.io",
        bucketName: "assets",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(bucketClient(), false).run([
      "bucket",
      "key",
      "create",
      "bkt_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 bucket key delete", () => {
  it("deletes the access key", async () => {
    const calls: Call[] = [];
    const result = await makeCli(bucketClient({ calls })).run(
      ["bucket", "key", "delete", "bkt_1", "bkey_1"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.path === "/v1/buckets/{bucketId}/keys/{keyId}",
      ),
    ).toBe(true);
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: "Deleting bucket access key." },
      { kind: "fields", rows: [{ label: "key", value: "bkey_1" }] },
      { kind: "list", items: ["The access key was revoked and removed."] },
    ]);
  });

  it.each([
    ["  ", "bkey_1"],
    ["bkt_1", "  "],
  ])("rejects a blank id pair (%s, %s)", async (bucketId, keyId) => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "key", "delete", bucketId, keyId, "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.USAGE_ERROR",
        summary: "Bucket id and key id required",
        why: "Bucket key deletion needs both a bucket id and a key id.",
        nextActions: [
          { kind: "user-choice", label: "Pass the bucket id and key id." },
          {
            kind: "run-command",
            command: "prisma-cli bucket key list <bucketId>",
          },
        ],
      },
    });
  });

  it("maps an API failure to the passthrough code", async () => {
    const result = await makeCli(
      bucketClient({
        routes: {
          "DELETE /v1/buckets/{bucketId}/keys/{keyId}": () =>
            apiFailure(404, { error: { code: "notFound" } }),
        },
      }),
    ).run(["bucket", "key", "delete", "bkt_1", "bkey_1", "--json"], {});

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "BUCKET.notFound",
        summary: "Failed to delete bucket key",
      },
    });
  });

  it("returns the deleted key id in json mode", async () => {
    const result = await makeCli(bucketClient()).run(
      ["bucket", "key", "delete", "bkt_1", "bkey_1", "--json"],
      {},
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "bucket.key.delete",
      result: { key: { id: "bkey_1" } },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(bucketClient(), false).run([
      "bucket",
      "key",
      "delete",
      "bkt_1",
      "bkey_1",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});
