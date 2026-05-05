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
    expect(result.stderr).toContain("prisma → Unified Prisma CLI.");
    expect(result.stderr).toContain("auth");
    expect(result.stderr).toContain("project");
    expect(result.stderr).toContain("$ prisma auth login");
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
    expect(rootResult.stderr).toContain("prisma → Unified Prisma CLI.");

    expect(authResult.exitCode).toBe(0);
    expect(authResult.stderr).toContain("auth → Authentication and identity commands.");

    expect(projectResult.exitCode).toBe(0);
    expect(projectResult.stderr).toContain("project → Project discovery and repo linking commands.");

    expect(branchResult.exitCode).toBe(0);
    expect(branchResult.stderr).toContain("branch → Branch context and safety commands.");
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
      argv: ["project", "link", "--no-interactive", "--trace"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("[USAGE_ERROR]");
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
