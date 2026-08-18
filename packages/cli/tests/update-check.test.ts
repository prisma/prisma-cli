import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getCliVersion } from "../src/lib/version";
import {
  runUpdateDiscovery,
  selectUpdateInstruction,
  UpdateCheckStore,
} from "../src/update-check";
import { createTempCwd } from "./helpers";

describe("update discovery and instructions", () => {
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
        value: "https://www.prisma.io/docs",
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
        value: "https://www.prisma.io/docs",
      },
    },
    {
      name: "bunx",
      env: { npm_config_user_agent: "bun/1.3.0" },
      argv: ["node", "/Users/alice/.bun/install/cache/@prisma/cli/prisma-cli"],
      expected: {
        type: "docs",
        value: "https://www.prisma.io/docs",
      },
    },
    {
      name: "unknown",
      env: {},
      argv: ["node", "/some/path/prisma-cli"],
      expected: {
        type: "docs",
        value: "https://www.prisma.io/docs",
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

async function readUpdateCheckState(updateCheckDir: string) {
  return JSON.parse(
    await readFile(path.join(updateCheckDir, "update-check.json"), "utf8"),
  ) as Record<string, unknown>;
}
