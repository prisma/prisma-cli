import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { createTempCwd, executeCli, readPrismaConfig, writePrismaConfig } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("project commands", () => {
  it("lists projects in human mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["project", "list"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "project list → Listing projects for the authenticated workspace.\n\n│  workspace:  Acme Inc\n│  ⚬ project:  Acme Dashboard (linked)\n│  ⚬ project:  Billing API\n",
    );
  });

  it("lists projects in JSON mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["project", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "project.list",
      result: {
        context: {
          workspace: "Acme Inc",
        },
        items: [
          {
            id: "proj_123",
            name: "Acme Dashboard",
            status: "linked",
          },
          {
            id: "proj_456",
            name: "Billing API",
            status: null,
          },
        ],
        count: 2,
      },
      warnings: [],
      nextSteps: ["prisma-cli project link"],
    });
  });

  it("returns AUTH_REQUIRED for project list in JSON mode when signed out", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["project", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "project.list",
      error: {
        code: "AUTH_REQUIRED",
        domain: "auth",
        severity: "error",
        summary: "Authentication required",
        why: "This command needs an authenticated session.",
        fix: "Run prisma-cli auth login, or rerun the command in a TTY to sign in interactively.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma-cli auth login"],
    });
  });

  it("auto-starts login for project list in interactive TTY mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["project", "list"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      stdinText: "\r\u001B[B\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("project list → Listing projects for the authenticated workspace.");
    expect(stderr).toContain("Select a provider");
    expect(stderr).toContain("Select a user");
    expect(stderr).toContain("workspace:  Acme Inc");
    expect(stderr).toContain("⚬ project:  Acme Dashboard");
  });

  it("shows the unlinked empty state", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["project", "show"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "project show → Showing the linked project for the current repo.\n\n│  project:  not linked\n",
    );
  });

  it("shows linked local-only state when signed out", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["project", "show"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "project show → Showing the linked project for the current repo.\n\n│  project:         linked\n│  remote details:  unavailable until you sign in\n",
    );
  });

  it("shows linked enriched state in JSON mode when signed in", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");
    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

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
        linkedProjectId: "proj_123",
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
        },
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("links a project and writes prisma.config.ts", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["project", "link", "proj_123"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "project link → Linking the current repo to an existing project.\n\n│  project:    Acme Dashboard\n│  workspace:  Acme Inc\n\n◇ Applying local project link...\n✔ Applied 1 operation(s)\n  Project link written to local repo config.\n",
    );
    expect(await readPrismaConfig(cwd)).toContain('project: "proj_123"');
  });

  it("prompts for project selection when no project id is passed in interactive mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["project", "link"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      stdinText: "\u001B[B\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("project link → Linking the current repo to an existing project.");
    expect(stderr).toContain("Select a project");
    expect(stderr).toContain("Acme Dashboard (proj_123)");
    expect(stderr).toContain("Billing API (proj_456)");
    expect(stderr).toContain("✔ Applied 1 operation(s)");
    expect(await readPrismaConfig(cwd)).toContain('project: "proj_456"');
  });

  it("links a project in JSON mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["project", "link", "proj_123", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "project.link",
      result: {
        linkedProjectId: "proj_123",
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
        },
      },
      warnings: [],
      nextSteps: ["prisma-cli project show", "prisma-cli app deploy"],
    });
  });

  it("returns USAGE_ERROR for project link in JSON mode when no project id is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["project", "link", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "project.link",
      error: {
        code: "USAGE_ERROR",
        domain: "project",
        severity: "error",
        summary: "Project link requires a project target in non-interactive mode",
        why: "This command cannot prompt for project selection in the current mode.",
        fix: "Re-run prisma-cli project link in a TTY, or pass a project id explicitly.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma-cli project list"],
    });
  });

  it("returns USAGE_ERROR for project link with --no-interactive when no project id is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["project", "link", "--no-interactive", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "project.link",
      error: {
        code: "USAGE_ERROR",
        domain: "project",
        severity: "error",
        summary: "Project link requires a project target in non-interactive mode",
        why: "This command cannot prompt for project selection in the current mode.",
        fix: "Re-run prisma-cli project link in a TTY, or pass a project id explicitly.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma-cli project list"],
    });
  });

  it("returns PROJECT_NOT_FOUND for an inaccessible project id", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["project", "link", "proj_789", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "project.link",
      error: {
        code: "PROJECT_NOT_FOUND",
        domain: "project",
        severity: "error",
        summary: "Project not found",
        why: 'The project "proj_789" does not exist in workspace "Acme Inc".',
        fix: "Run prisma-cli project list and choose a project id from the active workspace.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma-cli project list"],
    });
  });

  it("does not mutate local branch state when linking a project", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    await executeCli({
      argv: ["project", "link", "proj_123"],
      cwd,
      stateDir,
      fixturePath,
    });

    const whoami = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });
    const state = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));

    expect(JSON.parse(whoami.stdout).result.linkedProjectId).toBe("proj_123");
    expect(JSON.parse(whoami.stdout).result.workspace.id).toBe("ws_123");
    expect(state.branch.active).toBe("preview");
  });

  it("shows the documented help text for project commands", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const listHelp = await executeCli({
      argv: ["project", "list", "--help"],
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
    const linkHelp = await executeCli({
      argv: ["project", "link", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(listHelp.exitCode).toBe(0);
    expect(listHelp.stderr).toContain("List all projects in your workspace");
    expect(listHelp.stderr).toContain("│  Examples:");
    expect(listHelp.stderr).toContain("$ prisma-cli project list");
    expect(listHelp.stderr).toContain("$ prisma-cli project list --json");

    expect(showHelp.exitCode).toBe(0);
    expect(showHelp.stderr).toContain("Show the Prisma project linked to this directory");
    expect(showHelp.stderr).toContain("$ prisma-cli project show");
    expect(showHelp.stderr).toContain("$ prisma-cli project show --json");

    expect(linkHelp.exitCode).toBe(0);
    expect(linkHelp.stderr).toContain("Link this directory to a Prisma project");
    expect(linkHelp.stderr).toContain("$ prisma-cli project link");
    expect(linkHelp.stderr).toContain("$ prisma-cli project link proj_123");
  });
});
