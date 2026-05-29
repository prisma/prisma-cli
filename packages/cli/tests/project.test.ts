import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function login(cwd: string, stateDir: string, selectedFixturePath = fixturePath) {
  await executeCli({
    argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
    cwd,
    stateDir,
    fixturePath: selectedFixturePath,
  });
}

async function writePackageJson(cwd: string, name: string) {
  await writeFile(path.join(cwd, "package.json"), `${JSON.stringify({ name }, null, 2)}\n`, "utf8");
}

async function writeStaleProjectState(stateDir: string) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "state.json"),
    `${JSON.stringify(
      {
        auth: {
          provider: "github",
          userId: "usr_456",
          workspaceId: "ws_123",
        },
        project: {
          rememberedByWorkspace: {
            ws_123: {
              id: "proj_missing",
              name: "Missing Project",
              workspaceId: "ws_123",
            },
          },
          lastResolved: {
            id: "proj_missing",
            name: "Missing Project",
            workspaceId: "ws_123",
          },
          repositoryConnectionsByProject: {},
        },
        branch: { active: "preview" },
        app: {
          selectedByProject: {},
          knownLiveDeploymentByProject: {},
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function createAmbiguousFixture(cwd: string): Promise<string> {
  const raw = JSON.parse(await readFile(fixturePath, "utf8")) as {
    projects: Array<{ id: string; name: string; slug: string; workspaceId: string }>;
  };
  raw.projects.push({
    id: "proj_321",
    name: "Acme Dashboard",
    slug: "acme-dashboard",
    workspaceId: "ws_123",
  });
  const nextPath = path.join(cwd, "ambiguous-fixture.json");
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
      "project list → Listing projects for the authenticated workspace.\n\n│  workspace:  Acme Inc\n│  ⚬ project:  Acme Dashboard\n│  ⚬ project:  Billing API\n",
    );
  });

  it("shows the project resolved from package.json in JSON mode", async () => {
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
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "project.show",
      result: {
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_456",
          name: "Billing API",
        },
        resolution: {
          projectSource: "package-name",
          targetName: "billing-api",
          targetNameSource: "package-name",
        },
      },
      warnings: [],
      nextSteps: [],
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

  it("returns PROJECT_UNRESOLVED when automatic resolution has no safe source", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: ["project", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("PROJECT_UNRESOLVED");
  });

  it("treats a primitive package.json root as missing package metadata", async () => {
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

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("PROJECT_UNRESOLVED");
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

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("No project is resolved for this directory [PROJECT_UNRESOLVED]");
    expect(stderr).toContain("prisma-cli project list");
    expect(stderr).not.toContain("Select a project");
  });

  it("returns PROJECT_AMBIGUOUS when package inference matches multiple projects", async () => {
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

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("PROJECT_AMBIGUOUS");
  });

  it("returns LOCAL_STATE_STALE when remembered context is invalid and continuing is ambiguous", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeStaleProjectState(stateDir);

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

  it("returns PROJECT_UNRESOLVED for repository connection without a resolved project", async () => {
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
    expect(JSON.parse(result.stdout).error.code).toBe("PROJECT_UNRESOLVED");
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
    expect(stderr).toContain("Show which project is active for this directory");
    expect(stderr).toContain("Create a Project and link this directory");
    expect(stderr).toContain("Link this directory to an existing Project");
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
