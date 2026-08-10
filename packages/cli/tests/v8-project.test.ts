import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManagementApiClient, StreamEvent } from "@prisma/cli-engine";
import type { CliStructuredError } from "@prisma/cli-engine/protocol";
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecipientSessionInvalidError,
  resolveRecipientWorkspaceSession,
  WorkspaceSelectionError,
} from "../src/auth";

import { projectCreateCommand } from "../src/v8/project/create";
import { projectEnvAddCommand } from "../src/v8/project/env-add";
import { projectEnvListCommand } from "../src/v8/project/env-list";
import { projectEnvRemoveCommand } from "../src/v8/project/env-remove";
import { projectEnvUpdateCommand } from "../src/v8/project/env-update";
import { projectLinkCommand } from "../src/v8/project/link";
import { projectListCommand } from "../src/v8/project/list";
import { projectRemoveCommand } from "../src/v8/project/remove";
import { projectRenameCommand } from "../src/v8/project/rename";
import { projectShowCommand } from "../src/v8/project/show";
import { projectTransferCommand } from "../src/v8/project/transfer";
import { resolveActiveWorkspace } from "../src/v8/resources-shared/workspace";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  resolveRecipientWorkspaceSession: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(resolveRecipientWorkspaceSession).mockReset();
});

const ACME_SESSION = {
  workspaceId: "ws_1",
  workspaceName: "Acme Inc",
  credential: {
    token: mintTestJwt({ sub: "usr_1", workspace_id: "ws_1" }),
    refreshToken: undefined,
    expiresAt: undefined,
  },
};

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
  del?: (path: string, init: unknown) => unknown;
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
    DELETE: async (apiPath: string, init: unknown) =>
      spec.del ? spec.del(apiPath, init) : { data: { data: {} } },
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
      "project remove": projectRemoveCommand,
      "project transfer": projectTransferCommand,
      "project env add": projectEnvAddCommand,
      "project env update": projectEnvUpdateCommand,
      "project env list": projectEnvListCommand,
      "project env remove": projectEnvRemoveCommand,
    },
    groups: {
      project: { brief: "Manage and inspect your Prisma projects" },
      "project env": {
        brief: "Manage environment variables for the active project",
      },
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
  it("names the workspace of the engine's pinned credential", async () => {
    const workspace = await resolveActiveWorkspace({
      activeCredential: async () => ({
        workspaceId: "ws_1",
        workspaceName: "Acme Inc",
      }),
    } as never);

    expect(workspace).toEqual({ id: "ws_1", name: "Acme Inc" });
  });

  it("falls back to the workspace id when nothing names the workspace", async () => {
    const workspace = await resolveActiveWorkspace({
      activeCredential: async () => ({
        workspaceId: "ws_1",
        workspaceName: undefined,
      }),
    } as never);

    expect(workspace).toEqual({ id: "ws_1", name: "ws_1" });
  });

  // needs.credentials already fails a signed-out run, so a null
  // credential only reaches the helper defensively. Under the rev-6
  // model a credential can also name no workspace at all, which is the
  // same failure: the run is authenticated but has no workspace.
  it.each([
    ["no credential", null],
    ["a credential naming no workspace", { workspaceId: undefined }],
  ])("reports the ported workspace-required usage error with %s", async (_name, credential) => {
    let error: CliStructuredError | undefined;
    try {
      await resolveActiveWorkspace({
        activeCredential: async () => credential,
      } as never);
    } catch (thrown) {
      error = thrown as CliStructuredError;
    }

    expect(error?.toEnvelope()).toMatchObject({
      code: "AUTH.USAGE_ERROR",
      summary: "Workspace required",
      why: "This command needs an active workspace, but the authenticated session does not have one.",
      nextActions: [
        {
          kind: "user-choice",
          label: "Run prisma-cli auth login and choose a workspace.",
        },
        {
          kind: "run-command",
          label: "prisma-cli auth login",
          command: "prisma-cli auth login",
        },
      ],
    });
  });
});

interface EnvRow {
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
  updatedAt: string;
}

interface BranchRow {
  id: string;
  gitName: string;
  role: "production" | "preview";
  isDefault: boolean;
}

