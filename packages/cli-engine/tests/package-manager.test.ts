/**
 * D1: the engine's own package-manager detection and the single table
 * that spells every command line it will run. Detection runs against
 * real temporary directories, one case per precedence step, so a
 * behavior change in package-manager-detector is caught here.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  installCommand,
  type PackageManagerCommand,
  type PackageManagerId,
  resolvePackageManager,
  runCommand,
} from "../src/package-manager";

const USER_AGENT = "npm_config_user_agent";

describe("resolvePackageManager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "engine-pm-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  test("the caller's override beats the host and the project", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    expect(
      await resolvePackageManager({ cwd: dir, override: "bun", host: "yarn" }),
    ).toBe("bun");
  });

  test("the host's choice beats the project", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    expect(await resolvePackageManager({ cwd: dir, host: "yarn" })).toBe(
      "yarn",
    );
  });

  test("a lockfile in cwd names the manager", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    expect(await resolvePackageManager({ cwd: dir })).toBe("pnpm");
  });

  test("a lockfile in an ancestor directory names the manager", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    const child = join(dir, "packages", "app");
    await mkdir(child, { recursive: true });
    vi.stubEnv(USER_AGENT, "yarn/4.0.0 npm/? node/v24.0.0 darwin arm64");

    expect(await resolvePackageManager({ cwd: child })).toBe("pnpm");
  });

  test("a packageManager field beats a lockfile in the same directory", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ packageManager: "bun@1.2.0" }),
    );

    expect(await resolvePackageManager({ cwd: dir })).toBe("bun");
  });

  test("the invoking manager's user agent is used when the directory has no project", async () => {
    vi.stubEnv(USER_AGENT, "pnpm/9.7.0 npm/? node/v24.0.0 darwin arm64");

    expect(await resolvePackageManager({ cwd: dir })).toBe("pnpm");
  });

  test("npm is the answer when nothing matches", async () => {
    vi.stubEnv(USER_AGENT, undefined);

    expect(await resolvePackageManager({ cwd: dir })).toBe("npm");
  });
});

const PACKAGES = ["prisma@latest", "@prisma/client"];

interface SpellingCase extends PackageManagerCommand {
  readonly manager: PackageManagerId;
}

describe("installCommand", () => {
  test.each<SpellingCase>([
    {
      manager: "npm",
      file: "npm",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "npm add prisma@latest @prisma/client",
    },
    {
      manager: "pnpm",
      file: "pnpm",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "pnpm add prisma@latest @prisma/client",
    },
    {
      manager: "yarn",
      file: "yarn",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "yarn add prisma@latest @prisma/client",
    },
    {
      manager: "bun",
      file: "bun",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "bun add prisma@latest @prisma/client",
    },
    {
      manager: "deno",
      file: "deno",
      args: ["add", "npm:prisma@latest", "npm:@prisma/client"],
      line: "deno add npm:prisma@latest npm:@prisma/client",
    },
  ])("$manager adds dependencies", ({ manager, ...expected }) => {
    expect(installCommand(manager, { packages: PACKAGES })).toEqual(expected);
  });

  test.each<SpellingCase>([
    {
      manager: "npm",
      file: "npm",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "npm add -D prisma@latest @prisma/client",
    },
    {
      manager: "pnpm",
      file: "pnpm",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "pnpm add -D prisma@latest @prisma/client",
    },
    {
      manager: "yarn",
      file: "yarn",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "yarn add -D prisma@latest @prisma/client",
    },
    {
      manager: "bun",
      file: "bun",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "bun add -D prisma@latest @prisma/client",
    },
    {
      manager: "deno",
      file: "deno",
      args: ["add", "--dev", "npm:prisma@latest", "npm:@prisma/client"],
      line: "deno add --dev npm:prisma@latest npm:@prisma/client",
    },
  ])("$manager adds dev dependencies", ({ manager, ...expected }) => {
    expect(
      installCommand(manager, { packages: PACKAGES, dev: true }),
    ).toEqual(expected);
  });
});

describe("runCommand", () => {
  test.each<SpellingCase>([
    {
      manager: "npm",
      file: "npx",
      args: ["skills@latest", "add", "-y"],
      line: "npx skills@latest add -y",
    },
    {
      manager: "pnpm",
      file: "pnpm",
      args: ["dlx", "skills@latest", "add", "-y"],
      line: "pnpm dlx skills@latest add -y",
    },
    {
      manager: "yarn",
      file: "yarn",
      args: ["dlx", "skills@latest", "add", "-y"],
      line: "yarn dlx skills@latest add -y",
    },
    {
      manager: "bun",
      file: "bunx",
      args: ["skills@latest", "add", "-y"],
      line: "bunx skills@latest add -y",
    },
    {
      manager: "deno",
      file: "deno",
      args: ["run", "-A", "npm:skills@latest", "add", "-y"],
      line: "deno run -A npm:skills@latest add -y",
    },
  ])("$manager runs a package once", ({ manager, ...expected }) => {
    expect(
      runCommand(manager, { package: "skills@latest", args: ["add", "-y"] }),
    ).toEqual(expected);
  });

  test("omitted args spell the bare runner invocation", () => {
    expect(runCommand("pnpm", { package: "skills" })).toEqual({
      file: "pnpm",
      args: ["dlx", "skills"],
      line: "pnpm dlx skills",
    });
  });
});
