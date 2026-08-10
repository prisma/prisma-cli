import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import { createTestCli } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import type { AuthStateResult } from "../src/types/auth";
import { projectCreateCommand } from "../src/v8/project/create";
import { projectLinkCommand } from "../src/v8/project/link";
import { projectListCommand } from "../src/v8/project/list";
import { projectRenameCommand } from "../src/v8/project/rename";
import { projectShowCommand } from "../src/v8/project/show";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

const SIGNED_IN: AuthStateResult = {
  authenticated: true,
  provider: null,
  user: { id: "usr_1", email: "bob@example.com", name: "Bob" },
  workspace: { id: "ws_1", name: "Acme Inc" },
  credential: { type: "oauth", id: null, name: null },
};

const NO_WORKSPACE: AuthStateResult = { ...SIGNED_IN, workspace: null };

const API_PROJECTS = [
  {
    id: "proj_1",
    name: "Billing",
    defaultRegion: "us-east-1",
    workspace: { id: "ws_1", name: "Acme Inc" },
  },
  {
    id: "proj_2",
    name: "Storefront",
    defaultRegion: null,
    workspace: { id: "ws_1", name: "Acme Inc" },
  },
  {
    id: "proj_9",
    name: "Other workspace",
    defaultRegion: null,
    workspace: { id: "ws_other", name: "Globex" },
  },
];

interface FakeClientSpec {
  projects?: unknown[];
  post?: (path: string, init: unknown) => unknown;
  patch?: (path: string, init: unknown) => unknown;
}

function fakeClient(spec: FakeClientSpec = {}): ManagementApiClient {
  return {
    GET: async (_path: string) => ({
      data: { data: spec.projects ?? API_PROJECTS },
    }),
    POST: async (apiPath: string, init: unknown) =>
      spec.post ? spec.post(apiPath, init) : { data: { data: {} } },
    PATCH: async (apiPath: string, init: unknown) =>
      spec.patch ? spec.patch(apiPath, init) : { data: { data: {} } },
    DELETE: async () => ({ data: { data: {} } }),
  } as unknown as ManagementApiClient;
}

function makeCli(client: ManagementApiClient, signedIn = true) {
  return createTestCli({
    commands: {
      "project list": projectListCommand,
      "project show": projectShowCommand,
      "project create": projectCreateCommand,
      "project link": projectLinkCommand,
      "project rename": projectRenameCommand,
    },
    groups: { project: { brief: "Manage and inspect your Prisma projects" } },
    ...(signedIn ? { credentials: { token: "tok_1" } } : {}),
    managementApi: { client },
    now: () => new Date(0),
  });
}

async function tempCwd(pin?: { workspaceId: string; projectId: string }) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "v8-project-test-"));
  if (pin) {
    await mkdir(path.join(cwd, ".prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, ".prisma", "local.json"),
      `${JSON.stringify(pin, null, 2)}\n`,
      "utf8",
    );
  }
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

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
});

