/**
 * Composer's commands, mounted at the paths this shell gives them, run
 * against Composer's operations double: what is proven is the mount and
 * what a pipe receives, not Composer's dev logic, which Composer's own
 * integration tests run against real emulators.
 */
import { createTestCli, mintTestJwt } from "@prisma/cli-engine/testing";
import { defineConfig as composer } from "@prisma/composer/config";
import { nodeBuild } from "@prisma/composer/node/control";
import {
  createComposerFamily,
  type DeployedNode,
  type ListDeployed,
  type ListEmulators,
} from "@prisma/composer-cli/family";
import { createOperationsDouble } from "@prisma/composer-cli/testing";
import { describe, expect, it } from "vitest";
import { cliGroups, mountedCommands } from "../src/cli";

const build = nodeBuild();

const COMPOSER_SECTION = composer({
  extensions: [build],
  state: {
    extension: build.id,
    create: () => {
      throw new Error("no command in these tests reaches the state store");
    },
  },
});

type Listing = Awaited<ReturnType<ListEmulators>>;

function listing(emulators: readonly EmulatorListing[]): Listing {
  const value = { emulators };
  return {
    ok: true as const,
    value,
    assertOk: () => value,
    assertNotOk: (): never => {
      throw new Error("the listing succeeded");
    },
  };
}

type EmulatorListing = Extract<
  Listing,
  { ok: true }
>["value"]["emulators"][number];

/** One running service emulator holding one instance that `prisma dev`
 *  started, and a database emulator that is not running. */
const ONE_INSTANCE = listing([
  {
    kind: "service",
    running: true,
    url: "http://localhost:4000",
    instances: [
      {
        id: "svc_gateway",
        kind: "service",
        url: "http://localhost:4001",
        state: "running",
        labels: {
          "composer.address": "gateway",
          "composer.directory": "/projects/shop",
        },
      },
    ],
    error: null,
  },
  { kind: "database", running: false, url: null, instances: [], error: null },
]);

const DEPLOYED: readonly DeployedNode[] = [
  { address: "shop", kind: "project", platformId: "proj_1", url: null },
  {
    address: "shop.api",
    kind: "service",
    platformId: "cps_1",
    url: "https://api.example.prisma.build",
  },
];

const listDeployed: ListDeployed = async () => ({
  ok: true,
  value: DEPLOYED,
  assertOk: () => DEPLOYED,
  assertNotOk: () => {
    throw new Error("listDeployed succeeded");
  },
});

const COMPOSER_PATHS = [
  "deploy list",
  "dev",
  "dev url",
  "dev stop",
  "emulator list",
];

function shell(emulators: Listing = listing([])) {
  const family = createComposerFamily({
    operations: createOperationsDouble().operations,
    listEmulators: async () => emulators,
    listDeployed,
  });
  const commands = Object.fromEntries(
    COMPOSER_PATHS.map((path) => [path, family.commands[path]]),
  );
  return createTestCli({
    commandFamilies: [family],
    commands,
    groups: {
      deploy: cliGroups.deploy,
      dev: cliGroups.dev,
      emulator: cliGroups.emulator,
    },
    config: { composer: COMPOSER_SECTION },
    sessions: [
      {
        workspaceId: "ws_1",
        workspaceName: "Acme Inc",
        credential: {
          token: mintTestJwt({ sub: "usr_1", workspace_id: "ws_1" }),
          refreshToken: undefined,
          expiresAt: undefined,
        },
      },
    ],
    selectedWorkspaceId: "ws_1",
    now: () => new Date(0),
  });
}

describe("Composer's commands in the shell", () => {
  it("mounts Composer's deploy and dev children and emulator list where the shell says", () => {
    for (const path of COMPOSER_PATHS) {
      expect(mountedCommands[path], path).toBeDefined();
    }
    expect(cliGroups.deploy).toBeDefined();
    expect(cliGroups.dev).toBeDefined();
    expect(cliGroups.emulator?.description).toContain("emulator");
  });

  it("pipes the bare URL from dev url", async () => {
    const result = await shell().run(["dev", "url", "gateway"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("http://localhost:3000\n");
  });

  it("pipes nothing from dev stop", async () => {
    const result = await shell().run(["dev", "stop"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("pipes one tab-separated line per deployed node from deploy list", async () => {
    const result = await shell().run(["deploy", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "shop\tproject\tproj_1\t\nshop.api\tservice\tcps_1\thttps://api.example.prisma.build\n",
    );
  });

  it("lists emulators", async () => {
    const result = await shell().run(["emulator", "list"]);

    expect(result.exitCode).toBe(0);
  });

  it("pipes one tab-separated line per emulator instance", async () => {
    const result = await shell(ONE_INSTANCE).run(["emulator", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "service\tsvc_gateway\thttp://localhost:4001\trunning\tgateway\t/projects/shop\n",
    );
  });

  it("shows dev's own help with its children listed", async () => {
    const result = await shell().run(["dev", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prisma-test dev");
    expect(result.stdout).toContain("url <address>");
    expect(result.stdout).toContain("stop");
  });
});
