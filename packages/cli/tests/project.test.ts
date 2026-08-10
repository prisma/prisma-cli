import path from "node:path";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("project commands", () => {
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
