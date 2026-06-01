import path from "node:path";
import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { getCliVersion } from "../src/lib/version";
import { UpdateCheckStore } from "../src/shell/update-check";
import { createTempCwd, executeCli } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("automatic update check", () => {
  it("prints a cached update notice to stderr before eligible command output", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await seedStaleUpdate(updateCheckDir);

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Update available: prisma-cli ${getCliVersion()} -> ${nextMajorVersion()}`);
    expect(result.stderr).toContain("See https://prisma.io/docs for update instructions.");
    expect(result.stderr.indexOf("Update available")).toBeLessThan(result.stderr.indexOf("auth whoami"));
  });

  it("continues with the original command result when the command fails", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await seedStaleUpdate(updateCheckDir);

    const result = await executeCli({
      argv: ["project", "show", "--no-interactive"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Update available:");
    expect(result.stderr).toContain("[AUTH_REQUIRED]");
  });

  it("does not write update notices to stdout for JSON output", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await seedStaleUpdate(updateCheckDir);

    const result = await executeCli({
      argv: ["--json", "auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("Update available");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.whoami",
    });
  });

  it.each([
    { name: "quiet mode", argv: ["auth", "whoami", "--quiet"], env: {}, isTTY: true, preserveCI: false },
    { name: "CI", argv: ["auth", "whoami"], env: { CI: "1" }, isTTY: true, preserveCI: true },
    { name: "non-TTY", argv: ["auth", "whoami"], env: {}, isTTY: false, preserveCI: false },
    { name: "opt-out", argv: ["auth", "whoami"], env: { NO_UPDATE_NOTIFIER: "1" }, isTTY: true, preserveCI: false },
    { name: "version flag", argv: ["--version"], env: {}, isTTY: true, preserveCI: false },
  ])("suppresses cached update notices for $name", async ({ argv, env, isTTY, preserveCI }) => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await seedStaleUpdate(updateCheckDir);

    const result = await executeCli({
      argv,
      cwd,
      stateDir,
      fixturePath,
      isTTY,
      preserveCI,
      env: {
        ...enableUpdateCheck(updateCheckDir),
        ...env,
      },
    });

    expect(result.stderr).not.toContain("Update available");
    expect(result.stdout).not.toContain("Update available");
  });

  it("does not read update check state from project-local CLI state", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await seedStaleUpdate(updateCheckDir);

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    expect(result.stderr).toContain("Update available");
    await expect(access(path.join(stateDir, "update-check.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not show the same cached update notice again inside the notification interval", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await seedStaleUpdate(updateCheckDir);
    const env = enableUpdateCheck(updateCheckDir);

    const first = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env,
    });
    const second = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env,
    });

    expect(first.stderr).toContain("Update available");
    expect(second.stderr).not.toContain("Update available");
  });
});

async function createUpdateCheckTestDirs() {
  const cwd = await createTempCwd();
  return {
    cwd,
    stateDir: path.join(cwd, ".state"),
    updateCheckDir: path.join(cwd, ".update-check"),
  };
}

function enableUpdateCheck(updateCheckDir: string): NodeJS.ProcessEnv {
  return {
    PRISMA_CLI_TEST_ENABLE_UPDATE_CHECK: "1",
    PRISMA_CLI_UPDATE_CHECK_DIR: updateCheckDir,
  };
}

async function seedStaleUpdate(updateCheckDir: string): Promise<void> {
  await new UpdateCheckStore(updateCheckDir).write({
    packageName: "@prisma/cli",
    installedVersion: getCliVersion(),
    latestVersion: nextMajorVersion(),
    checkedAt: new Date().toISOString(),
  });
}

function nextMajorVersion(): string {
  const [major] = getCliVersion().split(".");
  return `${Number(major) + 1}.0.0`;
}
