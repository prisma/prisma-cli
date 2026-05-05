import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { createTempCwd, executeCli, readPrismaConfig, writePrismaConfig } from "./helpers";
import { DEFAULT_STATE_DIR_NAME } from "../src/shell/runtime";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("branch commands", () => {
  it("returns FEATURE_UNAVAILABLE for branch list in preview mode instead of crashing", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "list", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "branch.list",
      error: {
        code: "FEATURE_UNAVAILABLE",
        domain: "branch",
        severity: "error",
        summary: "Branch commands are not available in this preview",
        why: "The current preview cannot resolve or change remote branch context yet.",
        fix: "Use prisma app deploy for preview app deployment workflows.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma app deploy --app <name>"],
    });
  });

  it("returns FEATURE_UNAVAILABLE for branch show in preview mode instead of crashing", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "show", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "branch.show",
      error: {
        code: "FEATURE_UNAVAILABLE",
        domain: "branch",
        severity: "error",
        summary: "Branch commands are not available in this preview",
        why: "The current preview cannot resolve or change remote branch context yet.",
        fix: "Use prisma app deploy for preview app deployment workflows.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma app deploy --app <name>"],
    });
  });

  it("returns FEATURE_UNAVAILABLE for branch use in preview mode instead of crashing", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "use", "preview", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "branch.use",
      error: {
        code: "FEATURE_UNAVAILABLE",
        domain: "branch",
        severity: "error",
        summary: "Branch commands are not available in this preview",
        why: "The current preview cannot resolve or change remote branch context yet.",
        fix: "Use prisma app deploy for preview app deployment workflows.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma app deploy --app <name>"],
    });
  });

  it("renders the documented human output for branch list", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["branch", "list"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stripAnsi(result.stderr)).toBe(
      "branch list → Listing branches for the linked project.\n\n│  project:   Acme Dashboard\n│  ⚬ branch:  production\n│  ⚬ branch:  pr-123\n│  ⚬ branch:  preview (active)\n│  ⚬ branch:  staging\n│\n│  Read more  docs/product/command-spec.md#prisma-branch-list\n",
    );
  });

  it("shows the default preview branch context before remote state exists", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "show"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stripAnsi(result.stderr)).toBe(
      "branch show → Showing the current active branch context.\n\n│  project:       not linked\n│  branch:        preview\n│  kind:          preview\n│  remote state:  not created yet\n│\n│  Read more      docs/product/command-spec.md#prisma-branch-show\n",
    );
  });

  it("shows remote branch status and url without leaking deployment ids in human output", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    await executeCli({
      argv: ["branch", "use", "preview"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["branch", "show"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("branch show → Showing the current active branch context.");
    expect(stderr).toContain("project:   Acme Dashboard");
    expect(stderr).toContain("branch:    preview");
    expect(stderr).toContain("status:    ready");
    expect(stderr).toContain("url:       https://preview.acme-dashboard.prisma.app");
    expect(stderr).not.toContain("dep_123");
  });

  it("returns the shared list JSON shape for branch list", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["branch", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "branch.list",
      result: {
        context: {
          project: "Acme Dashboard",
        },
        items: [
          {
            id: "br_456",
            name: "production",
            status: null,
          },
          {
            id: "br_234",
            name: "pr-123",
            status: null,
          },
          {
            id: "br_123",
            name: "preview",
            status: "active",
          },
          {
            id: "br_345",
            name: "staging",
            status: null,
          },
        ],
        count: 4,
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("returns the documented JSON shape for branch show when remote state exists", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    await executeCli({
      argv: ["branch", "use", "preview"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["branch", "show", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "branch.show",
      result: {
        linkedProjectId: "proj_123",
        projectName: "Acme Dashboard",
        branch: {
          name: "preview",
          kind: "preview",
          active: true,
          remoteState: true,
          liveDeployment: {
            id: "dep_123",
            status: "ready",
            url: "https://preview.acme-dashboard.prisma.app",
          },
        },
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("returns the documented JSON shape for branch use production", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["branch", "use", "production", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "branch.use",
      result: {
        linkedProjectId: "proj_123",
        projectName: "Acme Dashboard",
        branch: {
          name: "production",
          kind: "production",
          active: true,
          remoteState: true,
          liveDeployment: {
            id: "dep_456",
            status: "ready",
            url: "https://acme-dashboard.prisma.app",
          },
        },
      },
      warnings: ["Production is protected and durable. Use with care."],
      nextSteps: ["prisma branch show"],
    });
  });

  it("prompts for branch selection when no name is passed in interactive mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");

    const result = await executeCli({
      argv: ["branch", "use"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      stdinText: "\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stderr).toContain("branch use → Changing the local default branch context.");
    expect(stderr).toContain("Select a branch");
    expect(stderr).toContain("production");
    expect(stderr).toContain("pr-123");
    expect(stderr).toContain("preview (active)");
    expect(stderr).toContain("staging");
    expect(stderr).toContain("✔ Applied 1 operation(s)");
    expect(stderr).toContain("branch:    production");
    expect(JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"))).toMatchObject({
      branch: {
        active: "production",
      },
    });
  });

  it("returns a structured usage error for an invalid branch name", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "use", "Preview Space", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "branch.use",
      error: {
        code: "USAGE_ERROR",
        domain: "branch",
        severity: "error",
        summary: "Branch name must use the documented form",
        why: "Branch names must be production or a lowercase preview slug such as preview or feat-auth.",
        fix: "Use production or a lowercase preview branch name with letters, numbers, and hyphens.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma branch list"],
    });
  });

  it("returns a structured usage error for branch use in JSON mode when no name is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "use", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "branch.use",
      error: {
        code: "USAGE_ERROR",
        domain: "branch",
        severity: "error",
        summary: "Branch use requires a target in non-interactive mode",
        why: "This command cannot prompt for branch selection in the current mode.",
        fix: "Re-run prisma branch use in a TTY, or pass a branch name explicitly.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma branch list"],
    });
  });

  it("returns a structured usage error for branch use with --no-interactive when no name is passed", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["branch", "use", "--no-interactive", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "branch.use",
      error: {
        code: "USAGE_ERROR",
        domain: "branch",
        severity: "error",
        summary: "Branch use requires a target in non-interactive mode",
        why: "This command cannot prompt for branch selection in the current mode.",
        fix: "Re-run prisma branch use in a TTY, or pass a branch name explicitly.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma branch list"],
    });
  });

  it("shows the documented help text for branch commands and adds branch to root help", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const rootHelp = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const branchHelp = await executeCli({
      argv: ["branch", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const listHelp = await executeCli({
      argv: ["branch", "list", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const showHelp = await executeCli({
      argv: ["branch", "show", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const useHelp = await executeCli({
      argv: ["branch", "use", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(rootHelp.exitCode).toBe(0);
    expect(rootHelp.stderr).toContain("branch");

    expect(branchHelp.exitCode).toBe(0);
    expect(branchHelp.stderr).toContain("Branch context and safety commands.");
    expect(branchHelp.stderr).toContain("$ prisma branch list");
    expect(branchHelp.stderr).toContain("$ prisma branch use production");

    expect(listHelp.exitCode).toBe(0);
    expect(listHelp.stderr).toContain("List branches for the linked project.");
    expect(listHelp.stderr).toContain("$ prisma branch list");
    expect(listHelp.stderr).toContain("$ prisma branch list --json");

    expect(showHelp.exitCode).toBe(0);
    expect(showHelp.stderr).toContain("Show the current active branch context.");
    expect(showHelp.stderr).toContain("$ prisma branch show");
    expect(showHelp.stderr).toContain("$ prisma branch show --json");

    expect(useHelp.exitCode).toBe(0);
    expect(useHelp.stderr).toContain("Change the local default branch context.");
    expect(useHelp.stderr).toContain("$ prisma branch use");
    expect(useHelp.stderr).toContain("$ prisma branch use production");
  });

  it("writes only local branch state and does not mutate config or fixture data", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writePrismaConfig(cwd, "proj_123");
    const fixtureBefore = await readFile(fixturePath, "utf8");

    const result = await executeCli({
      argv: ["branch", "use", "feat-auth"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"))).toMatchObject({
      branch: {
        active: "feat-auth",
      },
    });
    expect(await readPrismaConfig(cwd)).toContain('project: "proj_123"');
    expect(await readFile(fixturePath, "utf8")).toBe(fixtureBefore);
  });

  it("uses .prisma/cli/state.json as the default local state location", async () => {
    const cwd = await createTempCwd();

    const result = await executeCli({
      argv: ["branch", "use", "feat-auth"],
      cwd,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(path.join(cwd, DEFAULT_STATE_DIR_NAME, "state.json"), "utf8")),
    ).toMatchObject({
      branch: {
        active: "feat-auth",
      },
    });
    expect(stripAnsi(result.stderr)).toContain("Active branch updated in local CLI state for this repo.");
  });
});
