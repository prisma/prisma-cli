import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getCliVersion } from "../src/lib/version";
import {
  runUpdateDiscovery,
  selectUpdateInstruction,
  UpdateCheckStore,
} from "../src/shell/update-check";
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
    expect(result.stderr).toContain(
      `Update available: prisma-cli ${getCliVersion()} -> ${nextMajorVersion()}`,
    );
    expect(result.stderr).toContain(
      "See https://www.prisma.io/docs/orm/tools/prisma-cli for update instructions.",
    );
    expect(result.stderr.indexOf("Update available")).toBeLessThan(
      result.stderr.indexOf("auth whoami"),
    );
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
    {
      name: "quiet mode",
      argv: ["auth", "whoami", "--quiet"],
      env: {},
      isTTY: true,
      preserveCI: false,
    },
    {
      name: "CI",
      argv: ["auth", "whoami"],
      env: { CI: "1" },
      isTTY: true,
      preserveCI: true,
    },
    {
      name: "non-TTY",
      argv: ["auth", "whoami"],
      env: {},
      isTTY: false,
      preserveCI: false,
    },
    {
      name: "opt-out",
      argv: ["auth", "whoami"],
      env: { NO_UPDATE_NOTIFIER: "1" },
      isTTY: true,
      preserveCI: false,
    },
    {
      name: "version flag",
      argv: ["--version"],
      env: {},
      isTTY: true,
      preserveCI: false,
    },
  ])("suppresses cached update notices for $name", async ({
    argv,
    env,
    isTTY,
    preserveCI,
  }) => {
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
    await expect(
      access(path.join(stateDir, "update-check.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("continues with the original command result when cached update state is unreadable", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    await mkdir(updateCheckDir, { recursive: true });
    await writeFile(
      path.join(updateCheckDir, "update-check.json"),
      "{not json",
      "utf8",
    );

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stderr).toContain("auth whoami");
    expect(await readUpdateCheckState(updateCheckDir)).toMatchObject({
      packageName: "@prisma/cli",
      installedVersion: getCliVersion(),
    });
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

  it("records a remote discovery attempt without printing a notice in the same invocation", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();

    const result = await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });
    const state = await readUpdateCheckState(updateCheckDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Update available");
    expect(state).toMatchObject({
      packageName: "@prisma/cli",
      installedVersion: getCliVersion(),
    });
    expect(state.checkedAt).toEqual(expect.any(String));
  });

  it("does not record remote discovery attempts for suppressed invocations", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();

    await executeCli({
      argv: ["--json", "auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    await expect(
      access(path.join(updateCheckDir, "update-check.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips remote discovery attempts inside the 24-hour interval", async () => {
    const { cwd, stateDir, updateCheckDir } = await createUpdateCheckTestDirs();
    const checkedAt = new Date().toISOString();
    await new UpdateCheckStore(updateCheckDir).write({
      packageName: "@prisma/cli",
      installedVersion: getCliVersion(),
      checkedAt,
    });

    await executeCli({
      argv: ["auth", "whoami"],
      cwd,
      stateDir,
      fixturePath,
      isTTY: true,
      env: enableUpdateCheck(updateCheckDir),
    });

    expect((await readUpdateCheckState(updateCheckDir)).checkedAt).toBe(
      checkedAt,
    );
  });

  it("persists successful remote discovery results from injected registry metadata", async () => {
    const { updateCheckDir } = await createUpdateCheckTestDirs();

    await runUpdateDiscovery({
      cacheDir: updateCheckDir,
      installedVersion: getCliVersion(),
      now: new Date("2026-01-02T00:00:00.000Z"),
      fetchImpl: async () =>
        Response.json({ "dist-tags": { latest: "9.8.7" } }),
    });

    expect(await readUpdateCheckState(updateCheckDir)).toMatchObject({
      packageName: "@prisma/cli",
      installedVersion: getCliVersion(),
      latestVersion: "9.8.7",
      checkedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("preserves notification throttling when remote discovery succeeds", async () => {
    const { updateCheckDir } = await createUpdateCheckTestDirs();
    await new UpdateCheckStore(updateCheckDir).write({
      packageName: "@prisma/cli",
      installedVersion: getCliVersion(),
      latestVersion: "9.8.6",
      checkedAt: "2026-01-01T00:00:00.000Z",
      notifiedAt: "2026-01-01T01:00:00.000Z",
    });

    await runUpdateDiscovery({
      cacheDir: updateCheckDir,
      installedVersion: getCliVersion(),
      now: new Date("2026-01-02T00:00:00.000Z"),
      fetchImpl: async () =>
        Response.json({ "dist-tags": { latest: "9.8.7" } }),
    });

    expect(await readUpdateCheckState(updateCheckDir)).toMatchObject({
      latestVersion: "9.8.7",
      checkedAt: "2026-01-02T00:00:00.000Z",
      notifiedAt: "2026-01-01T01:00:00.000Z",
    });
  });

  it("ignores failed remote discovery without surfacing errors", async () => {
    const { updateCheckDir } = await createUpdateCheckTestDirs();

    await expect(
      runUpdateDiscovery({
        cacheDir: updateCheckDir,
        installedVersion: getCliVersion(),
        fetchImpl: async () => {
          throw new Error("network down");
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(updateCheckDir, "update-check.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    {
      name: "local npm",
      env: { npm_config_user_agent: "npm/10.9.0 node/v24.14.1 darwin arm64" },
      argv: ["node", "/repo/node_modules/.bin/prisma-cli"],
      expected: {
        type: "command",
        value: "npm install --save-dev @prisma/cli@latest",
      },
    },
    {
      name: "global npm",
      env: {
        npm_config_user_agent: "npm/10.9.0 node/v24.14.1 darwin arm64",
        npm_config_global: "true",
      },
      argv: ["node", "/usr/local/bin/prisma-cli"],
      expected: {
        type: "command",
        value: "npm install --global @prisma/cli@latest",
      },
    },
    {
      name: "local pnpm",
      env: {
        npm_config_user_agent: "pnpm/10.30.0 npm/? node/v24.14.1 darwin arm64",
      },
      argv: ["node", "/repo/node_modules/.bin/prisma-cli"],
      expected: { type: "command", value: "pnpm add -D @prisma/cli@latest" },
    },
    {
      name: "local bun",
      env: {
        npm_config_user_agent: "bun/1.3.0 npm/? node/v24.14.1 darwin arm64",
      },
      argv: ["node", "/repo/node_modules/.bin/prisma-cli"],
      expected: { type: "command", value: "bun add -d @prisma/cli@latest" },
    },
    {
      name: "npx",
      env: { npm_lifecycle_event: "npx" },
      argv: ["node", "/Users/alice/.npm/_npx/123/node_modules/.bin/prisma-cli"],
      expected: {
        type: "docs",
        value: "https://www.prisma.io/docs/orm/tools/prisma-cli",
      },
    },
    {
      name: "pnpx",
      env: {
        npm_lifecycle_event: "pnpx",
        npm_config_user_agent: "pnpm/10.30.0",
      },
      argv: ["node", "/repo/node_modules/.bin/prisma-cli"],
      expected: {
        type: "docs",
        value: "https://www.prisma.io/docs/orm/tools/prisma-cli",
      },
    },
    {
      name: "bunx",
      env: { npm_config_user_agent: "bun/1.3.0" },
      argv: ["node", "/Users/alice/.bun/install/cache/@prisma/cli/prisma-cli"],
      expected: {
        type: "docs",
        value: "https://www.prisma.io/docs/orm/tools/prisma-cli",
      },
    },
    {
      name: "unknown",
      env: {},
      argv: ["node", "/some/path/prisma-cli"],
      expected: {
        type: "docs",
        value: "https://www.prisma.io/docs/orm/tools/prisma-cli",
      },
    },
  ])("selects update instructions for $name", ({ env, argv, expected }) => {
    expect(selectUpdateInstruction(env, argv)).toEqual(expected);
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

async function readUpdateCheckState(updateCheckDir: string) {
  return JSON.parse(
    await readFile(path.join(updateCheckDir, "update-check.json"), "utf8"),
  ) as Record<string, unknown>;
}

function nextMajorVersion(): string {
  const [major] = getCliVersion().split(".");
  return `${Number(major) + 1}.0.0`;
}