function envRow(overrides: Partial<EnvRow> = {}): EnvRow {
  return {
    id: "env_1",
    key: "STRIPE_KEY",
    branchId: null,
    class: "production",
    isManagedBySystem: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface EnvClientSpec {
  variables?: EnvRow[];
  branches?: BranchRow[];
  writes?: unknown[];
  failWriteFor?: string;
  failWriteStatus?: number;
  createdBranch?: BranchRow;
}

function envClient(spec: EnvClientSpec = {}): ManagementApiClient {
  const variables = spec.variables ?? [];
  const branches = spec.branches ?? [];
  const page = { hasMore: false, nextCursor: null };

  return {
    GET: async (
      apiPath: string,
      init?: { params?: { query?: Record<string, string> } },
    ) => {
      if (apiPath === "/v1/projects") {
        return { data: { data: API_PROJECTS } };
      }
      if (apiPath === "/v1/projects/{projectId}/branches") {
        const gitName = init?.params?.query?.gitName;
        return {
          data: {
            data: gitName
              ? branches.filter((branch) => branch.gitName === gitName)
              : branches,
            pagination: page,
          },
        };
      }
      const query = init?.params?.query ?? {};
      const matched = variables.filter(
        (row) =>
          row.class === query.class &&
          (query.key === undefined || row.key === query.key) &&
          (query.branchId === undefined || row.branchId === query.branchId),
      );
      return { data: { data: matched, pagination: page } };
    },
    POST: async (apiPath: string, init: { body?: Record<string, unknown> }) => {
      if (apiPath === "/v1/projects/{projectId}/branches") {
        return { data: { data: spec.createdBranch } };
      }
      spec.writes?.push(init.body);
      const key = init.body?.key as string;
      if (spec.failWriteFor === key) {
        return {
          error: { error: { message: "boom" } },
          response: new Response(null, { status: spec.failWriteStatus ?? 500 }),
        };
      }
      return {
        data: {
          data: envRow({
            id: `env_${key}`,
            key,
            class:
              (init.body?.class as "production" | "preview") ?? "production",
            branchId: (init.body?.branchId as string) ?? null,
          }),
        },
      };
    },
    PATCH: async (
      _apiPath: string,
      init: {
        params?: { path?: { envVarId?: string } };
        body?: Record<string, unknown>;
      },
    ) => {
      const existing = variables.find(
        (row) => row.id === init.params?.path?.envVarId,
      );
      if (existing !== undefined && spec.failWriteFor === existing.key) {
        return {
          error: { error: { message: "boom" } },
          response: new Response(null, { status: spec.failWriteStatus ?? 500 }),
        };
      }
      spec.writes?.push({
        envVarId: init.params?.path?.envVarId,
        ...init.body,
      });
      return { data: { data: existing ?? envRow() } };
    },
    DELETE: async (
      _apiPath: string,
      init: { params?: { path?: { envVarId?: string } } },
    ) => {
      spec.writes?.push({ deleted: init.params?.path?.envVarId });
      return { data: { data: {} } };
    },
  } as unknown as ManagementApiClient;
}

async function pinnedCwd() {
  return await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
}

describe("prisma-v8 project env add", () => {
  it("creates a variable in the role scope", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(envClient({ writes })).run(
      ["project", "env", "add", "STRIPE_KEY=sk_test", "--role", "production"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([
      {
        projectId: "proj_1",
        class: "production",
        key: "STRIPE_KEY",
        value: "sk_test",
      },
    ]);
    expect(result.presented?.data).toMatchObject({
      projectId: "proj_1",
      scope: { kind: "role", role: "production" },
      variable: { key: "STRIPE_KEY", source: "production" },
    });
    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "info",
      text: "Setting a new environment variable.",
    });
  });

  it("creates the branch on demand and warns that preview has no default", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({
        writes,
        branches: [
          {
            id: "br_main",
            gitName: "main",
            role: "production",
            isDefault: true,
          },
        ],
        createdBranch: {
          id: "br_feature",
          gitName: "feature/foo",
          role: "preview",
          isDefault: false,
        },
      }),
    ).run(
      [
        "project",
        "env",
        "add",
        "DATABASE_URL=postgres://x",
        "--branch",
        "feature/foo",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([
      {
        projectId: "proj_1",
        class: "preview",
        branchId: "br_feature",
        key: "DATABASE_URL",
        value: "postgres://x",
      },
    ]);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "PROJECT.ENV_PREVIEW_DEFAULT_MISSING",
        severity: "warn",
        summary:
          'Variable "DATABASE_URL" does not exist in preview. It will only exist on branch:feature/foo.',
        nextActions: [],
      },
    ]);
  });

  it("refuses to create the first branch from project env", async () => {
    const result = await makeCli(envClient({ branches: [] })).run(
      [
        "project",
        "env",
        "add",
        "KEY=value",
        "--branch",
        "feature/foo",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH",
        summary: 'Cannot create branch "feature/foo" from project env',
      },
    });
  });

  it("rejects both scope flags", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "add",
        "KEY=value",
        "--role",
        "preview",
        "--branch",
        "feature/foo",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "prisma-cli project env add accepts either --role or --branch",
      },
    });
  });

  it("requires an explicit scope", async () => {
    const result = await makeCli(envClient()).run(
      ["project", "env", "add", "KEY=value", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "prisma-cli project env add requires --role or --branch",
      },
    });
  });

  it("rejects both input sources", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "add",
        "KEY=value",
        "--file",
        ".env",
        "--role",
        "preview",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary:
          "prisma-cli project env add accepts either KEY=VALUE or --file",
      },
    });
  });

  it("rejects an assignment without a separator", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "add",
        "not-an-assignment",
        "--role",
        "preview",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "KEY=VALUE argument is missing the = separator",
      },
    });
  });

  it("reads a bare KEY from the environment", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(envClient({ writes })).run(
      ["project", "env", "add", "API_URL", "--role", "preview"],
      { cwd: await pinnedCwd(), env: { API_URL: "https://api.example" } },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([
      {
        projectId: "proj_1",
        class: "preview",
        key: "API_URL",
        value: "https://api.example",
      },
    ]);
  });

  it("rejects a key that already exists in the scope", async () => {
    const result = await makeCli(envClient({ variables: [envRow()] })).run(
      [
        "project",
        "env",
        "add",
        "STRIPE_KEY=sk_test",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_VARIABLE_ALREADY_EXISTS",
        summary: 'Variable "STRIPE_KEY" already exists in production',
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Use `prisma-cli project env update` to change an existing variable's value.",
          },
          {
            kind: "run-command",
            command:
              "prisma-cli project env update STRIPE_KEY=<new-value> --role production",
          },
        ],
      },
    });
  });

  it("imports every assignment in a dotenv file", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "A=1\nB=2\n", "utf8");
    const writes: unknown[] = [];
    const result = await makeCli(envClient({ writes })).run(
      ["project", "env", "add", "--file", ".env", "--role", "preview"],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toHaveLength(2);
    expect(result.presented?.data).toMatchObject({
      file: { path: ".env", count: 2 },
      variables: [{ key: "A" }, { key: "B" }],
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toMatchObject({ columns: ["variable", "id", "status"] });
  });

  it("reports the keys written before a file import failed", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "A=1\nB=2\n", "utf8");
    const result = await makeCli(envClient({ failWriteFor: "B" })).run(
      [
        "project",
        "env",
        "add",
        "--file",
        ".env",
        "--role",
        "preview",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_FILE_APPLY_FAILED",
        summary: 'Failed to add "B" from ".env"',
        meta: { file: ".env", failedKey: "B", writtenKeys: ["A"] },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Inspect the target scope, then retry the remaining keys once the API issue is resolved.",
          },
          {
            kind: "run-command",
            label: "prisma-cli project env list --role preview",
            command: "prisma-cli project env list --role preview",
          },
          {
            kind: "run-command",
            label:
              "prisma-cli project env add --file <remaining.env> --role preview",
            command:
              "prisma-cli project env add --file <remaining.env> --role preview",
          },
        ],
      },
    });
  });

  it("turns the split-file comment lines into the reason of the step they explain", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "STRIPE_KEY=1\n", "utf8");
    const result = await makeCli(envClient({ variables: [envRow()] })).run(
      [
        "project",
        "env",
        "add",
        "--file",
        ".env",
        "--role",
        "production",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_VARIABLE_ALREADY_EXISTS",
        summary: "1 environment variable(s) already exist in production",
        meta: { keys: ["STRIPE_KEY"] },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Split the input file by key state: update existing keys and add new keys separately.",
          },
          {
            kind: "run-command",
            label:
              "prisma-cli project env update --file .env.existing --role production",
            command:
              "prisma-cli project env update --file .env.existing --role production",
            reason: 'existing keys: "STRIPE_KEY"',
          },
          {
            kind: "run-command",
            label:
              "prisma-cli project env add --file .env.new --role production",
            command:
              "prisma-cli project env add --file .env.new --role production",
            reason: "new keys only",
          },
        ],
      },
    });
  });

  it("maps a forbidden API write to PROJECT.AUTH_REQUIRED", async () => {
    const result = await makeCli(
      envClient({ failWriteFor: "STRIPE_KEY", failWriteStatus: 403 }),
    ).run(
      [
        "project",
        "env",
        "add",
        "STRIPE_KEY=sk_test",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.AUTH_REQUIRED",
        summary: "Authentication required",
        why: "This command needs an authenticated session.",
        nextActions: [
          {
            kind: "user-choice",
            label: "Run prisma-cli auth login.",
          },
          {
            kind: "run-command",
            label: "prisma-cli auth login",
            command: "prisma-cli auth login",
          },
        ],
      },
    });
  });

  it("returns the stripped result in json mode", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "add",
        "STRIPE_KEY=sk_test",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.env.add",
      result: {
        projectId: "proj_1",
        scope: { kind: "role", role: "production" },
        variable: { key: "STRIPE_KEY", isManagedBySystem: false },
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(envClient(), false).run([
      "project",
      "env",
      "add",
      "STRIPE_KEY=sk_test",
      "--role",
      "production",
    ]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project env update", () => {
  it("replaces the value of an existing variable", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({ writes, variables: [envRow()] }),
    ).run(
      ["project", "env", "update", "STRIPE_KEY=sk_new", "--role", "production"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([{ envVarId: "env_1", value: "sk_new" }]);
    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "info",
      text: "Replacing the environment variable's value.",
    });
  });

  it("reports a missing variable", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "update",
        "STRIPE_KEY=sk_new",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_VARIABLE_NOT_FOUND",
        summary: 'Variable "STRIPE_KEY" not found in production',
      },
    });
  });

  it("does not create a missing branch", async () => {
    const result = await makeCli(envClient({ branches: [] })).run(
      [
        "project",
        "env",
        "update",
        "KEY=value",
        "--branch",
        "feature/foo",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_BRANCH_NOT_FOUND",
        summary: 'Branch "feature/foo" not found',
      },
    });
  });

  it("reports the file keys that do not exist yet", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "A=1\nB=2\n", "utf8");
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "update",
        "--file",
        ".env",
        "--role",
        "preview",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_VARIABLE_NOT_FOUND",
        summary: "2 environment variable(s) not found in preview",
        meta: { keys: ["A", "B"] },
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Split the input file by key state: add missing keys and update existing keys separately.",
          },
          {
            kind: "run-command",
            label: "prisma-cli project env add --file .env.new --role preview",
            command:
              "prisma-cli project env add --file .env.new --role preview",
            reason: 'missing keys: "A", "B"',
          },
          {
            kind: "run-command",
            label:
              "prisma-cli project env update --file .env.existing --role preview",
            command:
              "prisma-cli project env update --file .env.existing --role preview",
            reason: "existing keys only",
          },
        ],
      },
    });
  });

  it("returns the stripped result in json mode", async () => {
    const result = await makeCli(envClient({ variables: [envRow()] })).run(
      [
        "project",
        "env",
        "update",
        "STRIPE_KEY=sk_new",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.env.update",
      result: { projectId: "proj_1", variable: { key: "STRIPE_KEY" } },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(envClient(), false).run([
      "project",
      "env",
      "update",
      "STRIPE_KEY=sk_new",
      "--role",
      "production",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });

  it("replaces a value in a branch scope", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({
        writes,
        variables: [
          envRow({ id: "env_br", class: "preview", branchId: "br_feature" }),
        ],
        branches: [
          {
            id: "br_feature",
            gitName: "feature/foo",
            role: "preview",
            isDefault: false,
          },
        ],
      }),
    ).run(
      [
        "project",
        "env",
        "update",
        "STRIPE_KEY=sk_new",
        "--branch",
        "feature/foo",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([{ envVarId: "env_br", value: "sk_new" }]);
    expect(result.presented?.data).toMatchObject({
      scope: {
        kind: "branch",
        branchName: "feature/foo",
        branchId: "br_feature",
      },
    });
  });

  it("replaces every assignment in a dotenv file", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "A=1\nB=2\n", "utf8");
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({
        writes,
        variables: [
          envRow({ id: "env_a", key: "A", class: "preview" }),
          envRow({ id: "env_b", key: "B", class: "preview" }),
        ],
      }),
    ).run(["project", "env", "update", "--file", ".env", "--role", "preview"], {
      cwd,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([
      { envVarId: "env_a", value: "1" },
      { envVarId: "env_b", value: "2" },
    ]);
    expect(result.presented?.data).toMatchObject({
      file: { path: ".env", count: 2 },
    });
    expect(blocks(result.presented)[0]).toEqual({
      kind: "summary",
      tone: "info",
      text: "Replacing environment variable values from file.",
    });
  });

  it("reports the keys written before a file replace failed", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "A=1\nB=2\n", "utf8");
    const result = await makeCli(
      envClient({
        failWriteFor: "B",
        variables: [
          envRow({ id: "env_a", key: "A", class: "preview" }),
          envRow({ id: "env_b", key: "B", class: "preview" }),
        ],
      }),
    ).run(
      [
        "project",
        "env",
        "update",
        "--file",
        ".env",
        "--role",
        "preview",
        "--json",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_FILE_APPLY_FAILED",
        summary: 'Failed to update "B" from ".env"',
        meta: { file: ".env", failedKey: "B", writtenKeys: ["A"] },
      },
    });
  });

  it("rejects both scope flags", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "update",
        "KEY=value",
        "--role",
        "preview",
        "--branch",
        "feature/foo",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary:
          "prisma-cli project env update accepts either --role or --branch",
      },
    });
  });

  it("requires an explicit scope", async () => {
    const result = await makeCli(envClient()).run(
      ["project", "env", "update", "KEY=value", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "prisma-cli project env update requires --role or --branch",
      },
    });
  });

  it("rejects both input sources", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "update",
        "KEY=value",
        "--file",
        ".env",
        "--role",
        "preview",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary:
          "prisma-cli project env update accepts either KEY=VALUE or --file",
      },
    });
  });

  it("rejects an assignment without a separator", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "update",
        "not-an-assignment",
        "--role",
        "preview",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "KEY=VALUE argument is missing the = separator",
      },
    });
  });

  it("reads a bare KEY from the environment", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({
        writes,
        variables: [envRow({ id: "env_api", key: "API_URL" })],
      }),
    ).run(["project", "env", "update", "API_URL", "--role", "production"], {
      cwd: await pinnedCwd(),
      env: { API_URL: "https://api.example" },
    });

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([
      { envVarId: "env_api", value: "https://api.example" },
    ]);
  });
});

