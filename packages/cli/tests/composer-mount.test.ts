/**
 * Composer's commands, mounted at the paths this shell gives them, run
 * against Composer's operations double: what is proven is the mount and
 * what a pipe receives, not Composer's dev logic, which Composer's own
 * integration tests run against real emulators.
 */
import { createTestCli } from "@prisma/cli-engine/testing";
import { defineConfig as composer } from "@prisma/composer/config";
import { nodeBuild } from "@prisma/composer/node/control";
import { createComposerFamily } from "@prisma/composer-cli/family";
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

const NO_EMULATORS = {
  ok: true as const,
  value: { emulators: [] },
  assertOk() {
    return this.value;
  },
  assertNotOk(): never {
    throw new Error("the listing succeeded");
  },
};

const COMPOSER_PATHS = ["dev", "dev url", "dev stop", "emulator list"];

function shell() {
  const family = createComposerFamily({
    operations: createOperationsDouble().operations,
    listEmulators: async () => NO_EMULATORS,
  });
  const commands = Object.fromEntries(
    COMPOSER_PATHS.map((path) => [path, family.commands[path]]),
  );
  return createTestCli({
    commandFamilies: [family],
    commands,
    groups: { dev: cliGroups.dev, emulator: cliGroups.emulator },
    config: { composer: COMPOSER_SECTION },
    now: () => new Date(0),
  });
}

describe("Composer's commands in the shell", () => {
  it("mounts Composer's dev children and emulator list where the shell says", () => {
    for (const path of COMPOSER_PATHS) {
      expect(mountedCommands[path], path).toBeDefined();
    }
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

  it("lists emulators", async () => {
    const result = await shell().run(["emulator", "list"]);

    expect(result.exitCode).toBe(0);
  });

  it("shows dev's own help with its children listed", async () => {
    const result = await shell().run(["dev", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prisma-test dev");
    expect(result.stdout).toContain("url <address>");
    expect(result.stdout).toContain("stop");
  });
});
