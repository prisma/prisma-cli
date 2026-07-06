import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

async function login(cwd: string, stateDir: string) {
  await executeCli({
    argv: [
      "auth",
      "login",
      "--provider",
      "github",
      "--user",
      "usr_123",
      "--workspace",
      "ws_123",
    ],
    cwd,
    stateDir,
    fixturePath,
  });
}

describe("github commands", () => {
  it("lists connected and connectable accounts as JSON", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["github", "list", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("github.list");
    expect(envelope.result.connected).toEqual([
      {
        installationId: 555001,
        accountLogin: "acme-bot",
        accountType: "organization",
        suspended: false,
      },
    ]);
    // Two fixture rows share the prisma-labs account; the newest wins.
    expect(envelope.result.connectable).toEqual([
      { installationId: 555003, accountLogin: "prisma-labs" },
    ]);
    expect(envelope.nextSteps.join(" ")).toContain(
      "github connect prisma-labs",
    );
  });

  it("connects a connectable account by login and drops it from connectable", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["github", "connect", "prisma-labs", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("github.connect");
    expect(envelope.result.installation).toEqual({
      installationId: 555003,
      accountLogin: "prisma-labs",
      accountType: "organization",
      suspended: false,
    });
  });

  it("connects by numeric installation id", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["github", "connect", "555003", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result.installation.accountLogin).toBe(
      "prisma-labs",
    );
  });

  it("requires an account argument and lists the connectable options", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["github", "connect", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("GITHUB_ACCOUNT_REQUIRED");
    expect(envelope.error.meta.connectable).toEqual([
      { installationId: 555003, accountLogin: "prisma-labs" },
    ]);
    expect(result.stdout).toContain("github connect prisma-labs");
  });

  it("fails with a structured error for an unknown account", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["github", "connect", "nope", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error.code).toBe("GITHUB_ACCOUNT_NOT_FOUND");
    expect(envelope.error.meta.connectable).toEqual([
      { installationId: 555003, accountLogin: "prisma-labs" },
    ]);
  });

  it("prints the install URL", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["github", "install", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.result.installUrl).toContain("github.com/apps/");
  });
});