describe("prisma-v8 project env list", () => {
  it("lists the variables of an explicit role scope", async () => {
    const result = await makeCli(
      envClient({
        variables: [
          envRow(),
          envRow({ id: "env_2", key: "API_URL", isManagedBySystem: true }),
        ],
      }),
    ).run(["project", "env", "list", "--role", "production"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(
      blocks(result.presented).find((block) => block.kind === "table"),
    ).toEqual({
      kind: "table",
      columns: ["variable", "id", "status"],
      rows: [
        ["STRIPE_KEY (production)", "env_1", ""],
        ["API_URL (production)", "env_2", "default"],
      ],
    });
    expect(result.presented?.presentation.stdout).toEqual([
      "STRIPE_KEY (production)\tenv_1\t",
      "API_URL (production)\tenv_2\tdefault",
    ]);
  });

  it("falls back to the overview scope outside a git repository", async () => {
    const result = await makeCli(
      envClient({
        variables: [
          envRow(),
          envRow({ id: "env_2", key: "API_URL", class: "preview" }),
        ],
      }),
    ).run(["project", "env", "list"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.presented?.data).toMatchObject({
      scope: { kind: "overview" },
      target: { source: "overview", envMap: "overview" },
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [{ label: "target", value: "overview" }],
    });
  });

  it("labels a local git branch that the platform does not know yet", async () => {
    const cwd = await pinnedCwd();
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await writeFile(
      path.join(cwd, ".git", "HEAD"),
      "ref: refs/heads/feature/foo\n",
      "utf8",
    );
    const result = await makeCli(envClient({ branches: [] })).run(
      ["project", "env", "list"],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.presented?.data).toMatchObject({
      target: {
        source: "local-git",
        branchName: "feature/foo",
        branchExists: false,
        envMap: "preview",
      },
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        {
          label: "target",
          value: "branch:feature/foo -> preview (not created yet)",
        },
      ],
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "prisma-cli project env add KEY=value --branch feature/foo",
        command: "prisma-cli project env add KEY=value --branch feature/foo",
      },
    ]);
  });

  it("suggests adding a variable when the scope is empty", async () => {
    const result = await makeCli(envClient()).run(
      ["project", "env", "list", "--role", "preview"],
      { cwd: await pinnedCwd(), isTty: { stdout: true } },
    );

    expect(blocks(result.presented)).toContainEqual({
      kind: "list",
      items: ["No environment variables defined in this scope."],
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "prisma-cli project env add KEY=value --role preview",
        command: "prisma-cli project env add KEY=value --role preview",
      },
    ]);
  });

  it("serializes the legacy list envelope in json mode", async () => {
    const result = await makeCli(envClient({ variables: [envRow()] })).run(
      ["project", "env", "list", "--role", "production", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.env.list",
      result: {
        projectId: "proj_1",
        scope: { kind: "role", role: "production" },
        context: { target: "production" },
        items: [{ name: "STRIPE_KEY (production)", id: "env_1", status: null }],
        count: 1,
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(envClient(), false).run([
      "project",
      "env",
      "list",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });

  it("targets the preview overrides of a local branch the platform knows", async () => {
    const cwd = await pinnedCwd();
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await writeFile(
      path.join(cwd, ".git", "HEAD"),
      "ref: refs/heads/feature/foo\n",
      "utf8",
    );
    const result = await makeCli(
      envClient({
        branches: [
          {
            id: "br_feature",
            gitName: "feature/foo",
            role: "preview",
            isDefault: false,
          },
        ],
        variables: [
          envRow({ id: "env_role", key: "SHARED", class: "preview" }),
          envRow({
            id: "env_branch",
            key: "SHARED",
            class: "preview",
            branchId: "br_feature",
          }),
        ],
      }),
    ).run(["project", "env", "list"], { cwd, isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      scope: {
        kind: "branch",
        branchName: "feature/foo",
        branchId: "br_feature",
      },
      target: {
        source: "local-git",
        branchName: "feature/foo",
        branchId: "br_feature",
        branchRole: "preview",
        branchExists: true,
        envMap: "preview",
      },
      variables: [{ id: "env_branch", source: "branch:feature/foo" }],
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [{ label: "target", value: "branch:feature/foo -> preview" }],
    });
  });

  it("targets production when the local branch is the production branch", async () => {
    const cwd = await pinnedCwd();
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await writeFile(
      path.join(cwd, ".git", "HEAD"),
      "ref: refs/heads/main\n",
      "utf8",
    );
    const result = await makeCli(
      envClient({
        branches: [
          {
            id: "br_main",
            gitName: "main",
            role: "production",
            isDefault: true,
          },
        ],
        variables: [envRow()],
      }),
    ).run(["project", "env", "list"], { cwd, isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      scope: { kind: "role", role: "production" },
      target: {
        source: "local-git",
        branchName: "main",
        branchRole: "production",
        branchExists: true,
        envMap: "production",
      },
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [{ label: "target", value: "branch:main -> production" }],
    });
  });
});

describe("prisma-v8 project env remove", () => {
  it("removes the variable from the scope", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({ writes, variables: [envRow()] }),
    ).run(["project", "env", "remove", "STRIPE_KEY", "--role", "production"], {
      cwd: await pinnedCwd(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([{ deleted: "env_1" }]);
    expect(blocks(result.presented)).toEqual([
      {
        kind: "summary",
        tone: "info",
        text: "Removing the environment variable from the scope.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: "proj_1" },
          { label: "scope", value: "production" },
          { label: "key", value: "STRIPE_KEY" },
        ],
      },
    ]);
  });

  it("reports a key that is not in the scope", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "remove",
        "STRIPE_KEY",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.ENV_VARIABLE_NOT_FOUND",
        summary: 'Variable "STRIPE_KEY" not found in production',
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Run prisma-cli project env list with the same scope to see the available variables.",
          },
          {
            kind: "run-command",
            command: "prisma-cli project env list --role production",
          },
        ],
      },
    });
  });

  it("returns the stripped result in json mode", async () => {
    const result = await makeCli(envClient({ variables: [envRow()] })).run(
      [
        "project",
        "env",
        "remove",
        "STRIPE_KEY",
        "--role",
        "production",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.env.remove",
      result: {
        projectId: "proj_1",
        scope: { kind: "role", role: "production" },
        key: "STRIPE_KEY",
      },
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(envClient(), false).run([
      "project",
      "env",
      "remove",
      "STRIPE_KEY",
      "--role",
      "production",
    ]);

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });

  it("removes a variable from a branch scope", async () => {
    const writes: unknown[] = [];
    const result = await makeCli(
      envClient({
        writes,
        variables: [
          envRow({ id: "env_br", class: "preview", branchId: "br_feature" }),
        ],
        branches: [
          {
            id: "br_feature",
            gitName: "feature/foo",
            role: "preview",
            isDefault: false,
          },
        ],
      }),
    ).run(
      ["project", "env", "remove", "STRIPE_KEY", "--branch", "feature/foo"],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([{ deleted: "env_br" }]);
  });

  it("rejects both scope flags", async () => {
    const result = await makeCli(envClient()).run(
      [
        "project",
        "env",
        "remove",
        "STRIPE_KEY",
        "--role",
        "preview",
        "--branch",
        "feature/foo",
        "--json",
      ],
      { cwd: await pinnedCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary:
          "prisma-cli project env remove accepts either --role or --branch",
      },
    });
  });

  it("requires an explicit scope", async () => {
    const result = await makeCli(envClient()).run(
      ["project", "env", "remove", "STRIPE_KEY", "--json"],
      { cwd: await pinnedCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "prisma-cli project env remove requires --role or --branch",
      },
    });
  });
});

