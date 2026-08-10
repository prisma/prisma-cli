import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

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

describe("project commands", () => {
  it("connects a GitHub repository to an explicit project in fixture mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: [
        "git",
        "connect",
        "git@github.com:prisma/prisma-cli.git",
        "--project",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);
    const state = JSON.parse(
      await readFile(path.join(stateDir, "state.json"), "utf8"),
    );

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
    expect(
      state.project.repositoryConnectionsByProject.proj_123.repository.fullName,
    ).toBe("prisma/prisma-cli");
  });

  it("keeps fixture repository connection idempotent for the same repo", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    await executeCli({
      argv: [
        "git",
        "connect",
        "https://github.com/prisma/prisma-cli",
        "--project",
        "proj_123",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const initialState = JSON.parse(
      await readFile(path.join(stateDir, "state.json"), "utf8"),
    );
    const initialConnection =
      initialState.project.repositoryConnectionsByProject.proj_123;

    const result = await executeCli({
      argv: [
        "git",
        "connect",
        "git@github.com:Prisma/Prisma-CLI.git",
        "--project",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const payload = JSON.parse(result.stdout);
    const nextState = JSON.parse(
      await readFile(path.join(stateDir, "state.json"), "utf8"),
    );

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      command: "git.connect",
    });
    expect(payload.result.repositoryConnection).toEqual(initialConnection);
    expect(nextState.project.repositoryConnectionsByProject.proj_123).toEqual(
      initialConnection,
    );
  });

  it("blocks fixture repository replacement without disconnecting first", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    await executeCli({
      argv: [
        "git",
        "connect",
        "https://github.com/prisma/prisma-cli",
        "--project",
        "proj_123",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const initialState = JSON.parse(
      await readFile(path.join(stateDir, "state.json"), "utf8"),
    );
    const initialConnection =
      initialState.project.repositoryConnectionsByProject.proj_123;

    const result = await executeCli({
      argv: [
        "git",
        "connect",
        "https://github.com/prisma/other",
        "--project",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });
    const state = JSON.parse(
      await readFile(path.join(stateDir, "state.json"), "utf8"),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "git.connect",
      error: {
        code: "REPO_ALREADY_CONNECTED",
      },
    });
    expect(state.project.repositoryConnectionsByProject.proj_123).toEqual(
      initialConnection,
    );
  });

  it("disconnects a GitHub repository from an explicit project in fixture mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    await executeCli({
      argv: [
        "git",
        "connect",
        "https://github.com/prisma/prisma-cli",
        "--project",
        "proj_123",
      ],
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
    const state = JSON.parse(
      await readFile(path.join(stateDir, "state.json"), "utf8"),
    );

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
    expect(
      state.project.repositoryConnectionsByProject.proj_123,
    ).toBeUndefined();
  });

  it("returns REPO_PROVIDER_UNSUPPORTED for non-GitHub repository URLs", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: [
        "git",
        "connect",
        "https://gitlab.com/prisma/prisma-cli",
        "--project",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe(
      "REPO_PROVIDER_UNSUPPORTED",
    );
  });

  it("returns PROJECT_SETUP_REQUIRED for repository connection without a Project binding", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);

    const result = await executeCli({
      argv: [
        "git",
        "connect",
        "https://github.com/prisma/prisma-cli",
        "--json",
      ],
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
    const stderr = stripAnsi(
      `${projectHelp.stderr}\n${showHelp.stderr}\n${createHelp.stderr}\n${linkHelp.stderr}\n${gitHelp.stderr}\n${connectRepoHelp.stderr}\n${disconnectRepoHelp.stderr}`,
    );

    expect(projectHelp.exitCode).toBe(0);
    expect(createHelp.exitCode).toBe(0);
    expect(linkHelp.exitCode).toBe(0);
    expect(gitHelp.exitCode).toBe(0);
    expect(stderr).toContain(
      "project → Manage and inspect your Prisma projects",
    );
    expect(stderr).toContain(
      "git → Manage Git repository connections for a project",
    );
    expect(stderr).toContain("Show this directory's Project binding");
    expect(stderr).toContain("Create a Project and link this directory");
    expect(stderr).toContain("Link this directory to a Project");
    expect(stderr).toContain(
      "Connect the resolved project to a GitHub repository",
    );
    expect(stderr).toContain(
      "Disconnect the GitHub repository from the resolved project",
    );
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
