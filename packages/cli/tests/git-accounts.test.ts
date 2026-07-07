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

describe("git account commands", () => {
  it("lists connected and connectable accounts as JSON", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["git", "accounts", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("git.accounts");
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
    expect(result.stdout).toContain("git connect-account prisma-labs");
  });

  it("connects a connectable account by login", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["git", "connect-account", "prisma-labs", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe("git.connect-account");
    expect(envelope.result.account).toEqual({
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
      argv: ["git", "connect-account", "555003", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result.account.accountLogin).toBe(
      "prisma-labs",
    );
  });

  it("requires an account and lists the connectable options", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["git", "connect-account", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("GIT_ACCOUNT_REQUIRED");
    expect(envelope.error.meta.connectable).toEqual([
      { installationId: 555003, accountLogin: "prisma-labs" },
    ]);
    expect(result.stdout).toContain("git connect-account prisma-labs");
  });

  it("fails with a structured error for an unknown account", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["git", "connect-account", "nope", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("GIT_ACCOUNT_NOT_FOUND");
  });

  it("prints the install URL", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await login(cwd, stateDir);
    const result = await executeCli({
      argv: ["git", "install", "--json"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result.installUrl).toContain(
      "github.com/apps/",
    );
  });
});