describe("prisma-v8 project remove", () => {
  it("removes the project and clears a pin that points at it", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "proj_1", "--confirm", "proj_1"],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      project: { id: "proj_1", name: "Billing" },
      localPin: { cleared: true },
    });
    expect(blocks(result.presented)).toEqual([
      { kind: "summary", tone: "ok", text: "Removing project." },
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
          "The project, its databases, and its apps were removed.",
          "This directory's local project binding was cleared.",
        ],
      },
    ]);
    expect(existsSync(path.join(cwd, ".prisma", "local.json"))).toBe(false);
  });

  // Provoking a failed delete needs a directory whose permissions stop it,
  // which Windows does not have: chmod there sets a read-only attribute on
  // files and leaves directory entries removable. The behaviour under test
  // is platform-independent, only the way of provoking it is not.
  it.skipIf(process.platform === "win32")(
    "warns when the pin it should clear cannot be deleted",
    async () => {
      const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
      await chmod(path.join(cwd, ".prisma"), 0o555);
      try {
        const result = await makeCli(fakeClient()).run(
          ["project", "remove", "proj_1", "--confirm", "proj_1"],
          { cwd },
        );

        expect(result.exitCode).toBe(0);
        expect(result.presented?.data).toMatchObject({
          localPin: { cleared: false },
        });
        expect(result.presented?.diagnostics).toEqual([
          {
            code: "PROJECT.LOCAL_STATE_WRITE_FAILED",
            severity: "warn",
            summary:
              "The local pin .prisma/local.json points at the removed project but could not be deleted.",
            nextActions: [],
          },
        ]);
      } finally {
        await chmod(path.join(cwd, ".prisma"), 0o755);
      }
    },
  );

  it("refuses to remove without consent in a non-interactive run", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "proj_1", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to remove when --yes stands in for consent", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "proj_1", "--yes", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("removes the project when the typed answer is the project id", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "proj_1"],
      {
        cwd: await tempCwd(),
        answers: ["proj_1"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ project: { id: "proj_1" } });
  });

  it("fails when the typed answer is not the project id", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "proj_1", "--json"],
      {
        cwd: await tempCwd(),
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

  it("maps a blocked removal to PROJECT.REMOVE_BLOCKED", async () => {
    const result = await makeCli(
      fakeClient({
        del: () => ({
          error: { error: { message: "Project still has deployments." } },
          response: new Response(null, { status: 400 }),
        }),
      }),
    ).run(["project", "remove", "proj_1", "--confirm", "proj_1", "--json"], {
      cwd: await tempCwd(),
    });

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.REMOVE_BLOCKED",
        summary: "Project cannot be removed yet",
        why: "Project still has deployments.",
      },
    });
  });

  it("maps an unknown positional to PROJECT.NOT_FOUND", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "nope", "--confirm", "nope", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "PROJECT.NOT_FOUND" },
    });
  });

  it("maps an ambiguous positional to PROJECT.AMBIGUOUS", async () => {
    const duplicates = [
      { ...API_PROJECTS[0], id: "proj_a", name: "Billing" },
      { ...API_PROJECTS[0], id: "proj_b", name: "Billing" },
    ];
    const result = await makeCli(fakeClient({ projects: duplicates })).run(
      ["project", "remove", "Billing", "--confirm", "Billing", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "PROJECT.AMBIGUOUS" },
    });
  });

  it("returns the remove result unchanged in json mode", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "remove", "proj_1", "--confirm", "proj_1", "--json"],
      { cwd: await tempCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.remove",
      result: {
        workspace: { id: "ws_1", name: "Acme Inc" },
        project: { id: "proj_1", name: "Billing" },
        localPin: { cleared: false },
      },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run([
      "project",
      "remove",
      "proj_1",
      "--confirm",
      "proj_1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});

describe("prisma-v8 project transfer", () => {
  it("transfers to a locally authenticated workspace and rewrites the pin", async () => {
    vi.mocked(resolveRecipientWorkspaceSession).mockResolvedValue({
      workspace: { id: "ws_2", name: "Prisma Labs" },
      accessToken: "recipient-token",
    } as never);
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const posts: unknown[] = [];
    const result = await makeCli(
      fakeClient({
        post: (apiPath, init) => {
          posts.push({ apiPath, init });
          return { data: { data: {} } };
        },
      }),
    ).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--to-workspace",
        "Prisma Labs",
        "--confirm",
        "proj_1",
      ],
      { cwd, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(posts).toMatchObject([
      {
        apiPath: "/v1/projects/{id}/transfer",
        init: { body: { recipientAccessToken: "recipient-token" } },
      },
    ]);
    expect(result.presented?.data).toMatchObject({
      recipient: {
        workspaceId: "ws_2",
        workspaceName: "Prisma Labs",
        source: "workspace-session",
      },
      localPin: { action: "rewritten" },
    });
    expect(
      JSON.parse(
        await readFile(path.join(cwd, ".prisma", "local.json"), "utf8"),
      ),
    ).toEqual({ workspaceId: "ws_2", projectId: "proj_1" });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "prisma-cli auth workspace use 'Prisma Labs'",
        command: "prisma-cli auth workspace use 'Prisma Labs'",
      },
    ]);
  });

  it("transfers with a recipient token and clears the pin", async () => {
    const cwd = await tempCwd({ workspaceId: "ws_1", projectId: "proj_1" });
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--recipient-token",
        "tok_recipient",
        "--confirm",
        "proj_1",
      ],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      recipient: {
        workspaceId: null,
        workspaceName: null,
        source: "recipient-token",
      },
      localPin: { action: "cleared" },
    });
    expect(existsSync(path.join(cwd, ".prisma", "local.json"))).toBe(false);
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it("rejects both recipient sources", async () => {
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--to-workspace",
        "Prisma Labs",
        "--recipient-token",
        "tok",
        "--confirm",
        "proj_1",
        "--json",
      ],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.USAGE_ERROR",
        summary: "Choose one transfer recipient source",
        why: "--to-workspace and --recipient-token are mutually exclusive.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Pass either --to-workspace <id-or-name> or --recipient-token <token>.",
          },
          {
            kind: "run-command",
            command:
              "prisma-cli project transfer <project> --to-workspace <id-or-name> --confirm <project-id>",
          },
        ],
      },
    });
  });

  it("requires a recipient source", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "transfer", "proj_1", "--confirm", "proj_1", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.TRANSFER_RECIPIENT_REQUIRED",
        summary: "Transfer recipient required",
        why: "Project transfer needs the receiving workspace.",
      },
    });
  });

  it("refuses --to-workspace under a service token", async () => {
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--to-workspace",
        "Prisma Labs",
        "--confirm",
        "proj_1",
        "--json",
      ],
      { cwd: await tempCwd(), env: { PRISMA_SERVICE_TOKEN: "tok" } },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE",
        summary: "Local workspace sessions are unavailable",
      },
    });
  });

  it("maps an ambiguous recipient workspace to AUTH.WORKSPACE_AMBIGUOUS", async () => {
    vi.mocked(resolveRecipientWorkspaceSession).mockRejectedValue(
      new WorkspaceSelectionError("ambiguous", "Labs", [
        { id: "ws_2", name: "Labs", credentialWorkspaceId: "cred_2" },
        { id: "ws_3", name: "Labs", credentialWorkspaceId: "cred_3" },
      ] as never),
    );
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--to-workspace",
        "Labs",
        "--confirm",
        "proj_1",
        "--json",
      ],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "AUTH.WORKSPACE_AMBIGUOUS",
        summary: "Workspace name is ambiguous",
      },
    });
  });

  it("maps an unauthenticated recipient workspace to AUTH.WORKSPACE_NOT_AUTHENTICATED", async () => {
    vi.mocked(resolveRecipientWorkspaceSession).mockRejectedValue(
      new RecipientSessionInvalidError({ workspaceRef: "Labs" } as never),
    );
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--to-workspace",
        "Labs",
        "--confirm",
        "proj_1",
        "--json",
      ],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "AUTH.WORKSPACE_NOT_AUTHENTICATED",
        summary: "Workspace is not authenticated",
      },
    });
  });

  it("refuses to transfer without consent in a non-interactive run", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "transfer", "proj_1", "--recipient-token", "tok", "--json"],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("refuses to transfer when --yes stands in for consent", async () => {
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--recipient-token",
        "tok",
        "--yes",
        "--json",
      ],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CONSENT_REQUIRED" },
    });
  });

  it("transfers when the typed answer is the project id", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "transfer", "proj_1", "--recipient-token", "tok"],
      {
        cwd: await tempCwd(),
        answers: ["proj_1"],
        isTty: { stdin: true, stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ project: { id: "proj_1" } });
  });

  it("fails when the typed answer is not the project id", async () => {
    const result = await makeCli(fakeClient()).run(
      ["project", "transfer", "proj_1", "--recipient-token", "tok", "--json"],
      {
        cwd: await tempCwd(),
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

  it("maps a rejected transfer to PROJECT.TRANSFER_REJECTED", async () => {
    const result = await makeCli(
      fakeClient({
        post: () => ({
          error: { error: { message: "The recipient token is invalid." } },
          response: new Response(null, { status: 400 }),
        }),
      }),
    ).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--recipient-token",
        "tok",
        "--confirm",
        "proj_1",
        "--json",
      ],
      { cwd: await tempCwd() },
    );

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT.TRANSFER_REJECTED",
        summary: "Project transfer was rejected",
        why: "The recipient token is invalid.",
      },
    });
  });

  it("returns the transfer result unchanged in json mode", async () => {
    const result = await makeCli(fakeClient()).run(
      [
        "project",
        "transfer",
        "proj_1",
        "--recipient-token",
        "tok",
        "--confirm",
        "proj_1",
        "--json",
      ],
      { cwd: await tempCwd() },
    );

    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: true,
      commandId: "project.transfer",
      result: {
        workspace: { id: "ws_1" },
        project: { id: "proj_1" },
        recipient: { source: "recipient-token" },
        localPin: { action: "none" },
      },
      nextActions: [],
    });
  });

  it("requires credentials", async () => {
    const result = await makeCli(fakeClient(), false).run([
      "project",
      "transfer",
      "proj_1",
      "--recipient-token",
      "tok",
      "--confirm",
      "proj_1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(resultFrame(result.json).envelope).toMatchObject({
      ok: false,
      error: { code: "CLI.CREDENTIALS_REQUIRED" },
    });
  });
});
