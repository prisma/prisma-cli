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

async function run(argv: string[]) {
  const cwd = await createTempCwd();
  const stateDir = path.join(cwd, ".state");
  await login(cwd, stateDir);
  return executeCli({ argv, cwd, stateDir, fixturePath, isTTY: false });
}

describe("git account commands", () => {
  it("lists connected and connectable accounts as JSON", async () => {
    const result = await run(["git", "account", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe("git.account.list");
    expect(envelope.result.connected).toEqual([
      {
        installationId: 555001,
        accountLogin: "acme-bot",
        accountType: "organization",
        suspended: false,
      },
    ]);
    // Two fixture rows share prisma-labs; the newest installation wins.
    expect(envelope.result.connectable).toEqual([
      { installationId: 555003, accountLogin: "prisma-labs" },
    ]);
    expect(result.stdout).toContain("git account connect prisma-labs");
  });

  it("connects an account by login", async () => {
    const result = await run([
      "git",
      "account",
      "connect",
      "prisma-labs",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe("git.account.connect");
    expect(envelope.result.account).toEqual({
      installationId: 555003,
      accountLogin: "prisma-labs",
      accountType: "organization",
      suspended: false,
    });
    expect(envelope.result.newlyInstalled).toBe(false);
  });

  it("connects by numeric installation id", async () => {
    const result = await run(["git", "account", "connect", "555003", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).result.account.accountLogin).toBe(
      "prisma-labs",
    );
  });

  it("returns the connectable options when no account is given and no TTY", async () => {
    const result = await run(["git", "account", "connect", "--json"]);

    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("GIT_ACCOUNT_REQUIRED");
    expect(envelope.error.meta.connectable).toEqual([
      { installationId: 555003, accountLogin: "prisma-labs" },
    ]);
    expect(result.stdout).toContain("git account connect prisma-labs");
  });

  it("fails with a structured error for an unknown account", async () => {
    const result = await run(["git", "account", "connect", "nope", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("GIT_ACCOUNT_NOT_FOUND");
  });
});
