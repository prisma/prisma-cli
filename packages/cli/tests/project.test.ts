import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function login(
  cwd: string,
  stateDir: string,
  selectedFixturePath = fixturePath,
  env?: NodeJS.ProcessEnv,
) {
  await executeCli({
    argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
    cwd,
    env,
    stateDir,
    fixturePath: selectedFixturePath,
  });
}

async function writePackageJson(cwd: string, name: string) {
  await writeFile(path.join(cwd, "package.json"), `${JSON.stringify({ name }, null, 2)}\n`, "utf8");
}

async function writeLocalPin(cwd: string, pin: unknown | string) {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    typeof pin === "string" ? pin : `${JSON.stringify(pin, null, 2)}\n`,
    "utf8",
  );
}

async function createAmbiguousFixture(cwd: string): Promise<string> {
  const raw = JSON.parse(await readFile(fixturePath, "utf8")) as {
    projects: Array<{ id: string; name: string; slug: string; url?: string; workspaceId: string }>;
  };
  raw.projects.push({
    id: "proj_321",
    name: "Acme Dashboard",
    slug: "acme-dashboard",
    url: "https://prisma.build/acme/acme-dashboard-2",
    workspaceId: "ws_123",
  });
  const nextPath = path.join(cwd, "ambiguous-fixture.json");
  await writeFile(nextPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return nextPath;
}

async function createAppleFixture(cwd: string): Promise<string> {
  const raw = JSON.parse(await readFile(fixturePath, "utf8")) as {
    projects: Array<{ id: string; name: string; slug: string; url?: string; workspaceId: string }>;
  };
  raw.projects = [
    {
      id: "proj_apple",
      name: "apple",
      slug: "apple",
      url: "https://prisma.build/acme/apple",
      workspaceId: "ws_123",
    },
  ];
  const nextPath = path.join(cwd, "apple-fixture.json");
  await writeFile(nextPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return nextPath;
}

async function createEdithOrangeFixture(cwd: string): Promise<string> {
  const raw = JSON.parse(await readFile(fixturePath, "utf8")) as {
    workspaces: Array<{ id: string; name: string; slug: string }>;
    projects: Array<{ id: string; name: string; slug: string; url?: string; workspaceId: string }>;
  };
  raw.workspaces = [
    {
      id: "ws_123",
      name: "Edith",
      slug: "edith",
    },
  ];
  raw.projects = [
    {
      id: "proj_orange",
      name: "orange",
      slug: "orange",
      url: "https://prisma.build/edith/orange",
      workspaceId: "ws_123",
    },
  ];
  const nextPath = path.join(cwd, "edith-orange-fixture.json");
  await writeFile(nextPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return nextPath;
}

describe("project commands", () => {
  it("lists projects without resolving the current directory", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "list"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "project list → Listing projects for the authenticated workspace.\n\n│  workspace:  Acme Inc\n│\n│  name            id\n│  Acme Dashboard  proj_123\n│  Billing API     proj_456\n\nNext steps:\n- Link an existing Project you choose: prisma-cli project link <id-or-name>\n- Create a new Project: prisma-cli project create <name>\n",
    );
  });

  it("adds a Project setup next action to project list JSON when unlinked", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result).toMatchObject({
      localBinding: {
        status: "not-linked",
      },
      items: expect.arrayContaining([
        expect.objectContaining({ name: "Acme Dashboard", id: "proj_123", status: null }),
      ]),
    });
    expect(payload.nextActions).toEqual([
      expect.objectContaining({
        kind: "user-choice",
        journey: "project-setup",
        label: "Ask the user whether to link an existing Project or create a new one",
      }),
      expect.objectContaining({
        kind: "run-command",
        command: "prisma-cli project link <id-or-name>",
      }),
      expect.objectContaining({
        kind: "run-command",
        command: "prisma-cli project create <name>",
      }),
    ]);
  });

  it("marks project list local binding invalid when the local pin cannot be parsed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeLocalPin(cwd, "{ nope");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result.localBinding).toEqual({ status: "invalid" });
  });

  it("prompts for a Project when bare project link runs interactively", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "link"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      stdinText: "\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("Which Project should this directory use?");
    expect(stderr).toContain(`Linked "./${path.basename(cwd)}" to Project "Acme Dashboard"`);
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).resolves.toContain('"projectId": "proj_123"');
  });

  it("disambiguates duplicate Project names in the bare project link picker", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const ambiguousFixturePath = await createAmbiguousFixture(cwd);
    await login(cwd, stateDir, ambiguousFixturePath);

    const result = await executeCli({
      argv: ["project", "link"],
      cwd,
      stateDir,
      fixturePath: ambiguousFixturePath,
      isTTY: true,
      stdinText: "\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("Acme Dashboard (proj_123)");
    expect(stderr).toContain("Acme Dashboard (proj_321)");
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).resolves.toContain('"projectId": "proj_123"');
  });

  it("lets the user cancel bare project link without writing local state", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "link"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      stdinText: "\u001B[B\u001B[B\u001B[B\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(2);
    expect(stderr).toContain("Project setup canceled");
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns PROJECT_LINK_TARGET_REQUIRED for bare project link in JSON mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, "pear");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "link", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(payload.error).toMatchObject({
      code: "PROJECT_LINK_TARGET_REQUIRED",
      meta: {
        suggestedProjectName: "pear",
        suggestedProjectNameSource: "package-name",
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: "proj_123", name: "Acme Dashboard" }),
          expect.objectContaining({ id: "proj_456", name: "Billing API" }),
        ]),
        recoveryCommands: [
          "prisma-cli project link <id-or-name>",
          "prisma-cli project create pear",
        ],
      },
    });
    expect(payload.nextActions).toEqual([
      expect.objectContaining({
        kind: "user-choice",
        journey: "project-setup",
        label: "Ask the user whether to link an existing Project or create a new one",
      }),
      expect.objectContaining({
        kind: "run-command",
        command: "prisma-cli project link <id-or-name>",
      }),
      expect.objectContaining({
        kind: "run-command",
        command: "prisma-cli project create pear",
      }),
    ]);
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let --yes choose a Project for bare project link", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "link", "--yes"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      stdinText: "\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(2);
    expect(stderr).toContain("PROJECT_LINK_TARGET_REQUIRED");
    expect(stderr).not.toContain("Which Project should this directory use?");
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("shows unbound suggestions from package.json in JSON mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePackageJson(cwd, "billing-api");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "project.show",
      result: {
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: null,
        localBinding: {
          status: "not-linked",
        },
        resolution: {
          projectSource: "unbound",
        },
        suggestedProjectName: "billing-api",
        suggestedProjectNameSource: "package-name",
        candidates: [
          {
            id: "proj_456",
            name: "Billing API",
          },
        ],
        recoveryCommands: [
          "prisma-cli project link <id-or-name>",
          "prisma-cli project show --project <id-or-name>",
        ],
      },
      warnings: [],
      nextSteps: [],
      nextActions: [
        expect.objectContaining({
          kind: "user-choice",
          journey: "project-setup",
          commands: [
            "prisma-cli project list",
            "prisma-cli project link <id-or-name>",
            "prisma-cli project show --project <id-or-name>",
          ],
        }),
        expect.objectContaining({
          kind: "run-command",
          command: "prisma-cli project link <id-or-name>",
        }),
        expect.objectContaining({
          kind: "run-command",
          command: "prisma-cli project create billing-api",
        }),
        expect.objectContaining({
          kind: "run-command",
          command: "prisma-cli project show --project <id-or-name>",
        }),
      ],
    });
  });

  it("shows an explicit project without mutating local state", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const state = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result.resolution.projectSource).toBe("explicit");
    expect(state.project?.lastResolved ?? null).toBe(null);
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("shows the pinned project from local state", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_123",
    });
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result).toMatchObject({
      project: {
        id: "proj_123",
        name: "Acme Dashboard",
        url: "https://prisma.build/acme/acme-dashboard",
      },
      resolution: {
        projectSource: "local-pin",
        targetName: "Acme Dashboard",
        targetNameSource: "local-pin",
      },
    });
  });

  it("shows a polished bound project block in human mode", async () => {
    const home = await createTempCwd();
    const cwd = path.join(home, "code", "apple");
    await mkdir(cwd, { recursive: true });
    const stateDir = path.join(cwd, ".state");
    const edithFixturePath = await createEdithOrangeFixture(cwd);
    const env = {
      ...process.env,
      HOME: home,
    };
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_orange",
    });
    await login(cwd, stateDir, edithFixturePath, env);

    const result = await executeCli({
      argv: ["project", "show"],
      cwd,
      env,
      stateDir,
      fixturePath: edithFixturePath,
      isTTY: true,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toBe(
      "project show → This directory is linked to the following platform project.\n\n│  local repo  ~/code/apple\n│  platform    Edith / orange\n│\n│  → https://prisma.build/edith/orange\n",
    );
  });

  it("returns LOCAL_PROJECT_WORKSPACE_MISMATCH when the local pin belongs to another workspace", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeLocalPin(cwd, {
      workspaceId: "ws_other",
      projectId: "proj_123",
    });
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "project.show",
      error: {
        code: "LOCAL_PROJECT_WORKSPACE_MISMATCH",
        domain: "project",
        meta: {
          pinPath: ".prisma/local.json",
          pinnedWorkspaceId: "ws_other",
          pinnedProjectId: "proj_123",
          activeWorkspaceId: "ws_123",
          activeWorkspaceName: "Acme Inc",
        },
      },
      nextSteps: [
        "prisma-cli auth login",
        "prisma-cli project list",
        "prisma-cli project link <id-or-name>",
      ],
    });
  });

  it("adds safe local context to project show in verbose human mode", async () => {
    const home = await createTempCwd();
    const cwd = path.join(home, "code", "apple");
    await mkdir(cwd, { recursive: true });
    const stateDir = path.join(cwd, ".state");
    const edithFixturePath = await createEdithOrangeFixture(cwd);
    const env = {
      ...process.env,
      HOME: home,
    };
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_orange",
    });
    await login(cwd, stateDir, edithFixturePath, env);

    const result = await executeCli({
      argv: ["project", "show", "--verbose"],
      cwd,
      env,
      stateDir,
      fixturePath: edithFixturePath,
      isTTY: true,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("Resolved context:");
    expect(stderr).toContain("workspace:");
    expect(stderr).toContain("Edith");
    expect(stderr).toContain("workspace id:");
    expect(stderr).toContain("ws_123");
    expect(stderr).toContain("project id:");
    expect(stderr).toContain("proj_orange");
    expect(stderr).toContain("project source:");
    expect(stderr).toContain(".prisma/local.json");
    expect(stderr).toContain("Local context:");
    expect(stderr).toContain("duration:");
    expect(stderr).toContain("cwd:");
    expect(stderr).toContain("~/code/apple");
    expect(stderr).toContain("state file:");
    expect(stderr).toContain("~");
  });

  it("returns PROJECT_NOT_FOUND for an inaccessible explicit project", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--project", "proj_789", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("shows an unbound directory when there is no safe source", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result).toMatchObject({
      project: null,
      localBinding: {
        status: "not-linked",
      },
      resolution: {
        projectSource: "unbound",
      },
      suggestedProjectName: path.basename(cwd),
      suggestedProjectNameSource: "directory-name",
      candidates: [],
    });
    expect(payload.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "user-choice",
        journey: "project-setup",
      }),
    ]));
  });

  it("uses the directory name as the suggestion when package metadata is unusable", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(path.join(cwd, "package.json"), "null\n", "utf8");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result).toMatchObject({
      project: null,
      resolution: {
        projectSource: "unbound",
      },
      suggestedProjectName: path.basename(cwd),
      suggestedProjectNameSource: "directory-name",
    });
  });

  it("does not prompt for project selection in interactive human mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("This directory is not linked to a Prisma Project.");
    expect(stderr).toContain("project:    Not linked");
    expect(stderr).toContain("Link an existing Project you choose: prisma-cli project link <id-or-name>");
    expect(stderr).not.toContain("match:");
    expect(stderr).not.toContain("Select a project");
  });

  it("does not suggest linking a nearby-looking Project in human output", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const appleFixturePath = await createAppleFixture(cwd);
    await writePackageJson(cwd, "pear");
    await login(cwd, stateDir, appleFixturePath);

    const result = await executeCli({
      argv: ["project", "show"],
      cwd,
      stateDir,
      fixturePath: appleFixturePath,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("project:    Not linked");
    expect(stderr).not.toContain("apple");
    expect(stderr).not.toContain("match:");
    expect(stderr).toContain("Create a new Project: prisma-cli project create pear");

    const jsonResult = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath: appleFixturePath,
    });
    const payload = JSON.parse(jsonResult.stdout);

    expect(payload.result.candidates).toEqual([]);
    expect(payload.nextActions[0]).toMatchObject({
      kind: "user-choice",
      journey: "project-setup",
    });
  });

  it("shows all matching candidates when package inference matches multiple projects", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const ambiguousFixturePath = await createAmbiguousFixture(cwd);
    await writePackageJson(cwd, "acme-dashboard");
    await login(cwd, stateDir, ambiguousFixturePath);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath: ambiguousFixturePath,
    });

    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.result).toMatchObject({
      project: null,
      localBinding: {
        status: "not-linked",
      },
      resolution: {
        projectSource: "unbound",
      },
      suggestedProjectName: "acme-dashboard",
      candidates: [
        { id: "proj_123", name: "Acme Dashboard" },
        { id: "proj_321", name: "Acme Dashboard" },
      ],
    });
  });

  it("returns LOCAL_STATE_STALE when the local pin is invalid", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_missing",
    });
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("LOCAL_STATE_STALE");
  });

  it("connects a GitHub repository to an explicit project in fixture mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["git", "connect", "git@github.com:prisma/prisma-cli.git", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);
    const state = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload).toMatchObject({
      ok: true,
      command: "git.connect",
      result: {
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
        },
        repositoryConnection: {
          provider: "github",
          repository: {
            fullName: "prisma/prisma-cli",
            url: "https://github.com/prisma/prisma-cli",
          },
          status: "pending",
        },
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
    expect(state.project.repositoryConnectionsByProject.proj_123.repository.fullName).toBe("prisma/prisma-cli");
  });

  it("keeps fixture repository connection idempotent for the same repo", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    await executeCli({
      argv: ["git", "connect", "https://github.com/prisma/prisma-cli", "--project", "proj_123"],
      cwd,
      stateDir,
      fixturePath,
    });
    const initialState = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));
    const initialConnection = initialState.project.repositoryConnectionsByProject.proj_123;

    const result = await executeCli({
      argv: ["git", "connect", "git@github.com:Prisma/Prisma-CLI.git", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);
    const nextState = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "git.connect",
    });
    expect(payload.result.repositoryConnection).toEqual(initialConnection);
    expect(nextState.project.repositoryConnectionsByProject.proj_123).toEqual(initialConnection);
  });

  it("blocks fixture repository replacement without disconnecting first", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    await executeCli({
      argv: ["git", "connect", "https://github.com/prisma/prisma-cli", "--project", "proj_123"],
      cwd,
      stateDir,
      fixturePath,
    });
    const initialState = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));
    const initialConnection = initialState.project.repositoryConnectionsByProject.proj_123;

    const result = await executeCli({
      argv: ["git", "connect", "https://github.com/prisma/other", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const state = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "git.connect",
      error: {
        code: "REPO_ALREADY_CONNECTED",
      },
    });
    expect(state.project.repositoryConnectionsByProject.proj_123).toEqual(initialConnection);
  });

  it("disconnects a GitHub repository from an explicit project in fixture mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    await executeCli({
      argv: ["git", "connect", "https://github.com/prisma/prisma-cli", "--project", "proj_123"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["git", "disconnect", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const state = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "git.disconnect",
      result: {
        repositoryConnection: {
          repository: {
            fullName: "prisma/prisma-cli",
          },
        },
      },
      warnings: [],
      nextSteps: [],
    });
    expect(state.project.repositoryConnectionsByProject.proj_123).toBeUndefined();
  });

  it("returns REPO_PROVIDER_UNSUPPORTED for non-GitHub repository URLs", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["git", "connect", "https://gitlab.com/prisma/prisma-cli", "--project", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe("REPO_PROVIDER_UNSUPPORTED");
  });

  it("returns PROJECT_SETUP_REQUIRED for repository connection without a Project binding", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["git", "connect", "https://github.com/prisma/prisma-cli", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("PROJECT_SETUP_REQUIRED");
  });

  it("shows Public Beta project, setup, and git help", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const projectHelp = await executeCli({
      argv: ["project", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const showHelp = await executeCli({
      argv: ["project", "show", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const createHelp = await executeCli({
      argv: ["project", "create", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const linkHelp = await executeCli({
      argv: ["project", "link", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const gitHelp = await executeCli({
      argv: ["git", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const connectRepoHelp = await executeCli({
      argv: ["git", "connect", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const disconnectRepoHelp = await executeCli({
      argv: ["git", "disconnect", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const stderr = stripAnsi(`${projectHelp.stderr}\n${showHelp.stderr}\n${createHelp.stderr}\n${linkHelp.stderr}\n${gitHelp.stderr}\n${connectRepoHelp.stderr}\n${disconnectRepoHelp.stderr}`);

    expect(projectHelp.exitCode).toBe(0);
    expect(createHelp.exitCode).toBe(0);
    expect(linkHelp.exitCode).toBe(0);
    expect(gitHelp.exitCode).toBe(0);
    expect(stderr).toContain("project → Manage and inspect your Prisma projects");
    expect(stderr).toContain("git → Manage Git repository connections for a project");
    expect(stderr).toContain("Show this directory's Project binding");
    expect(stderr).toContain("Create a Project and link this directory");
    expect(stderr).toContain("Link this directory to a Project");
    expect(stderr).toContain("Connect the resolved project to a GitHub repository");
    expect(stderr).toContain("Disconnect the GitHub repository from the resolved project");
  });

  it("registers project env remove and rm alias help", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const removeHelp = await executeCli({
      argv: ["project", "env", "remove", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const rmHelp = await executeCli({
      argv: ["project", "env", "rm", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(removeHelp.exitCode).toBe(0);
    expect(removeHelp.stderr).toContain("project env remove");
    expect(removeHelp.stderr).toContain("--branch <git-name>");
    expect(rmHelp.exitCode).toBe(0);
    expect(rmHelp.stderr).toContain("project env remove");
    expect(rmHelp.stderr).toContain("--role <role>");
  });
});
