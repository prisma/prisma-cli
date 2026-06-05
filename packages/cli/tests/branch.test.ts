import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { getCommandDescriptor } from "../src/shell/command-meta";
import { renderBranchList } from "../src/presenters/branch";
import { createTempCwd, createTestCommandContext, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function rememberProject(stateDir: string, projectId = "proj_123") {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "state.json"),
    `${JSON.stringify(
      {
        auth: null,
        project: {
          rememberedByWorkspace: {
            ws_123: {
              id: projectId,
              name: projectId === "proj_123" ? "Acme Dashboard" : projectId,
              workspaceId: "ws_123",
            },
          },
          lastResolved: {
            id: projectId,
            name: projectId === "proj_123" ? "Acme Dashboard" : projectId,
            workspaceId: "ws_123",
          },
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

describe("branch commands", () => {
  it("renders branch list with name, role, and env map", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await rememberProject(stateDir);

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
      "branch list → Listing branches for the resolved project.\n\n│  project:  Acme Dashboard\n│\n│  Name         Role         Env map\n│  production   production   production\n│  pr-123       preview      preview\n│  preview      preview      preview\n│  staging      preview      preview\n",
    );
  });

  it("renders resolved context for an empty verbose branch list", async () => {
    const { context } = await createTestCommandContext({
      argv: ["branch", "list", "--verbose"],
      flags: { verbose: true },
    });

    const output = stripAnsi(renderBranchList(
      context,
      getCommandDescriptor("branch.list"),
      {
        projectId: "proj_empty",
        projectName: "Empty Project",
        branches: [],
        verboseContext: {
          workspace: {
            id: "ws_123",
            name: "Acme Inc",
          },
          project: {
            id: "proj_empty",
            name: "Empty Project",
          },
          resolution: {
            projectSource: "explicit",
          },
        },
      },
    ).join("\n"));

    expect(output).toContain("No branches found.");
    expect(output).toContain("Resolved context:");
    expect(output).toContain("workspace:       Acme Inc");
    expect(output).toContain("project source:  --project");
  });

  it("returns the direct branch list JSON shape", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await rememberProject(stateDir);

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
      nextActions: [],
      result: {
        projectId: "proj_123",
        projectName: "Acme Dashboard",
        branches: [
          { id: "br_456", name: "production", role: "production", envMap: "production" },
          { id: "br_234", name: "pr-123", role: "preview", envMap: "preview" },
          { id: "br_123", name: "preview", role: "preview", envMap: "preview" },
          { id: "br_345", name: "staging", role: "preview", envMap: "preview" },
        ],
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("shows only branch list in branch help", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

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

    expect(branchHelp.exitCode).toBe(0);
    expect(branchHelp.stderr).toContain("View your Platform branches");
    expect(branchHelp.stderr).toContain("$ prisma-cli branch list");
    expect(branchHelp.stderr).not.toContain("branch show");
    expect(branchHelp.stderr).not.toContain("branch use");

    expect(listHelp.exitCode).toBe(0);
    expect(listHelp.stderr).toContain("List Platform branches for the resolved project");
    expect(listHelp.stderr).toContain("$ prisma-cli branch list");
    expect(listHelp.stderr).toContain("$ prisma-cli branch list --json");
  });
});
