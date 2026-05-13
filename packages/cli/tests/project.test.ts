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

  it("shows Public Beta project help without project link", async () => {
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
    const stderr = stripAnsi(`${projectHelp.stderr}\n${showHelp.stderr}`);

    expect(projectHelp.exitCode).toBe(0);
    expect(stderr).toContain("project → Manage and inspect your Prisma projects");
    expect(stderr).toContain("Show which project is active for this directory");
    expect(stderr).not.toContain("project link");
    expect(stderr).not.toContain("linked project");
  });
});
