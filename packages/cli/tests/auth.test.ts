import path from "node:path";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";

import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("auth commands", () => {
  it("shows the signed-out empty state for whoami", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "auth whoami → Showing the current authenticated identity.\n\n│  status:  signed out\n",
    );
  });

  it("logs in with mock selectors and returns the documented human output", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "auth login → Starting an authenticated CLI session.\n\n│  provider:   GitHub\n│  user:       bob@example.com\n│  workspace:  Acme Inc\n\n◇ Applying authentication session changes...\n✔ Applied 1 operation(s)\n  Session stored in local CLI state.\n",
    );
  });

  it("returns the stable signed-in JSON shape for whoami", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    await executeCli({
      argv: ["auth", "login", "--provider", "github", "--user", "usr_456"],
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "auth.whoami",
      result: {
        authenticated: true,
        provider: "github",
        user: {
          id: "usr_456",
          email: "bob@example.com",
          name: "Bob Example",
        },
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        credential: {
          type: "oauth",
          id: null,
          name: null,
        },
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
  });

  it("returns a structured usage error for non-interactive login without selectors", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "login", "--json"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      command: "auth.login",
      error: {
        code: "USAGE_ERROR",
        domain: "auth",
        severity: "error",
        summary: "Login requires explicit selectors in non-interactive mode",
        why: "The fixture mode cannot prompt in the current mode.",
        fix: "Re-run prisma-cli auth login in a TTY, or provide --provider and --user, and --workspace when required.",
        where: null,
        meta: {},
        docsUrl: null,
      },
      warnings: [],
      nextSteps: ["prisma-cli auth login"],
      nextActions: [],
    });
  });

  it("shows the documented help text for auth login", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "login", "--help"],
      cwd,
      stateDir,
      fixturePath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Log in to your Prisma platform account");
    expect(result.stderr).toContain("│  Examples:");
    expect(result.stderr).toContain("$ prisma-cli auth login");
    expect(result.stderr).not.toContain("Read more");
    expect(result.stderr).not.toContain("--provider");
    expect(result.stderr).not.toContain("--user");
    expect(result.stderr).not.toContain("--workspace");
  });

  it("renders the TTY header block for auth whoami", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
    });

    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("auth whoami → Showing the current authenticated identity.");
    expect(stderr).not.toContain("Read more");
    expect(stderr).toContain("status:  signed out");
  });
});
