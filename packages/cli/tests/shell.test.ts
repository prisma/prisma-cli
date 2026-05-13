import path from "node:path";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("shell behavior", () => {
  it("renders root help with workflow groups", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("prisma → The Prisma Developer Platform, from your terminal");
    expect(result.stderr).toContain("auth");
    expect(result.stderr).toContain("project");
    expect(result.stderr).toContain("Global options:");
    expect(result.stderr).toContain("--json");
    expect(result.stderr).toContain("--no-interactive");
    expect(result.stderr).toContain("-y, --yes");
    expect(result.stderr).not.toContain("--interactive");
    expect(result.stderr).not.toContain("--color");
    expect(result.stderr).toContain("$ prisma-cli auth login");

    const commandIndex = result.stderr.indexOf("app      Manage apps and deployments for a project");
    const descriptionIndex = result.stderr.indexOf("Deploy your app with isolated infrastructure for every branch");
    const globalOptionsIndex = result.stderr.indexOf("Global options:");
    const examplesIndex = result.stderr.indexOf("Examples:");

    expect(commandIndex).toBeGreaterThan(-1);
    expect(descriptionIndex).toBeGreaterThan(commandIndex);
    expect(globalOptionsIndex).toBeGreaterThan(descriptionIndex);
    expect(examplesIndex).toBeGreaterThan(globalOptionsIndex);
  });

  it("treats bare root and group commands as successful help output", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const rootResult = await executeCli({
      argv: [],
      cwd,
      stateDir,
      fixturePath,
    });
    const authResult = await executeCli({
      argv: ["auth"],
      cwd,
      stateDir,
      fixturePath,
    });
    const projectResult = await executeCli({
      argv: ["project"],
      cwd,
      stateDir,
      fixturePath,
    });
    const branchResult = await executeCli({
      argv: ["branch"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(rootResult.exitCode).toBe(0);
    expect(rootResult.stderr).toContain("prisma → The Prisma Developer Platform, from your terminal");

    expect(authResult.exitCode).toBe(0);
    expect(authResult.stderr).toContain("auth → Manage local authentication for the CLI");
    expect(authResult.stderr).toContain("Global options:");
    expect(authResult.stderr).toContain("--json");
    expect(authResult.stderr).toContain("--no-interactive");
    expect(authResult.stderr).not.toContain("--interactive");
    expect(authResult.stderr).not.toContain("--color");

    expect(projectResult.exitCode).toBe(0);
    expect(projectResult.stderr).toContain("project → Manage and inspect your Prisma projects");
    expect(projectResult.stderr).toContain("Global options:");

    expect(branchResult.exitCode).toBe(0);
    expect(branchResult.stderr).toContain("branch → View your active Platform branches");
    expect(branchResult.stderr).toContain("Global options:");
  });

  it("accepts global flags before the command path", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--json", "auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.whoami",
      result: {
        authenticated: false,
      },
    });
  });

  it("accepts global flags between the group and action", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "--quiet", "whoami"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("accepts non-interactive before the command path", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["--no-interactive", "project", "show"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("[AUTH_REQUIRED]");
  });

  it("shows a did-you-mean suggestion for mistyped subcommands", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "logni"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: unknown command 'logni'");
    expect(result.stderr).toContain("(Did you mean login?)");
  });

  it("suppresses successful human output in quiet mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami", "--quiet"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("omits the trace hint when --trace is enabled", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["project", "show", "--no-interactive", "--trace"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("[AUTH_REQUIRED]");
    expect(result.stderr).not.toContain("More: Re-run with --trace");
  });

  it("respects NO_COLOR in TTY mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(stripAnsi(result.stderr));
  });

  it("allows --color to force ANSI output in non-tty mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami", "--color"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toBe(stripAnsi(result.stderr));
  });
});
