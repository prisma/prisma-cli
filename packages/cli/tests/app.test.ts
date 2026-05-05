import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("app commands", () => {
  it("shows the documented help text for app commands and adds app to root help", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const rootHelp = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const appHelp = await executeCli({
      argv: ["app", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const buildHelp = await executeCli({
      argv: ["app", "build", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const runHelp = await executeCli({
      argv: ["app", "run", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const deployHelp = await executeCli({
      argv: ["app", "deploy", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const updateEnvHelp = await executeCli({
      argv: ["app", "update-env", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const listEnvHelp = await executeCli({
      argv: ["app", "list-env", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const showHelp = await executeCli({
      argv: ["app", "show", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const openHelp = await executeCli({
      argv: ["app", "open", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const listDeploysHelp = await executeCli({
      argv: ["app", "list-deploys", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const showDeployHelp = await executeCli({
      argv: ["app", "show-deploy", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const promoteHelp = await executeCli({
      argv: ["app", "promote", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const rollbackHelp = await executeCli({
      argv: ["app", "rollback", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });
    const removeHelp = await executeCli({
      argv: ["app", "remove", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(rootHelp.exitCode).toBe(0);
    expect(rootHelp.stderr).toContain("app");

    expect(appHelp.exitCode).toBe(0);
    expect(appHelp.stderr).toContain("App deployment and release commands.");
    expect(appHelp.stderr).toContain("$ prisma app build --build-type nextjs");
    expect(appHelp.stderr).toContain("$ prisma app deploy --app hello-world --build-type nextjs --http-port 3000");

    expect(buildHelp.exitCode).toBe(0);
    expect(buildHelp.stderr).toContain("Build the local app into a deployable artifact.");
    expect(buildHelp.stderr).toContain("$ prisma app build --build-type nextjs");

    expect(runHelp.exitCode).toBe(0);
    expect(runHelp.stderr).toContain("Start a local framework dev server.");
    expect(runHelp.stderr).toContain("$ prisma app run --build-type nextjs");

    expect(deployHelp.exitCode).toBe(0);
    expect(deployHelp.stderr).toContain("Build and release the selected app.");
    expect(deployHelp.stderr).toContain("$ prisma app deploy");
    expect(deployHelp.stderr).toContain("$ prisma app deploy --app hello-world --build-type nextjs --http-port 3000");
    expect(deployHelp.stderr).toContain("--entry <path>");
    expect(deployHelp.stderr).toContain("--build-type <type>");
    expect(deployHelp.stderr).toContain("--http-port <port>");
    expect(deployHelp.stderr).toContain("--env <name=value>");

    expect(updateEnvHelp.exitCode).toBe(0);
    expect(updateEnvHelp.stderr).toContain("Create a new deployment with updated environment variables.");
    expect(updateEnvHelp.stderr).toContain("$ prisma app update-env --env DATABASE_URL=postgresql://example");

    expect(listEnvHelp.exitCode).toBe(0);
    expect(listEnvHelp.stderr).toContain("List environment variable names for the selected app.");
    expect(listEnvHelp.stderr).toContain("$ prisma app list-env");

    expect(showHelp.exitCode).toBe(0);
    expect(showHelp.stderr).toContain("Show the current state of the selected app.");
    expect(showHelp.stderr).toContain("$ prisma app show");

    expect(openHelp.exitCode).toBe(0);
    expect(openHelp.stderr).toContain("Open the live URL for the selected app.");
    expect(openHelp.stderr).toContain("$ prisma app open");

    expect(listDeploysHelp.exitCode).toBe(0);
    expect(listDeploysHelp.stderr).toContain("List deployments for the selected app.");
    expect(listDeploysHelp.stderr).toContain("$ prisma app list-deploys");

    expect(showDeployHelp.exitCode).toBe(0);
    expect(showDeployHelp.stderr).toContain("Show one deployment in detail.");
    expect(showDeployHelp.stderr).toContain("$ prisma app show-deploy dep_123");

    expect(promoteHelp.exitCode).toBe(0);
    expect(promoteHelp.stderr).toContain("Switch the live deployment for the selected app.");
    expect(promoteHelp.stderr).toContain("$ prisma app promote dep_123");

    expect(rollbackHelp.exitCode).toBe(0);
    expect(rollbackHelp.stderr).toContain("Restore the selected app to an earlier deployment.");
    expect(rollbackHelp.stderr).toContain("$ prisma app rollback");

    expect(removeHelp.exitCode).toBe(0);
    expect(removeHelp.stderr).toContain("Remove the selected app from the linked project.");
    expect(removeHelp.stderr).toContain("$ prisma app remove --app hello-world");
  });
});