describe("prisma-v8 project list", () => {
  it("lists the workspace projects and reports the linked binding", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(["project", "list"], {
      cwd,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      workspace: { id: "ws_1", name: "Acme Inc" },
      localBinding: { status: "linked" },
      projects: [
        { id: "proj_1", name: "Billing", defaultRegion: "us-east-1" },
        { id: "proj_2", name: "Storefront" },
      ],
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toEqual({
      kind: "table",
      columns: ["name", "id", "region"],
      rows: [
        ["Billing", "proj_1", "us-east-1"],
        ["Storefront", "proj_2", "none"],
      ],
    });
    expect(result.presented?.presentation.stdout).toEqual([
      "Billing\tproj_1\tus-east-1",
      "Storefront\tproj_2\tnone",
    ]);
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it("suggests project setup when the directory is not linked", async () => {
    const cwd = await tempCwd();
    const result = await makeCli(fakeClient()).run(["project", "list"], {
      cwd,
    });

    expect(result.presented?.data).toMatchObject({
      localBinding: { status: "not-linked" },
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "user-choice",
        label:
          "Ask the user whether to link an existing Project or create a new one",
        commands: [
          "prisma-cli project list",
          "prisma-cli project link <id-or-name>",
        ],
        reason:
          "This directory is not linked to a Prisma Project. Project list shows available Projects, but none is selected for this directory.",
      },
      {
        kind: "run-command",
        label: "Link the chosen Project",
        command: "prisma-cli project link <id-or-name>",
        reason:
          "Linking writes the durable local Project binding for this directory.",
      },
      {
        kind: "run-command",
        label: "Create and link a new Project",
        command: "prisma-cli project create <name>",
        reason:
          "Use this when the user wants a new Prisma Project instead of an existing one.",
      },
    ]);
  });

  it("reports an invalid binding when the pin names another workspace", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_other", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(["project", "list"], {
      cwd,
    });

    expect(result.presented?.data).toMatchObject({
      localBinding: { status: "invalid" },
    });
    expect(result.presented?.presentation.next?.[0]?.reason).toBe(
      "This directory has an invalid local Project binding. Ask the user which Prisma Project to link before running Project-scoped commands.",
    );
  });

  it("renders an empty-state list block when the workspace has no projects", async () => {
    const cwd = await tempCwd();
    const result = await makeCli(fakeClient({ projects: [] })).run(
      ["project", "list"],
      { cwd, isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No projects found."],
    });
    expect(result.presented?.presentation.stdout).toEqual([]);
  });

  it("serializes the legacy list envelope in json mode", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(
      ["project", "list", "--json"],
      { cwd },
    );

    const frame = resultFrame(result.json);
    expect(frame.envelope).toMatchObject({
      ok: true,
      commandId: "project.list",
      result: {
        context: { workspace: "Acme Inc" },
        items: [
          { name: "Billing", id: "proj_1", status: null },
          { name: "Storefront", id: "proj_2", status: null },
        ],
        count: 2,
        localBinding: { status: "linked" },
      },
      nextActions: [],
    });
    expect(result.exitCode).toBe(0);
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run(["project", "list"]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project show", () => {
  it("shows the bound project for a pinned directory", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(["project", "show"], {
      cwd,
      env: { HOME: "/nowhere" },
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      workspace: { id: "ws_1" },
      project: { id: "proj_1", name: "Billing" },
      resolution: { projectSource: "local-pin" },
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toMatchObject({
      rows: [
        { label: "local repo", value: cwd },
        { label: "platform", value: "Acme Inc / Billing" },
        { label: "region", value: "us-east-1" },
      ],
    });
  });

  it("treats an unlinked directory as a success with setup next actions", async () => {
    const cwd = await tempCwd();
    const result = await makeCli(fakeClient()).run(["project", "show"], {
      cwd,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: null,
      localBinding: { status: "not-linked" },
      resolution: { projectSource: "unbound" },
    });
    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "warn",
      text: "This directory is not linked to a Prisma Project.",
    });
    expect(result.presented?.presentation.next?.at(-1)).toEqual({
      kind: "run-command",
      label: "Retry with an explicit Project",
      command: "prisma-cli project show --project <id-or-name>",
    });
  });

  it("maps an unknown --project to PROJECT.NOT_FOUND", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "show", "--project", "nope", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.NOT_FOUND",
        summary: "Project not found",
        why: 'The project "nope" does not exist in workspace "Acme Inc" or is not accessible.',
      },
    });
  });

  it("maps duplicate project names to PROJECT.AMBIGUOUS with the matches", async () => {
    const duplicates = [
      { ...API_PROJECTS[0], id: "proj_a", name: "Billing" },
      { ...API_PROJECTS[0], id: "proj_b", name: "Billing" },
    ];
    const result = await makeCli(fakeClient({ projects: duplicates })).run(
      ["project", "show", "--project", "Billing", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.AMBIGUOUS",
        summary: "Project resolution is ambiguous",
        meta: {
          matches: [
            { id: "proj_a", name: "Billing" },
            { id: "proj_b", name: "Billing" },
          ],
        },
      },
    });
  });

  it("maps a pin pointing at a removed project to PROJECT.LOCAL_STATE_STALE", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_gone" });
    const result = await makeCli(fakeClient()).run(
      ["project", "show", "--json"],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.LOCAL_STATE_STALE",
        summary: "Local project binding is stale",
        meta: { pinPath: ".prisma/local.json" },
      },
    });
  });

  it("maps a pin from another workspace to PROJECT.LOCAL_WORKSPACE_MISMATCH", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_other", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(
      ["project", "show", "--json"],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.LOCAL_WORKSPACE_MISMATCH",
        summary: "Project link uses another workspace",
        meta: {
          pinnedWorkspaceId: "ws_other",
          pinnedProjectId: "proj_1",
          activeWorkspaceId: "ws_1",
        },
      },
    });
  });

  it("returns the show result unchanged in json mode", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_2" });
    const result = await makeCli(fakeClient()).run(
      ["project", "show", "--json"],
      { cwd },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.show",
      result: {
        workspace: { id: "ws_1", name: "Acme Inc" },
        project: { id: "proj_2", name: "Storefront" },
        resolution: { projectSource: "local-pin", targetName: "Storefront" },
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run(["project", "show"]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project create", () => {
  it("creates the project, writes the pin and ignores it in git", async () => {
    const cwd = await tempCwd();
    const created = {
      id: "proj_new",
      name: "my-app",
      defaultRegion: "us-east-1",
    };
    const result = await makeCli(
      fakeClient({ post: () => ({ data: { data: created } }) }),
    ).run(["project", "create", "my-app"], { cwd, isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_new", name: "my-app" },
      localPin: { path: ".prisma/local.json", written: true },
      action: "created",
    });
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: 'Created Project "my-app"' },
      {
        kind: "summary",
        tone: "ok",
        text: `Linked "./${path.basename(cwd)}" to Project "my-app"`,
      },
      { kind: "summary", tone: "info", text: "Saved .prisma/local.json" },
    ]);
    expect(
      JSON.parse(
        await readFile(path.join(cwd, ".prisma", "local.json"), "utf8"),
      ),
    ).toEqual({ workspaceId: "ws_1", projectId: "proj_new" });
    expect(await readFile(path.join(cwd, ".gitignore"), "utf8")).toContain(
      ".prisma/",
    );
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "prisma-cli app deploy",
        command: "prisma-cli app deploy",
      },
    ]);
  });

  it("rejects a whitespace-only name as a usage error", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "create", "   ", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "Project create requires a name",
        why: "The project name must be a non-empty value.",
      },
    });
  });

  it("maps a rejected create to PROJECT.CREATE_FAILED with the permission fix", async () => {
    const result = await makeCli(
      fakeClient({
        post: () => ({
          error: { error: { message: "Forbidden (HTTP 403)" } },
          response: new Response(null, { status: 403 }),
        }),
      }),
    ).run(["project", "create", "my-app", "--json"], { cwd: await tempCwd() });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.CREATE_FAILED",
        summary: 'Could not create Project "my-app"',
        why: 'The platform rejected the Project create in workspace "Acme Inc" (HTTP 403).',
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Grant the token permission to create Projects in this workspace, or link an existing Project.",
          },
          {
            kind: "run-command",
            label: "prisma-cli project list",
            command: "prisma-cli project list",
          },
          {
            kind: "run-command",
            label: "prisma-cli project link <id-or-name>",
            command: "prisma-cli project link <id-or-name>",
          },
        ],
      },
    });
  });

  it("maps an unwritable pin location to PROJECT.LOCAL_STATE_WRITE_FAILED", async () => {
    const cwd = await tempCwd();
    await writeFile(path.join(cwd, ".prisma"), "not a directory", "utf8");
    const result = await makeCli(
      fakeClient({
        post: () => ({ data: { data: { id: "proj_new", name: "my-app" } } }),
      }),
    ).run(["project", "create", "my-app", "--json"], { cwd });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.LOCAL_STATE_WRITE_FAILED",
        summary: "Could not save local Project binding",
        meta: { pinPath: ".prisma/local.json" },
      },
    });
  });

  it("serializes the setup result in json mode", async () => {
    const cwd = await tempCwd();
    const result = await makeCli(
      fakeClient({
        post: () => ({ data: { data: { id: "proj_new", name: "my-app" } } }),
      }),
    ).run(["project", "create", "my-app", "--json"], { cwd });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.create",
      result: {
        workspace: { id: "ws_1", name: "Acme Inc" },
        project: { id: "proj_new", name: "my-app" },
        localPin: { path: ".prisma/local.json", written: true },
        action: "created",
      },
      nextActions: [
        {
          kind: "run-command",
          label: "prisma-cli app deploy",
          command: "prisma-cli app deploy",
        },
      ],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run([
      "project",
      "create",
      "my-app",
    ]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project link", () => {
  it("links the directory to the project named by the positional", async () => {
    const cwd = await tempCwd();
    const result = await makeCli(fakeClient()).run(
      ["project", "link", "Storefront"],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_2", name: "Storefront" },
      action: "linked",
    });
    expect(blocks(result.presented)).toHaveLength(2);
    expect(
      JSON.parse(
        await readFile(path.join(cwd, ".prisma", "local.json"), "utf8"),
      ),
    ).toEqual({ workspaceId: "ws_1", projectId: "proj_2" });
  });

  it("maps an ambiguous positional to PROJECT.AMBIGUOUS", async () => {
    const duplicates = [
      { ...API_PROJECTS[0], id: "proj_a", name: "Billing" },
      { ...API_PROJECTS[0], id: "proj_b", name: "Billing" },
    ];
    const result = await makeCli(fakeClient({ projects: duplicates })).run(
      ["project", "link", "Billing", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "PROJECT.AMBIGUOUS" },
    });
  });

  it("maps an unknown positional to PROJECT.NOT_FOUND", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "link", "nope", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "PROJECT.NOT_FOUND" },
    });
  });

  it("links the project chosen in the picker", async () => {
    const cwd = await tempCwd();
    const result = await makeCli(fakeClient()).run(["project", "link"], {
      cwd,
      answers: ["proj_2"],
      isTty: { stdin: true, stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_2", name: "Storefront" },
      action: "linked",
    });
  });

  it("creates a project from the picker, defaulting the name to the directory", async () => {
    const cwd = await tempCwd();
    const seen: unknown[] = [];
    const result = await makeCli(
      fakeClient({
        post: (_path, init) => {
          seen.push(init);
          return {
            data: { data: { id: "proj_new", name: path.basename(cwd) } },
          };
        },
      }),
    ).run(["project", "link"], {
      cwd,
      answers: ["__create__", ""],
      isTty: { stdin: true, stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(seen).toMatchObject([{ body: { name: path.basename(cwd) } }]);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_new" },
      action: "created",
    });
  });

  it("maps a cancelled picker to the setup-canceled usage error", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "link", "--json"],
      {
        cwd: await tempCwd(),
        answers: ["__cancel__"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "Project setup canceled",
        why: "Project link needs a Project before it can continue.",
      },
    });
  });

  it("fails structurally when the picker cannot run", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "link", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.PROMPT_REQUIRED" },
    });
  });

  it("serializes the setup result in json mode", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "link", "proj_1", "--json"],
      { cwd: await tempCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.link",
      result: { project: { id: "proj_1" }, action: "linked" },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run(["project", "link"]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project rename", () => {
  it("renames the pinned project", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(
      fakeClient({
        patch: () => ({
          data: { data: { id: "proj_1", name: "Billing v2" } },
          response: { status: 200 } as Response,
        }),
      }),
    ).run(["project", "rename", "Billing v2"], {
      cwd,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_1", name: "Billing v2" },
      previousName: "Billing",
    });
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: "Renaming project." },
      {
        kind: "fields",
        rows: [
          { label: "workspace", value: "Acme Inc" },
          { label: "project", value: "Billing" },
          { label: "id", value: "proj_1" },
        ],
      },
      {
        kind: "list",
        items: [
          'The project is now named "Billing v2". Directory bindings pin the project id, so they stay valid.',
        ],
      },
    ]);
  });

  it("maps a rejected name to PROJECT.RENAME_FAILED", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(
      fakeClient({
        patch: () => ({
          error: {
            error: {
              message: "Name already taken",
              hint: "Pick another name.",
            },
          },
          response: { status: 422 } as Response,
        }),
      }),
    ).run(["project", "rename", "Storefront", "--json"], { cwd });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.RENAME_FAILED",
        summary: "Project rename failed",
        why: "Name already taken",
        nextActions: [{ kind: "user-choice", label: "Pick another name." }],
      },
    });
  });

  it("maps an unlinked directory to PROJECT.SETUP_REQUIRED", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "rename", "Billing v2", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.SETUP_REQUIRED",
        summary: "Choose a Project before running this command",
      },
    });
  });

  it("returns the rename result unchanged in json mode", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(
      fakeClient({
        patch: () => ({
          data: { data: { id: "proj_1", name: "Billing v2" } },
          response: { status: 200 } as Response,
        }),
      }),
    ).run(["project", "rename", "Billing v2", "--json"], { cwd });

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.rename",
      result: {
        workspace: { id: "ws_1" },
        project: { id: "proj_1", name: "Billing v2" },
        previousName: "Billing",
      },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run([
      "project",
      "rename",
      "Billing v2",
    ]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project workspace requirement", () => {
  it("reports the ported workspace-required usage error", async () => {
    vi.mocked(readAuthState).mockResolvedValue(NO_WORKSPACE);
    const result = await makeCli(fakeClient()).run(
      ["project", "list", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "AUTH.USAGE_ERROR",
        summary: "Workspace required",
        why: "This command needs an active workspace, but the authenticated session does not have one.",
      },
    });
  });
});
